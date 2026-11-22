CREATE INDEX staff_qualifications_eligible_candidates
  ON staff_qualifications (
    organisation_id,
    site_id,
    qualification_code,
    staff_user_id,
    qualification_revision DESC
  )
  WHERE state = 'accepted' AND restrictions = '[]'::jsonb;
