"""Download public pretrain datasets into ../paybrake-datasets (outside git). See DATA_SOURCES.md.
usage: python ml/fetch_datasets.py [--dir PATH] [--sms]   (--sms: UCI SMS Spam, CC BY 4.0, optional)"""
import argparse, urllib.request
from pathlib import Path
from pretrain_data import DIR

HF = "https://huggingface.co/datasets/{}/resolve/main/{}"
FILES = {
    "BothBosu__multi-agent-scam-conversation.csv": ("BothBosu/multi-agent-scam-conversation", "agent_conversation_all.csv"),
    "BothBosu__scam-dialogue.csv": ("BothBosu/scam-dialogue", "scam-dialogue_all.csv"),
    "FredZhang7__all-scam-spam.csv": ("FredZhang7/all-scam-spam", "junkmail_dataset.csv"),
}
SMS = ("ucirvine/sms_spam", "plain_text/train-00000-of-00001.parquet")


def get(repo, path, dest):
    print("GET", HF.format(repo, path), "->", dest)
    urllib.request.urlretrieve(HF.format(repo, path), dest)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dir", default=str(DIR)); ap.add_argument("--sms", action="store_true")
    a = ap.parse_args(); d = Path(a.dir); d.mkdir(parents=True, exist_ok=True)
    for name, (repo, path) in FILES.items():
        if not (d / name).exists():
            get(repo, path, d / name)
    if a.sms and not (d / "ucirvine__sms_spam.csv").exists():
        import pandas as pd  # needs pandas + pyarrow
        tmp = d / "sms_spam.parquet"; get(*SMS, tmp)
        pd.read_parquet(tmp).to_csv(d / "ucirvine__sms_spam.csv", index=False); tmp.unlink()
    print("done:", sorted(p.name for p in d.glob("*.csv")))


if __name__ == "__main__":
    main()
