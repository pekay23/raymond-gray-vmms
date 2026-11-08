import 'dotenv/config';
import { z } from 'zod';
import { makePool } from './db.js';
import { createEvidenceServices, runEvidenceWorker } from './evidence.js';

const workerDatabaseUrl = z.url().parse(process.env.VMMS_EVIDENCE_WORKER_DATABASE_URL);
const pool = makePool(workerDatabaseUrl);
const services = createEvidenceServices(process.env, 'worker');
const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

try {
  await runEvidenceWorker(pool, services, controller.signal);
} finally {
  await pool.end();
}
