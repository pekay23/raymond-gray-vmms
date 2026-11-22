ALTER TABLE public.work_order_task_activity
  DROP CONSTRAINT work_order_task_activity_request_type_check;

ALTER TABLE public.work_order_task_activity
  ADD CONSTRAINT work_order_task_activity_request_type_check
  CHECK (request_type IS NULL OR request_type IN ('help','parts','information','access','evidence','supervisor-review'));
