"""Prove that incomplete scope cannot satisfy the project's completion gates."""

from copy import deepcopy
import csv
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("project-status.py")
spec = importlib.util.spec_from_file_location("project_status", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
requirements = module.read_json("docs/requirements/requirements.json")
tasks = module.read_json("docs/delivery/tasks.json")
assert module.validate_completion(requirements, tasks) == []
source_ids = {
    block["id"]
    for source in ("master", "upgrade")
    for block in module.read_json(f"docs/sources/{source}.json")["blocks"]
}
assert module.validate_counts(requirements, source_ids) == []
assert module.validate_task_counts(tasks) == []
with Path("docs/delivery/decisions.tsv").open(encoding="utf-8", newline="") as decision_stream:
    decision_log = list(csv.reader(decision_stream, delimiter="\t"))
assert decision_log[0] == ["ts", "phase", "decision", "why", "evidence", "result"]
assert all(len(row) == 6 and all(value.strip() for value in row) for row in decision_log[1:])

stale_counts = deepcopy(requirements)
stale_counts["counts"]["requirements"] -= 1
assert any("counts.requirements is stale" in error for error in module.validate_counts(stale_counts, source_ids))
stale_counts = deepcopy(requirements)
stale_counts["counts"]["byStatus"]["planned"] -= 1
assert any("counts.byStatus is stale" in error for error in module.validate_counts(stale_counts, source_ids))

stale_task_counts = deepcopy(tasks)
stale_task_counts["counts"]["tasks"] -= 1
assert any("tasks.json counts.tasks is stale" in error for error in module.validate_task_counts(stale_task_counts))
stale_task_counts = deepcopy(tasks)
stale_task_counts["counts"]["byStatus"]["verified"] -= 1
assert any("tasks.json counts.byStatus is stale" in error for error in module.validate_task_counts(stale_task_counts))
stale_task_counts = deepcopy(tasks)
stale_task_counts["counts"]["byPhase"]["2-core-workflow"] -= 1
assert any("tasks.json counts.byPhase is stale" in error for error in module.validate_task_counts(stale_task_counts))

missing_build = deepcopy(requirements)
missing_build["requirements"] = [item for item in missing_build["requirements"] if item["id"] != "R-M-0008"]
tasks_without_build = deepcopy(tasks)
tasks_without_build["tasks"] = [item for item in tasks_without_build["tasks"] if item["id"] != "BUILD-R-M-0008"]
missing_build["requirements"].append(next(item for item in requirements["requirements"] if item["id"] == "R-M-0008"))
assert any("requires a BUILD implementation task" in error for error in module.validate_requirement_tasks(missing_build, tasks_without_build))

tasks_without_check = deepcopy(tasks)
tasks_without_check["tasks"] = [item for item in tasks_without_check["tasks"] if item["id"] != "CHECK-R-M-0008"]
assert any("requires a CHECK verification task" in error for error in module.validate_requirement_tasks(requirements, tasks_without_check))

tasks_with_unlinked_check = deepcopy(tasks)
check_task = next(item for item in tasks_with_unlinked_check["tasks"] if item["id"] == "CHECK-R-M-0008")
check_task["dependencies"].remove("BUILD-R-M-0008")
assert any("CHECK task must depend on its BUILD task" in error for error in module.validate_requirement_tasks(requirements, tasks_with_unlinked_check))

broken_links = deepcopy(requirements)
broken_coverage = next(item for item in broken_links["sourceCoverage"] if item["requirementIds"])
broken_coverage["requirementIds"].pop()
assert any("is not reciprocal" in error for error in module.validate_source_links(broken_links))

unlinked_requirement = deepcopy(tasks)
unlinked_requirement["tasks"] = [item for item in unlinked_requirement["tasks"] if "R-M-0008" not in item["requirementIds"]]
assert any("no linked implementation or decision task" in error for error in module.validate_requirement_tasks(requirements, unlinked_requirement))

missing_work = deepcopy(tasks)
gate = next(item for item in missing_work["tasks"] if item["id"] == "G-003")
gate["completionGate"]["requiredTaskIds"].pop()
assert any("omits current scope" in error for error in module.validate_completion(requirements, missing_work))

false_completion = deepcopy(tasks)
gate = next(item for item in false_completion["tasks"] if item["id"] == "G-003")
gate["status"] = "verified"
gate["evidence"] = ["docs/verification/README.md"]
assert any("verified gate has unfinished" in error for error in module.validate_completion(requirements, false_completion))

false_epic = deepcopy(tasks)
epic = next(item for item in false_epic["tasks"] if item["kind"] == "epic")
epic["status"] = "verified"
epic["evidence"] = ["docs/verification/README.md"]
assert any("verified epic has unfinished" in error for error in module.validate_completion(requirements, false_epic))

print("Traceability assertions passed, including decision log integrity, stale counts, reciprocal links, BUILD/CHECK paths and false completion rejection.")
