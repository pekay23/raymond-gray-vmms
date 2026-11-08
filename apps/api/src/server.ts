import { createApp } from './app.js';
import { readConfig } from './config.js';

const config=readConfig();
const app=await createApp(config);
await app.listen({host:config.HOST,port:config.PORT});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void app.close();});
