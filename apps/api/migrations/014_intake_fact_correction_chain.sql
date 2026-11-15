CREATE UNIQUE INDEX intake_facts_single_successor_idx
  ON intake_facts (organisation_id, site_id, work_order_id, supersedes_fact_id)
  WHERE supersedes_fact_id IS NOT NULL;
