"""Write reference probabilities from sklearn for the JS parity test."""
import json, numpy as np
from common import load, default_paths, ROOT
from train import DEFAULT, CHAR, fit
import sys
# Must mirror the ml/model.json training run. --pretrain: char_wb + public datasets (seed_weight 20).
rows = load(default_paths()); X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
if "--pretrain" in sys.argv:
    from pretrain_data import load_pretrain
    vec, clf = fit(CHAR, X, y, load_pretrain(), 20.0)
else:
    vec, clf = fit(DEFAULT, X, y)
p = clf.predict_proba(vec.transform(X))[:, 1]
json.dump([{"text": t, "p": float(s)} for t, s in zip(X[:10], p[:10])], open(ROOT / "tests/fixtures-ml-ref.json", "w"), ensure_ascii=False)
