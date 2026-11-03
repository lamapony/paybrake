"""TF-IDF + logistic regression. Stratified CV, high-confidence threshold, JSON export.

usage: python ml/train.py [--data a.jsonl ...] [--out ml/model.json] [--max-far 0.0]
       python ml/train.py --pretrain [--analyzer char_wb] [--max-features 3000]
--pretrain adds public Apache-2.0 datasets (ml/fetch_datasets.py, DATA_SOURCES.md) to training.
Seed rows are always the evaluation set: CV folds split seed only; pretrain rows are train-only.
"""
import argparse, json, sys
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, StratifiedGroupKFold
from common import tokenize, analyze, load, default_paths

DEFAULT = dict(analyzer="word", ngram_max=2, min_df=1, sublinear_tf=True, C=1.0, max_features=20000)
CHAR = dict(analyzer="char_wb", char_min=2, char_max=4, ngram_max=2, min_df=2, sublinear_tf=True, C=1.0,
            max_features=3000)


def build(p):
    vec = TfidfVectorizer(analyzer=lambda t: analyze(t, p), min_df=p["min_df"],
                          sublinear_tf=p["sublinear_tf"], max_features=p["max_features"], norm="l2")
    clf = LogisticRegression(C=p["C"], class_weight="balanced", max_iter=3000)
    return vec, clf


def fit(p, texts, y, pre=None, seed_weight=1.0):
    """Fit on seed texts (+ optional pretrain (texts, y)); seed rows get seed_weight."""
    X, Y, W = list(texts), list(y), [seed_weight] * len(texts)
    if pre:
        X += pre[0]; Y += list(pre[1]); W += [1.0] * len(pre[0])
    vec, clf = build(p)
    clf.fit(vec.fit_transform(X), np.array(Y), sample_weight=np.array(W))
    return vec, clf


def group_of(r):
    """CV group: synthetic rows share a group per pattern so templates never straddle train/test."""
    return r["notes"].split(";")[0] if r.get("source") == "synthetic" else r["id"]


def oof_scores(texts, y, p, folds=5, seed=0, pre=None, seed_weight=1.0, groups=None):
    k = max(2, min(folds, int(np.bincount(y).min())))
    s = np.zeros(len(y))
    split = (StratifiedGroupKFold(k, shuffle=True, random_state=seed).split(texts, y, groups) if groups is not None
             else StratifiedKFold(k, shuffle=True, random_state=seed).split(texts, y))
    for tr, te in split:
        vec, clf = fit(p, [texts[i] for i in tr], y[tr], pre, seed_weight)
        s[te] = clf.predict_proba(vec.transform([texts[i] for i in te]))[:, 1]
    return s


def metrics(s, y, thr):
    honest, scam = s[y == 0], s[y == 1]
    return dict(threshold=float(thr), false_alarms=int((honest >= thr).sum()), honest=int(len(honest)),
                far=float((honest >= thr).mean()), recall=float((scam >= thr).mean()), scam=int(len(scam)))


def pick_threshold(s, y, max_far=0.0, floor=0.5, max_fa=None):
    """Lowest threshold (>= floor) whose false alarms on honest <= max_fa (or max_far * honest)."""
    honest = np.sort(s[y == 0])
    allowed = int(max_fa) if max_fa is not None else int(np.floor(max_far * len(honest)))
    cut = honest[-(allowed + 1)] + 1e-6 if allowed < len(honest) else 0.0
    return float(max(cut, floor))


def export(texts, y, p, thr, path, pre=None, seed_weight=1.0):
    vec, clf = fit(p, texts, y, pre, seed_weight)
    vocab = vec.vocabulary_
    order = sorted(vocab, key=vocab.get)
    params = {k: p[k] for k in ("ngram_max", "sublinear_tf")}
    if p.get("analyzer") == "char_wb":
        params.update(analyzer="char_wb", char_min=p["char_min"], char_max=p["char_max"])
    model = dict(version=1, kind="tfidf-logreg", params=params, threshold=thr, intercept=float(clf.intercept_[0]),
                 terms={t: [round(float(vec.idf_[vocab[t]]), 5), round(float(clf.coef_[0][vocab[t]]), 5)] for t in order})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    return model


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="*", default=None)
    ap.add_argument("--out", default="ml/model.json")
    ap.add_argument("--max-far", type=float, default=0.0)
    ap.add_argument("--max-fa", type=int, default=None, help="allowed false alarms on seed honest (overrides --max-far)")
    ap.add_argument("--pretrain", nargs="*", default=None, help="pretrain CSV names (empty = default Apache-2.0 set)")
    ap.add_argument("--analyzer", choices=["word", "char_wb"], default=None)
    ap.add_argument("--max-features", type=int, default=None)
    ap.add_argument("--seed-weight", type=float, default=5.0)
    ap.add_argument("--tomato", action="store_true", help="add TOMATO marketplace conversations to pretrain")
    a = ap.parse_args(argv)
    rows = load(a.data or default_paths())
    texts = [r["text"] for r in rows]
    y = np.array([1 if r["label"] == "scam" else 0 for r in rows])
    p = dict(CHAR if (a.analyzer or ("char_wb" if a.pretrain is not None else "word")) == "char_wb" else DEFAULT)
    if a.max_features:
        p["max_features"] = a.max_features
    pre, sw = None, 1.0
    if a.pretrain is not None:
        from pretrain_data import load_pretrain
        pre, sw = load_pretrain(a.pretrain or None), a.seed_weight
        if a.tomato:
            from pretrain_data import load_tomato
            tx, ty = load_tomato(); pre = (pre[0] + tx, list(pre[1]) + ty)
        print(f"pretrain rows={len(pre[0])} scam={sum(pre[1])}")
    print(f"seed rows={len(rows)} scam={y.sum()} honest={(y == 0).sum()} params={p}")
    if (y == 0).sum() < y.sum():
        print("WARNING: fewer honest than scam chats; labeling rule says honest >= scam", file=sys.stderr)
    s = oof_scores(texts, y, p, pre=pre, seed_weight=sw, groups=[group_of(r) for r in rows])
    thr = pick_threshold(s, y, a.max_far, max_fa=a.max_fa)
    m = metrics(s, y, thr)
    print("CV @0.5:", json.dumps(metrics(s, y, 0.5)))
    print("CV @picked:", json.dumps(m))
    export(texts, y, p, thr, a.out, pre, sw)
    print("wrote", a.out)
    return m


if __name__ == "__main__":
    main()
