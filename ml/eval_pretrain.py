"""Held-out eval: train on public datasets only, score data/labeled seed (never trained on).
Also pretrain+seed with seed-only CV folds. Prints recall at 0 and <=1 false alarms (no 0.5 floor).
usage: python ml/eval_pretrain.py [--max-features 3000]"""
import argparse, json, numpy as np
from common import load, default_paths
from pretrain_data import load_pretrain
from train import CHAR, DEFAULT, fit, oof_scores, pick_threshold, metrics

ap = argparse.ArgumentParser(); ap.add_argument("--max-features", type=int, default=3000)
ap.add_argument("--sms", action="store_true"); ap.add_argument("--seed-weight", type=float, default=5.0)
a = ap.parse_args()
rows = load(default_paths()); X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
names = None if not a.sms else ["BothBosu__multi-agent-scam-conversation.csv", "BothBosu__scam-dialogue.csv",
                                "FredZhang7__all-scam-spam.csv", "ucirvine__sms_spam.csv"]
pre = load_pretrain(names)
p = dict(CHAR, max_features=a.max_features)


def report(name, s):
    out = {"variant": name}
    for fa in (0, 1):
        m = metrics(s, y, pick_threshold(s, y, max_fa=fa, floor=0.0))
        out[f"recall@{fa}FA"] = round(m["recall"], 3); out[f"thr@{fa}FA"] = round(m["threshold"], 4)
        out[f"FA@{fa}"] = m["false_alarms"]
    print(json.dumps(out))


report("seed-only word CV (baseline)", oof_scores(X, y, DEFAULT))
report("seed-only char CV", oof_scores(X, y, p))
vec, clf = fit(p, [], [], pre)
report("pretrain-only -> seed held-out", clf.predict_proba(vec.transform(X))[:, 1])
report(f"pretrain+seed CV (seed_weight={a.seed_weight})", oof_scores(X, y, p, pre=pre, seed_weight=a.seed_weight))
