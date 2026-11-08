import { newAuthorizationParameters, OidcClient } from '../src/oidc-client.js';
import { readConfig } from '../src/config.js';

const config=readConfig();
const provider=new OidcClient(config);
const authorizationUrl=await provider.createAuthorizationUrl(newAuthorizationParameters());
process.stdout.write(JSON.stringify({discovery:'passed',authorizationEndpoint:`${authorizationUrl.origin}${authorizationUrl.pathname}`,clientId:config.OIDC_CLIENT_ID})+'\n');
