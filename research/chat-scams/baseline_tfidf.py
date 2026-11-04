#!/usr/bin/env python3
"""Tiny TF-IDF + L2 logistic regression baseline on the synthetic seed.

No third-party ML library. Reads data/chat-scams/seed.jsonl, checks the schema,
and writes research/chat-scams/baseline-results.json.

The seed is a few dozen hand-written chats. Scores are a smoke test of the
label schema and the feature idea. They are not a claim about real inboxes.

Usage (from the repo root):
    python3 research/chat-scams/baseline_tfidf.py
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "chat-scams" / "seed.jsonl"
OUT = Path(__file__).resolve().parent / "baseline-results.json"

STAGES = {
    "hook",
    "trust",
    "urgency",
    "payment_ask",
    "move_off_platform",
    "recovery",
    "reply",
    "benign",
}
SCAM_TYPES = {
    "hi_mum",
    "friend_impersonation",
    "fake_seller",
    "fake_buyer",
    "romance",
    "investment",
    "fake_bank",
    "job_mule",
    "benign",
}
LANGS = {"da", "en"}
CHANNELS = {"sms", "whatsapp", "messenger", "telegram", "mobilepay", "marketplace"}
TOKEN = re.compile(r"[0-9A-Za-zÆØÅæøå]+")

# Fixed from PLAYBOOKS.md before the run. Not tuned on the seed.
# Counted only on counterparty turns. Two or more distinct hits -> scam.
LEXICON = (
    "nyt nummer",
    "new number",
    "telefon er gået",
    "phone broke",
    "mitid",
    "engangskode",
    "one-time code",
    "google play",
    "gift card",
    "gavekort",
    "friends and family",
    "forskud",
    "sikre konto",
    "safe account",
    "ikke sig",
    "don't tell",
    "keep this between",
    "fortæl det ikke",
    "release fee",
    "lokal agent",
    "local agent",
    "personal assistant",
    "oil rig",
    "cashier",
    "wallet address",
    "2 procent",
    "2 percent",
)


def load_rows(path: Path) -> list[dict]:
    rows = []
    seen = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        check_row(row, line_no)
        if row["id"] in seen:
            raise SystemExit(f"duplicate id {row['id']}")
        seen.add(row["id"])
        rows.append(row)
    if len(rows) < 10:
        raise SystemExit("seed is unexpectedly small")
    return rows


def check_row(row: dict, line_no: int) -> None:
    for key in ("id", "lang", "channel", "scam_type", "label", "source", "messages"):
        if key not in row:
            raise SystemExit(f"line {line_no}: missing {key}")
    if row["lang"] not in LANGS or row["channel"] not in CHANNELS:
        raise SystemExit(f"line {line_no}: bad lang or channel")
    if row["scam_type"] not in SCAM_TYPES or row["label"] not in {"scam", "benign"}:
        raise SystemExit(f"line {line_no}: bad type or label")
    if row["source"] != "synthetic":
        raise SystemExit(f"line {line_no}: this seed file only allows synthetic rows")
    if not row["pattern_sources"]:
        raise SystemExit(f"line {line_no}: pattern_sources is empty")
    if row["label"] == "benign" and row["scam_type"] != "benign":
        raise SystemExit(f"line {line_no}: benign label with scam type")
    if row["label"] == "scam" and row["scam_type"] == "benign":
        raise SystemExit(f"line {line_no}: scam label with benign type")
    if not isinstance(row["messages"], list) or len(row["messages"]) < 2:
        raise SystemExit(f"line {line_no}: need at least two messages")
    for msg in row["messages"]:
        if msg.get("speaker") not in {"counterparty", "user"}:
            raise SystemExit(f"line {line_no}: bad speaker")
        if msg.get("stage") not in STAGES:
            raise SystemExit(f"line {line_no}: bad stage {msg.get('stage')}")
        if not str(msg.get("text", "")).strip():
            raise SystemExit(f"line {line_no}: empty text")
        if re.search(r"\d{8,}", msg["text"]):
            raise SystemExit(f"line {line_no}: long digit run, looks like an account or phone")


def transcript(row: dict, limit: int | None) -> str:
    """Speaker-prefixed text. Stages and labels are not included: they would leak.

    `limit` keeps the dialogue only through the first N counterparty turns, so an
    early-detection run cannot see a payment ask that arrives later.
    """
    parts = []
    seen_counterparty = 0
    for msg in row["messages"]:
        if msg["speaker"] == "counterparty":
            if limit is not None and seen_counterparty >= limit:
                break
            seen_counterparty += 1
        parts.append(f"{msg['speaker']}: {msg['text']}")
    return "\n".join(parts)


def tokenize(text: str) -> list[str]:
    words = [w.lower() for w in TOKEN.findall(text)]
    grams = list(words)
    grams.extend(f"{a}_{b}" for a, b in zip(words, words[1:]))
    return grams


def tfidf(train_docs: list[list[str]], test_docs: list[list[str]]) -> tuple[np.ndarray, np.ndarray]:
    """Unigrams and bigrams that occur in at least two training chats.

    A minimum document frequency of 2 drops one-chat hapaxes. On 37 rows those
    hapaxes let L2 logistic regression memorize a training fold while leaving
    every probability stuck near one half.
    """
    df = Counter()
    for doc in train_docs:
        df.update(set(doc))
    terms = [term for term, count in df.items() if count >= 2]
    vocab = {term: i for i, term in enumerate(terms)}
    n_docs = len(train_docs)

    def matrix(docs: list[list[str]]) -> np.ndarray:
        x = np.zeros((len(docs), len(vocab)), dtype=np.float64)
        for r, doc in enumerate(docs):
            counts = Counter(doc)
            length = max(len(doc), 1)
            for term, n in counts.items():
                idx = vocab.get(term)
                if idx is None:
                    continue
                tf = n / length
                idf = math.log((1 + n_docs) / (1 + df[term])) + 1
                x[r, idx] = tf * idf
        norms = np.linalg.norm(x, axis=1, keepdims=True)
        norms[norms == 0] = 1
        return x / norms

    return matrix(train_docs), matrix(test_docs)


def fit_lr(x_train: np.ndarray, y_train: np.ndarray, x_test: np.ndarray) -> np.ndarray:
    """L2 logistic regression, class-balanced, bias unpenalized. Returns P(scam)."""
    y = y_train.astype(np.float64)
    n = len(y)
    n_pos = max(float(y.sum()), 1.0)
    n_neg = max(float(n - y.sum()), 1.0)
    weights = np.where(y == 1.0, n / (2 * n_pos), n / (2 * n_neg))
    x = np.concatenate([np.ones((n, 1)), x_train], axis=1)
    coef = np.zeros(x.shape[1], dtype=np.float64)
    lr = 1.0
    l2 = 0.05
    for _ in range(800):
        z = np.clip(x @ coef, -20, 20)
        prob = 1 / (1 + np.exp(-z))
        grad = (x.T @ (weights * (prob - y))) / n
        penalty = l2 * coef
        penalty[0] = 0
        coef -= lr * (grad + penalty)
    z_test = np.clip(np.concatenate([np.ones((len(x_test), 1)), x_test], axis=1) @ coef, -20, 20)
    return 1 / (1 + np.exp(-z_test))


def prf(y_true: np.ndarray, y_hat: np.ndarray) -> dict:
    tp = int(((y_hat == 1) & (y_true == 1)).sum())
    fp = int(((y_hat == 1) & (y_true == 0)).sum())
    fn = int(((y_hat == 0) & (y_true == 1)).sum())
    tn = int(((y_hat == 0) & (y_true == 0)).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "false_positive_rate": round(fpr, 3),
    }


def folds(y: np.ndarray, k: int, seed: int) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    folds_out = [[] for _ in range(k)]
    for label in (0, 1):
        idx = np.flatnonzero(y == label)
        rng.shuffle(idx)
        for n, i in enumerate(idx):
            folds_out[n % k].append(int(i))
    return [np.array(sorted(part), dtype=int) for part in folds_out]


def lexicon_hit(row: dict) -> int:
    text = " ".join(m["text"].lower() for m in row["messages"] if m["speaker"] == "counterparty")
    return sum(1 for phrase in LEXICON if phrase in text)


def evaluate(rows: list[dict], limit: int | None, k: int = 5) -> dict:
    docs = [tokenize(transcript(row, limit)) for row in rows]
    y = np.array([1 if row["label"] == "scam" else 0 for row in rows], dtype=int)
    pred = np.zeros(len(rows), dtype=int)
    proba = np.zeros(len(rows), dtype=np.float64)
    for test_idx in folds(y, k, seed=1105):
        train_idx = np.array([i for i in range(len(rows)) if i not in set(test_idx)])
        x_train, x_test = tfidf([docs[i] for i in train_idx], [docs[i] for i in test_idx])
        prob = fit_lr(x_train, y[train_idx], x_test)
        proba[test_idx] = prob
        pred[test_idx] = (prob >= 0.5).astype(int)
    errors = []
    for i, row in enumerate(rows):
        if pred[i] != y[i]:
            errors.append({
                "id": row["id"],
                "label": row["label"],
                "predicted": "scam" if pred[i] == 1 else "benign",
                "p_scam": round(float(proba[i]), 3),
                "scam_type": row["scam_type"],
                "confusable_with": row.get("confusable_with", ""),
            })
    return {"metrics": prf(y, pred), "errors": errors}


def main() -> None:
    rows = load_rows(SEED)
    y = np.array([1 if row["label"] == "scam" else 0 for row in rows])
    lex_pred = np.array([1 if lexicon_hit(row) >= 2 else 0 for row in rows])
    by_type = Counter(row["scam_type"] for row in rows)
    by_lang = Counter((row["lang"], row["label"]) for row in rows)
    result = {
        "seed": str(SEED.relative_to(ROOT)),
        "n": len(rows),
        "n_scam": int(y.sum()),
        "n_benign": int((y == 0).sum()),
        "by_scam_type": dict(sorted(by_type.items())),
        "by_lang_label": {f"{lang}_{label}": n for (lang, label), n in sorted(by_lang.items())},
        "protocol": (
            "5-fold stratified CV, seed 1105. Vocabulary and IDF fit on each "
            "training fold only. Word unigrams and bigrams with document "
            "frequency at least 2, TF-IDF, L2 logistic regression (L2=0.05, "
            "800 steps, class-balanced), decision threshold 0.5. Stage tags "
            "are not features."
        ),
        "tfidf_full_chat": evaluate(rows, limit=None),
        "tfidf_first_two_counterparty_turns": evaluate(rows, limit=2),
        "lexicon_at_least_two_hits": {
            "metrics": prf(y, lex_pred),
            "rule": "counterparty text contains at least two distinct phrases from a fixed list",
            "missed_scam_ids": [
                row["id"] for row, guess in zip(rows, lex_pred) if row["label"] == "scam" and guess == 0
            ],
            "false_positive_ids": [
                row["id"] for row, guess in zip(rows, lex_pred) if row["label"] == "benign" and guess == 1
            ],
        },
        "caveat": (
            "Every row is synthetic. The lexicon was written from the same playbook, "
            "and the benign rows were written so they would not contain two lexicon "
            "hits, so its precision is not a live-traffic estimate. The TF-IDF model "
            "does not see stage labels. Neither number is performance on UCI SMS, "
            "ScamGuardBench, or a real inbox."
        ),
    }
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "n": result["n"],
        "full": result["tfidf_full_chat"]["metrics"],
        "early": result["tfidf_first_two_counterparty_turns"]["metrics"],
        "lexicon": result["lexicon_at_least_two_hits"]["metrics"],
        "full_errors": result["tfidf_full_chat"]["errors"],
        "early_errors": result["tfidf_first_two_counterparty_turns"]["errors"],
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
