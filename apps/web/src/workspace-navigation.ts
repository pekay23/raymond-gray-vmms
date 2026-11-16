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
    canOpenMyTasks: roles.has("technician-engineer-trainee"),
    canOpenHeadOverview: roles.has("head-service-centre"),
    canManageTeam: roles.has("head-service-centre"),
    canSendStaffMessages: roles.has("head-service-centre"),
    canManageStaffAccounts: hasOperatorRole,
    canOpenDocuments: hasStaffRole || operatorOnly,
    canOpenVehicleLearning: vehicleLearningRoleCodes.some((role) => roles.has(role)),
    canOpenFinanceSetup: roles.has("finance-billing"),
    canRegisterVisit: hasWorkOrderRole && site.canWrite,
    operatorOnly,
  };
}

export function workspaceHomePath(site: Site): string {
  const capabilities = workspaceCapabilities(site);
  if (capabilities.operatorOnly) return `/sites/${site.id}/staff/accounts`;
  if (!capabilities.hasWorkOrderRole && capabilities.canOpenVehicleHistory)
    return `/sites/${site.id}/sales-deliveries`;
  return `/sites/${site.id}/today`;
}
