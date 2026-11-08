import { randomBytes,timingSafeEqual } from 'node:crypto';
import type { FastifyReply,FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { ApiError } from './errors.js';

export function issueCsrf(reply:FastifyReply,config:Config) {
  reply.setCookie('vmms_csrf',randomBytes(32).toString('hex'),{path:'/',signed:true,httpOnly:false,secure:config.NODE_ENV==='production',sameSite:'strict'});
}

export function requireCsrf(request:FastifyRequest,config:Config) {
  const cookie=request.cookies.vmms_csrf;
  const header=request.headers['x-csrftoken'];
  if(request.headers.origin!==config.WEB_ORIGIN||!cookie||typeof header!=='string'||!request.unsignCookie(cookie).valid) {
    throw new ApiError(403,'CSRF_REQUIRED','Refresh this page and try again. A valid same-origin security token is required.');
  }
  const left=Buffer.from(cookie),right=Buffer.from(header);
  if(left.length!==right.length||!timingSafeEqual(left,right)) throw new ApiError(403,'CSRF_REQUIRED','Refresh this page and try again. A valid security token is required.');
}
