"""Convert eval/cases/pay-risk.json (35 synthetic dialogs) into data/labeled/seed.jsonl."""
import json
from common import ROOT

cases = json.loads((ROOT / "eval/cases/pay-risk.json").read_text())["cases"]
with open(ROOT / "data/labeled/seed.jsonl", "w", encoding="utf-8") as f:
    for c in cases:
        text = "\n".join(f"{m['from']}: {m['text']}" for m in c["messages"])
        f.write(json.dumps({
            "id": "seed-" + c["id"], "source": "synthetic-eval", "language": c["lang"],
            "text": text, "label": "scam" if c["expect"] == "risk" else "honest",
            "scam_type": ",".join(c.get("signals") or []) if c["expect"] == "risk" else "",
            "notes": "from eval/cases/pay-risk.json",
        }, ensure_ascii=False) + "\n")
print(len(cases), "rows")
