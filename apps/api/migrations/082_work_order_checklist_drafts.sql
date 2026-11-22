-- Prepare a source-backed maintenance checklist without activating technical work.
-- Runtime writes remain narrowly constrained by role-scoped RLS and action-time grants.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.work_order_checklists
    GROUP BY organisation_id,site_id,work_order_id,template_revision_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Duplicate work-order checklist template instances exist; review them before enforcing one instance per template revision.';
  END IF;
END
$$;

CREATE UNIQUE INDEX work_order_checklist_one_template_per_visit
  ON public.work_order_checklists(organisation_id,site_id,work_order_id,template_revision_id);

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review',
    'work-order.prepare-work-plan',
    'work-order.prepare-scope-proposal',
    'work-order.checklist.prepare'
  ) THEN
    RAISE EXCEPTION 'Unsupported work-order capability';
  END IF;
  SELECT g.* INTO selected FROM public.staff_authority_grants g
  WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND g.capability=requested_capability AND g.revoked_at IS NULL
    AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
  ORDER BY g.grant_revision DESC,g.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;

CREATE FUNCTION public.lock_work_order_checklist_publisher_grant(target_grant_id uuid,target_user_id uuid,target_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF target_revision<1 THEN RETURN NULL; END IF;
  SELECT grant_row.* INTO selected FROM public.staff_authority_grants grant_row
  JOIN public.staff_users staff ON staff.id=grant_row.staff_user_id AND staff.active
  JOIN public.memberships membership ON membership.user_id=staff.id AND membership.site_id=grant_row.site_id AND membership.active
  WHERE grant_row.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND grant_row.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND grant_row.id=target_grant_id AND grant_row.staff_user_id=target_user_id
    AND grant_row.capability='work-order.checklist-template.publish'
    AND grant_row.grant_revision=target_revision AND grant_row.revoked_at IS NULL
    AND grant_row.valid_from<=clock_timestamp()
    AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
  FOR SHARE OF grant_row,staff,membership;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
REVOKE ALL ON FUNCTION public.lock_work_order_checklist_publisher_grant(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_checklist_publisher_grant(uuid,uuid,integer) TO vmms_runtime;

ALTER TABLE public.work_order_checklists
  ADD COLUMN created_by_placement_id uuid,
  ADD COLUMN preparation_authority_snapshot jsonb,
  ADD CONSTRAINT work_order_checklist_creator_placement_fk
    FOREIGN KEY (organisation_id,site_id,created_by_placement_id,created_by)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id),
  ADD CONSTRAINT work_order_checklist_preparation_authority_snapshot_object
    CHECK (preparation_authority_snapshot IS NULL OR jsonb_typeof(preparation_authority_snapshot)='object');

CREATE POLICY work_order_checklists_prepare_draft ON public.work_order_checklists
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid
    AND state='draft' AND kind='routine-maintenance'
    AND created_by_placement_id IS NOT NULL
    AND preparation_authority_snapshot IS NOT NULL
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants grant_row
      WHERE grant_row.organisation_id=work_order_checklists.organisation_id
        AND grant_row.site_id=work_order_checklists.site_id
        AND grant_row.staff_user_id=work_order_checklists.created_by
        AND grant_row.id::text=work_order_checklists.preparation_authority_snapshot->'grant'->>'id'
        AND grant_row.grant_revision::text=work_order_checklists.preparation_authority_snapshot->'grant'->>'grant_revision'
        AND grant_row.capability='work-order.checklist.prepare'
        AND grant_row.revoked_at IS NULL AND grant_row.valid_from<=clock_timestamp()
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
    )
  );

CREATE POLICY work_order_checklist_items_prepare_draft ON public.work_order_checklist_items
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
    AND EXISTS (
      SELECT 1 FROM public.work_order_checklists checklist
      WHERE checklist.organisation_id=work_order_checklist_items.organisation_id
        AND checklist.site_id=work_order_checklist_items.site_id
        AND checklist.work_order_id=work_order_checklist_items.work_order_id
        AND checklist.id=work_order_checklist_items.checklist_id
        AND checklist.created_by=nullif(current_setting('app.actor_id',true),'')::uuid
        AND checklist.state='draft' AND checklist.kind='routine-maintenance'
        AND EXISTS (
          SELECT 1 FROM public.workshop_checklist_template_revisions template,
            LATERAL jsonb_array_elements(template.items) source_item
          WHERE template.organisation_id=checklist.organisation_id AND template.site_id=checklist.site_id
            AND template.id=checklist.template_revision_id
            AND source_item->>'id'=work_order_checklist_items.item_code
            AND source_item=work_order_checklist_items.definition_snapshot
            AND jsonb_typeof(source_item->'requiredQualifications')='array'
            AND jsonb_array_length(source_item->'requiredQualifications')>0
        )
    )
  );

CREATE POLICY work_order_checklist_outcomes_record ON public.work_order_checklist_item_revisions
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants grant_row
      WHERE grant_row.organisation_id=work_order_checklist_item_revisions.organisation_id
        AND grant_row.site_id=work_order_checklist_item_revisions.site_id
        AND grant_row.staff_user_id=work_order_checklist_item_revisions.actor_id
        AND grant_row.id::text=work_order_checklist_item_revisions.authority_snapshot->>'id'
        AND grant_row.grant_revision::text=work_order_checklist_item_revisions.authority_snapshot->>'grant_revision'
        AND grant_row.capability='work-order.checklist.item-outcome.record'
        AND grant_row.revoked_at IS NULL AND grant_row.valid_from<=clock_timestamp()
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
    )
  );

CREATE POLICY work_order_checklists_record_outcome_version ON public.work_order_checklists
  FOR UPDATE USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND kind='routine-maintenance' AND state='in-progress'
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
  ) WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND kind='routine-maintenance' AND state='in-progress'
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
  );

GRANT INSERT ON public.work_order_checklists,public.work_order_checklist_items TO vmms_runtime;
