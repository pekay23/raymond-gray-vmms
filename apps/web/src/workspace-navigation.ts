import type { Site } from "./api";

const workshopRoleCodes = [
  "head-service-centre",
  "ev-team-lead",
  "ice-team-lead",
  "supervisor",
  "technician-engineer-trainee",
  "service-advisor",
  "quality-inspector",
  "parts-inventory",
  "warranty-customer-support",
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
  const hasWorkshopRole = workshopRoleCodes.some((role) => roles.has(role));
  const canViewVehicleHistory = vehicleHistoryRoleCodes.some((role) => roles.has(role));
  const hasOperatorRole = roles.has("vmms-operator");
  const operatorOnly = hasOperatorRole && !hasStaffRole;

  return {
    hasStaffRole,
    hasWorkshopRole,
    canOpenToday: hasStaffRole,
    canOpenRequests: hasStaffRole,
    canOpenWorkOrders: hasWorkshopRole,
    canOpenVehicleHistory: canViewVehicleHistory,
    canOpenMyTasks: roles.has("technician-engineer-trainee"),
    canOpenHeadOverview: roles.has("head-service-centre"),
    canManageTeam: roles.has("head-service-centre"),
    canSendStaffMessages: roles.has("head-service-centre"),
    canManageStaffAccounts: hasOperatorRole,
    canOpenDocuments: hasStaffRole || operatorOnly,
    canOpenVehicleLearning: hasWorkshopRole,
    canOpenFinanceSetup: hasStaffRole,
    canRegisterVisit: hasWorkshopRole && site.canWrite,
    operatorOnly,
  };
}

export function workspaceHomePath(site: Site): string {
  const capabilities = workspaceCapabilities(site);
  if (capabilities.operatorOnly) return `/sites/${site.id}/staff/accounts`;
  if (!capabilities.hasWorkshopRole && capabilities.canOpenVehicleHistory)
    return `/sites/${site.id}/sales-deliveries`;
  return `/sites/${site.id}/today`;
}
