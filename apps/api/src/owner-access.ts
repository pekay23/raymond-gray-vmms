import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import type { Database, Scope } from './db.js';
import { uuid } from './db.js';
import { ApiError, notFound } from './errors.js';

const expectedVersion=z.number().int().nonnegative();
const reason=z.string().trim().min(1).max(1000);
const acceptedEvidenceId=uuid;
const validUntil=z.iso.datetime({offset:true}).nullable().optional();
const timestamp=z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value);
const revisionState=z.enum(['approved','revoked','expired','transferred']);

export const approveOwnerSchema=z.object({expectedVersion,ownerAccountId:uuid,evidenceRecordId:acceptedEvidenceId,reason,validUntil}).strict();
export const revokeOwnerSchema=z.object({expectedVersion,evidenceRecordId:acceptedEvidenceId,reason}).strict();
export const expireOwnerSchema=z.object({expectedVersion}).strict();
export const transferOwnerSchema=z.object({expectedVersion,newOwnerAccountId:uuid,evidenceRecordId:acceptedEvidenceId,reason,validUntil}).strict();

export const ownerAccessSummarySchema=z.object({
  accessScopeId:uuid,
  vehicleId:uuid,
  version:z.number().int().nonnegative(),
  relationships:z.array(z.object({
    relationshipId:uuid,
    ownerAccountId:uuid,
    revision:z.number().int().positive(),
    state:revisionState,
    effectiveFrom:timestamp,
    effectiveUntil:timestamp.nullable(),
    currentlyValid:z.boolean(),
  })),
});
export type OwnerAccessSummary=z.infer<typeof ownerAccessSummarySchema>;

type AccessScope={id:string;vehicleId:string;version:number};
type Relationship=z.infer<typeof currentRelationshipSchema>;
const currentRelationshipSchema=z.object({
  id:uuid,
  owner_account_id:uuid,
  revision:z.number().int().positive(),
  state:revisionState,
  effective_from:z.date(),
  effective_until:z.date().nullable(),
  evidence_record_id:uuid,
});

async function requireOwnerAccessAuthority(client:PoolClient,scope:Scope) {
  const found=await client.query('SELECT public.lock_vehicle_owner_access_authority($1,$2) AS allowed',[scope.actorId,scope.siteId]);
  if (!z.object({allowed:z.boolean()}).parse(found.rows[0]).allowed) throw new ApiError(403,'OWNER_ACCESS_APPROVER_REQUIRED','A current vehicle-owner access approval grant is required.');
}

async function requireAcceptedEvidence(client:PoolClient,scope:Scope,evidenceRecordId:string) {
  const found=await client.query('SELECT public.lock_accepted_owner_evidence($1,$2) AS accepted',[evidenceRecordId,scope.siteId]);
  if (!z.object({accepted:z.boolean()}).parse(found.rows[0]).accepted) throw new ApiError(422,'EVIDENCE_NOT_ACCEPTED','Reference an accepted evidence record in this site.');
}

async function requireOwnerAccount(client:PoolClient,ownerAccountId:string) {
  const found=await client.query('SELECT public.lock_active_vehicle_owner_account($1) AS active',[ownerAccountId]);
  if (!z.object({active:z.boolean()}).parse(found.rows[0]).active) {
    throw new ApiError(422,'OWNER_ACCOUNT_NOT_APPROVED','The specified owner account is not active in this organisation.');
  }
}

