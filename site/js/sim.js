(function () {
  const DEMO_URL = "https://paybrake-demo.spbabinov.workers.dev/demo/marketplace.html?live=1";
  const QUIET = "The rules stay quiet: no risky ask found.";
  const PRESETS = [
    {
      label: "Friends & Family deposit",
      text: "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow"
    },
    {
      label: "MobilePay or bank transfer",
      text: "Send 2,400 kr on MobilePay, bank transfer works too. Today only."
    },
    {
      label: "Gift card",
      text: "Buy a 100 EUR gift card and send me the code. That is the only way I can take payment."
    },
    {
      label: "Asks for an SMS code",
      text: "Hi, this is the MobilePay security team. To receive the 1,800 kr, send me the 6-digit code you just got by SMS."
    },
    {
      label: "Lookalike payment link",
      text: "I have paid. Receive the money via this link: paypa1-secure-checkout.example/claim"
    },
    {
      label: "Delivery fee via link",
      text: "Before I can ship, pay the 49 kr delivery fee via this link: postnord-parcel.top/pay"
    },
    {
      label: "Remote-access app",
      text: "Install AnyDesk and I will help you set up the payment."
    },
    {
      label: "Pay on pickup",
      text: "Sure, you can see it Saturday and pay when you pick it up"
    },
    {
      label: "Goods & Services",
      text: "Yes, Goods & Services works. Pay the 1,800 kr through the marketplace checkout."
    }
  ];

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

  function isRisk(result) {
    return !!(result && result.kind === "risk" && (result.level === "high" || result.level === "medium"));
  }

  function levelLabel(level) {
    return level === "medium" ? "Possible payment risk" : "High risk payment request";
  }

  function mergeRanges(evidence, len) {
    const raw = [];
    for (const item of evidence || []) {
      if (!item || typeof item.start !== "number" || typeof item.end !== "number") continue;
      const start = Math.max(0, item.start);
      const end = Math.min(len, item.end);
      if (start < end) raw.push([start, end]);
    }
    raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const range of raw) {
      const last = merged[merged.length - 1];
      if (!last || range[0] > last[1]) merged.push(range);
      else last[1] = Math.max(last[1], range[1]);
    }
    return merged;
  }

  function highlight(container, text, evidence) {
    const frag = document.createDocumentFragment();
    const source = String(text ?? "");
    const ranges = mergeRanges(evidence, source.length);
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start > cursor) frag.append(document.createTextNode(source.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.textContent = source.slice(start, end);
      frag.append(mark);
      cursor = end;
    }
    if (cursor < source.length) frag.append(document.createTextNode(source.slice(cursor)));
    container.replaceChildren(frag);
  }

  function whyFor(result, text) {
    const signals = (result && result.signals) || [];
    if (isRisk(result)) {
      const parts = [];
      if (signals.includes("remote_access")) {
        parts.push("A remote-access app lets a stranger control your device, so it shows a card on its own.");
      } else if (signals.includes("credential_request")) {
        parts.push("Asking for a code, card details or a login is enough for a card on its own.");
      } else if (signals.includes("fee_via_link")) {
        parts.push("A fee you must pay before you get something is enough for a card on its own.");
      } else if (signals.includes("phishing_link")) {
        parts.push("The link goes to a lookalike or odd address and asks you to pay or claim, so the card shows.");
      } else if (signals.includes("friends_family") && signals.includes("upfront_deposit")) {
        parts.push("Friends & Family plus an upfront deposit is a concrete payment ask, so the card shows.");
      } else if (signals.includes("friends_family")) {
        parts.push("Friends & Family as the way to pay is a concrete payment ask, so the card shows.");
      } else if (signals.includes("pay_before_see")) {
        parts.push("Asking to pay before you see the item is a concrete payment ask, so the card shows.");
      } else if (signals.includes("off_platform") && signals.includes("upfront_deposit")) {
        parts.push("An upfront deposit outside PayPal checkout is a concrete payment ask, so the card shows.");
      } else if (signals.includes("off_platform")) {
        parts.push("An off-platform payment ask is enough for a card.");
      } else if (signals.includes("upfront_deposit")) {
        parts.push("An upfront deposit is a concrete payment ask, so the card shows.");
      } else {
        parts.push("The rules matched a concrete payment ask, so the card shows.");
      }
      if (signals.includes("urgency_pressure")) parts.push("Pressure to hurry is only an extra chip.");
      if (signals.includes("ship_before_meet")) parts.push("Shipping before you meet is only an extra chip.");
      if (signals.includes("impersonation")) parts.push("Posing as a bank or support team is only an extra chip.");
      return parts.join(" ");
    }
    if (result && result.silentReason === "veto") {
      return "A pickup or checkout phrase is a veto, so the rules stay quiet.";
    }
    if (result && result.silentReason === "weak_only") {
      return "Only a weak signal matched, such as hurry, shipping or 'this is your bank'. Those never open a card on their own.";
    }
    if (result && result.silentReason === "short") {
      return "Under 20 characters after tidy-up, so the rules stay quiet.";
    }
    return "No rule matched, so the rules stay quiet. In the extension, the AI check can still add a card when it is set up.";
  }

  function warningIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const tri = document.createElementNS(ns, "path");
    tri.setAttribute("d", "M12 3 L22 20 H2 Z");
    tri.setAttribute("fill", "#f5a524");
    tri.setAttribute("stroke", "#b42318");
    tri.setAttribute("stroke-width", "1.6");
    tri.setAttribute("stroke-linejoin", "round");
    const stem = document.createElementNS(ns, "path");
    stem.setAttribute("d", "M12 9.5v4.5");
    stem.setAttribute("stroke", "#1c2530");
    stem.setAttribute("stroke-width", "2");
    stem.setAttribute("stroke-linecap", "round");
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", "12");
    dot.setAttribute("cy", "17");
    dot.setAttribute("r", "1.2");
    dot.setAttribute("fill", "#1c2530");
    svg.append(tri, stem, dot);
    return svg;
  }

  function chipList(signals, labelId) {
    const label = el("p", "pb-signals-label", "Detected signals");
    label.id = labelId;
    const list = el("ul", "pb-chips");
    list.setAttribute("aria-labelledby", labelId);
    const seen = new Set();
    for (const id of signals || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.append(el("li", "pb-chip", chipLabel(id)));
    }
    return { label, list, count: seen.size };
  }

  globalThis.pbDemo = { el, chipLabel, highlight, whyFor, isRisk, levelLabel, chipList, QUIET };

  function initSim() {
    const presets = document.getElementById("sim-presets");
    const textarea = document.getElementById("sim-text");
    const bubble = document.getElementById("sim-bubble");
    const result = document.getElementById("sim-result");
    if (!presets || !textarea || !bubble || !result) return;

    let timer = 0;
    let seq = 0;
    const buttons = [];

    function syncPressed(value) {
      for (const button of buttons) {
        button.setAttribute("aria-pressed", button._text === value ? "true" : "false");
      }
    }

    function showError() {
      const note = el("p", "quiet is-error", "The rules check did not run. Reload the page and try again.");
      result.replaceChildren(note);
    }

    function showQuiet() {
      result.replaceChildren(el("p", "quiet", QUIET));
    }

    function showNote(note, kind) {
      note.replaceChildren();
      if (kind === "switch") {
        note.append(document.createTextNode("In the extension this opens a sandbox PayPal order. Try the real thing in the "));
        const link = document.createElement("a");
        link.href = DEMO_URL;
        link.textContent = "demo store";
        note.append(link, document.createTextNode("."));
      } else {
        note.textContent = "PayBrake lets you; it only notes the choice on your device.";
      }
    }

    function showCard(verdict) {
      const card = el("aside", "pb");
      card.dataset.level = verdict.level;
      card.setAttribute("role", "region");
      card.setAttribute("aria-labelledby", "pb-sim-title");
      card.append(el("div", "pb-bar"));

      const body = el("div", "pb-body");
      const top = el("div", "pb-top");
      const badge = el("span", "pb-badge");
      badge.id = "pb-sim-title";
      badge.append(warningIcon());
      badge.append(document.createTextNode(levelLabel(verdict.level)));
      top.append(badge, el("span", "pb-tag", "Checked just now"));

      const explain = el("p", "pb-explain", verdict.reason || "");
      const chips = chipList(verdict.signals, "pb-sim-signals");
      const actions = el("div", "pb-actions");
      const note = el("p", "pb-note");
      note.hidden = true;

      const switchBtn = el("button", "pb-btn pb-btn-primary", "Switch to a PayPal order");
      switchBtn.type = "button";
      const anywayBtn = el("button", "pb-btn pb-btn-ghost", "Pay anyway");
      anywayBtn.type = "button";
      switchBtn.addEventListener("click", () => {
        note.hidden = false;
        showNote(note, "switch");
      });
      anywayBtn.addEventListener("click", () => {
        note.hidden = false;
        showNote(note, "anyway");
      });
      actions.append(switchBtn, anywayBtn);
      body.append(top, explain);
      if (chips.count) body.append(chips.label, chips.list);
      body.append(actions, note);

      const foot = el("div", "pb-foot");
      const brand = el("span", "pb-brand");
      brand.append(el("span", "pb-dot"), document.createTextNode("PayBrake · rules check · only you can see this"));
      foot.append(brand);
      card.append(body, foot);
      result.replaceChildren(card);
    }

    async function run(text) {
      const id = ++seq;
      highlight(bubble, text, []);
      let verdict;
      try {
        if (!globalThis.pbPayRisk || typeof pbPayRisk.detect !== "function") throw new Error("missing");
        verdict = await pbPayRisk.detect(text, {});
      } catch (error) {
        if (id !== seq) return;
        showError();
        return;
      }
      if (id !== seq) return;
      if (isRisk(verdict)) {
        highlight(bubble, text, verdict.evidence);
        showCard(verdict);
      } else {
        highlight(bubble, text, []);
        showQuiet();
      }
    }

    function schedule(text) {
      highlight(bubble, text, []);
      clearTimeout(timer);
      timer = setTimeout(() => { void run(text); }, 150);
    }

    PRESETS.forEach((preset) => {
      const button = el("button", "preset");
      button.type = "button";
      button._text = preset.text;
      button.setAttribute("aria-pressed", "false");
      button.append(el("span", "preset-name", preset.label), el("span", "preset-sample", preset.text));
      button.addEventListener("click", () => {
        textarea.value = preset.text;
        syncPressed(preset.text);
        clearTimeout(timer);
        void run(preset.text).then(() => {
          if (window.matchMedia("(max-width: 860px)").matches) {
            result.scrollIntoView({ block: "nearest" });
          }
        });
      });
      buttons.push(button);
      presets.append(button);
    });

    textarea.addEventListener("input", () => {
      syncPressed(textarea.value);
      schedule(textarea.value);
    });

    textarea.value = PRESETS[0].text;
    syncPressed(PRESETS[0].text);
    void run(PRESETS[0].text);
  }

  function initReveal() {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frames = [...document.querySelectorAll(".frame")].filter((frame) => frame.querySelector("img"));
    if (!frames.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    }, { root: null, rootMargin: "0px 0px -5% 0px", threshold: 0.01 });
    for (const frame of frames) {
      frame.classList.add("is-reveal");
      observer.observe(frame);
    }
  }

  initSim();
  initReveal();
})();
