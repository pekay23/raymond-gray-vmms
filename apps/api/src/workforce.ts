import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { runStaffCommand, lockAdvisoryRoots } from './commands.js';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError } from './errors.js';
import { requireActiveReadMembership, recordSensitiveRead } from './sensitive-read-audit.js';

export const roleProfileSchema = z.object({
  code: z.string(), label: z.string(), description: z.string(), assignableByHead: z.boolean(),
});
const placementSchema = z.object({
  id: uuid, staffUserId: uuid, displayName: z.string(), username: z.string(), role: roleProfileSchema,
  reportsToPlacementId: uuid.nullable(), reportsToName: z.string().nullable(), revision: z.number().int().positive(),
  state: z.enum(['active','ended']),
});
const staffDirectoryEntrySchema=z.object({
  id:uuid,displayName:z.string(),username:z.string(),roleCodes:z.array(z.string()),
  rolePlacements:z.array(z.object({id:uuid,roleCode:z.string(),revision:z.number().int().positive(),state:z.enum(['active','ended']),reportsToPlacementId:uuid.nullable(),reportsToName:z.string().nullable()})),
});
const organogramSchema = z.object({
  roles: z.array(roleProfileSchema), placements: z.array(placementSchema), staff: z.array(staffDirectoryEntrySchema),
  page: z.number().int().positive(), pageSize: z.number().int().positive(), totalCount: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
  staffTotalCount:z.number().int().nonnegative(), staffTotalPages:z.number().int().nonnegative(),
});
const headOverviewSchema=z.object({
  asOf:z.iso.datetime({offset:true}),
  workOrders:z.object({
    active:z.number().int().nonnegative(),held:z.number().int().nonnegative(),
    awaitingOperationsReview:z.number().int().nonnegative(),awaitingTeamLead:z.number().int().nonnegative(),
    assignedToTeamLead:z.number().int().nonnegative(),
  }),
  staff:z.object({active:z.number().int().nonnegative(),activeRolePlacements:z.number().int().nonnegative()}),
}).strict();
const assignRoleSchema = z.object({
  staffUserId: uuid,
  roleCode: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  reportsToPlacementId: uuid.nullable().default(null),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();

type AssignRole = z.infer<typeof assignRoleSchema>;

export async function readSiteOrganogram(pool: Database, scope: Scope, requestId: string, page=1, pageSize=50) {
  const pageNumber=z.number().int().min(1).max(10000).parse(page);
  const size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    await requireHeadRole(client,scope);
    const roles=await client.query(`SELECT code,label,description,assignable_by_head AS "assignableByHead"
      FROM public.staff_role_profiles WHERE active ORDER BY label,code`);
    const count=await client.query(`SELECT count(*)::int AS total FROM public.staff_role_placements p
      WHERE p.organisation_id=$1 AND p.site_id=$2`,[scope.organisationId,scope.siteId]);
    const totalCount=(count.rows[0] as {total:number}).total;
    const staffCount=await client.query(`SELECT count(*)::int AS total FROM public.memberships m
      JOIN public.sites s ON s.id=m.site_id AND s.organisation_id=$1
      JOIN public.staff_users u ON u.id=m.user_id WHERE m.site_id=$2 AND m.active AND u.active`,[scope.organisationId,scope.siteId]);
    const staffTotalCount=(staffCount.rows[0] as {total:number}).total;
    const result=await client.query(`SELECT p.id,p.staff_user_id AS "staffUserId",u.display_name AS "displayName",u.username,
      jsonb_build_object('code',r.code,'label',r.label,'description',r.description,'assignableByHead',r.assignable_by_head) AS role,
      p.reports_to_placement_id AS "reportsToPlacementId",manager.display_name AS "reportsToName",
      p.revision,p.state
      FROM public.staff_role_placements p
      JOIN public.staff_users u ON u.id=p.staff_user_id
      JOIN public.staff_role_profiles r ON r.code=p.role_code
      LEFT JOIN public.staff_role_placements parent ON parent.id=p.reports_to_placement_id
      LEFT JOIN public.staff_users manager ON manager.id=parent.staff_user_id
      WHERE p.organisation_id=$1 AND p.site_id=$2
      ORDER BY u.display_name,r.label,p.id LIMIT $3 OFFSET $4`,[scope.organisationId,scope.siteId,size,(pageNumber-1)*size]);
    const staff=await client.query(`SELECT u.id,u.display_name AS "displayName",u.username,
      COALESCE(array_agg(DISTINCT p.role_code) FILTER (WHERE p.id IS NOT NULL),'{}') AS "roleCodes",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',rp.id,'roleCode',rp.role_code,'revision',rp.revision,'state',rp.state,
        'reportsToPlacementId',rp.reports_to_placement_id,'reportsToName',manager.display_name) ORDER BY profile.label,rp.id),'[]'::jsonb)
       FROM public.staff_role_placements rp JOIN public.staff_role_profiles profile ON profile.code=rp.role_code
       LEFT JOIN public.staff_role_placements parent ON parent.id=rp.reports_to_placement_id
       LEFT JOIN public.staff_users manager ON manager.id=parent.staff_user_id
       WHERE rp.organisation_id=$1 AND rp.site_id=$2 AND rp.staff_user_id=u.id) AS "rolePlacements"
      FROM public.memberships m JOIN public.sites s ON s.id=m.site_id AND s.organisation_id=$1
      JOIN public.staff_users u ON u.id=m.user_id
      LEFT JOIN public.staff_role_placements p ON p.organisation_id=$1 AND p.site_id=m.site_id AND p.staff_user_id=u.id AND p.state='active'
      WHERE m.site_id=$2 AND m.active AND u.active GROUP BY u.id,u.display_name,u.username
      ORDER BY u.display_name,u.id LIMIT $3 OFFSET $4`,[scope.organisationId,scope.siteId,size,(pageNumber-1)*size]);
    await recordSensitiveRead(client,scope,'workforce-organogram-read-prepared',(result.rowCount??0)+(staff.rowCount??0),requestId);
    return organogramSchema.parse({roles:roles.rows,placements:result.rows,staff:staff.rows,page:pageNumber,pageSize:size,totalCount,totalPages:Math.ceil(totalCount/size),staffTotalCount,staffTotalPages:Math.ceil(staffTotalCount/size)});
  });
}

