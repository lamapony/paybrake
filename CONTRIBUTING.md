# Contributing

## Run the checks

Node 20 or newer.

```sh
npm install
npm test        # offline, no keys needed
npm run eval    # rules on the in-repo chats; exits 1 if the gate fails
```

CI runs both on every pull request. If you changed the hosted pages or the extension, also run `npm run hosted:build`, and `npm run e2e` for a browser check of the unpacked extension.

If you change detection, add a test for the case you fixed and a quiet case for the honest chat that looks similar. A false alarm costs more than a miss here: see [the silent-unless-evidenced decision](docs/adr/0001-silent-unless-evidenced.md).

## Branches and pull requests

- Branch from `main`. Use a short descriptive name such as `fix/iban-veto` or `docs/testing-steps`.
- One change per pull request. Say what changed and paste the `npm test` and `npm run eval` summary lines.
- Any number you add to the README or the promo page must come from a command you ran. Name the command and the set. [docs/EVALUATION.md](docs/EVALUATION.md) has the list.

## Secrets and real data

- Never commit `backend/.env`, API keys or PayPal credentials. `backend/.env.example` is the template. The Typesafe key lives only as a Worker secret.
- Sandbox only. Do not add code paths that reach live PayPal.
- Use fictional names in demo pages, tests and eval cases. Do not commit real chat logs or personal data.

## Retraining the model

`npm run train:model` overwrites `extension/lib/scam-model-weights.js`. For a measurement-only run, use `node research/chat-scams/train-model.mjs --no-write`.
