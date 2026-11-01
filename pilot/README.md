# PayBrake pilot — do not publish this folder as the demo

**Before going public.** This directory is a private rehearsal build, not the hackathon judge path. `extension/manifest.json` injects on `facebook.com` messages, `facebook.com` marketplace, and `messenger.com`, and a second content script matches all of `facebook.com` so the scan can follow that site's in-app navigation. `INSTALL-RU.md` tells a tester to open those live chats. The judge demo is the local mock in the repository [README](../README.md): `demo/marketplace.html` on localhost, with mock orders and no third-party site.

Dima decides whether this tree stays, moves to a private repo, or is removed before any public remote. The commands for that decision are in [docs/SUBMISSION-GAPS.md](../docs/SUBMISSION-GAPS.md) under **Before going public**. They were not run on this branch. Deleting the files from the next commit does not erase them from history. `.gitignore` does not untrack them either.

Do not link this pilot, `PILOT-TASK.md`, or `shots/pilot-*.png` from the Devpost submission.

## What is in here

- `extension/` — unpacked Manifest V3 pilot. Permissions are `storage` only. Host matches include Facebook messages, Facebook Marketplace, and messenger.com.
- `fixtures/messenger-thread.html` — local DOM fixture. The Playwright script can serve it in place of those hosts. It is still a third-party-shaped target and is part of the same decision.
- `INSTALL-RU.md` — install notes that send a tester to live chats.
- `tests/` — detector cases and the pilot smoke test.
- `scripts/` — zip packaging and debug helpers.

`shots/pilot-1280.png`, `shots/pilot-390.png`, `shots/pilot-anyway-1280.png`, `shots/pilot-order-1280.png`, `shots/pilot-order-created-1280.png`, and `shots/pilot-safe-1280.png` live outside this directory. Removing `pilot/` leaves those images in the tree until they are removed too.
