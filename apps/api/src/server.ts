import Fastify from 'fastify';
import { createApp, fastifyServerOptions } from './routes.js';
import { readConfig } from './config.js';

function startupFailure(error: unknown) {
  if (!(error instanceof Error)) return {errorType:typeof error};
  const code='code' in error&&typeof error.code==='string'?error.code:undefined;
  const issues='issues' in error&&Array.isArray(error.issues)
    ? error.issues.map((issue: {path?:unknown[];code?:unknown})=>({path:issue.path,code:issue.code}))
    : undefined;
  return {name:error.name,code,issues};
}

console.info('VMMS API function entry loaded');
let config;
try {
  config=readConfig();
  console.info('VMMS API configuration validated',{stage:config.VMMS_DEPLOYMENT_STAGE??config.NODE_ENV});
} catch(error) {
  console.error('VMMS API configuration rejected',startupFailure(error));
  throw error;
}

const app=Fastify(fastifyServerOptions(config));
try {
  await createApp(config,undefined,undefined,undefined,undefined,undefined,app);
  console.info('VMMS API routes registered');
  if (process.env.VERCEL==='1') await app.listen({port:config.PORT});
  else await app.listen({host:config.HOST,port:config.PORT});
  console.info('VMMS API listener ready');
} catch(error) {
  console.error('VMMS API startup failed',startupFailure(error));
  throw error;
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void app.close();});
