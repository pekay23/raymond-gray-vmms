ALTER TABLE public.vehicle_learning_entries
  ADD COLUMN assessment jsonb,
  ADD CONSTRAINT vehicle_learning_entries_assessment_object
    CHECK (assessment IS NULL OR (jsonb_typeof(assessment)='object' AND assessment->>'schemaVersion'='1'));

ALTER TABLE public.vehicle_learning_entry_revisions
  ADD COLUMN assessment jsonb,
  ADD CONSTRAINT vehicle_learning_revisions_assessment_object
    CHECK (assessment IS NULL OR (jsonb_typeof(assessment)='object' AND assessment->>'schemaVersion'='1'));

-- NULL is the explicit legacy marker. The API read adapter preserves old scalar values as unconfirmed legacy notes.
-- New commands write one structured assessment snapshot and derive scalar compatibility fields from it.
