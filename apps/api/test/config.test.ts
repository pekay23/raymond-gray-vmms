import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

const productionEnvironment = {
  DATABASE_URL: 'postgres://vmms_runtime:synthetic@127.0.0.1:5432/vmms',
  SESSION_SECRET: 'Synthetic-production-session-secret-32-characters',
  WEB_ORIGIN: 'https://vmms.raymond-gray.org',
  OIDC_ISSUER: 'https://auth.raymond-gray.org/api/auth',
  OIDC_CLIENT_ID: 'vmms-web',
  OIDC_CLIENT_SECRET: 'Synthetic-production-client-secret-with-more-than-32-characters',
  OIDC_REQUIRE_MFA_ASSURANCE: 'true',
  OIDC_CALLBACK_URL: 'https://vmms.raymond-gray.org/api/v1/auth/oidc/callback',
  OIDC_LOGOUT_CALLBACK_URL: 'https://vmms.raymond-gray.org/api/v1/auth/oidc/logout/callback',
  TRUSTED_PROXY_CIDRS: '203.0.113.10/32',
  NODE_ENV: 'production',
  VMMS_DEPLOYMENT_STAGE: 'production',
  VERCEL: '1',
  STAFF_MESSAGES_ENABLED: 'false',
} satisfies Record<string, string>;

test('staging requires central MFA assurance before OIDC can be used', () => {
  const environment={...productionEnvironment,NODE_ENV:'staging',OIDC_REQUIRE_MFA_ASSURANCE:'false'};
  const previous=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    assert.throws(readConfig,/OIDC_REQUIRE_MFA_ASSURANCE=true is required outside local development/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('production starts only on Vercel with the reviewed central issuer and exact production callbacks', () => {
  const previous = new Map(Object.keys(productionEnvironment).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, productionEnvironment);
    const config=readConfig();
    assert.equal(config.OIDC_REQUIRE_MFA_ASSURANCE,true);
    assert.equal(config.OIDC_ISSUER,'https://auth.raymond-gray.org/api/auth');
    assert.equal(config.OIDC_CALLBACK_URL,'https://vmms.raymond-gray.org/api/v1/auth/oidc/callback');
    assert.equal(config.OIDC_LOGOUT_CALLBACK_URL,'https://vmms.raymond-gray.org/api/v1/auth/oidc/logout/callback');
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('production cannot start outside the approved Vercel Node runtime', () => {
  const environment={...productionEnvironment,VERCEL:'0'};
  const previous=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    assert.throws(readConfig,/production API must run on the approved Vercel Node deployment/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('production deployment stage cannot mask a non-production Node environment', () => {
  const environment={...productionEnvironment,NODE_ENV:'staging'};
  const previous=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    assert.throws(readConfig,/NODE_ENV=production is required for the production deployment/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('production rejects an unreviewed identity issuer', () => {
  const environment={...productionEnvironment,OIDC_ISSUER:'https://untrusted.example/api/auth'};
  const previous=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    assert.throws(readConfig,/Production identity origins and callbacks must match the reviewed VMMS and Raymond Gray Auth domains/);
  } finally {
    for(const [key,value] of previous) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
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