async function lockScopeForVehicle(client:PoolClient,scope:Scope,vehicleId:string,expected:number,create:boolean):Promise<AccessScope> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`vehicle-owner-access:${scope.organisationId}:${scope.siteId}:${vehicleId}`]);
  const found=await client.query('SELECT id,vehicle_id AS "vehicleId",version FROM vehicle_owner_access_scopes WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,vehicleId]);
  if (!found.rowCount) {
    if (!create) notFound();
    if (expected!==0) throw new ApiError(409,'STALE_VERSION','This vehicle has no owner-access scope yet.',0);
    const id=randomUUID();
    await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'vehicle-owner-access')",[id,scope.organisationId,scope.siteId]);
    await client.query('INSERT INTO vehicle_owner_access_scopes(id,organisation_id,site_id,vehicle_id) VALUES($1,$2,$3,$4)',[id,scope.organisationId,scope.siteId,vehicleId]);
    return {id,vehicleId,version:0};
  }
  const accessScope=z.object({id:uuid,vehicleId:uuid,version:z.number().int().nonnegative()}).parse(found.rows[0]);
  if (accessScope.version!==expected) throw new ApiError(409,'STALE_VERSION','Vehicle-owner access changed. Review the latest relationships before submitting again.',accessScope.version);
  return accessScope;
}

