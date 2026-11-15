import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';
import { linkLocalStaffIdentity, localIdentityLinkTargets } from './local-identity-link.js';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const {issuer,databaseUrl}=localIdentityLinkTargets({
  nodeEnv:process.env.NODE_ENV,
  issuer:process.env.OIDC_ISSUER,
  databaseUrl:process.env.MIGRATION_DATABASE_URL,
});
const subject=z.string().min(1).max(255).parse(process.env.OIDC_DEV_TEST_SUBJECT);
const staffUserId='10000000-0000-4000-8000-000000000003';
const pool=new pg.Pool({connectionString:databaseUrl.toString()});
try {
  await linkLocalStaffIdentity(pool,{
    issuer,
    subject,
    staffUserId,
  });
  process.stdout.write('Linked the synthetic shared identity to the development staff account.\n');
} finally {
  await pool.end();
}
