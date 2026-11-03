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


WS_RE = re.compile(r"\s+", re.UNICODE)


def char_ngrams(text, nmin=2, nmax=4):
    """sklearn char_wb semantics: per whitespace word, padded with spaces."""
    out = []
    for w in WS_RE.sub(" ", text.lower()).split():
        w = " " + w + " "
        for n in range(nmin, nmax + 1):
            if len(w) <= n:  # sklearn counts a short/exact word once, then stops
                out.append(w)
                break
            out += [w[i:i + n] for i in range(len(w) - n + 1)]
    return out


def analyze(text, p):
    if p.get("analyzer") == "char_wb":
        return char_ngrams(text, p.get("char_min", 2), p.get("char_max", 4))
    return tokenize(text, p["ngram_max"])


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
