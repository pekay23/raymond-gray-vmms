import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Database } from '../src/db.js';
import { linkLocalStaffIdentity, localIdentityLinkTargets } from '../scripts/local-identity-link.js';

const staffUserId = '10000000-0000-4000-8000-000000000003';

test('local identity linking accepts only development loopback identity and database targets', () => {
  const targets = localIdentityLinkTargets({
    nodeEnv: 'development',
    issuer: 'http://localhost:8080/realms/raymond-gray-dev/',
    databaseUrl: 'postgres://fixture:synthetic@127.0.0.1:5432/vmms',
  });
  assert.equal(targets.issuer, 'http://localhost:8080/realms/raymond-gray-dev');
  assert.equal(targets.databaseUrl.hostname, '127.0.0.1');
  assert.throws(() => localIdentityLinkTargets({
    nodeEnv: 'production',
    issuer: 'http://localhost:8080/realms/raymond-gray-dev',
    databaseUrl: 'postgres://fixture:synthetic@127.0.0.1:5432/vmms',
  }), /cannot run in production/i);
  assert.throws(() => localIdentityLinkTargets({
    nodeEnv: 'development',
    issuer: 'https://auth.raymond-gray.org/realms/raymond-gray',
    databaseUrl: 'postgres://fixture:synthetic@127.0.0.1:5432/vmms',
  }), /loopback OIDC issuer/i);
  assert.throws(() => localIdentityLinkTargets({
    nodeEnv: 'development',
    issuer: 'http://localhost:8080/realms/raymond-gray-dev',
    databaseUrl: 'postgres://fixture:synthetic@db.example.test/vmms',
  }), /loopback PostgreSQL/i);
});

test('local identity link leaves a conflicting issuer subject untouched', async () => {
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO staff_identities')) return { rows: [], rowCount: 0 };
      return { rows: [{ staff_user_id: '10000000-0000-4000-8000-000000000099' }], rowCount: 1 };
    },
  } as unknown as Database;
  await assert.rejects(linkLocalStaffIdentity(pool, {
    issuer: 'http://localhost:8080/realms/raymond-gray-dev',
    subject: 'synthetic-subject',
    staffUserId,
  }), /No existing identity was changed/);
  assert.match(statements[0]!.sql, /ON CONFLICT\(issuer,subject\) DO NOTHING/);
  assert.doesNotMatch(statements[0]!.sql, /DO UPDATE/);
  assert.deepEqual(statements[0]!.values, [
    'http://localhost:8080/realms/raymond-gray-dev',
    'synthetic-subject',
    staffUserId,
  ]);
});

test('local identity link accepts an already matching active staff mapping without changing it', async () => {
  let insertCount = 0;
  const pool = {
    async query(sql: string) {
      if (sql.includes('INSERT INTO staff_identities')) {
        insertCount += 1;
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ staff_user_id: staffUserId }], rowCount: 1 };
    },
  } as unknown as Database;
  await linkLocalStaffIdentity(pool, {
    issuer: 'http://localhost:8080/realms/raymond-gray-dev',
    subject: 'synthetic-subject',
    staffUserId,
  });
  assert.equal(insertCount, 1);
});
