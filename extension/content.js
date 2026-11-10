/* PayBrake content script.
   Classic script. Libs load first and set globalThis.pb*.
   Test-only: if chrome.runtime is missing, window.__pbShim calls the backend
   with fetch so scripts/shot-demo.cjs can inject this file without the extension.
   The shim is not part of the product path. */
(function () {
  if (globalThis.__paybrakeContent) return;
  globalThis.__paybrakeContent = true;

  const FRIENDLY = "Could not reach the PayBrake server. Check your internet connection and try again.";
  const PAID = "Paid with PayPal Goods & Services (sandbox). Buyer Protection may be eligible; see PayPal terms.";
  const ANYWAY = "You chose to pay anyway. Logged on this device.";
  const DISMISSED = "Card hidden. Nothing was sent or typed in the chat.";

  const SITES = [
    {
      id: "demo",
      thread: "[data-pb-thread]",
      msg: "[data-pb-msg]"
    }
    // Template for a future marketplace. Leave commented. Do not ship a real adapter.
    // {
    //   id: "example-market",
    //   thread: ".thread",
    //   msg: ".message",
    //   title: ".listing-title",
    //   price: ".listing-price",
    //   email: ".seller-email"
    // }
  ];

  const sessions = new Map();
  // AI check on all chats: one request per chat text (hash), after the chat has been
  // still for AI_DEBOUNCE_MS. The background caches answers per hash.
  const AI_DEBOUNCE_MS = 800;
  const aiState = new Map();
  const aiTimers = new WeakMap();
  let cssText = "";
  let depth = 0;
  let pending = false;
  let debugOn = false;
  let scanTimer = 0;

  function enter() {
    depth += 1;
  }

  function leave() {
    depth = Math.max(0, depth - 1);
    if (depth === 0 && pending) {
      pending = false;
      schedule();
    }
  }

  function locked() {
    return depth > 0;
  }

  document.documentElement.dataset.paybrake = "on";

  function extensionOn() {
    try {
      return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function send(type, body) {
    const payload = Object.assign({ type: type }, body || {});
    try {
      if (extensionOn()) {
        return chrome.runtime.sendMessage(payload).catch(() => ({ ok: false, error: FRIENDLY }));
      }
      if (globalThis.__pbShim && typeof __pbShim.handle === "function") {
        return Promise.resolve(__pbShim.handle(type, body || {})).catch(() => ({ ok: false, error: FRIENDLY }));
      }
      return Promise.resolve({ ok: false, error: FRIENDLY });
    } catch {
      return Promise.resolve({ ok: false, error: FRIENDLY });
    }
  }

  function installShim() {
    if (extensionOn() || globalThis.__pbShim) return;
    const backend = String(globalThis.__pbBackend || "http://127.0.0.1:8787").replace(/\/$/, "");
    const deals = new Map();
    const log = [];
    let mode = null;

    function dealKey(hash) {
      return "pbdeal:" + String(hash || "");
    }

    function demoPage() {
      try {
        const host = String(location.hostname || "");
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
          || host === "paybrake-demo.spbabinov.workers.dev";
      } catch {
        return false;
      }
    }

    function readDisk(hash) {
      try {
        if (!demoPage() || !hash || !globalThis.localStorage) return {};
        const raw = localStorage.getItem(dealKey(hash));
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }

    function loadDeal(hash) {
      if (!hash) return {};
      return Object.assign({}, deals.get(hash) || {}, readDisk(hash));
    }

    function saveDeal(hash, patch) {
      if (!hash) return patch || {};
      const next = Object.assign({}, loadDeal(hash), patch || {}, { ts: Date.now() });
      deals.set(hash, next);
      try {
        if (demoPage() && globalThis.localStorage) {
          const api = globalThis.pbChatState;
          const disk = api && typeof api.diskDeal === "function" ? api.diskDeal(next) : null;
          if (disk) localStorage.setItem(dealKey(hash), JSON.stringify(disk));
          else localStorage.removeItem(dealKey(hash));
        }
      } catch {
        /* this page still has the in-memory deal */
      }
      return next;
    }

    function storedResponse(response, hash) {
      const api = globalThis.pbChatState;
      if (!api || typeof api.withStored !== "function") return response;
      return api.withStored(response, loadDeal(hash));
    }

    async function api(path, options) {
      const res = await fetch(backend + path, options);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const error = new Error((data && (data.message || data.error)) || FRIENDLY);
        error.status = res.status;
        error.code = data && data.error;
        throw error;
      }
      return data;
    }

    async function handle(type, body) {
      try {
        if (type === "pb:detect") {
          const ask = globalThis.__pbLlm && globalThis.pbAskLlm
            ? (payload) => pbAskLlm.askLlm(payload, { baseUrl: backend })
            : null;
          const verdict = await pbPayRisk.detect(body.text || "", body.context || {}, ask ? { askLlm: ask } : {});
          saveDeal(body.hash, {
            verdict: verdict,
            context: body.context || {},
            text: String(body.text || "").slice(0, 500)
          });
          try {
            const health = await Promise.race([
              api("/health", { method: "GET" }),
              new Promise((resolve) => setTimeout(() => resolve(null), 1500))
            ]);
            mode = health && health.paypal;
          } catch {
            mode = null;
          }
          return storedResponse({ ok: true, verdict: verdict, debug: false, mode: mode }, body.hash);
        }
        if (type === "pb:protect") {
          const stored = loadDeal(body.hash);
          const verdict = body.verdict || stored.verdict || {};
          const deal = verdict.deal || {};
          const item = body.item || deal.item;
          const amount = body.amount != null ? body.amount : deal.amount;
          const currency = body.currency || deal.currency;
          const payeeEmail = body.payeeEmail || deal.payeeEmail || "";
          const referenceId = body.referenceId || (body.hash
            ? [body.hash, item || "", amount == null ? "" : String(amount), currency || "", payeeEmail].join("\u001f")
            : undefined);
          const data = await api("/api/protect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              item,
              amount,
              currency,
              payeeEmail,
              referenceId,
              verdict: { level: verdict.level, signals: verdict.signals, reason: verdict.reason }
            })
          });
          saveDeal(body.hash, {
            orderId: data.orderId,
            approveUrl: data.approveUrl,
            mode: data.mode,
            status: data.status,
            verdict: verdict
          });
          mode = data.mode || mode;
          return { ok: true, orderId: data.orderId, approveUrl: data.approveUrl, mode: data.mode, status: data.status };
        }
        if (type === "pb:status") {
          const data = await api("/api/orders/" + encodeURIComponent(body.orderId), { method: "GET" });
          if (body.hash) saveDeal(body.hash, { status: data.status, orderId: data.orderId });
          return { ok: true, status: data.status, orderId: data.orderId };
        }
        if (type === "pb:capture") {
          const data = await api("/api/orders/" + encodeURIComponent(body.orderId) + "/capture", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
          });
          if (body.hash) saveDeal(body.hash, { status: data.status, orderId: data.orderId });
          return { ok: true, status: data.status, orderId: data.orderId, captureId: data.captureId };
        }
        if (type === "pb:override") {
          log.push({
            hash: body.hash || "",
            signals: body.signals || [],
            level: body.level || "",
            action: "override",
            ts: Date.now(),
            head: String(body.head || "").slice(0, 160)
          });
          saveDeal(body.hash, { override: true });
          return { ok: true };
        }
        if (type === "pb:mark") {
          log.push({
            hash: body.hash || "",
            signals: body.signals || [],
            level: body.level || "",
            action: body.action || "mark",
            ts: Date.now(),
            head: String(body.head || "").slice(0, 160)
          });
          return { ok: true, mark: body.action || "mark" };
        }
        return { ok: false, error: "Unknown message" };
      } catch (error) {
        if (error && (error.code === "not_approved" || error.status === 409)) {
          return { ok: false, error: "Approve the sandbox order first, then capture." };
        }
        if (error && error.status === 400 && error.message) return { ok: false, error: error.message };
        return { ok: false, error: FRIENDLY };
      }
    }

    globalThis.__pbShim = {
      testOnly: true,
      backend: backend,
      llm: Boolean(globalThis.__pbLlm),
      log: log,
      handle: handle
    };
  }

  installShim();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function chipLabel(id) {
    if (id === "model_flag") return "Reads like a scam chat";
    const atoms = globalThis.pbAtoms && pbAtoms.ATOMS;
    const atom = atoms && atoms.find((item) => item.id === id);
    return (atom && atom.receipt) || id;
  }

  const AI_NOTES = {
    confirmed: "rules + AI check",
    added: "AI check",
    unavailable: "rules check · AI check unavailable",
    off_server: "rules check · AI check not set up on this server (mock mode)",
    disagreed_low_confidence: "rules check · AI check unsure",
    pending: "rules check · AI check running…"
  };

  function aiNote(verdict, session) {
    const state = verdict && verdict.llm;
    const note = session && session.aiPending && (!state || state === "off") ? AI_NOTES.pending : AI_NOTES[state] || "rules check";
    // A card the on-device model added names it, so it is never mistaken for a rules hit.
    if (verdict && verdict.source === "model") return note.replace(/^rules check/, "on-device model");
    return note;
  }

  function footerText(verdict, session) {
    return "PayBrake · " + aiNote(verdict, session) + " · only you can see this";
  }

  function safeHttp(url) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch {
      /* ignore */
    }
    return "";
  }

  function bubbleText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(".sr-only, .time").forEach((child) => child.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function field(thread, name) {
    const sel = "[" + name + "]";
    // A page-level attribute may serve every thread, but never one that belongs to another
    // conversation: that would give this chat someone else's listing price.
    const shared = () => [...document.querySelectorAll(sel)].find((node) => {
      const owner = node.closest("[data-pb-thread]");
      return !owner || owner === thread;
    });
    const node = thread.matches(sel) ? thread : (thread.querySelector(sel) || shared());
    if (!node) return "";
    const value = node.getAttribute(name);
    if (value) return value.trim();
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function visible(node) {
    if (!node || node.hidden || node.closest("[hidden]")) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return node.getClientRects().length > 0;
  }

  function readMessages(thread) {
    const nodes = [...thread.querySelectorAll("[data-pb-msg]")].filter((node) => !node.closest("[data-pb-host]"));
    const buyers = nodes.filter((node) => node.getAttribute("data-from") === "buyer");
    const lastBuyer = buyers[buyers.length - 1] || null;
    return nodes
      .filter((node) => node.getAttribute("data-from") !== "buyer" || node === lastBuyer)
      .map((node) => ({
        from: node.getAttribute("data-from") === "buyer" ? "buyer" : "seller",
        text: bubbleText(node)
      }))
      .filter((message) => message.text);
  }

  async function hashText(text) {
    try {
      if (globalThis.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }
    } catch {
      /* fall through */
    }
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16);
  }

  function anchorFor(thread, evidence) {
    const quotes = (evidence || []).map((item) => item && item.text).filter(Boolean);
    const msgs = [...thread.querySelectorAll(".msg")];
    let found = null;
    for (const msg of msgs) {
      const text = msg.textContent || "";
      if (quotes.some((quote) => text.includes(quote))) found = msg;
    }
    if (found) return found;
    const sellers = [...thread.querySelectorAll('[data-pb-msg][data-from="seller"]')];
    const last = sellers[sellers.length - 1];
    return (last && last.closest(".msg")) || last || thread.lastElementChild || thread;
  }

  function highlight(thread, evidence) {
    const quotes = [...new Set((evidence || []).map((item) => item && item.text).filter(Boolean))];
    for (const quote of quotes) {
      const bubbles = thread.querySelectorAll("[data-pb-msg]");
      for (const bubble of bubbles) wrapQuote(bubble, quote);
    }
  }

  function blocked(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest("input, textarea, [contenteditable='true'], .composer, [data-pb-host], mark.pb-ev")) return true;
    return false;
  }

  function wrapQuote(root, quote) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes(quote)) return NodeFilter.FILTER_REJECT;
        if (blocked(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const node = walker.nextNode();
    if (!node) return;
    const index = node.nodeValue.indexOf(quote);
    if (index < 0) return;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + quote.length);
    const mark = document.createElement("mark");
    mark.className = "pb-ev";
    try {
      range.surroundContents(mark);
    } catch {
      /* split ranges stay unmarked rather than rewriting the site */
    }
  }

  function ensureMarkStyle() {
    if (document.getElementById("pb-ev-style")) return;
    const style = document.createElement("style");
    style.id = "pb-ev-style";
    // Same marker as the promo slip: an amber band under the words, no rounded pill.
    style.textContent = "mark.pb-ev{background:linear-gradient(#ffc629,#ffc629) no-repeat 0 62%/100% 80%;color:inherit;border-radius:0;padding:0 .06em;box-decoration-break:clone;-webkit-box-decoration-break:clone;}";
    document.documentElement.append(style);
  }

  // The foot caption: plain text, no brand dot.
  function brand(text) {
    return el("span", "pb-brand", text);
  }

  function setFoot(foot, text, kind) {
    foot.className = "pb-foot" + (kind === "status" ? " is-status" : kind === "error" ? " is-error" : "");
    foot.replaceChildren(kind === "status" || kind === "error" ? el("span", null, text) : brand(text));
  }

  // The first phrase the engine quoted for each signal (evidence[i].atom === signal id).
  function quotedPhrases(verdict) {
    const quoted = new Map();
    for (const item of (verdict && verdict.evidence) || []) {
      if (!item || typeof item.atom !== "string" || typeof item.text !== "string") continue;
      const text = item.text.replace(/\s+/g, " ").trim();
      if (text && !quoted.has(item.atom)) quoted.set(item.atom, text.length > 64 ? text.slice(0, 61).trimEnd() + "…" : text);
    }
    return quoted;
  }

  // Signals as footnotes: the receipt label, then the seller's own words in curly quotes.
  function signalNotes(verdict) {
    const notes = el("ol", "pb-notes");
    notes.setAttribute("aria-label", "Detected signals");
    const quoted = quotedPhrases(verdict);
    for (const id of (verdict && verdict.signals) || []) {
      const label = chipLabel(id);
      const item = el("li", null, label);
      const phrase = quoted.get(id);
      // A quote that only repeats the label ("Friends & Family") adds nothing; skip it.
      if (phrase && phrase.toLowerCase() !== label.toLowerCase()) {
        item.append(document.createTextNode(" "));
        item.append(el("span", "pb-quote", "“" + phrase + "”"));
      }
      notes.append(item);
    }
    return notes;
  }

  function orderLine(orderId) {
    const span = el("span");
    span.append(document.createTextNode("Sandbox order created · ID "));
    span.append(el("code", null, orderId));
    span.append(document.createTextNode(" · awaiting approval"));
    return span;
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function paymentRisk(verdict) {
    const api = globalThis.pbPayRisk;
    if (api && typeof api.isPaymentRisk === "function") return api.isPaymentRisk(verdict);
    return true;
  }

  // A card the user has acted on (order created, paid, paid anyway, dismissed) must not be
  // replaced by a later rescan or AI pass.
  function isTerminal(state) {
    return state === "created" || state === "paid" || state === "override" || state === "dismissed";
  }

  function stopPoll(session) {
    if (session.poll) {
      clearInterval(session.poll);
      session.poll = 0;
    }
  }

  function startPoll(session) {
    stopPoll(session);
    const tick = async () => {
      if (!session.orderId || session.state === "paid" || session.state === "override" || session.state === "dismissed") {
        stopPoll(session);
        return;
      }
      const res = await send("pb:status", { orderId: session.orderId, hash: session.hash });
      if (!res || !res.ok) return;
      if (res.status === "COMPLETED" && session.state !== "paid") {
        session.state = "paid";
        session.approved = true;
        stopPoll(session);
        render(session);
        return;
      }
      if (res.status === "APPROVED" && !session.approved) {
        session.approved = true;
        render(session);
      }
    };
    tick();
    session.poll = setInterval(tick, 2000);
  }

  function render(session) {
    enter();
    try {
      ensureMarkStyle();
      let host = session.host;
      if (!host || !host.isConnected) {
        host = document.createElement("div");
        host.dataset.pbHost = "1";
        host.dataset.pbCard = "1";
        const anchor = anchorFor(session.thread, session.verdict && session.verdict.evidence);
        anchor.insertAdjacentElement("afterend", host);
        host.addEventListener("click", (event) => event.stopPropagation());
        host.addEventListener("keydown", (event) => event.stopPropagation());
        session.host = host;
      }
      host.dataset.pbHash = session.hash;
      const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
      shadow.replaceChildren();
      const style = document.createElement("style");
      style.textContent = cssText;
      shadow.append(style);
      shadow.append(session.state === "override" || session.state === "dismissed" ? collapsedCard(session) : fullCard(session));
    } finally {
      leave();
    }
  }

  function collapsedCard(session) {
    const card = el("aside", "pb is-collapsed");
    card.id = "pb-card";
    card.dataset.pbRisk = (session.verdict && session.verdict.level) || "high";
    const note = el("p", "pb-collapsed", session.state === "dismissed" ? DISMISSED : ANYWAY);
    note.tabIndex = -1;
    note.setAttribute("role", "status");
    card.append(note);
    queueMicrotask(() => note.focus());
    return card;
  }

  function fullCard(session) {
    const verdict = session.verdict || {};
    const isPayment = paymentRisk(verdict);
    const card = el("aside", "pb");
    card.id = "pb-card";
    card.dataset.pbRisk = verdict.level || "high";
    card.setAttribute("role", "region");
    card.setAttribute("aria-labelledby", "pb-title");
    if (session.mode) card.dataset.pbMode = session.mode;

    const body = el("div", "pb-body");
    const top = el("div", "pb-top");
    // The level is in the words; the same headline on every viewport.
    const title = el("p", "pb-title", isPayment
      ? (verdict.level === "medium" ? "Possible payment risk" : "High risk payment request")
      : "Account safety risk");
    title.id = "pb-title";
    top.append(title);

    // One plain meta line under the title, joined with " · ".
    const tags = [];
    if (session.mode === "mock") tags.push(el("span", "pb-tag mock", "mock mode"));
    else tags.push(el("span", "pb-tag", "Checked just now"));
    // Visible AI state, so a rules-only card is never mistaken for an AI-checked one.
    if (verdict.llm === "unavailable") tags.push(el("span", "pb-tag ai-off", "AI check unavailable"));
    else if (verdict.llm === "off_server") tags.push(el("span", "pb-tag ai-off", "AI check off (mock server)"));
    else if (verdict.llm === "added" || verdict.llm === "confirmed") tags.push(el("span", "pb-tag ai", "AI checked"));
    if (verdict.source === "model") tags.push(el("span", "pb-tag ai", "On-device model"));
    const tagLine = el("p", "pb-tags");
    tags.forEach((tag, index) => {
      if (index) tagLine.append(document.createTextNode(" · "));
      tagLine.append(tag);
    });

    // Collapsible details (the signal notes, the seller-email field). Collapsed by default on
    // a narrow viewport so the card stays small; always shown on desktop.
    const detailsId = "pb-details";
    const toggle = el("button", "pb-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", detailsId);
    toggle.append(document.createTextNode("Details"));
    top.append(toggle);

    const explain = el("p", "pb-explain", verdict.reason || "");
    const details = el("div", "pb-details");
    details.id = detailsId;
    const notes = signalNotes(verdict);

    const deal = verdict.deal || {};
    let emailInput = null;
    if (isPayment && !deal.payeeEmail && session.state !== "created" && session.state !== "paid") {
      const labelEmail = el("label", "pb-email");
      labelEmail.append(el("span", null, "Seller email for this order"));
      emailInput = document.createElement("input");
      emailInput.id = "pb-email";
      emailInput.type = "email";
      emailInput.autocomplete = "off";
      emailInput.spellcheck = false;
      if (session.typedEmail) emailInput.value = session.typedEmail;
      labelEmail.append(emailInput);
      emailInput.addEventListener("input", () => {
        session.typedEmail = emailInput.value;
      });
    }

    const actions = el("div", "actions");
    const foot = el("div", "pb-foot");
    foot.id = "pb-foot";
    foot.setAttribute("aria-live", "polite");

    if (session.state === "paid") {
      foot.classList.add("is-status");
      foot.append(el("span", null, PAID));
    } else if (session.state === "created") {
      foot.classList.add("is-status");
      foot.append(orderLine(session.orderId || ""));
      if (session.approved) foot.append(el("span", null, "Approval received."));
      const open = el("a", "btn btn-primary", "Open approval");
      const href = safeHttp(session.approveUrl);
      if (href) {
        open.href = href;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
      }
      const capture = el("button", "btn btn-ghost", "I approved it, capture");
      capture.type = "button";
      capture.id = "pb-capture";
      capture.addEventListener("click", () => captureOrder(session, foot));
      actions.append(open, capture);
    } else if (isPayment) {
      const protect = el("button", "btn btn-primary", "Switch to a PayPal order");
      protect.type = "button";
      protect.id = "pb-protect";
      const anyway = el("button", "btn btn-ghost", "Pay anyway");
      anyway.type = "button";
      anyway.id = "pb-anyway";
      protect.addEventListener("click", () => protectDeal(session, emailInput, foot, protect));
      anyway.addEventListener("click", () => payAnyway(session));
      actions.append(protect, anyway);
      foot.append(brand(footerText(verdict, session)));
      if (session.error) {
        foot.classList.add("is-error");
        foot.replaceChildren(el("span", null, session.error));
      }
    } else {
      // No payment to route through PayPal (a code, a remote-access tool, an impostor).
      // The safe action is to acknowledge and hide the card; there is no order to create.
      const dismiss = el("button", "btn btn-primary", "Got it, hide this");
      dismiss.type = "button";
      dismiss.id = "pb-dismiss";
      dismiss.addEventListener("click", () => dismissCard(session));
      actions.append(dismiss);
      foot.append(brand(footerText(verdict, session)));
      if (session.error) {
        foot.classList.add("is-error");
        foot.replaceChildren(el("span", null, session.error));
      }
    }

    if (notes.childElementCount) details.append(notes);
    if (emailInput) details.append(emailInput.parentElement);

    toggle.addEventListener("click", () => {
      const open = card.classList.toggle("pb-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.replaceChildren(document.createTextNode(open ? "Hide" : "Details"));
    });

    body.append(top, tagLine, explain, details);
    if (session.state !== "paid") body.append(actions);
    card.append(body, foot);
    return card;
  }

  async function protectDeal(session, emailInput, foot, button) {
    const verdict = session.verdict || {};
    const deal = verdict.deal || {};
    const email = deal.payeeEmail || (emailInput ? emailInput.value.trim() : "");
    if (!deal.payeeEmail && !validEmail(email)) {
      session.error = "Add the seller email to create the sandbox order.";
      render(session);
      return;
    }
    if (!deal.item || !deal.amount || !deal.currency) {
      session.error = "This chat has no item and price PayBrake can send.";
      render(session);
      return;
    }
    button.disabled = true;
    session.error = "";
    const res = await send("pb:protect", {
      hash: session.hash,
      item: deal.item,
      amount: deal.amount,
      currency: deal.currency,
      payeeEmail: email,
      verdict: verdict
    });
    if (!res || !res.ok) {
      session.error = (res && res.error) || FRIENDLY;
      render(session);
      return;
    }
    session.state = "created";
    session.orderId = res.orderId;
    session.approveUrl = res.approveUrl;
    session.mode = res.mode || session.mode;
    session.approved = res.status === "APPROVED" || res.status === "COMPLETED";
    session.error = "";
    render(session);
    startPoll(session);
  }

  async function captureOrder(session, foot) {
    const res = await send("pb:capture", { orderId: session.orderId, hash: session.hash });
    if (!res || !res.ok) {
      if (foot) {
        foot.className = "pb-foot is-error";
        foot.replaceChildren(el("span", null, (res && res.error) || FRIENDLY));
      }
      return;
    }
    session.state = "paid";
    stopPoll(session);
    render(session);
  }

  async function dismissCard(session) {
    const verdict = session.verdict || {};
    const res = await send("pb:mark", {
      hash: session.hash,
      action: "dismiss",
      signals: verdict.signals || [],
      level: verdict.level || "",
      head: verdict.reason || ""
    });
    if (!res || !res.ok) {
      session.error = (res && res.error) || FRIENDLY;
      render(session);
      return;
    }
    session.state = "dismissed";
    session.error = "";
    stopPoll(session);
    render(session);
  }

  async function payAnyway(session) {
    const verdict = session.verdict || {};
    const res = await send("pb:override", {
      hash: session.hash,
      signals: verdict.signals || [],
      level: verdict.level || "",
      head: (session.text || verdict.reason || "").slice(0, 160)
    });
    if (!res || !res.ok) {
      session.error = (res && res.error) || FRIENDLY;
      render(session);
      return;
    }
    session.state = "override";
    session.error = "";
    stopPoll(session);
    render(session);
  }

  // The AI must never raise the level above the rules level. If a verdict still carries a
  // rule-based level, clamp the shown level to it.
  function clampVerdictLevel(verdict) {
    const api = globalThis.pbPayRisk;
    if (!verdict || !api || typeof api.clampLevel !== "function") return verdict;
    const base = verdict.rulesLevel || (verdict.source === "rules" ? verdict.level : null);
    if (!base) return verdict;
    const level = api.clampLevel(base, verdict.level);
    return level === verdict.level ? verdict : Object.assign({}, verdict, { level });
  }

  function updateHud(line) {
    let hud = document.getElementById("pb-hud");
    if (!debugOn) {
      if (hud) hud.remove();
      return;
    }
    if (!hud) {
      hud = el("div");
      hud.id = "pb-hud";
      hud.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2147483646;max-width:280px;padding:8px 10px;background:#1c2530;color:#fff;font:12px/1.4 system-ui,sans-serif;border-radius:8px;overflow-wrap:anywhere;";
      document.documentElement.append(hud);
    }
    hud.textContent = line || "PayBrake debug";
  }

  function unhighlight(thread) {
    for (const mark of [...thread.querySelectorAll("mark.pb-ev")]) {
      mark.replaceWith(...mark.childNodes);
    }
  }

  function showVerdict(thread, hash, text, verdict, res) {
    let session = sessions.get(hash);
    if (verdict.kind !== "risk") {
      if (session && session.host && !isTerminal(session.state)) {
        session.host.remove();
        unhighlight(thread);
      }
      updateHud("silent " + (verdict.silentReason || "") + (verdict.llm ? " · ai " + verdict.llm : ""));
      return;
    }
    highlight(thread, verdict.evidence);
    if (!session) {
      session = { hash: hash, state: "risk" };
      sessions.set(hash, session);
    }
    session.thread = thread;
    session.verdict = clampVerdictLevel(verdict);
    session.text = text;
    session.mode = (res && res.mode) || session.mode || null;
    session.aiPending = aiState.get(hash) === "pending";
    if (!session.state) session.state = "risk";
    applyStored(session, res.stored);
    render(session);
    if (session.state === "created") startPoll(session);
    updateHud("risk " + verdict.level + " · " + (verdict.signals || []).join(", ") + (verdict.llm ? " · ai " + verdict.llm : ""));
  }

  function queueAi(thread, hash, text, context) {
    if (aiState.has(hash)) return;
    clearTimeout(aiTimers.get(thread));
    aiTimers.set(thread, setTimeout(async () => {
      if (thread.dataset.pbHash !== hash || aiState.has(hash)) return;
      aiState.set(hash, "pending");
      const current = sessions.get(hash);
      if (current && current.host && current.host.isConnected && current.state === "risk") {
        current.aiPending = true;
        render(current);
      }
      const res = await send("pb:detect", { text: text, hash: hash, site: "demo", context: context, phase: "ai" });
      aiState.set(hash, "done");
      const session = sessions.get(hash);
      if (session) session.aiPending = false;
      if (thread.dataset.pbHash !== hash) return;
      if (!res || !res.ok || !res.verdict) {
        updateHud(res && res.error ? res.error : "ai check failed");
        if (session && session.host && session.host.isConnected) render(session);
        return;
      }
      if (session && session.host && session.host.isConnected && isTerminal(session.state)) return;
      enter();
      try {
        showVerdict(thread, hash, text, res.verdict, res);
      } finally {
        leave();
      }
    }, AI_DEBOUNCE_MS));
  }

  async function scanThread(thread) {
    if (!visible(thread)) return;
    const messages = readMessages(thread);
    if (!messages.length) return;
    const text = messages.map((message) => message.text).join("\n");
    const hash = await hashText(text);
    if (thread.querySelector("#pb-card") && thread.dataset.pbHash === hash) return;
    thread.dataset.pbHash = hash;
    const context = {
      listingTitle: field(thread, "data-pb-listing-title"),
      listingPrice: field(thread, "data-pb-listing-price"),
      sellerName: field(thread, "data-pb-seller-name"),
      sellerEmail: field(thread, "data-pb-seller-email"),
      messages: messages
    };
    const session = sessions.get(hash);
    if (session && session.host && session.host.isConnected && isTerminal(session.state)) {
      return;
    }
    if (session && session.state === "risk" && session.host && session.host.isConnected && session.text === text) {
      return;
    }
    if (aiState.get(hash) === "done") return;
    // Phase 1: rules only, instant. Phase 2 (if "AI check on all chats" is on): queued AI check.
    const res = await send("pb:detect", { text: text, hash: hash, site: "demo", context: context, phase: "rules" });
    if (res && res.debug) debugOn = true;
    if (!res || !res.ok || !res.verdict) {
      updateHud(res && res.error ? res.error : "detect failed");
      return;
    }
    showVerdict(thread, hash, text, res.verdict, res);
    if (res.aiOn) queueAi(thread, hash, text, context);
  }

  function applyStored(session, stored) {
    const api = globalThis.pbChatState;
    if (!api || typeof api.sessionPatch !== "function") return;
    const patch = api.sessionPatch(stored);
    if (!patch) return;
    const mode = session.mode;
    Object.assign(session, patch);
    if (!session.mode) session.mode = mode || null;
  }

  async function scan() {
    if (locked()) {
      pending = true;
      return;
    }
    enter();
    try {
      if (!cssText) cssText = await loadCss();
      for (const site of SITES) {
        const threads = [...document.querySelectorAll(site.thread)];
        for (const thread of threads) {
          await scanThread(thread);
        }
      }
    } finally {
      leave();
    }
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 60);
  }

  async function loadCss() {
    const urls = [];
    if (extensionOn()) {
      try { urls.push(chrome.runtime.getURL("card.css")); } catch { /* ignore */ }
    }
    try { urls.push(new URL("/extension/card.css", location.origin).href); } catch { /* ignore */ }
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const text = await res.text();
          if (text && text.includes(".pb")) return text;
        }
      } catch {
        /* try the next url or the fallback */
      }
    }
    return fallbackCss();
  }

  function fallbackCss() {
    return ":host{all:initial;display:block;max-width:min(560px,100%);margin:4px 0 8px 36px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#14161a;container-type:inline-size;min-width:0}*{box-sizing:border-box}:where(button,input,a){font:inherit}:focus-visible{outline:3px solid #14161a;outline-offset:2px;border-radius:2px}.pb{margin:0;background:#fff;border:1px solid #14161a;border-radius:2px;overflow:hidden}.pb-body{padding:16px 20px 14px}.pb-top{display:flex;align-items:flex-start;gap:4px 12px;min-width:0}.pb-title{flex:1 1 auto;min-width:0;margin:0;font-size:19px;line-height:1.2;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}.pb-toggle{display:none}.pb-details{display:block}.pb-tags{margin:3px 0 0;font-size:13px;line-height:1.4;color:#556070}.pb-tag.mock{color:#14161a;font-weight:600}.pb-explain{margin:6px 0 0;font-weight:500;overflow-wrap:anywhere}.pb-notes{position:relative;list-style:none;margin:12px 0 0;padding:9px 0 0;display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px;line-height:1.4;font-weight:600}.pb-notes::before{content:'';position:absolute;left:0;top:0;width:72px;height:1px;background:#14161a}.pb-quote{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:400;color:#556070}.pb-email{display:flex;flex-direction:column;gap:6px;margin:14px 0 0;font-size:13px;font-weight:600;color:#556070}.pb-email input{min-height:44px;width:100%;border:1px solid #8a94a3;border-radius:2px;padding:8px 12px;background:#fff;color:#14161a}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin-top:14px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:2px;font-size:15px;font-weight:650;text-decoration:none;cursor:pointer;transition:background-color .15s ease}.btn-primary{padding:0 20px;background:#0062a8;color:#fff;border:1px solid #0062a8}.btn-primary:hover{background:#004f88;border-color:#004f88}.btn-primary[disabled],.btn-primary[aria-disabled=true]{background:#4d7fb0;border-color:#4d7fb0;cursor:default}.btn-ghost{padding:0 6px;background:transparent;border:0;color:#14161a;font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.22em}.btn-ghost:hover{text-decoration-thickness:2px}.actions>.btn-ghost:first-child{margin-left:-6px}.pb-foot{display:flex;flex-wrap:wrap;gap:2px 8px;padding:10px 20px 12px;font-size:12.5px;line-height:1.4;color:#556070;overflow-wrap:anywhere}.pb-foot.is-status{color:#0b3b66;font-weight:600}.pb-foot.is-error{color:#8a1c12;font-weight:600}.pb-foot code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.pb.is-collapsed{border-color:#d5dbe2}.pb-collapsed{margin:0;padding:12px 20px;font-size:14px;color:#556070}@container (max-width:520px){.pb-body{padding:14px 16px 12px}.actions{flex-direction:column;align-items:flex-start}.actions .btn-primary{width:100%}.actions .btn-ghost{margin-left:-6px}.pb-foot{padding:10px 16px 12px}.pb-collapsed{padding:12px 16px}}@media (max-width:520px){:host{margin-left:0;margin-right:0}.pb-body{padding:14px 16px 12px}.pb-toggle{display:inline-flex;align-items:center;flex:none;min-height:44px;margin:-11px -6px -11px 0;padding:0 6px;font-size:14px;font-weight:600;color:#14161a;background:transparent;border:0;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.22em;cursor:pointer}.pb-explain{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden}.pb-details{display:none}.pb-open .pb-explain{display:block;-webkit-line-clamp:unset;overflow:visible}.pb-open .pb-details{display:block}.actions{flex-direction:column;align-items:flex-start}.actions .btn-primary{width:100%}.actions .btn-ghost{margin-left:-6px}.pb-foot{padding:10px 16px 12px}.pb-collapsed{padding:12px 16px}}@media (prefers-reduced-motion:reduce){.btn{transition:none}}";
  }

  document.addEventListener("click", (event) => {
    if (!event.altKey || !event.shiftKey) return;
    const thread = event.target && event.target.closest && event.target.closest("[data-pb-thread]");
    if (!thread || event.target.closest("[data-pb-host]")) return;
    const session = sessions.get(thread.dataset.pbHash || "");
    send("pb:mark", {
      hash: thread.dataset.pbHash || "",
      action: "miss",
      signals: session && session.verdict ? session.verdict.signals : [],
      level: session && session.verdict ? session.verdict.level : "",
      head: "marked from the chat"
    });
  }, true);

  const observer = new MutationObserver(() => {
    if (locked()) {
      pending = true;
      return;
    }
    schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "class", "style"]
  });

  if (extensionOn() && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pb_opts) {
        debugOn = !!(changes.pb_opts.newValue && changes.pb_opts.newValue.debug);
        updateHud(debugOn ? "PayBrake debug" : "");
      }
    });
  }

  setInterval(schedule, 1500);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();
})();
