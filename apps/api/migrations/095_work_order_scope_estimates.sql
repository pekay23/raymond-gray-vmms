-- Keep the proposed amount in the immutable scope revision so payer approval
-- can bind to both the exact work and the amount read back to them.
ALTER TABLE public.work_order_scope_revisions
  ADD COLUMN estimate_minor_units numeric(38,0),
  ADD COLUMN estimate_currency text;

ALTER TABLE public.work_order_scope_revisions
  ADD CONSTRAINT work_order_scope_revision_estimate_pair
    CHECK ((estimate_minor_units IS NULL AND estimate_currency IS NULL)
        OR (estimate_minor_units IS NOT NULL AND estimate_minor_units >= 0
            AND estimate_currency ~ '^[A-Z]{3}$')) NOT VALID,
  ADD CONSTRAINT work_order_scope_revision_repair_estimate
    CHECK (requested_kind <> 'repair'
        OR (estimate_minor_units IS NOT NULL AND estimate_minor_units > 0)) NOT VALID;

ALTER TABLE public.work_order_scope_revisions
  VALIDATE CONSTRAINT work_order_scope_revision_estimate_pair;
-- Keep pre-existing, non-authorizing draft revisions readable. NOT VALID
-- enforces the rule on new rows without pretending legacy rows had an estimate.
