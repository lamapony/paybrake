"""Write reference probabilities from sklearn for the JS parity test."""
import json, numpy as np
from common import load, default_paths, da_paths, ROOT
from train import DEFAULT, CHAR, fit
import sys
# Must mirror the ml/model.json training run:
#   python ml/train.py --pretrain --tomato --data data/labeled/seed.jsonl data/labeled/da_synthetic.jsonl --seed-weight 20 --max-fa 0
rows = load(default_paths() + (da_paths() if "--pretrain" in sys.argv else [])); X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
if "--pretrain" in sys.argv:
    from pretrain_data import load_pretrain
    from pretrain_data import load_tomato
    pub, tom = load_pretrain(), load_tomato()
    vec, clf = fit(CHAR, X, y, (pub[0] + tom[0], list(pub[1]) + tom[1]), 20.0)
else:
    vec, clf = fit(DEFAULT, X, y)
p = clf.predict_proba(vec.transform(X))[:, 1]
json.dump([{"text": t, "p": float(s)} for t, s in zip(X[:10], p[:10])], open(ROOT / "tests/fixtures-ml-ref.json", "w"), ensure_ascii=False)
