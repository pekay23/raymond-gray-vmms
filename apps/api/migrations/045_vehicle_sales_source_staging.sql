-- Source-only showroom deliveries stay outside the canonical workshop ledgers.
-- Operational organisation/site assignment is deliberately absent pending review.
CREATE SCHEMA vmms_import_staging AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA vmms_import_staging FROM PUBLIC;
REVOKE ALL ON SCHEMA vmms_import_staging FROM vmms_runtime;

CREATE TABLE vmms_import_staging.sales_batches (
  batch_id uuid PRIMARY KEY,
  source_file_sha256 text NOT NULL UNIQUE CHECK(source_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_file_name text NOT NULL,
  mapping_version text NOT NULL,
  worksheet text NOT NULL,
  report_period_from date NOT NULL,
  report_period_through date NOT NULL CHECK(report_period_through>=report_period_from),
  row_count integer NOT NULL CHECK(row_count>=0),
  policy jsonb NOT NULL,
  review_state text NOT NULL DEFAULT 'pending-owner-review' CHECK(review_state='pending-owner-review'),
  import_state text NOT NULL DEFAULT 'source-staged' CHECK(import_state='source-staged'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vmms_import_staging.sales_source_rows (
  batch_id uuid NOT NULL REFERENCES vmms_import_staging.sales_batches(batch_id),
  source_row_id text NOT NULL,
  source_row_number text,
  delivery_date_raw text,
  delivery_date_normalized date,
  vehicle_model_raw text,
  chassis_number_raw text,
  chassis_number_candidate text,
  registration_raw text,
  sales_customer_name_claim_raw text,
  review_flags jsonb NOT NULL,
  source_row_sha256 text NOT NULL CHECK(source_row_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(batch_id,source_row_id)
);

ALTER TABLE vmms_import_staging.sales_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE vmms_import_staging.sales_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE vmms_import_staging.sales_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE vmms_import_staging.sales_source_rows FORCE ROW LEVEL SECURITY;
-- No runtime policies or grants are created. Only the separate local migration/import credential can stage or inspect this source.

CREATE FUNCTION vmms_import_staging.reject_source_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical source staging rows are immutable; create a new batch for corrections.';
END;
$$;

CREATE TRIGGER sales_batches_immutable BEFORE UPDATE OR DELETE ON vmms_import_staging.sales_batches
FOR EACH ROW EXECUTE FUNCTION vmms_import_staging.reject_source_mutation();
CREATE TRIGGER sales_source_rows_immutable BEFORE UPDATE OR DELETE ON vmms_import_staging.sales_source_rows
FOR EACH ROW EXECUTE FUNCTION vmms_import_staging.reject_source_mutation();

COMMENT ON SCHEMA vmms_import_staging IS 'Restricted source staging only; no workshop API/runtime access. Promotion requires reviewed organisation/site mapping.';
COMMENT ON TABLE vmms_import_staging.sales_source_rows IS 'Immutable raw showroom delivery claims. Customer names are not verified owner or service-client identities.';
