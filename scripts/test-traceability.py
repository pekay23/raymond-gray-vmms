"""Prove that incomplete scope cannot satisfy the project's completion gates."""

from copy import deepcopy
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("project-status.py")
spec = importlib.util.spec_from_file_location("project_status", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
requirements = module.read_json("docs/requirements/requirements.json")
tasks = module.read_json("docs/delivery/tasks.json")
assert module.validate_completion(requirements, tasks) == []

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

print("4 traceability gate checks passed, including missing scope and false completion rejection.")
