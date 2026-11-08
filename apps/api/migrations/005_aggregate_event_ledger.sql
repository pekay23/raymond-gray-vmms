CREATE TABLE aggregate_roots (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  aggregate_type text NOT NULL CHECK (length(aggregate_type) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (organisation_id, site_id, id, aggregate_type),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id)
);

INSERT INTO aggregate_roots(id, organisation_id, site_id, aggregate_type, created_at)
SELECT id, organisation_id, site_id, 'work-order', created_at FROM work_orders;

ALTER TABLE work_orders
  ADD COLUMN aggregate_type text NOT NULL DEFAULT 'work-order' CHECK (aggregate_type = 'work-order');
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_aggregate_root_fk
  FOREIGN KEY (organisation_id, site_id, id, aggregate_type)
  REFERENCES aggregate_roots (organisation_id, site_id, id, aggregate_type);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 4000),
  previous_state jsonb NOT NULL,
  new_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_id, aggregate_version),
  UNIQUE (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id, aggregate_id, aggregate_type)
    REFERENCES aggregate_roots (organisation_id, site_id, id, aggregate_type)
);

INSERT INTO domain_events(id, organisation_id, site_id, aggregate_id, aggregate_type, aggregate_version, actor_id, event_type, reason, previous_state, new_state, created_at)
SELECT
  audit.id,
  audit.organisation_id,
  audit.site_id,
  audit.work_order_id,
  'work-order',
  COALESCE(NULLIF(audit.new_state->>'version', '')::integer, ROW_NUMBER() OVER (PARTITION BY audit.work_order_id ORDER BY audit.created_at, audit.id)::integer),
  audit.actor_id,
  audit.action,
  audit.reason,
  audit.previous_state,
  audit.new_state,
  audit.created_at
FROM audit_events AS audit;

CREATE TABLE outbox_replacement (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id, site_id, event_id)
    REFERENCES domain_events (organisation_id, site_id, id)
);

INSERT INTO outbox_replacement(id, organisation_id, site_id, event_id, payload, created_at)
SELECT legacy.id, legacy.organisation_id, legacy.site_id, event.id, legacy.payload, legacy.created_at
FROM outbox AS legacy
JOIN domain_events AS event
  ON event.organisation_id = legacy.organisation_id
  AND event.site_id = legacy.site_id
  AND event.aggregate_id = legacy.work_order_id
  AND event.aggregate_type = 'work-order'
  AND event.event_type = legacy.event_type
  AND event.aggregate_version = (legacy.payload->>'version')::integer;

DO $migration$
DECLARE legacy_count bigint; migrated_count bigint;
BEGIN
  SELECT count(*) INTO legacy_count FROM outbox;
  SELECT count(*) INTO migrated_count FROM outbox_replacement;
  IF legacy_count <> migrated_count THEN
    RAISE EXCEPTION 'Aggregate event migration matched % of % existing outbox records', migrated_count, legacy_count;
  END IF;
END $migration$;

DROP TABLE outbox;
ALTER TABLE outbox_replacement RENAME TO outbox;
DROP TABLE audit_events;

CREATE INDEX domain_events_aggregate_history ON domain_events(aggregate_id, aggregate_version DESC);
CREATE INDEX outbox_created ON outbox(created_at, id);

ALTER TABLE aggregate_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_roots FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON aggregate_roots
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON domain_events
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON outbox
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

GRANT SELECT, INSERT ON aggregate_roots TO vmms_runtime;
GRANT SELECT, INSERT ON domain_events TO vmms_runtime;
GRANT SELECT, INSERT ON outbox TO vmms_runtime;

