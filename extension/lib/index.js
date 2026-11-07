// ESM re-export for Node tests and eval. Do not load this file as a content script
// or via importScripts: it uses import/export. Content scripts and the service
// worker load the lib files as classic scripts, which set globalThis.pb*.
//
//   manifest / addScriptTag order:
//   brand.js, tidy.js, atoms.js, extract.js, redact.js, pay-risk.js, ask-llm.js, chat-state.js, content.js

import "./brand.js";
import "./tidy.js";
import "./atoms.js";
import "./extract.js";
import "./redact.js";
import "./pay-risk.js";
import "./ask-llm.js";
import "./chat-state.js";

export const brand = globalThis.pbBrand;
export const tidy = globalThis.pbTidy;
export const atoms = globalThis.pbAtoms;
export const extract = globalThis.pbExtract;
export const payRisk = globalThis.pbPayRisk;
export const redact = globalThis.pbRedact;
export const askLlmClient = globalThis.pbAskLlm;
export const chatState = globalThis.pbChatState;
