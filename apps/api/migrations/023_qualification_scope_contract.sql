-- Make competence records explicit about their applicability. Empty scopes and
-- any unevaluated restrictions are not usable for authority-sensitive actions.
ALTER TABLE staff_qualifications
  ADD COLUMN powertrain_classes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN vehicle_models text[] NOT NULL DEFAULT '{}',
  ADD COLUMN systems text[] NOT NULL DEFAULT '{}',
  ADD COLUMN task_classes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT staff_qualifications_restrictions_array
    CHECK (jsonb_typeof(restrictions) = 'array'),
  ADD CONSTRAINT staff_qualifications_scope_values_nonempty
    CHECK (array_position(powertrain_classes,'') IS NULL
       AND array_position(vehicle_models,'') IS NULL
       AND array_position(systems,'') IS NULL
       AND array_position(task_classes,'') IS NULL);

COMMENT ON COLUMN staff_qualifications.powertrain_classes IS 'Approved propulsion-class scope; an empty array is unscoped and never authorizes class-sensitive work.';
COMMENT ON COLUMN staff_qualifications.vehicle_models IS 'Approved model scope values; empty means not scoped to any model.';
COMMENT ON COLUMN staff_qualifications.systems IS 'Approved vehicle-system scope values; empty means no system scope is asserted.';
COMMENT ON COLUMN staff_qualifications.task_classes IS 'Approved task-class scope values; empty means no task-class scope is asserted.';
COMMENT ON COLUMN staff_qualifications.restrictions IS 'Structured restriction declarations. Non-empty restrictions remain ineligible until a matching evaluator exists.';

CREATE INDEX staff_qualifications_powertrain_scope
  ON staff_qualifications USING gin (powertrain_classes)
  WHERE state='accepted';
