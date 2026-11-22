import type { Site } from "./api";

const workOrderRoleCodes = [
  "head-service-centre",
  "ev-team-lead",
  "ice-team-lead",
  "supervisor",
  "technician-engineer-trainee",
  "service-advisor",
  "quality-inspector",
  "parts-inventory",
  "warranty-customer-support",
] as const;

const vehicleLearningRoleCodes = [
  ...workOrderRoleCodes,
  "finance-billing",
  "compliance-records-hr",
] as const;

const vehicleHistoryRoleCodes = [
  "head-service-centre",
  "sales-representative",
  "pdi-observer",
] as const;

const serviceHistoryRoleCodes = [
  "head-service-centre",
  "service-advisor",
  "ev-team-lead",
  "ice-team-lead",
  "supervisor",
  "technician-engineer-trainee",
] as const;

// The first staff rollout is the after-sales workshop pilot. Keep Sales and
// Finance setup out of its navigation and direct page routes until those
// workstreams are brought into the pilot deliberately.
const pilotModules = {
  salesDeliveries: false,
  financeSetup: false,
} as const;

export function workspaceCapabilities(site: Pick<Site, "roleCodes" | "canWrite">) {
  const roles = new Set(site.roleCodes);
  const hasStaffRole = site.roleCodes.some((role) => role !== "vmms-operator");
  const hasWorkOrderRole = workOrderRoleCodes.some((role) => roles.has(role));
  const canViewVehicleHistory = vehicleHistoryRoleCodes.some((role) => roles.has(role));
  const hasOperatorRole = roles.has("vmms-operator");
  const operatorOnly = hasOperatorRole && !hasStaffRole;

  return {
    hasStaffRole,
    hasWorkOrderRole,
    canOpenToday: hasStaffRole,
    canOpenRequests: hasStaffRole,
    canOpenWorkOrders: hasWorkOrderRole,
    canOpenVehicleHistory: canViewVehicleHistory,
    canOpenSalesDeliveries: pilotModules.salesDeliveries && canViewVehicleHistory,
    canOpenServiceHistory: serviceHistoryRoleCodes.some((role) => roles.has(role)),
    canOpenMyTasks: roles.has("technician-engineer-trainee"),
    canOpenHeadOverview: roles.has("head-service-centre"),
    canManageTeam: roles.has("head-service-centre"),
    canSendStaffMessages: roles.has("head-service-centre"),
    canManageStaffAccounts: hasOperatorRole,
    canOpenDocuments: hasStaffRole || operatorOnly,
    canOpenVehicleLearning: vehicleLearningRoleCodes.some((role) => roles.has(role)),
    canOpenFinanceSetup: pilotModules.financeSetup && roles.has("finance-billing"),
    canRegisterVisit: hasWorkOrderRole && site.canWrite,
    operatorOnly,
  };
}

export type TodayWorkQueue =
  | { kind: "work-orders"; key: string; title: string; description: string; queue: "awaiting-operations" | "awaiting-lead" | "team-lead" | "supervisor"; action: string }
  | { kind: "task-reviews"; key: "task-reviews"; title: string; description: string; action: string }
  | { kind: "diagnostic-reviews"; key: "diagnostic-reviews"; title: string; description: string; action: string }
  | { kind: "checklist-reviews"; key: "checklist-reviews"; title: string; description: string; action: string }
  | { kind: "assigned-tasks"; key: string; title: string; description: string; action: string };

/** Build the Today work preview from the staff member's active site roles. */
export function todayWorkQueues(roleCodes: readonly string[]): TodayWorkQueue[] {
  const roles = new Set(roleCodes);
  const queues: TodayWorkQueue[] = [];

  if (roles.has("head-service-centre")) {
    queues.push(
      { kind: "work-orders", key: "operations-review", title: "Jobs to review", description: "New or changed jobs waiting for Operations review.", queue: "awaiting-operations", action: "Review job" },
      { kind: "work-orders", key: "lead-assignment", title: "Jobs needing a team lead", description: "Reviewed jobs that still need a qualified lead assigned.", queue: "awaiting-lead", action: "Assign lead" },
    );
  }
  if (roles.has("ev-team-lead") || roles.has("ice-team-lead")) {
    queues.push({ kind: "work-orders", key: "team-lead", title: "Jobs assigned to you", description: "Prepare plans and hand work to a Supervisor.", queue: "team-lead", action: "Continue job" });
  }
  if (roles.has("supervisor")) {
    queues.push({ kind: "work-orders", key: "supervisor", title: "Jobs with your team", description: "Review work assigned to your team and follow task progress.", queue: "supervisor", action: "Open job" });
  }
  if (roles.has("head-service-centre") || roles.has("ev-team-lead") || roles.has("ice-team-lead") || roles.has("supervisor")) {
    queues.push({ kind: "task-reviews", key: "task-reviews", title: "Technician reviews to answer", description: "Review requests from assigned technicians that still need a response.", action: "Open job" });
  }
  if (roles.has("head-service-centre") || roles.has("ev-team-lead") || roles.has("ice-team-lead")) {
    queues.push({ kind: "diagnostic-reviews", key: "diagnostic-reviews", title: "Latest diagnostic findings", description: "Review recorded findings, uncertainty, residual risks and restrictions for your jobs.", action: "Review finding" });
  }
  if (roles.has("head-service-centre") || roles.has("ev-team-lead") || roles.has("ice-team-lead") || roles.has("supervisor")) {
    queues.push({ kind: "checklist-reviews", key: "checklist-reviews", title: "Checklist records to review", description: "Confirm that a technician's record is supported or return it for correction.", action: "Review record" });
  }
  if (roles.has("technician-engineer-trainee")) {
    queues.push({ kind: "assigned-tasks", key: "assigned-tasks", title: "Your assigned tasks", description: "Acknowledge work and record updates, findings and evidence.", action: "Open my tasks" });
  }
  return queues;
}

export function workspaceHomePath(site: Site): string {
  const capabilities = workspaceCapabilities(site);
  if (capabilities.operatorOnly) return `/sites/${site.id}/staff/accounts`;
  return `/sites/${site.id}/today`;
}
