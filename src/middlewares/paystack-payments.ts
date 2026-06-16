type PaystackInitializeResponse = {
  status?: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

type PaystackVerifyResponse = {
  status?: boolean;
  message?: string;
  data?: {
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    gateway_response?: string;
    paid_at?: string;
    channel?: string;
  };
};

function getPaystackSecretKey(ctx: any) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    ctx.throw(500, 'PAYSTACK_SECRET_KEY is not configured on the backend');
  }

  return secretKey;
}

function toKobo(amount: unknown) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return null;
  }

  return Math.round(numericAmount * 100);
}

function getExpectedKobo(ctx: any) {
  const rawAmount = ctx.query.amount;
  if (!rawAmount) return null;

  const amount = Array.isArray(rawAmount) ? rawAmount[0] : rawAmount;
  return toKobo(amount);
}

async function initializePaystackPayment(ctx: any) {
  const secretKey = getPaystackSecretKey(ctx);
  const { amount, email, callbackUrl, metadata } = ctx.request.body || {};
  const amountInKobo = toKobo(amount);

  if (!amountInKobo) {
    ctx.throw(400, 'A valid amount is required');
  }

  if (!email || typeof email !== 'string') {
    ctx.throw(400, 'A valid customer email is required');
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountInKobo,
      email,
      callback_url: callbackUrl,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    }),
  });
  const payload = (await response.json()) as PaystackInitializeResponse;

  if (!response.ok || !payload.status || !payload.data?.authorization_url || !payload.data.reference) {
    ctx.throw(response.status || 502, payload.message || 'Unable to initialize Paystack payment');
  }

  ctx.body = {
    authorizationUrl: payload.data.authorization_url,
    accessCode: payload.data.access_code,
    reference: payload.data.reference,
  };
}

async function verifyPaystackPayment(ctx: any, strapi: any) {
  const secretKey = getPaystackSecretKey(ctx);
  const reference = String(ctx.params?.reference || ctx.path.replace('/api/payments/verify/', '') || '').trim();
  if (!reference) {
    ctx.throw(400, 'Payment reference is required');
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });
  const payload = (await response.json()) as PaystackVerifyResponse;

  if (!response.ok || !payload.status || !payload.data) {
    ctx.throw(response.status || 502, payload.message || 'Unable to verify Paystack payment');
  }

  const expectedKobo = getExpectedKobo(ctx);
  const paidAmount = payload.data.amount ?? 0;
  const paid = payload.data.status === 'success';
  const amountMatches = expectedKobo === null || paidAmount === expectedKobo;

  strapi.log.info(
    `[paystack] verify reference=${payload.data.reference || reference} status=${payload.data.status || 'unknown'} amount=${paidAmount} expected=${expectedKobo ?? 'not-provided'} amountMatches=${amountMatches}`,
  );

  ctx.body = {
    verified: paid && amountMatches,
    status: payload.data.status || 'unknown',
    reference: payload.data.reference || reference,
    amount: paidAmount / 100,
    expectedAmount: expectedKobo === null ? undefined : expectedKobo / 100,
    currency: payload.data.currency,
    gatewayResponse: payload.data.gateway_response,
    paidAt: payload.data.paid_at,
    channel: payload.data.channel,
    amountMatches,
  };
}

export default (_config: unknown, { strapi }: { strapi: any }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    if (ctx.path === '/api/payments/initialize') {
      if (ctx.method !== 'POST') {
        ctx.set('Allow', 'POST');
        ctx.throw(405, 'Method Not Allowed');
      }

      await initializePaystackPayment(ctx);
      return;
    }

    if (ctx.path.startsWith('/api/payments/verify/')) {
      if (ctx.method !== 'GET') {
        ctx.set('Allow', 'GET');
        ctx.throw(405, 'Method Not Allowed');
      }

      await verifyPaystackPayment(ctx, strapi);
      return;
    }

    await next();
  };
};
