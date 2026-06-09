import type { Core } from '@strapi/strapi';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

type ProtectedResource = 'profiles' | 'saved-addresses' | 'orders';

const RESOURCE_MAP: Record<ProtectedResource, string> = {
  profiles: 'api::profile.profile',
  'saved-addresses': 'api::saved-address.saved-address',
  orders: 'api::order.order',
};

function initFirebaseAdmin() {
  if (getApps().length > 0) return;

  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawCredentials) {
    const parsed = JSON.parse(rawCredentials) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields.');
    }

    initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, '\n'),
      }),
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
  });
}

function getProtectedResource(pathname: string) {
  const match = pathname.match(/^\/api\/(profiles|saved-addresses|orders)(?:\/(\d+))?\/?$/);
  if (!match) return null;

  return {
    resource: match[1] as ProtectedResource,
    id: match[2],
  };
}

function getBodyData(ctx: { request: { body?: { data?: Record<string, unknown> } } }) {
  ctx.request.body = ctx.request.body || {};
  ctx.request.body.data = ctx.request.body.data || {};
  return ctx.request.body.data;
}

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    if (!ctx.path.startsWith('/api/')) {
      await next();
      return;
    }

    const resourceInfo = getProtectedResource(ctx.path);
    if (!resourceInfo) {
      await next();
      return;
    }

    try {
      initFirebaseAdmin();
    } catch (error) {
      ctx.throw(500, error instanceof Error ? error.message : 'Firebase Admin is not configured');
    }

    const authHeader = ctx.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      ctx.throw(401, 'Missing Firebase authorization token');
    }

    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(token);
    } catch {
      ctx.throw(401, 'Invalid Firebase authorization token');
    }

    const firebaseUid = decoded.uid;
    ctx.state.firebaseUid = firebaseUid;

    if (ctx.method === 'GET' && !resourceInfo.id) {
      const filters = ctx.query.filters || {};
      const existingUid = filters?.firebaseUid?.$eq;
      if (existingUid && existingUid !== firebaseUid) {
        ctx.throw(403, 'You can only read your own records');
      }

      ctx.query.filters = {
        ...filters,
        firebaseUid: { $eq: firebaseUid },
      };

      await next();
      return;
    }

    if (resourceInfo.id) {
      const recordId = Number(resourceInfo.id);
      if (!Number.isInteger(recordId)) {
        ctx.throw(400, 'Invalid record id');
      }

      const record = await strapi.db.query(RESOURCE_MAP[resourceInfo.resource]).findOne({
        where: { id: recordId },
      });

      if (!record) {
        ctx.throw(404, 'Record not found');
      }

      if (record.firebaseUid !== firebaseUid) {
        ctx.throw(403, 'You can only access your own records');
      }

      if (ctx.method === 'GET') {
        await next();
        return;
      }
    }

    if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH') {
      const data = getBodyData(ctx);
      const bodyUid = data.firebaseUid as string | undefined;
      if (bodyUid && bodyUid !== firebaseUid) {
        ctx.throw(403, 'You can only modify your own records');
      }

      data.firebaseUid = firebaseUid;
    }

    await next();
  };
};
