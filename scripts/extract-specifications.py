"""Extract paragraph and table text from the authoritative DOCX inputs."""

import hashlib
import json
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "sources"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
INPUTS = {
    "master": "Raymond_Gray_VMMS_Master_Functional_Specification.docx",
    "upgrade": "Raymond_Gray_VMMS_Upgrade_Implementation_Prompt.docx",
}


def extract(key: str, filename: str) -> dict:
    source = ROOT / filename
    if not source.exists():
        source = OUT / filename
    payload = source.read_bytes()
    with ZipFile(source) as doc:
        body = ET.fromstring(doc.read("word/document.xml")).find("w:body", NS)
    blocks = []
    for element in body:
        if element.tag.endswith("}p"):
            text = "".join(
                node.text or "" for node in element.findall(".//w:t", NS)
            )
            if text.strip():
                blocks.append({"id": f"{key}-{len(blocks) + 1:04}", "kind": "paragraph", "text": text})
        elif element.tag.endswith("}tbl"):
            for row in element.findall("w:tr", NS):
                cells = [" ".join("".join(t.text or "" for t in p.findall(".//w:t", NS)) for p in cell.findall("w:p", NS)) for cell in row.findall("w:tc", NS)]
                blocks.append({"id": f"{key}-{len(blocks) + 1:04}", "kind": "table-row", "text": " | ".join(cells)})
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / filename
    if source.resolve() != target.resolve():
        shutil.copy2(source, target)
    (OUT / f"{key}.md").write_text(f"# {filename}\n\n" + "\n\n".join(f"[{b['id']}] {b['text']}" for b in blocks) + "\n", encoding="utf-8")
    result = {"file": filename, "sha256": hashlib.sha256(payload).hexdigest(), "blocks": blocks}
    (OUT / f"{key}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"key": key, "file": filename, "sha256": result["sha256"], "blocks": len(blocks)}


if __name__ == "__main__":
    manifests = [extract(key, filename) for key, filename in INPUTS.items()]
    (OUT / "manifest.json").write_text(json.dumps(manifests, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifests, indent=2))
