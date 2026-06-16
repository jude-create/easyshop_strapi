import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'global::paystack-payments',
  'global::firebase-auth',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
