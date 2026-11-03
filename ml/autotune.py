"""Autoresearch-style loop: try TF-IDF/LR variants on a fixed held-out split.
Keep a variant only if honest false alarms do not increase AND scam recall improves.
Appends every trial to ml/results.tsv.  usage: python ml/autotune.py [--trials 20] [--seed 0]
"""
import argparse, random, time
import numpy as np
from pathlib import Path
from sklearn.model_selection import train_test_split
from common import load, default_paths
from train import DEFAULT, build, oof_scores, pick_threshold, metrics

SPACE = dict(ngram_max=[1, 2, 3], min_df=[1, 2], sublinear_tf=[True, False],
             C=[0.1, 0.3, 1.0, 3.0, 10.0], max_features=[2000, 20000])


def evaluate(p, Xtr, ytr, Xte, yte):
    thr = pick_threshold(oof_scores(Xtr, ytr, p), ytr, 0.0)  # threshold from train-only CV
    vec, clf = build(p)
    clf.fit(vec.fit_transform(Xtr), ytr)
    return metrics(clf.predict_proba(vec.transform(Xte))[:, 1], yte, thr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--log", default="ml/results.tsv")
    a = ap.parse_args()
    rows = load(default_paths())
    X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, stratify=y, random_state=a.seed)
    log = Path(a.log); new = not log.exists()
    rng = random.Random(a.seed)
    with log.open("a") as f:
        if new:
            f.write("ts\ttrial\tkept\tfalse_alarms\thonest\trecall\tthreshold\tparams\n")
        best_p = dict(DEFAULT); best = evaluate(best_p, Xtr, ytr, Xte, yte)
        def w(i, kept, m, p):
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{i}\t{kept}\t{m['false_alarms']}\t{m['honest']}\t{m['recall']:.3f}\t{m['threshold']:.3f}\t{p}\n")
        w(0, "baseline", best, best_p)
        print("baseline", best)
        for i in range(1, a.trials + 1):
            p = dict(best_p); k = rng.choice(list(SPACE)); p[k] = rng.choice(SPACE[k])
            m = evaluate(p, Xtr, ytr, Xte, yte)
            kept = m["false_alarms"] <= best["false_alarms"] and m["recall"] > best["recall"]
            w(i, "yes" if kept else "no", m, p)
            if kept:
                best, best_p = m, p
                print(f"trial {i} KEPT {k}={p[k]}", m)
    print("best", best_p, best)


if __name__ == "__main__":
    main()