async function requireHeadRole(client: PoolClient, scope: Scope) {
  const allowed=await client.query(`SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code
    JOIN public.staff_users u ON u.id=p.staff_user_id
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active'
      AND r.code='head-service-centre' AND r.active AND u.active AND m.active`,
  [scope.organisationId,scope.siteId,scope.actorId]);
  if (!allowed.rowCount) throw new ApiError(403,'ROLE_REQUIRED','Only the Head of Service Centre can view staff roles and the service-centre overview.');
}

function requireWritableMembership(canWrite:boolean) {
  if (!canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit staff role changes.');
}

/** Return the Head's current site-scoped queue and staffing counts without exposing record details. */
export async function readHeadOverview(pool:Database,scope:Scope,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    await requireHeadRole(client,scope);
    const snapshot=await client.query(`
      WITH work_order_totals AS MATERIALIZED (
        SELECT
          count(*) FILTER (WHERE w.status='intakeDraft')::int AS active,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM public.holds h WHERE h.organisation_id=w.organisation_id AND h.site_id=w.site_id AND h.work_order_id=w.id
          ))::int AS held,
          count(*) FILTER (WHERE (latest_review.id IS NULL OR latest_review.reviewed_work_order_version<>w.version)
            AND (latest_review.id IS NULL OR latest_assignment.operations_review_id IS DISTINCT FROM latest_review.id))::int AS "awaitingOperationsReview",
          count(*) FILTER (WHERE latest_review.id IS NOT NULL AND latest_review.reviewed_work_order_version=w.version
            AND (latest_assignment.id IS NULL OR latest_assignment.operations_review_id<>latest_review.id))::int AS "awaitingTeamLead",
          count(*) FILTER (WHERE latest_review.id IS NOT NULL
            AND latest_assignment.operations_review_id=latest_review.id)::int AS "assignedToTeamLead"
        FROM public.work_orders w
        LEFT JOIN LATERAL (
          SELECT r.id,r.reviewed_work_order_version FROM public.work_order_operations_reviews r
          WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
          ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1
        ) latest_review ON true
        LEFT JOIN LATERAL (
          SELECT a.id,a.operations_review_id FROM public.work_order_lead_assignments a
          WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1
        ) latest_assignment ON true
        WHERE w.organisation_id=$1 AND w.site_id=$2
      ), staffing_totals AS MATERIALIZED (
        SELECT
          (SELECT count(*)::int FROM public.memberships m
            JOIN public.sites s ON s.id=m.site_id AND s.organisation_id=$1
            JOIN public.staff_users u ON u.id=m.user_id
            WHERE m.site_id=$2 AND m.active AND u.active) AS active,
          (SELECT count(*)::int FROM public.staff_role_placements p
            JOIN public.staff_role_profiles r ON r.code=p.role_code
            JOIN public.staff_users u ON u.id=p.staff_user_id
            JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id
            WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.state='active' AND r.active AND u.active AND m.active) AS "activeRolePlacements"
      )
      SELECT statement_timestamp() AS "asOf",
        jsonb_build_object(
          'active',work_order_totals.active,
          'held',work_order_totals.held,
          'awaitingOperationsReview',work_order_totals."awaitingOperationsReview",
          'awaitingTeamLead',work_order_totals."awaitingTeamLead",
          'assignedToTeamLead',work_order_totals."assignedToTeamLead"
        ) AS "workOrders",
        jsonb_build_object(
          'active',staffing_totals.active,
          'activeRolePlacements',staffing_totals."activeRolePlacements"
        ) AS staff
      FROM work_order_totals CROSS JOIN staffing_totals`,[scope.organisationId,scope.siteId]);
    const row=z.object({asOf:z.union([z.date(),z.iso.datetime({offset:true})]),workOrders:z.unknown(),staff:z.unknown()}).parse(snapshot.rows[0]);
    const projection=headOverviewSchema.parse({
      asOf:row.asOf instanceof Date?row.asOf.toISOString():row.asOf,
      workOrders:row.workOrders,
      staff:row.staff,
    });
    await recordSensitiveRead(client,scope,'workforce-overview-read-prepared',1,requestId);
    return projection;
  });
}

