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


def load_tomato(d=DIR, n_per_class=3000, seed=0):
    """TOMATO (Zenodo 10.5281/zenodo.17742186, CC BY 4.0) -> conversation-level examples.
    Labels in TOMATO are per user/session, so we map carefully (see DATA_SOURCES.md):
      scam   = rows of answers/ATO_admessages.csv (sent from a fraudster session; scenario 1-3)
      honest = ad_messages.csv rows from users NOT in answers/ato_users.csv, whose text never occurs as a
               scam text (1,071 template texts shared with the fraud set are dropped as ambiguous)
      dropped: legit-session rows of ATO users.
    A "conversation" = all messages one sender sent about one ad (user_id, adid), joined by newlines
    (TOMATO has no replies). Deduplicated by text, then n_per_class sampled per class."""
    import pandas as pd
    t = Path(d) / "TOMATO"
    m = pd.read_csv(t / "ad_messages.csv", usecols=["user_id", "adid", "timestamp", "content"])
    a = pd.read_csv(t / "answers" / "ATO_admessages.csv", usecols=["user_id", "adid", "timestamp", "content"])
    ato = set(pd.read_csv(t / "answers" / "ato_users.csv", usecols=["id"]).id)
    scam_text = set(a.content)
    hon = m[~m.user_id.isin(ato) & ~m.content.isin(scam_text)]
    out = {}
    for lab, df in ((1, a), (0, hon)):
        conv = df.sort_values("timestamp").groupby(["user_id", "adid"]).content.agg("\n".join).drop_duplicates()
        out[lab] = conv.sample(min(n_per_class, len(conv)), random_state=seed).tolist()
    return out[1] + out[0], [1] * len(out[1]) + [0] * len(out[0])
