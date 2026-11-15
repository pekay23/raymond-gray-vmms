import { z } from 'zod';
import { type Database, uuid } from './db.js';

const claimSchema=z.object({
  request_id:uuid,
  operation_id:uuid,
  organisation_id:uuid,
  site_id:uuid,
  email:z.email(),
  display_name:z.string().min(1).max(120),
  attempt_no:z.number().int().positive(),
  lease_token:uuid,
}).strict();

const providerReference=z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const errorCode=z.enum(['provider-unavailable','identity-already-exists','provider-rejected','invalid-request']);

export type StaffAccountProvisioningInput={operationId:string;email:string;displayName:string};
export type StaffAccountProvisioningResult=
  |{kind:'invitation-issued';providerReference:string}
  |{kind:'retryable-failure';errorCode:z.infer<typeof errorCode>}
  |{kind:'permanent-failure';errorCode:z.infer<typeof errorCode>};

/** Adapter boundary for a private shared-identity service. Never expose it to HTTP handlers. */
export interface StaffAccountProvisioningAdapter {
  createInvitation(input:StaffAccountProvisioningInput):Promise<StaffAccountProvisioningResult>;
}

export type StaffAccountWorkerOptions={
  leaseSeconds?:number;
  retryDelaySeconds?:number;
  maxAttempts?:number;
};

/** Process one durable request using a dedicated account-worker database connection. */
export async function processNextStaffAccountProvisioningRequest(
  workerPool:Database,
  adapter:StaffAccountProvisioningAdapter,
  options:StaffAccountWorkerOptions={},
):Promise<boolean>{
  const leaseSeconds=z.number().int().min(10).max(600).default(120).parse(options.leaseSeconds);
  const retryDelaySeconds=z.number().int().min(1).max(3600).default(30).parse(options.retryDelaySeconds);
  const maxAttempts=z.number().int().min(1).max(20).default(8).parse(options.maxAttempts);
  const claimed=await workerPool.query('SELECT * FROM public.claim_staff_account_provisioning_request($1)',[leaseSeconds]);
  const raw=claimed.rows[0] as Record<string,unknown>|undefined;
  if(!raw)return false;
  const request=claimSchema.parse(raw);

  let result:StaffAccountProvisioningResult;
  try{
    result=await adapter.createInvitation({
      operationId:request.operation_id,
      email:request.email,
      displayName:request.display_name,
    });
  }catch{
    result={kind:'retryable-failure',errorCode:'provider-unavailable'};
  }

  const parsed=z.discriminatedUnion('kind',[
    z.object({kind:z.literal('invitation-issued'),providerReference}).strict(),
    z.object({kind:z.literal('retryable-failure'),errorCode}).strict(),
    z.object({kind:z.literal('permanent-failure'),errorCode}).strict(),
  ]).parse(result);
  const completed=await workerPool.query(`SELECT public.complete_staff_account_provisioning_request(
    $1,$2,$3,$4,$5,$6,$7) AS completed`,[
    request.request_id,
    request.lease_token,
    parsed.kind,
    parsed.kind==='invitation-issued'?parsed.providerReference:null,
    parsed.kind==='invitation-issued'?null:parsed.errorCode,
    retryDelaySeconds,
    maxAttempts,
  ]);
  if(completed.rows[0]?.completed!==true)throw new Error('The provisioning request lease is no longer current.');
  return true;
}
