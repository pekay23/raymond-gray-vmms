import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const configSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  OIDC_ISSUER: z.url().default('http://localhost:8080/realms/raymond-gray-dev'),
  OIDC_CLIENT_ID: z.string().min(1).default('vmms-web-dev'),
  OIDC_CLIENT_SECRET: z.string().min(32).optional(),
  OIDC_CALLBACK_URL: z.url().default('http://127.0.0.1:4100/api/v1/auth/oidc/callback'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(): Config {
  const parsed = configSchema.parse(process.env);
  if (parsed.NODE_ENV !== 'test') {
    if (!parsed.OIDC_CLIENT_SECRET) throw new Error('OIDC_CLIENT_SECRET is required for web sign-in.');
    const issuer = new URL(parsed.OIDC_ISSUER);
    const callback = new URL(parsed.OIDC_CALLBACK_URL);
    const localHosts = new Set(['localhost', '127.0.0.1']);
    const localDevelopment = parsed.NODE_ENV === 'development' && localHosts.has(issuer.hostname) && localHosts.has(callback.hostname);
    if ((!localDevelopment && (issuer.protocol !== 'https:' || callback.protocol !== 'https:')) || issuer.username || issuer.password || issuer.search || issuer.hash || callback.username || callback.password || callback.search || callback.hash) {
      throw new Error('OIDC issuer and callback must be exact HTTPS URLs outside local development.');
    }
  }
  if (parsed.NODE_ENV === 'production') {
    throw new Error('Production startup is blocked until staff identity, MFA and deployment controls pass readiness review.');
  }
  return parsed;
}
