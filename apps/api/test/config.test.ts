import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

const productionEnvironment = {
  DATABASE_URL: 'postgres://vmms_runtime:synthetic@127.0.0.1:5432/vmms',
  SESSION_SECRET: 'Synthetic-production-session-secret-32-characters',
  WEB_ORIGIN: 'https://vmms.raymond-gray.org',
  OIDC_ISSUER: 'https://auth.raymond-gray.org/realms/raymond-gray',
  OIDC_CLIENT_ID: 'vmms-web',
  OIDC_CLIENT_SECRET: 'Synthetic-production-client-secret-with-more-than-32-characters',
  OIDC_CALLBACK_URL: 'https://vmms.raymond-gray.org/api/v1/auth/oidc/callback',
  NODE_ENV: 'production',
} satisfies Record<string, string>;

test('production startup stays blocked until identity and deployment readiness are approved', () => {
  const previous = new Map(Object.keys(productionEnvironment).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, productionEnvironment);
    assert.throws(readConfig, /Production startup is blocked until staff identity, MFA and deployment controls pass readiness review/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