async function lockScopeById(client:PoolClient,scope:Scope,accessScopeId:string,expected:number):Promise<AccessScope> {
  const found=await client.query('SELECT id,vehicle_id AS "vehicleId",version FROM vehicle_owner_access_scopes WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,accessScopeId]);
  if (!found.rowCount) notFound();
  const accessScope=z.object({id:uuid,vehicleId:uuid,version:z.number().int().nonnegative()}).parse(found.rows[0]);
  if (accessScope.version!==expected) throw new ApiError(409,'STALE_VERSION','Vehicle-owner access changed. Review the latest relationships before submitting again.',accessScope.version);
  return accessScope;
}

async function lockScopeRootById(client:PoolClient,scope:Scope,accessScopeId:string) {
  const found=await client.query('SELECT id FROM vehicle_owner_access_scopes WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,accessScopeId]);
  if (!found.rowCount) notFound();
}

async function lockScopeRootForVehicle(client:PoolClient,scope:Scope,vehicleId:string) {
  await lockAdvisoryRoots(client,[`vehicle-owner-access:${scope.organisationId}:${scope.siteId}:${vehicleId}`]);
  await client.query('SELECT id FROM vehicle_owner_access_scopes WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,vehicleId]);
}

async function lockRelationship(client:PoolClient,scope:Scope,accessScopeId:string,relationshipId:string):Promise<Relationship> {
  const found=await client.query(`SELECT r.id,r.owner_account_id,v.revision,v.state,v.effective_from,v.effective_until,v.evidence_record_id
    FROM vehicle_owner_relationships r
    JOIN LATERAL (SELECT revision,state,effective_from,effective_until,evidence_record_id FROM vehicle_owner_revisions
      WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id ORDER BY revision DESC LIMIT 1) v ON true
    WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.access_scope_id=$3 AND r.id=$4`,
  [scope.organisationId,scope.siteId,accessScopeId,relationshipId]);
  if (!found.rowCount) notFound();
  return currentRelationshipSchema.parse(found.rows[0]);
}

async function findRelationshipForOwner(client:PoolClient,scope:Scope,accessScopeId:string,ownerAccountId:string):Promise<{id:string;current:Relationship|null}|null> {
  const found=await client.query('SELECT id FROM vehicle_owner_relationships WHERE organisation_id=$1 AND site_id=$2 AND access_scope_id=$3 AND owner_account_id=$4',[scope.organisationId,scope.siteId,accessScopeId,ownerAccountId]);
  if (!found.rowCount) return null;
  const id=z.object({id:uuid}).parse(found.rows[0]).id;
  const revisions=await client.query(`SELECT id,owner_account_id,revision,state,effective_from,effective_until,evidence_record_id
    FROM vehicle_owner_revisions WHERE organisation_id=$1 AND site_id=$2 AND relationship_id=$3 ORDER BY revision DESC LIMIT 1`,[scope.organisationId,scope.siteId,id]);
  if (!revisions.rowCount) throw new ApiError(409,'OWNER_RELATIONSHIP_INCOMPLETE','This relationship has no accepted revision and needs administrator review.');
  return {id,current:currentRelationshipSchema.parse(revisions.rows[0])};
}

async function createRelationship(client:PoolClient,scope:Scope,accessScopeId:string,ownerAccountId:string) {
  const relationshipId=randomUUID();
  await client.query('INSERT INTO vehicle_owner_relationships(id,organisation_id,site_id,access_scope_id,owner_account_id) VALUES($1,$2,$3,$4,$5)',[relationshipId,scope.organisationId,scope.siteId,accessScopeId,ownerAccountId]);
  return relationshipId;
}

async function appendRevision(client:PoolClient,scope:Scope,relationshipId:string,revision:number,state:z.infer<typeof revisionState>,effectiveFrom:Date,effectiveUntil:Date|null,actorId:string,evidenceRecordId:string,reasonText:string) {
  await client.query(`INSERT INTO vehicle_owner_revisions(id,organisation_id,site_id,relationship_id,revision,state,effective_from,effective_until,actor_id,evidence_record_id,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),scope.organisationId,scope.siteId,relationshipId,revision,state,effectiveFrom,effectiveUntil,actorId,evidenceRecordId,reasonText]);
}

async function incrementScope(client:PoolClient,scope:Scope,accessScope:AccessScope) {
  const version=accessScope.version+1;
  await client.query('UPDATE vehicle_owner_access_scopes SET version=$1 WHERE organisation_id=$2 AND site_id=$3 AND id=$4',[version,scope.organisationId,scope.siteId,accessScope.id]);
  return version;
}

async function projectAccessScope(client:PoolClient,accessScopeId:string):Promise<OwnerAccessSummary> {
  const scope=await client.query('SELECT id AS "accessScopeId",vehicle_id AS "vehicleId",version FROM vehicle_owner_access_scopes WHERE id=$1',[accessScopeId]);
  if (!scope.rowCount) notFound();
  const relationships=await client.query(`SELECT r.id AS "relationshipId",r.owner_account_id AS "ownerAccountId",v.revision,v.state,
      v.effective_from AS "effectiveFrom",v.effective_until AS "effectiveUntil",
      (a.active AND v.state='approved' AND v.effective_from<=transaction_timestamp() AND (v.effective_until IS NULL OR transaction_timestamp()<v.effective_until)) AS "currentlyValid"
    FROM vehicle_owner_relationships r
    JOIN vehicle_owner_accounts a ON a.id=r.owner_account_id AND a.organisation_id=r.organisation_id
    JOIN LATERAL (SELECT revision,state,effective_from,effective_until FROM vehicle_owner_revisions
      WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id ORDER BY revision DESC LIMIT 1) v ON true
    WHERE r.access_scope_id=$1 ORDER BY r.created_at,r.id`,[accessScopeId]);
  return ownerAccessSummarySchema.parse({...scope.rows[0],relationships:relationships.rows});
}

export async function approveVehicleOwnerAccess(pool:Database,scope:Scope,commandId:string,vehicleId:string,body:z.infer<typeof approveOwnerSchema>) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'owner-access.relationship-approved',targetAggregateId:vehicleId,payload:body,responseSchema:ownerAccessSummarySchema,
    lockSerializationRoots:client=>lockScopeRootForVehicle(client,scope,vehicleId),
    authorize:client=>requireOwnerAccessAuthority(client,scope),
    apply:async client=>{
      await requireAcceptedEvidence(client,scope,body.evidenceRecordId);
      await requireOwnerAccount(client,body.ownerAccountId);
      const accessScope=await lockScopeForVehicle(client,scope,vehicleId,body.expectedVersion,true);
      const nowResult=await client.query('SELECT transaction_timestamp() AS now');
      const effectiveFrom=z.date().parse(nowResult.rows[0].now);
      const effectiveUntil=body.validUntil?new Date(body.validUntil):null;
      if (effectiveUntil && effectiveUntil<=effectiveFrom) throw new ApiError(400,'INVALID_ACCESS_INTERVAL','The access expiry must be later than its start time.');
      const existing=await findRelationshipForOwner(client,scope,accessScope.id,body.ownerAccountId);
      if (existing?.current?.state==='approved') {
        const intervalEnded=existing.current.effective_until!==null&&existing.current.effective_until<=effectiveFrom;
        throw new ApiError(409,intervalEnded?'OWNER_EXPIRY_REVISION_REQUIRED':'OWNER_RELATIONSHIP_ALREADY_APPROVED',intervalEnded?'Append the expiration revision before approving this account again.':'This owner already has an approved relationship for this vehicle and site.');
      }
      const relationshipId=existing?.id??await createRelationship(client,scope,accessScope.id,body.ownerAccountId);
      const revision=(existing?.current?.revision??0)+1;
      await appendRevision(client,scope,relationshipId,revision,'approved',effectiveFrom,effectiveUntil,scope.actorId,body.evidenceRecordId,body.reason);
      const version=await incrementScope(client,scope,accessScope);
      return {aggregateId:accessScope.id,aggregateType:'vehicle-owner-access',version,previous:{version:accessScope.version},next:{version,relationshipId,ownerAccountId:body.ownerAccountId,state:'approved',revision},reason:body.reason};
    },
    project:(client,mutation)=>projectAccessScope(client,mutation.aggregateId),
  });
}

export async function revokeVehicleOwnerAccess(pool:Database,scope:Scope,commandId:string,accessScopeId:string,relationshipId:string,body:z.infer<typeof revokeOwnerSchema>) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'owner-access.relationship-revoked',targetAggregateId:accessScopeId,payload:{relationshipId,...body},responseSchema:ownerAccessSummarySchema,
    lockSerializationRoots:client=>lockScopeRootById(client,scope,accessScopeId),
    authorize:client=>requireOwnerAccessAuthority(client,scope),
    apply:async client=>{
      await requireAcceptedEvidence(client,scope,body.evidenceRecordId);
      const accessScope=await lockScopeById(client,scope,accessScopeId,body.expectedVersion);
      const relationship=await lockRelationship(client,scope,accessScopeId,relationshipId);
      if (relationship.state!=='approved') throw new ApiError(409,'OWNER_RELATIONSHIP_NOT_ACTIVE','Only an approved relationship can be revoked.');
      const nowResult=await client.query('SELECT transaction_timestamp() AS now');
      const now=z.date().parse(nowResult.rows[0].now);
      if (relationship.effective_until&&relationship.effective_until<=now) throw new ApiError(409,'OWNER_EXPIRY_REVISION_REQUIRED','Append the expiration revision before revoking this relationship.');
      const revision=relationship.revision+1;
      await appendRevision(client,scope,relationshipId,revision,'revoked',now,null,scope.actorId,body.evidenceRecordId,body.reason);
      const version=await incrementScope(client,scope,accessScope);
      return {aggregateId:accessScope.id,aggregateType:'vehicle-owner-access',version,previous:{version:accessScope.version,relationshipId,state:relationship.state,revision:relationship.revision},next:{version,relationshipId,state:'revoked',revision},reason:body.reason};
    },
    project:(client,mutation)=>projectAccessScope(client,mutation.aggregateId),
  });
}

export async function expireVehicleOwnerAccess(pool:Database,scope:Scope,commandId:string,accessScopeId:string,relationshipId:string,body:z.infer<typeof expireOwnerSchema>) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'owner-access.relationship-expired',targetAggregateId:accessScopeId,payload:{relationshipId,...body},responseSchema:ownerAccessSummarySchema,
    lockSerializationRoots:client=>lockScopeRootById(client,scope,accessScopeId),
    authorize:client=>requireOwnerAccessAuthority(client,scope),
    apply:async client=>{
      const accessScope=await lockScopeById(client,scope,accessScopeId,body.expectedVersion);
      const relationship=await lockRelationship(client,scope,accessScopeId,relationshipId);
      const nowResult=await client.query('SELECT transaction_timestamp() AS now');
      const now=z.date().parse(nowResult.rows[0].now);
      if (relationship.state!=='approved'||!relationship.effective_until||relationship.effective_until>now) throw new ApiError(409,'OWNER_RELATIONSHIP_NOT_EXPIRED','Only an approved relationship whose expiry time has passed can be marked expired.');
      const revision=relationship.revision+1;
      await appendRevision(client,scope,relationshipId,revision,'expired',relationship.effective_until,null,scope.actorId,relationship.evidence_record_id,'Approved vehicle access interval ended.');
      const version=await incrementScope(client,scope,accessScope);
      return {aggregateId:accessScope.id,aggregateType:'vehicle-owner-access',version,previous:{version:accessScope.version,relationshipId,state:relationship.state,revision:relationship.revision},next:{version,relationshipId,state:'expired',revision},reason:'Approved vehicle access interval ended.'};
    },
    project:(client,mutation)=>projectAccessScope(client,mutation.aggregateId),
  });
}

export async function transferVehicleOwnerAccess(pool:Database,scope:Scope,commandId:string,accessScopeId:string,relationshipId:string,body:z.infer<typeof transferOwnerSchema>) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'owner-access.relationship-transferred',targetAggregateId:accessScopeId,payload:{relationshipId,...body},responseSchema:ownerAccessSummarySchema,
    lockSerializationRoots:client=>lockScopeRootById(client,scope,accessScopeId),
    authorize:client=>requireOwnerAccessAuthority(client,scope),
    apply:async client=>{
      await requireAcceptedEvidence(client,scope,body.evidenceRecordId);
      // The target access-scope root is already locked before authority evaluation.
      await requireOwnerAccount(client,body.newOwnerAccountId);
      const accessScope=await lockScopeById(client,scope,accessScopeId,body.expectedVersion);
      const prior=await lockRelationship(client,scope,accessScopeId,relationshipId);
      if (prior.state!=='approved') throw new ApiError(409,'OWNER_RELATIONSHIP_NOT_ACTIVE','Only an approved relationship can be transferred.');
      const nowResult=await client.query('SELECT transaction_timestamp() AS now');
      const now=z.date().parse(nowResult.rows[0].now);
      if (prior.effective_until&&prior.effective_until<=now) throw new ApiError(409,'OWNER_EXPIRY_REVISION_REQUIRED','Append the expiration revision before transferring this relationship.');
      if (prior.owner_account_id===body.newOwnerAccountId) throw new ApiError(422,'TRANSFER_OWNER_UNCHANGED','Choose a different active owner account for the transfer.');
      const effectiveUntil=body.validUntil?new Date(body.validUntil):null;
      if (effectiveUntil&&effectiveUntil<=now) throw new ApiError(400,'INVALID_ACCESS_INTERVAL',"The incoming owner's access expiry must be later than the transfer time.");
      const incoming=await findRelationshipForOwner(client,scope,accessScope.id,body.newOwnerAccountId);
      if (incoming?.current?.state==='approved') throw new ApiError(409,'OWNER_RELATIONSHIP_ALREADY_APPROVED','The incoming owner already has an approved relationship for this vehicle and site.');
      const incomingRelationshipId=incoming?.id??await createRelationship(client,scope,accessScope.id,body.newOwnerAccountId);
      const transferRevision=prior.revision+1;
      const incomingRevision=(incoming?.current?.revision??0)+1;
      await appendRevision(client,scope,relationshipId,transferRevision,'transferred',now,null,scope.actorId,body.evidenceRecordId,body.reason);
      await appendRevision(client,scope,incomingRelationshipId,incomingRevision,'approved',now,effectiveUntil,scope.actorId,body.evidenceRecordId,body.reason);
      const version=await incrementScope(client,scope,accessScope);
      return {aggregateId:accessScope.id,aggregateType:'vehicle-owner-access',version,previous:{version:accessScope.version,relationshipId,state:prior.state,revision:prior.revision},next:{version,transferredRelationshipId:relationshipId,incomingRelationshipId,ownerAccountId:body.newOwnerAccountId,transferredRevision:transferRevision,approvedRevision:incomingRevision},reason:body.reason};
    },
    project:(client,mutation)=>projectAccessScope(client,mutation.aggregateId),
  });
}
