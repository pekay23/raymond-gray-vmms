"""Append a dated decision and its evidence without rewriting prior entries."""

import argparse
import csv
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "docs/delivery/decisions.tsv"


def clean(value):
    result = str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")
    return "'" + result if result.startswith(("=", "+", "-", "@")) else result


def log(*, phase, decision, why, evidence, result):
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    exists = TARGET.exists()
    with TARGET.open("a", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t", lineterminator="\n")
        if not exists:
            writer.writerow(["ts", "phase", "decision", "why", "evidence", "result"])
        writer.writerow([datetime.now(timezone.utc).isoformat(), *map(clean, [phase, decision, why, evidence, result])])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("phase", "decision", "why", "evidence", "result"):
        parser.add_argument(f"--{name}", required=True)
    log(**vars(parser.parse_args()))
