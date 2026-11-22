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
    'workforce-site-activity-read-prepared',
    'staff-messages-read-prepared',
    'staff-account-requests-read-prepared',
    'service-request-read-prepared',
    'vehicle-sales-history-read-prepared',
    'work-order-task-activity-read-prepared',
    'work-order-task-work-entries-read-prepared',
    'work-order-task-work-evidence-options-read-prepared',
    'work-order-service-report-read-prepared',
    'work-order-source-reports-read-prepared',
    'vehicle-learning-activity-read-prepared',
    'vehicle-learning-review-queue-read-prepared',
    'vehicle-learning-library-read-prepared',
    'finance-configuration-draft-read-prepared',
    'work-order-checklists-read-prepared',
    'my-task-checklist-items-read',
    'work-order-checklist-outcomes-read-prepared',
    'work-order-checklist-report-read-prepared',
    'work-order-scope-proposals-read-prepared',
    'work-order-scope-payer-responses-read-prepared',
    'work-order-task-labor-read-prepared'
  ));
