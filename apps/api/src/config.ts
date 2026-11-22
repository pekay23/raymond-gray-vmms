import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { z } from 'zod';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

function isIpRange(value:string) {
  const [address,mask,...extra]=value.split('/');
  if (!address||extra.length>0) return false;
  const version=isIP(address);
  if (!version) return false;
  if (mask===undefined) return true;
  if (!/^\d{1,3}$/.test(mask)) return false;
  const prefix=Number(mask);
  return prefix>0&&prefix<=(version===4?32:128);
}

const configSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  OIDC_ISSUER: z.url().default('http://localhost:8080/realms/raymond-gray-dev'),
  OIDC_CLIENT_ID: z.string().min(1).default('vmms-web-dev'),
  OIDC_CLIENT_SECRET: z.string().min(32).optional(),
  OIDC_REQUIRE_MFA_ASSURANCE: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  OIDC_CALLBACK_URL: z.url().default('http://127.0.0.1:4100/api/v1/auth/oidc/callback'),
  OIDC_LOGOUT_CALLBACK_URL: z.url().default('http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback'),
  TRUSTED_PROXY_CIDRS: z.string().default('').transform(value=>value.split(',').map(item=>item.trim()).filter(Boolean)).refine(values=>values.length<=64&&values.every(isIpRange),'TRUSTED_PROXY_CIDRS must be a comma-separated list of exact IP addresses or valid CIDR ranges.'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  VMMS_DEPLOYMENT_STAGE: z.enum(['development', 'staging', 'production']).optional(),
  STAFF_MESSAGES_ENABLED: z.enum(['true','false']).default('false').transform(value=>value==='true'),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(): Config {
  const parsed = configSchema.parse(process.env);
  const deploymentStage=parsed.VMMS_DEPLOYMENT_STAGE??(parsed.NODE_ENV==='test'?'development':parsed.NODE_ENV);
  if (parsed.NODE_ENV !== 'test') {
    if (!parsed.OIDC_CLIENT_SECRET) throw new Error('OIDC_CLIENT_SECRET is required for web sign-in.');
    if (deploymentStage !== 'development' && !parsed.OIDC_REQUIRE_MFA_ASSURANCE) throw new Error('OIDC_REQUIRE_MFA_ASSURANCE=true is required outside local development.');
    const issuer = new URL(parsed.OIDC_ISSUER);
    const callback = new URL(parsed.OIDC_CALLBACK_URL);
    const logoutCallback = new URL(parsed.OIDC_LOGOUT_CALLBACK_URL);
    const localHosts = new Set(['localhost', '127.0.0.1']);
    const isLocalDev = deploymentStage === 'development' && localHosts.has(issuer.hostname) && localHosts.has(callback.hostname);
    const requiresHttps = deploymentStage !== 'development' || !isLocalDev;
    const callbackUrlIsExact = (url: URL) => !url.username && !url.password && !url.search && !url.hash;
    if (requiresHttps && (issuer.protocol !== 'https:' || callback.protocol !== 'https:' || logoutCallback.protocol !== 'https:')) {
      throw new Error('OIDC issuer and callback must be exact HTTPS URLs outside local development.');
    }
    if (issuer.username || issuer.password || issuer.search || issuer.hash
      || !callbackUrlIsExact(callback) || !callbackUrlIsExact(logoutCallback)
      || callback.origin !== logoutCallback.origin
      || (deploymentStage === 'production' && logoutCallback.origin !== new URL(parsed.WEB_ORIGIN).origin)) {
      throw new Error('OIDC issuer and callback must be exact HTTPS URLs outside local development.');
    }
  }
  if (deploymentStage === 'production') {
    if (parsed.NODE_ENV !== 'production') throw new Error('NODE_ENV=production is required for the production deployment.');
    if (process.env.VERCEL !== '1') throw new Error('The production API must run on the approved Vercel Node deployment.');
    if (!parsed.TRUSTED_PROXY_CIDRS.length && process.env.VERCEL !== '1') throw new Error('TRUSTED_PROXY_CIDRS must identify the exact ingress proxies before production startup.');
    if (parsed.STAFF_MESSAGES_ENABLED) throw new Error('STAFF_MESSAGES_ENABLED cannot be true until REV-042 retention and operational ownership are approved.');
    if (parsed.WEB_ORIGIN !== 'https://vmms.raymond-gray.org'
      || parsed.OIDC_ISSUER !== 'https://auth.raymond-gray.org/api/auth'
      || parsed.OIDC_CALLBACK_URL !== 'https://vmms.raymond-gray.org/api/v1/auth/oidc/callback'
      || parsed.OIDC_LOGOUT_CALLBACK_URL !== 'https://vmms.raymond-gray.org/api/v1/auth/oidc/logout/callback') {
      throw new Error('Production identity origins and callbacks must match the reviewed VMMS and Raymond Gray Auth domains.');
    }
  }
  return parsed;
}
