import assert from "node:assert/strict";
import test from "node:test";
import type { Site } from "./api";
import { workspaceCapabilities, workspaceHomePath } from "./workspace-navigation";

function site(roleCodes: string[], id = "10000000-0000-4000-8000-000000000001"): Site {
  return {
    id,
    name: "Synthetic Service Centre",
    code: "SYN",
    timeZone: "Africa/Accra",
    canWrite: true,
    roleCodes,
  };
}

test("workshop roles receive operational destinations but Operator stays account-only", () => {
  const capabilities = workspaceCapabilities(site(["head-service-centre", "vmms-operator"]));
  assert.equal(capabilities.canOpenToday, true);
  assert.equal(capabilities.canOpenWorkOrders, true);
  assert.equal(capabilities.canManageStaffAccounts, true);
  assert.equal(capabilities.operatorOnly, false);
});

test("sales-only staff can record and review their own requests without seeing workshop jobs", () => {
  const capabilities = workspaceCapabilities(site(["sales-representative"]));
  assert.equal(capabilities.canOpenToday, true);
  assert.equal(capabilities.canOpenRequests, true);
  assert.equal(capabilities.canOpenVehicleHistory, true);
  assert.equal(capabilities.canOpenWorkOrders, false);
  assert.equal(capabilities.canRegisterVisit, false);
  assert.equal(workspaceHomePath(site(["sales-representative"])), "/sites/10000000-0000-4000-8000-000000000001/sales-deliveries");
});

test("Operator-only landing remains account administration", () => {
  const accountSite = site(["vmms-operator"]);
  const capabilities = workspaceCapabilities(accountSite);
  assert.equal(capabilities.operatorOnly, true);
  assert.equal(capabilities.canOpenToday, false);
  assert.equal(capabilities.canOpenRequests, false);
  assert.equal(capabilities.canOpenWorkOrders, false);
  assert.equal(capabilities.canManageStaffAccounts, true);
  assert.equal(workspaceHomePath(accountSite), "/sites/10000000-0000-4000-8000-000000000001/staff/accounts");
});

test("Technician landing exposes personal task queue and not vehicle or Head reports", () => {
  const capabilities = workspaceCapabilities(site(["technician-engineer-trainee"]));
  assert.equal(capabilities.canOpenToday, true);
  assert.equal(capabilities.canOpenWorkOrders, true);
  assert.equal(capabilities.canOpenMyTasks, true);
  assert.equal(capabilities.canOpenVehicleHistory, false);
  assert.equal(capabilities.canOpenHeadOverview, false);
});

test("read-only workshop access cannot register a new visit", () => {
  const readOnly = { ...site(["service-advisor"]), canWrite: false };
  assert.equal(workspaceCapabilities(readOnly).canOpenWorkOrders, true);
  assert.equal(workspaceCapabilities(readOnly).canRegisterVisit, false);
});

test("site landing is calculated from the selected site role set", () => {
  const workshop = site(["service-advisor"], "10000000-0000-4000-8000-000000000003");
  const sales = site(["sales-representative"], "10000000-0000-4000-8000-000000000004");
  assert.equal(workspaceHomePath(workshop), "/sites/10000000-0000-4000-8000-000000000003/today");
  assert.equal(workspaceHomePath(sales), "/sites/10000000-0000-4000-8000-000000000004/sales-deliveries");
});

test("vehicle learning is available to every after-sales role including Head, technician and trainee", () => {
  for (const role of ["head-service-centre","ev-team-lead","ice-team-lead","supervisor","technician-engineer-trainee","service-advisor","quality-inspector","parts-inventory","warranty-customer-support","finance-billing","compliance-records-hr"]) {
    assert.equal(workspaceCapabilities(site([role])).canOpenVehicleLearning,true,role);
  }
  assert.equal(workspaceCapabilities(site(["sales-representative"])).canOpenVehicleLearning,false);
  assert.equal(workspaceCapabilities(site(["vmms-operator"])).canOpenVehicleLearning,false);
});

test("Finance setup is discoverable to staff but does not grant access to Operator-only accounts", () => {
  assert.equal(workspaceCapabilities(site(["head-service-centre"])).canOpenFinanceSetup, true);
  assert.equal(workspaceCapabilities(site(["finance-billing"])).canOpenFinanceSetup, true);
  assert.equal(workspaceCapabilities(site(["sales-representative"])).canOpenFinanceSetup, true);
  assert.equal(workspaceCapabilities(site(["vmms-operator"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site([])).canOpenFinanceSetup, false);
});
