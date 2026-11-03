"""Write reference probabilities from sklearn for the JS parity test."""
import json, numpy as np
from common import load, default_paths, ROOT
from train import DEFAULT, build
rows = load(default_paths()); X = [r["text"] for r in rows]; y = np.array([r["label"] == "scam" for r in rows], int)
vec, clf = build(DEFAULT); clf.fit(vec.fit_transform(X), y)
p = clf.predict_proba(vec.transform(X))[:, 1]
json.dump([{"text": t, "p": float(s)} for t, s in zip(X[:10], p[:10])], open(ROOT / "tests/fixtures-ml-ref.json", "w"), ensure_ascii=False)
