CREATE TABLE public.staff_account_provisioning_requests (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  email text NOT NULL CHECK (length(trim(email)) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  site_access text NOT NULL CHECK (site_access IN ('read-only','write-enabled')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','provisioning','invitation-issued','active','suspended','failed'
  )),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id)
    REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,id)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id)
);

CREATE INDEX staff_account_provisioning_site_created
  ON public.staff_account_provisioning_requests(organisation_id,site_id,created_at DESC,id);

ALTER TABLE public.staff_account_provisioning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_account_provisioning_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_account_provisioning_site_scope
  ON public.staff_account_provisioning_requests
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
  )
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
  );

REVOKE ALL ON public.staff_account_provisioning_requests FROM PUBLIC;
GRANT SELECT,INSERT ON public.staff_account_provisioning_requests TO vmms_runtime;

ALTER TABLE public.sensitive_read_events
  DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
    'work-order-queue-read-prepared',
    'vehicle-lookup-read-prepared',
    'client-lookup-read-prepared',
    'party-lookup-read-prepared',
    'workforce-organogram-read-prepared',
    'workforce-overview-read-prepared',
    'staff-messages-read-prepared',
    'staff-account-requests-read-prepared'
  ));
