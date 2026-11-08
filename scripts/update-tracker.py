"""Update one task or requirement with explicit evidence, then refresh counts."""

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUSES = ("planned", "in-progress", "implemented", "verified", "configuration-required", "blocked", "deferred", "not-applicable")


def update(*, record_id, status, evidence, reason, requirement=False):
    relative = "docs/requirements/requirements.json" if requirement else "docs/delivery/tasks.json"
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    key = "requirements" if requirement else "tasks"
    item = next((item for item in data[key] if item["id"] == record_id), None)
    if item is None:
        raise ValueError(f"Unknown {key} ID {record_id}")
    if status in ("verified", "not-applicable") and not evidence:
        raise ValueError("Verified or inapplicable status needs explicit evidence")
    for reference in evidence:
        if not (ROOT / reference).exists():
            raise ValueError(f"Evidence path does not exist: {reference}")
    item["status"] = status
    item["evidence"] = list(dict.fromkeys(item["evidence"] + evidence))
    if reason:
        item["statusNote"] = reason
    data["updatedAt"] = date.today().isoformat()
    data["counts"]["byStatus"] = dict(sorted(Counter(i["status"] for i in data[key]).items()))
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return item


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record_id")
    parser.add_argument("status", choices=STATUSES)
    parser.add_argument("--requirement", action="store_true")
    parser.add_argument("--evidence", action="append", default=[])
    parser.add_argument("--reason", default="")
    args = parser.parse_args()
    item = update(record_id=args.record_id, status=args.status, evidence=args.evidence, reason=args.reason, requirement=args.requirement)
    print(f"{item['id']}: {item['status']}")