async function checkReportingChain(client: PoolClient, siteId: string, placementId: string | null, staffUserId: string, targetPlacementId: string | null) {
  if (!placementId) return;
  const owner=await client.query(`SELECT staff_user_id FROM public.staff_role_placements WHERE id=$1 AND site_id=$2`,[placementId,siteId]);
  if ((owner.rows[0] as {staff_user_id:string}|undefined)?.staff_user_id===staffUserId)
    throw new ApiError(409,'REPORTING_CYCLE','A person cannot report to their own role.');
  const parent=await client.query(`SELECT p.id,p.staff_user_id,u.active,p.state,m.active AS membership_active
    FROM public.staff_role_placements p JOIN public.staff_users u ON u.id=p.staff_user_id
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id
    WHERE p.id=$1 AND p.site_id=$2`,[placementId,siteId]);
  const row=parent.rows[0] as {id:string;staff_user_id:string;active:boolean;state:string;membership_active:boolean}|undefined;
  if (!row || !row.active || !row.membership_active || row.state!=='active') throw new ApiError(409,'REPORTING_MANAGER_UNAVAILABLE','Choose an active manager at this site.');
  if (targetPlacementId) {
    const cycle=await client.query(`WITH RECURSIVE chain AS (
      SELECT id,reports_to_placement_id,ARRAY[id] AS seen FROM public.staff_role_placements WHERE id=$1 AND site_id=$2 AND state='active'
      UNION ALL
      SELECT p.id,p.reports_to_placement_id,c.seen||p.id FROM public.staff_role_placements p JOIN chain c ON p.id=c.reports_to_placement_id
      WHERE p.site_id=$2 AND p.state='active' AND NOT p.id=ANY(c.seen)
    ) SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,[placementId,siteId,targetPlacementId]);
    if (cycle.rowCount) throw new ApiError(409,'REPORTING_CYCLE','This reporting change would create a loop. Choose someone higher in the reporting line.');
  }
}

export async function assignExistingRole(pool: Database, scope: Scope, commandId: string, input: AssignRole) {
  const body=assignRoleSchema.parse(input);
  const commandTarget=`staff-role:${body.staffUserId}:${body.roleCode}`;
  return runStaffCommand(pool,{
    scope,commandId,operation:'workforce.role-assigned',targetAggregateId:commandTarget,
    payload:body,responseSchema:placementSchema,
    lockSerializationRoots:client=>lockAdvisoryRoots(client,[`workforce:${scope.organisationId}:${scope.siteId}`]),
    authorize:async(client,membership)=>{requireWritableMembership(membership.canWrite);await requireHeadRole(client,scope);},
    apply:async client=>{
      const profile=await client.query(`SELECT code FROM public.staff_role_profiles
        WHERE code=$1 AND active AND assignable_by_head`,[body.roleCode]);
      if (!profile.rowCount) throw new ApiError(409,'ROLE_NOT_ASSIGNABLE','Choose an active role that the Head can assign.');
      const targetUser=await client.query('SELECT id FROM public.staff_users WHERE id=$1 AND active',[body.staffUserId]);
      const member=await client.query('SELECT 1 FROM public.memberships WHERE user_id=$1 AND site_id=$2 AND active',[body.staffUserId,scope.siteId]);
      if (!targetUser.rowCount||!member.rowCount) throw new ApiError(409,'STAFF_NOT_ACTIVE_AT_SITE','Choose a staff member with active access to this site.');
      if (body.roleCode==='head-service-centre'&&body.staffUserId===scope.actorId)
        throw new ApiError(403,'SELF_ELEVATION_DENIED','You cannot assign the Head role to your own account.');
      const current=await client.query(`SELECT id,revision,staff_user_id,role_code,reports_to_placement_id,state
        FROM public.staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND role_code=$4 AND state='active' FOR UPDATE`,
      [scope.organisationId,scope.siteId,body.staffUserId,body.roleCode]);
      const row=current.rows[0] as {id:string;revision:number;staff_user_id:string;role_code:string;reports_to_placement_id:string|null;state:string}|undefined;
      await checkReportingChain(client,scope.siteId,body.reportsToPlacementId,body.staffUserId,row?.id??null);
      if (!row&&body.expectedVersion!==0) throw new ApiError(409,'STALE_VERSION','This role assignment changed. Refresh the staff list.');
      if (row&&row.revision!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This role assignment changed. Refresh the staff list.');
      const previous=row?{id:row.id,revision:row.revision,staffUserId:row.staff_user_id,roleCode:row.role_code,reportsToPlacementId:row.reports_to_placement_id,state:row.state}:{revision:0,state:'absent'};
      const id=row?.id??randomUUID();
      const revision=(row?.revision??0)+1;
      if (row) {
        await client.query(`UPDATE public.staff_role_placements SET reports_to_placement_id=$1,revision=$2,updated_by=$3,updated_at=now()
          WHERE id=$4 AND organisation_id=$5 AND site_id=$6`,[body.reportsToPlacementId,revision,scope.actorId,id,scope.organisationId,scope.siteId]);
      } else {
        await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
          VALUES($1,$2,$3,'staff-role-placement')`,[id,scope.organisationId,scope.siteId]);
        await client.query(`INSERT INTO public.staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,revision,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,1,$7,$7)`,[id,scope.organisationId,scope.siteId,body.staffUserId,body.roleCode,body.reportsToPlacementId,scope.actorId]);
      }
      const next={id,revision,staffUserId:body.staffUserId,roleCode:body.roleCode,reportsToPlacementId:body.reportsToPlacementId,state:'active'};
      await client.query(`INSERT INTO public.staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,reports_to_placement_id,state,changed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8)`,[scope.organisationId,scope.siteId,id,revision,body.staffUserId,body.roleCode,body.reportsToPlacementId,scope.actorId]);
      return {aggregateId:id,aggregateType:'staff-role-placement',version:revision,previous,next,reason:body.reason};
    },
    project:async (client,mutation)=>{
      const result=await client.query(`SELECT p.id,p.staff_user_id AS "staffUserId",u.display_name AS "displayName",u.username,
        jsonb_build_object('code',r.code,'label',r.label,'description',r.description,'assignableByHead',r.assignable_by_head) AS role,
        p.reports_to_placement_id AS "reportsToPlacementId",manager.display_name AS "reportsToName",p.revision,p.state
        FROM public.staff_role_placements p JOIN public.staff_users u ON u.id=p.staff_user_id
        JOIN public.staff_role_profiles r ON r.code=p.role_code
        LEFT JOIN public.staff_role_placements parent ON parent.id=p.reports_to_placement_id
        LEFT JOIN public.staff_users manager ON manager.id=parent.staff_user_id
        WHERE p.id=$1 AND p.organisation_id=$2 AND p.site_id=$3`,[mutation.aggregateId,scope.organisationId,scope.siteId]);
      return result.rows[0];
    },
  });
}

