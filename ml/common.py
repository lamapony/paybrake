"""Shared helpers. Tokenizer must match extension/lib/ml-scorer.js exactly."""
import json, re
from pathlib import Path

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ["id", "source", "language", "text", "label", "scam_type", "notes"]


def tokenize(text, ngram_max=2):
    toks = TOKEN_RE.findall(text.lower())
    out = list(toks)
    for n in range(2, ngram_max + 1):
        out += [" ".join(toks[i:i + n]) for i in range(len(toks) - n + 1)]
    return out


def load(paths):
    rows = []
    for p in paths:
        for i, line in enumerate(Path(p).read_text(encoding="utf-8").splitlines()):
            if not line.strip():
                continue
            r = json.loads(line)
            missing = [k for k in REQUIRED if k not in r]
            if missing:
                raise ValueError(f"{p}:{i+1} missing {missing}")
            if r["label"] not in ("scam", "honest"):
                raise ValueError(f"{p}:{i+1} bad label {r['label']}")
            rows.append(r)
    return rows


def default_paths():
    return sorted(str(p) for p in (ROOT / "data" / "labeled").glob("*.jsonl"))
