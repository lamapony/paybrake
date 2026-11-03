"""TF-IDF + logistic regression. Stratified CV, high-confidence threshold, JSON export.

usage: python ml/train.py [--data a.jsonl ...] [--out ml/model.json] [--max-far 0.0]
"""
import argparse, json, sys
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from common import tokenize, load, default_paths

DEFAULT = dict(ngram_max=2, min_df=1, sublinear_tf=True, C=1.0, max_features=20000)


def build(p):
    vec = TfidfVectorizer(analyzer=lambda t: tokenize(t, p["ngram_max"]), min_df=p["min_df"],
                          sublinear_tf=p["sublinear_tf"], max_features=p["max_features"], norm="l2")
    clf = LogisticRegression(C=p["C"], class_weight="balanced", max_iter=2000)
    return vec, clf


def oof_scores(texts, y, p, folds=5, seed=0):
    k = max(2, min(folds, int(np.bincount(y).min())))
    s = np.zeros(len(y))
    for tr, te in StratifiedKFold(k, shuffle=True, random_state=seed).split(texts, y):
        vec, clf = build(p)
        clf.fit(vec.fit_transform([texts[i] for i in tr]), y[tr])
        s[te] = clf.predict_proba(vec.transform([texts[i] for i in te]))[:, 1]
    return s


def metrics(s, y, thr):
    honest, scam = s[y == 0], s[y == 1]
    return dict(threshold=float(thr), false_alarms=int((honest >= thr).sum()), honest=int(len(honest)),
                far=float((honest >= thr).mean()), recall=float((scam >= thr).mean()), scam=int(len(scam)))


def pick_threshold(s, y, max_far=0.0, floor=0.5):
    """Lowest threshold (>= floor) whose false-alarm rate on honest <= max_far."""
    honest = np.sort(s[y == 0])
    allowed = int(np.floor(max_far * len(honest)))
    # threshold just above the (allowed+1)-th highest honest score
    cut = honest[-(allowed + 1)] + 1e-6 if allowed < len(honest) else 0.0
    return float(max(cut, floor))


def export(texts, y, p, thr, path):
    vec, clf = build(p)
    clf.fit(vec.fit_transform(texts), y)
    vocab = {t: i for t, i in vec.vocabulary_.items()}
    order = sorted(vocab, key=vocab.get)
    model = dict(version=1, kind="tfidf-logreg", params={k: p[k] for k in ("ngram_max", "sublinear_tf")},
                 threshold=thr, intercept=float(clf.intercept_[0]),
                 terms={t: [round(float(vec.idf_[vocab[t]]), 5), round(float(clf.coef_[0][vocab[t]]), 5)] for t in order})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False)
    return model


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="*", default=None)
    ap.add_argument("--out", default="ml/model.json")
    ap.add_argument("--max-far", type=float, default=0.0)
    a = ap.parse_args(argv)
    rows = load(a.data or default_paths())
    texts = [r["text"] for r in rows]
    y = np.array([1 if r["label"] == "scam" else 0 for r in rows])
    print(f"rows={len(rows)} scam={y.sum()} honest={(y == 0).sum()}")
    if (y == 0).sum() < y.sum():
        print("WARNING: fewer honest than scam chats; labeling rule says honest >= scam", file=sys.stderr)
    s = oof_scores(texts, y, DEFAULT)
    thr = pick_threshold(s, y, a.max_far)
    m = metrics(s, y, thr)
    print("CV @0.5:", json.dumps(metrics(s, y, 0.5)))
    print("CV @picked:", json.dumps(m))
    export(texts, y, DEFAULT, thr, a.out)
    print("wrote", a.out)
    return m


if __name__ == "__main__":
    main()
