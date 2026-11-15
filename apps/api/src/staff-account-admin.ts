import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError } from './errors.js';
import { requireActiveReadMembership, recordSensitiveRead } from './sensitive-read-audit.js';

const siteAccessSchema = z.enum(['read-only','write-enabled']);
const accountRequestStateSchema = z.enum(['queued','provisioning','invitation-issued','active','suspended','failed']);
const requestInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  displayName: z.string().trim().min(1).max(120),
  siteAccess: siteAccessSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();

const accountRequestSchema = z.object({
  id: uuid,
  displayName: z.string(),
  siteAccess: siteAccessSchema,
  state: accountRequestStateSchema,
  revision: z.number().int().positive(),
  createdAt: z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value),
}).strict();

const accountRequestListSchema = z.object({
  requests: z.array(accountRequestSchema.extend({email:z.email()})),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
}).strict();

async function requireOperatorRole(client:PoolClient,scope:Scope) {
  const found=await client.query(`SELECT 1
    FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code
    JOIN public.staff_users u ON u.id=p.staff_user_id
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.role_code='vmms-operator' AND p.state='active'
      AND r.active AND u.active AND m.active`,
  [scope.organisationId,scope.siteId,scope.actorId]);
  if (!found.rowCount) throw new ApiError(403,'OPERATOR_REQUIRED','Only the VMMS Operator can manage staff account requests.');
}

function requireWritableMembership(canWrite:boolean) {
  if (!canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit account changes.');
}

function requestIdFor(scope:Scope,commandId:string) {
  const bytes=createHash('sha256')
    .update(`vmms-staff-account-request\0${scope.organisationId}\0${scope.siteId}\0${scope.actorId}\0${commandId}`)
    .digest().subarray(0,16);
  bytes[6]=(bytes[6]!&0x0f)|0x50;
  bytes[8]=(bytes[8]!&0x3f)|0x80;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Queue a site-scoped account request. This does not create an identity or send an invitation. */
export async function requestStaffAccountProvisioning(
  pool:Database,
  scope:Scope,
  commandId:string,
  input:z.input<typeof requestInputSchema>,
) {
  const body=requestInputSchema.parse(input);
  const id=requestIdFor(scope,uuid.parse(commandId));
  return runStaffCommand(pool,{
    scope,
    commandId,
    operation:'staff-account.provisioning-requested',
    targetAggregateId:id,
    payload:body,
    responseSchema:accountRequestSchema,
    lockSerializationRoots:client=>lockAdvisoryRoots(client,[
      `staff-account-requests:${scope.organisationId}:${scope.siteId}`,
      `workforce:${scope.organisationId}:${scope.siteId}`,
    ]),
    authorize:async(client,membership)=>{
      requireWritableMembership(membership.canWrite);
      await requireOperatorRole(client,scope);
    },
    apply:async client=>{
      const duplicate=await client.query(`SELECT id FROM public.staff_account_provisioning_requests
        WHERE organisation_id=$1 AND site_id=$2 AND lower(email)=lower($3) LIMIT 1`,
      [scope.organisationId,scope.siteId,body.email]);
      if (duplicate.rowCount) throw new ApiError(409,'ACCOUNT_REQUEST_EXISTS','A request already exists for this email at this site. Review the existing request before continuing.');
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'staff-account-provisioning')`,[id,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.staff_account_provisioning_requests
        (id,organisation_id,site_id,email,display_name,site_access,requested_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id,scope.organisationId,scope.siteId,body.email,body.displayName,body.siteAccess,scope.actorId]);
      return {
        aggregateId:id,
        aggregateType:'staff-account-provisioning',
        version:1,
        previous:{state:'absent'},
        next:{state:'queued',displayName:body.displayName,siteAccess:body.siteAccess},
        reason:body.reason,
      };
    },
    project:async client=>{
      const found=await client.query(`SELECT id,display_name AS "displayName",site_access AS "siteAccess",
        state,revision,created_at AS "createdAt"
        FROM public.staff_account_provisioning_requests
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,[scope.organisationId,scope.siteId,id]);
      if (!found.rowCount) throw new ApiError(500,'ACCOUNT_REQUEST_NOT_RECORDED','The account request could not be read after it was saved.');
      return found.rows[0];
    },
  });
}

/** Return the Operator's paginated local requests without exposing other sites. */
export async function listStaffAccountProvisioningRequests(
  pool:Database,
  scope:Scope,
  requestId:string,
  page=1,
  pageSize=25,
) {
  const pageNumber=z.number().int().min(1).max(10000).parse(page);
  const size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    await requireOperatorRole(client,scope);
    const count=await client.query(`SELECT count(*)::int AS total
      FROM public.staff_account_provisioning_requests
      WHERE organisation_id=$1 AND site_id=$2`,[scope.organisationId,scope.siteId]);
    const totalCount=(count.rows[0] as {total:number}).total;
    const found=await client.query(`SELECT id,email,display_name AS "displayName",site_access AS "siteAccess",
      state,revision,created_at AS "createdAt"
      FROM public.staff_account_provisioning_requests
      WHERE organisation_id=$1 AND site_id=$2
      ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
    [scope.organisationId,scope.siteId,size,(pageNumber-1)*size]);
    await recordSensitiveRead(client,scope,'staff-account-requests-read-prepared',found.rowCount??0,requestId);
    return accountRequestListSchema.parse({
      requests:found.rows,
      page:pageNumber,
      pageSize:size,
      totalCount,
      totalPages:Math.ceil(totalCount/size),
    });
  });
}

export const staffAccountProvisioningRequestInputSchema=requestInputSchema;
