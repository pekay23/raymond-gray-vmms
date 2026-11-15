CREATE TABLE public.work_order_source_reports (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('client-report','workshop-report','external-record','other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  source_date date NOT NULL,
  source_file_evidence_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  recorded_by_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  recorded_by_placement_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  supersedes_report_id uuid,
  correction_reason text,
  CHECK ((supersedes_report_id IS NULL) = (correction_reason IS NULL)),
  CHECK (correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 1000),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,source_document_id,revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,recorded_by_placement_id,recorded_by_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,supersedes_report_id)
    REFERENCES public.work_order_source_reports(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,source_file_evidence_id)
    REFERENCES public.work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id)
);

CREATE UNIQUE INDEX work_order_source_reports_one_correction
  ON public.work_order_source_reports(organisation_id,site_id,work_order_id,supersedes_report_id)
  WHERE supersedes_report_id IS NOT NULL;
CREATE UNIQUE INDEX work_order_source_reports_one_root
  ON public.work_order_source_reports(organisation_id,site_id,work_order_id,source_document_id)
  WHERE supersedes_report_id IS NULL;
CREATE INDEX work_order_source_reports_history
  ON public.work_order_source_reports(organisation_id,site_id,work_order_id,recorded_at,id);

CREATE TABLE public.work_order_source_report_items (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  source_report_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  item_kind text NOT NULL CHECK (item_kind IN ('concern','finding','test','action','follow-up')),
  result text,
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 160),
  detail text NOT NULL CHECK (length(btrim(detail)) BETWEEN 0 AND 4000),
  source_occurrence_date date,
  complaint_id uuid,
  CHECK (
    (item_kind='concern' AND result='reported' AND complaint_id IS NOT NULL) OR
    (item_kind='finding' AND result IN ('observed','inconclusive')) OR
    (item_kind='test' AND result IN ('reproduced','not-reproduced','inconclusive')) OR
    (item_kind='action' AND result IN ('done','partial','blocked')) OR
    (item_kind='follow-up' AND result IN ('pending','done','blocked'))
  ),
  UNIQUE (organisation_id,site_id,work_order_id,source_report_id,ordinal),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,source_report_id)
    REFERENCES public.work_order_source_reports(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,complaint_id)
    REFERENCES public.complaints(organisation_id,site_id,work_order_id,id)
);

CREATE INDEX work_order_source_report_items_order
  ON public.work_order_source_report_items(organisation_id,site_id,work_order_id,source_report_id,ordinal,id);

ALTER TABLE public.work_order_source_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_source_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_source_reports_scope ON public.work_order_source_reports
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.work_order_source_report_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_source_report_items FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_source_report_items_scope ON public.work_order_source_report_items
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

CREATE FUNCTION public.reject_work_order_source_report_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'work-order source reports are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_source_report_change() FROM PUBLIC;
CREATE TRIGGER work_order_source_reports_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_source_reports
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_source_report_change();
CREATE TRIGGER work_order_source_report_items_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_source_report_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_source_report_change();

REVOKE ALL ON public.work_order_source_reports FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_source_reports TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_source_reports FROM vmms_runtime;
REVOKE ALL ON public.work_order_source_report_items FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_source_report_items TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_source_report_items FROM vmms_runtime;

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
  'work-order-task-work-entries-read-prepared','work-order-service-report-read-prepared',
  'work-order-task-work-evidence-options-read-prepared','work-order-source-reports-read-prepared'
));
