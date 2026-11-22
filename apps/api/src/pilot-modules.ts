import { ApiError } from './errors.js';

export type PilotModule = 'sales' | 'finance-setup';
type RuntimeMode = 'development' | 'test' | 'staging' | 'production';

/** Sales and finance configuration stay testable but are unavailable outside isolated tests during the workshop pilot. */
export function requirePilotModule(_module: PilotModule, mode: RuntimeMode): void {
  if (mode === 'test') return;
  throw new ApiError(404, 'FEATURE_UNAVAILABLE', 'This feature is not available.');
}
