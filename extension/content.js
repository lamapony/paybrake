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
          deals.set(body.hash, { verdict: verdict, context: body.context || {}, text: body.text || "" });
          try {
            const health = await Promise.race([
              api("/health", { method: "GET" }),
              new Promise((resolve) => setTimeout(() => resolve(null), 1500))
            ]);
            mode = health && health.paypal;
          } catch {
            mode = null;
          }
          return { ok: true, verdict: verdict, debug: false, mode: mode };
        }
        if (type === "pb:protect") {
          const stored = deals.get(body.hash) || {};
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
          deals.set(body.hash, Object.assign({}, stored, data));
          mode = data.mode || mode;
          return { ok: true, orderId: data.orderId, approveUrl: data.approveUrl, mode: data.mode, status: data.status };
        }
        if (type === "pb:status") {
          const data = await api("/api/orders/" + encodeURIComponent(body.orderId), { method: "GET" });
          return { ok: true, status: data.status, orderId: data.orderId };
        }
        if (type === "pb:capture") {
          const data = await api("/api/orders/" + encodeURIComponent(body.orderId) + "/capture", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
          });
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
    if (session && session.aiPending && (!state || state === "off")) return AI_NOTES.pending;
    return AI_NOTES[state] || "rules check";
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
    const node = thread.matches(sel) ? thread : (thread.querySelector(sel) || document.querySelector(sel));
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
    style.textContent = "mark.pb-ev{background:#ffe7b3;color:inherit;border-radius:4px;padding:0 3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;}";
    document.documentElement.append(style);
  }

  function badgeSvg() {
    const wrap = document.createElement("span");
    wrap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 L22 20 H2 Z" fill="#f5a524" stroke="#b42318" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.5v4.5" stroke="#1c2530" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#1c2530"/></svg>';
    return wrap.firstChild;
  }

  function brand() {
    const span = el("span", "pb-brand");
    span.append(el("span", "pb-dot"), document.createTextNode(""));
    return span;
  }

  function setFoot(foot, text, kind) {
    foot.className = "pb-foot" + (kind === "status" ? " is-status" : kind === "error" ? " is-error" : "");
    foot.replaceChildren();
    if (kind === "status" || kind === "error") {
      const span = el("span", null, text);
      foot.append(span);
      return;
    }
    const span = brand();
    span.append(document.createTextNode(text));
    foot.append(span);
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
    session.poll = setInterval(async () => {
      if (!session.orderId || session.state === "paid" || session.state === "override" || session.state === "dismissed") {
        stopPoll(session);
        return;
      }
      const res = await send("pb:status", { orderId: session.orderId });
      if (!res || !res.ok) return;
      if (res.status === "COMPLETED" && session.state !== "paid") {
        session.state = "paid";
        stopPoll(session);
        render(session);
        return;
      }
      if (res.status === "APPROVED" && !session.approved) {
        session.approved = true;
        render(session);
      }
    }, 2000);
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
    const badge = el("span", "risk-badge");
    badge.id = "pb-title";
    badge.append(badgeSvg());
    const long = el("span", "pb-headline-long", isPayment
      ? (verdict.level === "medium" ? "Possible payment risk" : "High risk payment request")
      : "Account safety risk");
    const short = el("span", "pb-headline-short", isPayment ? "Payment risk" : "Account safety");
    badge.append(long, short);
    top.append(badge);
    // Narrow viewports: the level is shown as its own pill next to a short headline.
    top.append(el("span", "pb-level", verdict.level === "medium" ? "Medium" : "High"));
    if (session.mode === "mock") top.append(el("span", "pb-tag mock", "mock mode"));
    else top.append(el("span", "pb-tag", "Checked just now"));
    // Visible AI state, so a rules-only card is never mistaken for an AI-checked one.
    if (verdict.llm === "unavailable") top.append(el("span", "pb-tag ai-off", "AI check unavailable"));
    else if (verdict.llm === "off_server") top.append(el("span", "pb-tag ai-off", "AI check off (mock server)"));
    else if (verdict.llm === "added" || verdict.llm === "confirmed") top.append(el("span", "pb-tag ai", "AI checked"));

    // Collapsible details (chips, the seller-email field). Collapsed by default on a narrow
    // viewport so the card stays small; always shown on desktop.
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
    const label = el("p", "signals-label", "Detected signals");
    label.id = "signals-label";
    const chips = el("ul", "chips");
    chips.setAttribute("aria-labelledby", "signals-label");
    for (const id of verdict.signals || []) chips.append(el("li", "chip", chipLabel(id)));

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
      const brandSpan = brand();
      brandSpan.append(document.createTextNode(footerText(verdict, session)));
      foot.append(brandSpan);
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
      const brandSpan = brand();
      brandSpan.append(document.createTextNode(footerText(verdict, session)));
      foot.append(brandSpan);
      if (session.error) {
        foot.classList.add("is-error");
        foot.replaceChildren(el("span", null, session.error));
      }
    }

    details.append(label, chips);
    if (emailInput) details.append(emailInput.parentElement);

    toggle.addEventListener("click", () => {
      const open = card.classList.toggle("pb-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.replaceChildren(document.createTextNode(open ? "Hide" : "Details"));
    });

    body.append(top, explain, details);
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
    const res = await send("pb:capture", { orderId: session.orderId });
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
    render(session);
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
    return ":host{all:initial;display:block;max-width:min(560px,100%);margin:4px 0 8px 36px;font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;color:#1c2530;container-type:inline-size}*{box-sizing:border-box}button,input,a{font:inherit}:focus-visible{outline:3px solid #2e90fa;outline-offset:2px}.pb{border-radius:16px;background:#fff;border:1px solid #f1c27d;box-shadow:0 8px 24px rgba(180,35,24,.12);position:relative;overflow:hidden}.pb::before{content:'';position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(180deg,#f5a524,#b42318)}.pb-body{padding:14px 14px 12px 18px}.pb-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.risk-badge{display:inline-flex;align-items:center;gap:6px;background:#fef3f2;color:#b42318;border:1px solid #fecdca;font-weight:700;font-size:13px;padding:5px 10px;border-radius:999px}.pb-explain{margin:0 0 10px;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0 0 12px;padding:0}.chip{background:#fff8eb;border:1px solid #f3c46b;border-radius:8px;padding:4px 8px;font-size:13px;font-weight:600}.actions{display:flex;flex-wrap:wrap;gap:8px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border-radius:999px;font-weight:650;text-decoration:none;cursor:pointer}.btn-primary{background:#0062a8;color:#fff;border:1px solid #0062a8}.btn-ghost{background:transparent;color:#4a5666;border:1px solid #c3ccd7}.pb-foot{padding:8px 14px 8px 18px;background:#f6f8fb;border-top:1px solid #dde3ea;font-size:12px;overflow-wrap:anywhere}.pb-foot.is-status{background:#eef4ff;color:#1e3a8a;font-weight:600}.pb-foot.is-error{background:#fef3f2;color:#7a271a}.pb.is-collapsed{border-color:#dde3ea;box-shadow:none}.pb-collapsed{margin:0;padding:11px 14px 11px 18px}.pb-email{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}.pb-email input{min-height:44px;width:100%;border:1px solid #c3ccd7;border-radius:10px;padding:8px 12px}.pb-headline-short,.pb-level,.pb-toggle{display:none}.pb-details{display:block}@container (max-width:520px){.actions{flex-direction:column}.actions .btn{width:100%}}@media (max-width:520px){:host{margin-left:0}.pb-headline-long{display:none}.pb-headline-short{display:inline}.pb-level{display:inline-flex;font-size:11px;font-weight:700;text-transform:uppercase;color:#7a271a;background:#fef3f2;border:1px solid #fecdca;border-radius:999px;padding:3px 9px}.pb-tag:not(.mock):not(.ai):not(.ai-off){display:none}.pb-toggle{display:inline-flex;margin-left:auto;padding:6px 10px;font-size:12px;font-weight:650;color:#4a5666;background:#f6f8fb;border:1px solid #c3ccd7;border-radius:999px;cursor:pointer}.pb-explain{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden}.pb-details{display:none}.pb-open .pb-explain{display:block;-webkit-line-clamp:unset;overflow:visible}.pb-open .pb-details{display:block}.actions{flex-direction:column}.actions .btn{width:100%}}@media (prefers-reduced-motion:reduce){.btn{transition:none}}";
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
