"""Honest eval: nested, grouped CV. Thresholds are tuned ONLY on inner-CV scores of the outer-train part,
then applied to the outer-test fold. Pool = hand seed + da_synthetic; synthetic rows are grouped by pattern,
so a whole scam/honest pattern is unseen at test time. Variants that don't train on da still get scored on it.
usage: python ml/eval_nested.py"""
import json, sys, numpy as np
from sklearn.model_selection import StratifiedGroupKFold
from common import load, default_paths, da_paths
from pretrain_data import load_pretrain, load_tomato
from train import CHAR, DEFAULT, fit, oof_scores, group_of

seed_rows, da_rows = load(default_paths()), load(da_paths())
rows = seed_rows + da_rows
X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
G = np.array([group_of(r) for r in rows]); is_da = np.array([r["source"] == "synthetic" for r in rows])
pub = load_pretrain(); tom = load_tomato()
pub_tom = (pub[0] + tom[0], list(pub[1]) + tom[1])
VARIANTS = {  # name: (params, pretrain, seed_weight, train on da?)
    "A before: word, seed only": (DEFAULT, None, 1.0, False),
    "B prev commit: char + public + seed": (CHAR, pub, 20.0, False),
    "C new: char + public + TOMATO + seed + da": (CHAR, pub_tom, 20.0, True),
}


def thresholds(s, yy):
    h = np.sort(s[yy == 0])
    return h[-1] + 1e-6, (h[-2] + 1e-6 if len(h) > 1 else 0.0)


res = {}
for name, (p, pre, sw, use_da) in VARIANTS.items():
    t0 = np.zeros(len(y)); t1 = np.zeros(len(y)); sc = np.zeros(len(y))
    for tr, te in StratifiedGroupKFold(5, shuffle=True, random_state=0).split(X, y, G):
        tr = tr if use_da else tr[~is_da[tr]]
        Xt = [X[i] for i in tr]
        inner = oof_scores(Xt, y[tr], p, folds=3, pre=pre, seed_weight=sw, groups=G[tr])
        a, b = thresholds(inner, y[tr])
        vec, clf = fit(p, Xt, y[tr], pre, sw)
        sc[te] = clf.predict_proba(vec.transform([X[i] for i in te]))[:, 1]; t0[te] = a; t1[te] = b
    out = {}
    for part, msk in (("seed", ~is_da), ("da", is_da)):
        for tag, t in (("0FA-tuned", t0), ("1FA-tuned", t1)):
            hit = sc >= t
            out[f"{part} {tag}"] = dict(recall=round(float(hit[msk & (y == 1)].mean()), 3),
                                       FA=int(hit[msk & (y == 0)].sum()), honest=int((msk & (y == 0)).sum()),
                                       scam=int((msk & (y == 1)).sum()))
    res[name] = out; print(name, json.dumps(out), flush=True)
json.dump(res, open(sys.argv[1] if len(sys.argv) > 1 else "/dev/null", "w"), indent=1)
