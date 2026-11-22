ALTER TABLE public.work_order_task_activity
  ADD COLUMN completion_declaration jsonb,
  ADD COLUMN declaration_work_entry_ids uuid[];

ALTER TABLE public.work_order_task_activity
  ADD CONSTRAINT work_order_task_activity_completion_declaration_shape
  CHECK (
    (completion_declaration IS NULL AND declaration_work_entry_ids IS NULL)
    OR (
      entry_type='request' AND request_type='supervisor-review'
      AND jsonb_typeof(completion_declaration)='object'
      AND completion_declaration ?& ARRAY['actionsSummary','checksSummary','outcome','remainingWork']
      AND jsonb_typeof(completion_declaration->'actionsSummary')='string'
      AND length(trim(completion_declaration->>'actionsSummary')) BETWEEN 1 AND 4000
      AND jsonb_typeof(completion_declaration->'checksSummary')='string'
      AND length(trim(completion_declaration->>'checksSummary')) BETWEEN 1 AND 4000
      AND completion_declaration->>'outcome' IN ('reported-complete','reported-incomplete','blocked')
      AND jsonb_typeof(completion_declaration->'remainingWork')='string'
      AND length(trim(completion_declaration->>'remainingWork')) BETWEEN 1 AND 2000
      AND declaration_work_entry_ids IS NOT NULL
      AND cardinality(declaration_work_entry_ids) BETWEEN 1 AND 1000
    )
  );
