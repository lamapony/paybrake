"""Load public pretrain CSVs (see DATA_SOURCES.md; fetch with ml/fetch_datasets.py).
Raw files live outside git (default ../paybrake-datasets or $PAYBRAKE_DATASETS)."""
import csv, os, random, sys
from pathlib import Path
from common import ROOT

csv.field_size_limit(sys.maxsize)
DIR = Path(os.environ.get("PAYBRAKE_DATASETS", ROOT.parent / "paybrake-datasets"))
# file -> (text column, label column, max rows sampled)
SOURCES = {
    "BothBosu__multi-agent-scam-conversation.csv": ("dialogue", "labels", None),
    "BothBosu__scam-dialogue.csv": ("dialogue", "label", None),
    "FredZhang7__all-scam-spam.csv": ("text", "is_spam", 6000),
    "ucirvine__sms_spam.csv": ("sms", "label", None),  # optional, CC BY 4.0
}
DEFAULT_SET = ["BothBosu__multi-agent-scam-conversation.csv", "BothBosu__scam-dialogue.csv",
               "FredZhang7__all-scam-spam.csv"]


def load_pretrain(names=None, d=DIR, max_chars=2000, seed=0):
    texts, y = [], []
    for name in names or DEFAULT_SET:
        tcol, lcol, cap = SOURCES[name]
        with open(Path(d) / name, encoding="utf-8", newline="") as f:
            rows = [(r[tcol], int(float(r[lcol]))) for r in csv.DictReader(f) if r.get(tcol)]
        if cap and len(rows) > cap:
            rows = random.Random(seed).sample(rows, cap)
        texts += [t[:max_chars] for t, _ in rows]
        y += [l for _, l in rows]
    return texts, y
