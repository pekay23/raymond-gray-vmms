"""Validate traceability and generate the human-readable implementation tracker."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def read_json(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf-8-sig"))


def validate():
    requirements_doc = read_json("docs/requirements/requirements.json")
    tasks_doc = read_json("docs/delivery/tasks.json")
    requirements = requirements_doc["requirements"]
    tasks = tasks_doc["tasks"]
    errors = []
    req_ids = {r["id"] for r in requirements}
    task_ids = {t["id"] for t in tasks}
    if len(req_ids) != len(requirements):
        errors.append("Duplicate requirement IDs")
    if len(task_ids) != len(tasks):
        errors.append("Duplicate task IDs")
    source_ids = set()
    for key in ("master", "upgrade"):
        source_ids.update(b["id"] for b in read_json(f"docs/sources/{key}.json")["blocks"])
    covered = set()
    for item in requirements_doc["sourceCoverage"]:
        ref = item["sourceRef"]
        if ref in covered:
            errors.append(f"Duplicate source coverage reference {ref}")
        covered.add(ref)
        if ref not in source_ids:
            errors.append(f"Unknown source coverage reference {ref}")
        if any(r not in req_ids for r in item["requirementIds"]):
            errors.append(f"Invalid coverage mapping for {ref}")
    missing = source_ids - covered
    if missing:
        errors.append(f"Unaccounted source blocks: {sorted(missing)}")
    for requirement in requirements:
        for ref in requirement["sourceRefs"]:
            if ref.startswith(("master-", "upgrade-")) and ref not in source_ids:
                errors.append(f"{requirement['id']}: unknown source {ref}")
        if requirement["status"] in ("done", "completed", "verified") and not requirement["evidence"]:
            errors.append(f"{requirement['id']}: completion without evidence")
        if not requirement["acceptance"]:
            errors.append(f"{requirement['id']}: no acceptance criteria")
    for task in tasks:
        if any(r not in req_ids for r in task["requirementIds"]):
            errors.append(f"{task['id']}: unknown requirement")
        if any(d not in task_ids for d in task["dependencies"]):
            errors.append(f"{task['id']}: unknown dependency")
        if task.get("parentId") and task["parentId"] not in task_ids:
            errors.append(f"{task['id']}: unknown parent")
        if task["status"] in ("done", "completed", "verified") and not task["evidence"]:
            errors.append(f"{task['id']}: completion without evidence")
        if not task["acceptance"]:
            errors.append(f"{task['id']}: no acceptance criteria")
    by_id = {t["id"]: t for t in tasks}
    active, visited = set(), set()

    def visit(task_id):
        if task_id in active:
            errors.append(f"Dependency cycle at {task_id}")
            return
        if task_id in visited or task_id not in by_id:
            return
        active.add(task_id)
        for dep in by_id[task_id]["dependencies"]:
            visit(dep)
        active.remove(task_id)
        visited.add(task_id)

    for task_id in by_id:
        visit(task_id)
    errors.extend(validate_completion(requirements_doc, tasks_doc))
    return requirements_doc, tasks_doc, errors


def validate_completion(requirements_doc, tasks_doc):
    errors = []
    tasks = {item["id"]: item for item in tasks_doc["tasks"]}
    requirements = {item["id"]: item for item in requirements_doc["requirements"]}
    allowed = set(requirements_doc["statusDefinitions"])

    def terminal(item):
        if item["status"] == "verified":
            return bool(item["evidence"])
        if item["status"] != "not-applicable":
            return False
        decision = item.get("applicabilityDecision", item.get("decision", {}))
        return bool(decision.get("reference") and decision.get("note") and decision.get("status") in ("approved", "resolved"))

    def ancestors(task_id, seen=None):
        seen = set() if seen is None else seen
        for dependency in tasks.get(task_id, {}).get("dependencies", []):
            if dependency not in seen:
                seen.add(dependency)
                ancestors(dependency, seen)
        return seen

    for item in list(tasks.values()) + list(requirements.values()):
        if item["status"] not in allowed:
            errors.append(f"{item['id']}: unknown status {item['status']}")
        if item["status"] == "not-applicable" and not terminal(item):
            errors.append(f"{item['id']}: inapplicable status requires an explicit referenced scope decision")
    for task in tasks.values():
        gate = task.get("completionGate")
        if gate:
            needed_tasks = set(gate.get("requiredTaskIds", []))
            needed_reqs = set(gate.get("requiredRequirementIds", []))
            if needed_tasks - tasks.keys() or needed_reqs - requirements.keys():
                errors.append(f"{task['id']}: gate references unknown tasks or requirements")
            if needed_tasks - ancestors(task["id"]):
                errors.append(f"{task['id']}: gate tasks are absent from dependency ancestry")
            if gate["scope"] == "full-completion":
                all_work = {item["id"] for item in tasks.values() if item["kind"] != "epic" and item["id"] != task["id"]}
                if all_work != needed_tasks or set(requirements) != needed_reqs:
                    errors.append(f"{task['id']}: full-completion gate omits current scope")
            if gate["scope"] == "launch" and needed_reqs != set(requirements_doc.get("launchRequirementIds", [])):
                errors.append(f"{task['id']}: launch requirement manifest disagrees with gate")
            if task["status"] == "verified":
                unfinished = [key for key in needed_tasks if key in tasks and not terminal(tasks[key])]
                unfinished += [key for key in needed_reqs if key in requirements and not terminal(requirements[key])]
                if unfinished:
                    errors.append(f"{task['id']}: verified gate has unfinished requirements or tasks: {unfinished[:8]}")
        if task["kind"] == "epic" and task["status"] == "verified":
            children = [item for item in tasks.values() if item.get("parentId") == task["id"]]
            if any(not terminal(item) for item in children):
                errors.append(f"{task['id']}: verified epic has unfinished children")
        if task["status"] == "verified" and any(dep in tasks and not terminal(tasks[dep]) for dep in task["dependencies"]):
            errors.append(f"{task['id']}: verified task has unfinished dependencies")
    return errors


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def render(requirements_doc, tasks_doc):
    requirements = requirements_doc["requirements"]
    tasks = tasks_doc["tasks"]
    lines = ["# Implementation tracker", "", "Generated by `python scripts/project-status.py --write`. Edit the JSON sources, then regenerate this file.", "", "The product goal remains open until the specification, approved rollout scope, operational checks and management acceptance have evidence. Counts include epics and individual tasks; they are not a percentage of engineering effort.", "", "## Current counts", "", "| Record | Status | Count |", "| --- | --- | ---: |"]
    for kind, records in (("Requirements", requirements), ("Tasks including epics", tasks)):
        for status, count in sorted(Counter(r["status"] for r in records).items()):
            lines.append(f"| {kind} | {cell(status)} | {count} |")
    for phase in dict.fromkeys(t["phase"] for t in tasks):
        lines.extend(["", f"## {phase}", "", "| ID | Task | Status | Dependencies | Evidence |", "| --- | --- | --- | --- | --- |"])
        for task in (t for t in tasks if t["phase"] == phase):
            evidence = ", ".join(e if isinstance(e, str) else json.dumps(e, ensure_ascii=False) for e in task["evidence"])
            lines.append(f"| {task['id']} | {cell(task['title'])} | {cell(task['status'])} | {cell(', '.join(task['dependencies']))} | {cell(evidence)} |")
    lines.extend(["", "## Requirement status", "", "See [the complete requirement data](../requirements/requirements.json) for acceptance criteria, SOP mapping, server controls, migration, UAT, decisions and evidence.", "", "| ID | Requirement | Module | Status | Source |", "| --- | --- | --- | --- | --- |"])
    for req in requirements:
        lines.append(f"| {req['id']} | {cell(req['title'])} | {cell(req['module'])} | {cell(req['status'])} | {cell(', '.join(req['sourceRefs']))} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate the Markdown tracker after validation")
    args = parser.parse_args()
    try:
        requirements_doc, tasks_doc, errors = validate()
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"Traceability input error: {exc}", file=sys.stderr)
        sys.exit(1)
    target = ROOT / "docs/delivery/implementation-tracker.md"
    content = render(requirements_doc, tasks_doc)
    if not errors and args.write:
        target.write_text(content, encoding="utf-8")
    elif not errors and (not target.exists() or target.read_text(encoding="utf-8") != content):
        errors.append("Tracker is stale; run python scripts/project-status.py --write")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"requirements": len(requirements_doc["requirements"]), "tasks": len(tasks_doc["tasks"]), "sourceBlocks": len(requirements_doc["sourceCoverage"]), "validation": "passed"}))