const endRoleSchema=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();

export async function endRolePlacement(pool: Database, scope: Scope, commandId: string, placementId: string, input: z.infer<typeof endRoleSchema>) {
  const body=endRoleSchema.parse(input);
  const id=uuid.parse(placementId);
  return runStaffCommand(pool,{
    scope,commandId,operation:'workforce.role-ended',targetAggregateId:id,payload:{placementId:id,...body},responseSchema:placementSchema,
    lockSerializationRoots:client=>lockAdvisoryRoots(client,[`workforce:${scope.organisationId}:${scope.siteId}`]),
    authorize:async(client,membership)=>{requireWritableMembership(membership.canWrite);await requireHeadRole(client,scope);},
    apply:async client=>{
      const current=await client.query(`SELECT p.id,p.revision,p.staff_user_id,p.role_code,p.reports_to_placement_id,p.state
        FROM public.staff_role_placements p WHERE p.id=$1 AND p.organisation_id=$2 AND p.site_id=$3 FOR UPDATE`,[id,scope.organisationId,scope.siteId]);
      const row=current.rows[0] as {id:string;revision:number;staff_user_id:string;role_code:string;reports_to_placement_id:string|null;state:string}|undefined;
      if (!row||row.state!=='active') throw new ApiError(404,'ROLE_PLACEMENT_NOT_FOUND','This active staff role is not available at this site.');
      if (row.revision!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This staff role changed. Refresh the staff list.');
      if (row.role_code==='vmms-operator') throw new ApiError(403,'OPERATOR_ROLE_SEPARATE','The Head cannot manage VMMS Operator accounts.');
      if (row.role_code==='head-service-centre') {
        const otherHeads=await client.query(`SELECT count(*)::int AS count FROM public.staff_role_placements
          WHERE organisation_id=$1 AND site_id=$2 AND role_code='head-service-centre' AND state='active' AND id<>$3`,[scope.organisationId,scope.siteId,id]);
        if ((otherHeads.rows[0] as {count:number}).count===0)
          throw new ApiError(409,'LAST_HEAD_ROLE','Assign another Head before ending the last Head role at this site.');
      }
      const reports=await client.query(`SELECT 1 FROM public.staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND reports_to_placement_id=$3 AND state='active' LIMIT 1`,[scope.organisationId,scope.siteId,id]);
      if (reports.rowCount) throw new ApiError(409,'ACTIVE_REPORTS_TO_ROLE','Move active reporting lines before ending this role.');
      const previous={id:row.id,revision:row.revision,staffUserId:row.staff_user_id,roleCode:row.role_code,reportsToPlacementId:row.reports_to_placement_id,state:row.state};
      const revision=row.revision+1;
      await client.query(`UPDATE public.staff_role_placements SET state='ended',revision=$1,updated_by=$2,updated_at=now() WHERE id=$3 AND organisation_id=$4 AND site_id=$5`,[revision,scope.actorId,id,scope.organisationId,scope.siteId]);
      const next={...previous,revision,state:'ended'};
      await client.query(`INSERT INTO public.staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,reports_to_placement_id,state,changed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,'ended',$8)`,[scope.organisationId,scope.siteId,id,revision,row.staff_user_id,row.role_code,row.reports_to_placement_id,scope.actorId]);
      return {aggregateId:id,aggregateType:'staff-role-placement',version:revision,previous,next,reason:body.reason};
    },
    project:async client=>{
      const result=await client.query(`SELECT p.id,p.staff_user_id AS "staffUserId",u.display_name AS "displayName",u.username,
        jsonb_build_object('code',r.code,'label',r.label,'description',r.description,'assignableByHead',r.assignable_by_head) AS role,
        p.reports_to_placement_id AS "reportsToPlacementId",manager.display_name AS "reportsToName",p.revision,p.state
        FROM public.staff_role_placements p JOIN public.staff_users u ON u.id=p.staff_user_id
        JOIN public.staff_role_profiles r ON r.code=p.role_code
        LEFT JOIN public.staff_role_placements parent ON parent.id=p.reports_to_placement_id
        LEFT JOIN public.staff_users manager ON manager.id=parent.staff_user_id
        WHERE p.id=$1 AND p.organisation_id=$2 AND p.site_id=$3`,[id,scope.organisationId,scope.siteId]);
      return result.rows[0];
    },
  });
}
