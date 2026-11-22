import assert from "node:assert/strict";
import test from "node:test";
import type { Site } from "./api";
import { todayWorkQueues, workspaceCapabilities, workspaceHomePath } from "./workspace-navigation";

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

test("sales-only staff can record service requests while Sales pages remain outside the workshop pilot", () => {
  const capabilities = workspaceCapabilities(site(["sales-representative"]));
  assert.equal(capabilities.canOpenToday, true);
  assert.equal(capabilities.canOpenRequests, true);
  assert.equal(capabilities.canOpenVehicleHistory, true);
  assert.equal(capabilities.canOpenSalesDeliveries, false);
  assert.equal(capabilities.canOpenWorkOrders, false);
  assert.equal(capabilities.canRegisterVisit, false);
  assert.equal(workspaceHomePath(site(["sales-representative"])), "/sites/10000000-0000-4000-8000-000000000001/today");
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
  assert.equal(capabilities.canOpenServiceHistory, true);
  assert.equal(capabilities.canOpenHeadOverview, false);
});

test("service history is available to workshop roles without granting it to sales-only staff or the Operator", () => {
  for (const role of ["head-service-centre", "service-advisor", "ev-team-lead", "ice-team-lead", "supervisor", "technician-engineer-trainee"]) {
    assert.equal(workspaceCapabilities(site([role])).canOpenServiceHistory, true, role);
  }
  for (const role of ["sales-representative", "pdi-observer", "vmms-operator", "finance-billing"]) {
    assert.equal(workspaceCapabilities(site([role])).canOpenServiceHistory, false, role);
  }
});

test("read-only workshop access cannot register a new visit", () => {
  const readOnly = { ...site(["service-advisor"]), canWrite: false };
  assert.equal(workspaceCapabilities(readOnly).canOpenWorkOrders, true);
  assert.equal(workspaceCapabilities(readOnly).canRegisterVisit, false);
});

test("site landing is calculated from the selected site role set and stays in the workshop pilot", () => {
  const workshop = site(["service-advisor"], "10000000-0000-4000-8000-000000000003");
  const sales = site(["sales-representative"], "10000000-0000-4000-8000-000000000004");
  assert.equal(workspaceHomePath(workshop), "/sites/10000000-0000-4000-8000-000000000003/today");
  assert.equal(workspaceHomePath(sales), "/sites/10000000-0000-4000-8000-000000000004/today");
});

test("vehicle learning is available to every after-sales role including Head, technician and trainee", () => {
  for (const role of ["head-service-centre","ev-team-lead","ice-team-lead","supervisor","technician-engineer-trainee","service-advisor","quality-inspector","parts-inventory","warranty-customer-support","finance-billing","compliance-records-hr"]) {
    assert.equal(workspaceCapabilities(site([role])).canOpenVehicleLearning,true,role);
  }
  assert.equal(workspaceCapabilities(site(["sales-representative"])).canOpenVehicleLearning,false);
  assert.equal(workspaceCapabilities(site(["vmms-operator"])).canOpenVehicleLearning,false);
});

test("Finance setup stays outside the workshop pilot for every role", () => {
  assert.equal(workspaceCapabilities(site(["head-service-centre"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["finance-billing"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["head-service-centre", "finance-billing"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["finance-billing"])).canOpenWorkOrders, false);
  assert.equal(workspaceCapabilities(site(["finance-billing"])).canOpenVehicleLearning, true);
  assert.equal(workspaceCapabilities(site(["service-advisor"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["technician-engineer-trainee"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["compliance-records-hr"])).canOpenWorkOrders, false);
  assert.equal(workspaceCapabilities(site(["compliance-records-hr"])).canOpenVehicleLearning, true);
  assert.equal(workspaceCapabilities(site(["compliance-records-hr"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["sales-representative"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site(["vmms-operator"])).canOpenFinanceSetup, false);
  assert.equal(workspaceCapabilities(site([])).canOpenFinanceSetup, false);
});

test("Today builds the right work previews for combined workshop roles", () => {
  assert.deepEqual(todayWorkQueues(["head-service-centre", "ev-team-lead", "supervisor", "technician-engineer-trainee"]).map(({ key }) => key), [
    "operations-review",
    "lead-assignment",
    "team-lead",
    "supervisor",
    "task-reviews",
    "diagnostic-reviews",
    "checklist-reviews",
    "assigned-tasks",
  ]);
  assert.deepEqual(todayWorkQueues(["service-advisor"]).map(({ key }) => key), []);
  assert.deepEqual(todayWorkQueues(["supervisor"]).map(({ key }) => key), ["supervisor", "task-reviews", "checklist-reviews"]);
  assert.deepEqual(todayWorkQueues(["ev-team-lead"]).map(({ key }) => key), ["team-lead", "task-reviews", "diagnostic-reviews", "checklist-reviews"]);
  assert.deepEqual(todayWorkQueues(["vmms-operator"]), []);
});
