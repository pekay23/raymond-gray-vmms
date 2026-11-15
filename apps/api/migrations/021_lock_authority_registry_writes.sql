-- Authority and qualification records must be provisioned through a separately
-- controlled governance path. Ordinary runtime sessions can inspect but not mint them.
REVOKE INSERT, UPDATE, DELETE ON staff_authority_grants, staff_qualifications FROM vmms_runtime;
GRANT SELECT ON staff_authority_grants, staff_qualifications TO vmms_runtime;
