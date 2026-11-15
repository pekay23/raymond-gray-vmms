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
  OIDC_LOGOUT_CALLBACK_URL: 'https://vmms.raymond-gray.org/api/v1/auth/oidc/logout/callback',
  TRUSTED_PROXY_CIDRS: '203.0.113.10/32',
  NODE_ENV: 'production',
  STAFF_MESSAGES_ENABLED: 'false',
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

test('production cannot enable staff messages before the retention and ownership review', () => {
  const environment={...productionEnvironment,STAFF_MESSAGES_ENABLED:'true'};
  const previous=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    assert.throws(readConfig,/STAFF_MESSAGES_ENABLED cannot be true until REV-042 retention and operational ownership are approved/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('trusted proxy configuration rejects arbitrary hostnames, invalid CIDRs and trust-all ranges', () => {
  const invalidEnvironment={...productionEnvironment,TRUSTED_PROXY_CIDRS:'cloudflare.example,203.0.113.0/99,0.0.0.0/0'};
  const previous=new Map(Object.keys(invalidEnvironment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,invalidEnvironment);
    assert.throws(readConfig,/TRUSTED_PROXY_CIDRS must be a comma-separated list of exact IP addresses or valid CIDR ranges/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('production OIDC logout callback must be exact and share the API and web origin', () => {
  const invalidEnvironment={...productionEnvironment,OIDC_LOGOUT_CALLBACK_URL:'https://outside.example/logout/callback'};
  const previous=new Map(Object.keys(invalidEnvironment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,invalidEnvironment);
    assert.throws(readConfig,/OIDC issuer and callback must be exact HTTPS URLs outside local development/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
