// The page behaves like the product: "Pay anyway" collapses the card, the blue button is the brake,
// the playground runs the extension's real rules while you type. Also the row sweeps and the one fixed button.
(function () {
  "use strict";

  var root = document.documentElement;
  var motion = root.classList.contains("read");
  var SWEEP = "cubic-bezier(.22, 1, .36, 1)";
  // The flood travels a whole screen; with the sweep curve it would be gone in the first frames.
  var FLOOD = "cubic-bezier(.4, 0, .2, 1)";
  var FLOOD_MS = 480;

  var card = document.querySelector("#scam .pb");
  var fullCard = card && card.querySelector(".pb-full");
  var saidCard = card && card.querySelector(".pb-said");

  // "Pay anyway": the card collapses to the extension's one-line state. Height is measured and animated
  // with WAAPI so no inline style is left behind and reduced motion simply skips the animation.
  function setCollapsed(on, animate) {
    if (!fullCard || fullCard.hidden === on) return;
    var from = card.offsetHeight;
    fullCard.hidden = on;
    saidCard.hidden = !on;
    card.classList.toggle("is-collapsed", on);
    if (!animate || !motion || !card.animate) return;
    card.animate({ height: [from + "px", card.offsetHeight + "px"] }, { duration: 220, easing: SWEEP });
    (on ? saidCard : fullCard).animate({ opacity: [0, 1] }, { duration: 160, easing: "ease-out" });
  }

  if (card) {
    var anyway = card.querySelector("[data-anyway]");
    var restore = card.querySelector("[data-restore]");
    anyway.addEventListener("click", function (event) {
      event.preventDefault();
      setCollapsed(true, true);
      restore.focus({ preventScroll: true });
    });
    restore.addEventListener("click", function () {
      setCollapsed(false, true);
      anyway.focus({ preventScroll: true });
    });
  }

  // "Read it again" restarts the hero's CSS animations, from the full card.
  var again = document.querySelector("[data-replay]");
  if (again && motion) {
    again.hidden = false;
    again.addEventListener("click", function () {
      setCollapsed(false, false);
      root.classList.remove("read");
      void root.offsetWidth;
      root.classList.add("read");
    });
  }

  // Sweeps. Something is armed (retracted) only once the visitor scrolls and it is still below the viewport,
  // so a printed or full-page copy always shows the final state.
  if (motion && "IntersectionObserver" in window) {
    root.classList.add("io");
    var makeWatcher = function (threshold) {
      var watcher = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            watcher.unobserve(entry.target);
            entry.target.classList.remove("armed");
          }
        });
      }, { threshold: threshold, rootMargin: "0px 0px -8% 0px" });
      return watcher;
    };
    var rowWatcher = makeWatcher(0.6);
    var tallWatcher = makeWatcher(0.15);   // the path and the big fields can be taller than the viewport
    var arm = function () {
      var bottom = window.innerHeight;
      document.querySelectorAll("[data-sweep]").forEach(function (el) {
        if (el.getBoundingClientRect().top > bottom) {
          el.classList.add("armed");
          (el.getAttribute("data-sweep") === "tall" ? tallWatcher : rowWatcher).observe(el);
        }
      });
    };
    window.addEventListener("scroll", arm, { passive: true, once: true });
  }

  // The brake: the button's blue spreads over the page from the button, and the page is the order under it.
  var brake = document.querySelector("[data-brake]");
  var order = document.getElementById("order");
  var orderHeading = document.getElementById("order-h");

  function landOnOrder() {
    window.scrollTo({ top: order.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
    if (window.history && history.pushState) history.pushState(null, "", "#order");
    orderHeading.focus({ preventScroll: true });
  }

  // The strike lands on 500 a beat after the page turns blue, so it reads as the result of the press.
  function strikeAmounts() {
    if (!root.classList.contains("io")) return;
    var rows = [].slice.call(document.querySelectorAll(".ledger [data-sweep]")).filter(function (row) {
      return row.getBoundingClientRect().top < window.innerHeight;
    });
    rows.forEach(function (row) { row.classList.add("armed"); });
    setTimeout(function () {
      rows.forEach(function (row) { row.classList.remove("armed"); });
    }, 240);
  }

  if (brake && order && orderHeading) {
    brake.addEventListener("click", function (event) {
      event.preventDefault();
      if (!motion) {
        landOnOrder();
        return;
      }
      var box = brake.getBoundingClientRect();
      var x = Math.round(box.left + box.width / 2);
      var y = Math.round(box.top + box.height / 2);
      var reach = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));
      var circle = { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + reach + "px at " + x + "px " + y + "px)"] };

      if (document.startViewTransition) {
        root.classList.add("braking");
        var transition = document.startViewTransition(function () {
          landOnOrder();
          strikeAmounts();
        });
        var done = function () {
          root.classList.remove("braking");
          if (document.activeElement !== orderHeading) orderHeading.focus({ preventScroll: true });
        };
        transition.ready.then(function () {
          root.animate(circle, { duration: FLOOD_MS, easing: FLOOD, pseudoElement: "::view-transition-new(root)" });
        }, function () {});
        transition.finished.then(done, done);
        return;
      }

      var flood = document.createElement("div");
      flood.className = "flood";
      document.body.appendChild(flood);
      flood.animate(circle, { duration: FLOOD_MS, easing: FLOOD }).finished.then(function () {
        landOnOrder();
        strikeAmounts();
        flood.animate({ opacity: [1, 0] }, { duration: 120, easing: "ease-out" }).finished.then(function () {
          flood.remove();
        });
      });
    });
  }

  // One button stays on screen: once the hero (and its CTA) has scrolled away, until the try chapter or footer
  // is in view. The whole hero is observed because an anchor jump can carry a small target past the viewport
  // without it ever intersecting. Over the ink chapter it turns white so it stays visible.
  var dock = document.getElementById("dock");
  var hero = document.getElementById("scam");
  var tryChapter = document.getElementById("try");
  var foot = document.querySelector(".foot");
  if (dock && hero && tryChapter && foot && "IntersectionObserver" in window) {
    var past = false;
    var ending = false;
    var update = function () { dock.classList.toggle("on", past && !ending); };
    new IntersectionObserver(function (entries) {
      var entry = entries[entries.length - 1];
      past = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      update();
    }).observe(hero);
    var inView = new Set();
    var endWatcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) inView.add(entry.target); else inView.delete(entry.target);
      });
      ending = inView.size > 0;
      update();
    });
    endWatcher.observe(tryChapter);
    endWatcher.observe(foot);
    var numbersChapter = document.getElementById("numbers");
    if (numbersChapter) {
      new IntersectionObserver(function (entries) {
        dock.classList.toggle("inv", entries[entries.length - 1].isIntersecting);
      }, { rootMargin: "-92% 0px 0px 0px" }).observe(numbersChapter);
    }
  }

  // Playground. Runs only where the build has copied the rules files next to the page.
  var form = document.getElementById("check");
  if (!form) return;
  var base = form.getAttribute("data-rules-lib");
  if (!base) return;
  form.hidden = false;

  var field = document.getElementById("try-msg");
  var echo = document.getElementById("try-echo");
  var verdictBox = document.getElementById("try-verdict");
  var presets = [].slice.call(form.querySelectorAll("[data-msg]"));
  var FILES = ["brand", "tidy", "atoms", "extract", "redact", "pay-risk"];
  var MIN_LENGTH = 20;   // the rules skip anything shorter
  var loading = null;
  var painted = { text: "", marks: [] };   // what the mirror shows now
  var shownVerdict = null;
  var timer = 0;
  var runId = 0;

  function loadRules() {
    if (loading) return loading;
    loading = FILES.reduce(function (chain, name) {
      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          var script = document.createElement("script");
          script.src = base + name + ".js?v=11";
          script.onload = resolve;
          script.onerror = function () { reject(new Error("could not load " + name)); };
          document.head.appendChild(script);
        });
      });
    }, Promise.resolve());
    return loading;
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  // The verdict box is a live region, so it only changes when the verdict does.
  function setVerdict(key, children) {
    if (key === shownVerdict) return;
    shownVerdict = key;
    verdictBox.replaceChildren.apply(verdictBox, children);
  }

  // Marks away from an edit keep their place until the rules have run again.
  function shiftMarks(before, after, marks) {
    var start = 0;
    var limit = Math.min(before.length, after.length);
    while (start < limit && before[start] === after[start]) start++;
    var endBefore = before.length;
    var endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    var delta = after.length - before.length;
    var kept = [];
    marks.forEach(function (mark) {
      if (mark.end <= start) kept.push(mark);
      else if (mark.start >= endBefore) kept.push({ start: mark.start + delta, end: mark.end + delta, kind: mark.kind });
    });
    return kept;
  }

  // Overlapping hits merge. In a card the strongest kind wins; a silent message keeps the safe mark.
  function mergeHits(hits, kind) {
    var rank = kind === "risk" ? { weak: 1, safe: 2, strong: 3 } : { weak: 1, strong: 2, safe: 3 };
    var marks = hits.map(function (hit) {
      return { start: hit.start, end: hit.end, kind: hit.role === "veto" ? "safe" : hit.strength === "strong" ? "strong" : "weak" };
    });
    marks.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var merged = [];
    marks.forEach(function (mark) {
      var last = merged[merged.length - 1];
      if (last && mark.start < last.end) {
        last.end = Math.max(last.end, mark.end);
        if (rank[mark.kind] > rank[last.kind]) last.kind = mark.kind;
      } else {
        merged.push(mark);
      }
    });
    return merged;
  }

  // Paint the mirror. Only marks that were not there before sweep in, so typing does not make old ones flicker.
  // The zero-width space keeps a trailing newline's line box.
  function paint(text, marks) {
    var before = painted.marks;
    var frag = document.createDocumentFragment();
    var fresh = [];
    var at = 0;
    marks.forEach(function (mark) {
      if (mark.start > at) frag.appendChild(document.createTextNode(text.slice(at, mark.start)));
      var el = node("mark", mark.kind, text.slice(mark.start, mark.end));
      var known = before.some(function (old) { return old.start === mark.start && old.end === mark.end && old.kind === mark.kind; });
      if (!known && motion) {
        el.classList.add("fresh");
        fresh.push(el);
      }
      frag.appendChild(el);
      at = mark.end;
    });
    frag.appendChild(document.createTextNode(text.slice(at) + "​"));
    echo.replaceChildren(frag);
    painted = { text: text, marks: marks };
    if (fresh.length) {
      void echo.offsetWidth;
      fresh.forEach(function (el) { el.classList.remove("fresh"); });
    }
  }

  function signalNames(verdict) {
    return (verdict.signals || []).map(function (id) {
      var atom = pbAtoms.ATOMS.find(function (item) { return item.id === id; });
      return atom ? atom.receipt : id;
    });
  }

  function renderRisk(verdict, marks, text) {
    var label = !pbPayRisk.isPaymentRisk(verdict)
      ? "Account safety risk"
      : verdict.level === "medium" ? "Possible payment risk" : "High risk payment request";
    var names = signalNames(verdict);
    var parts = [node("p", "state card", label), node("p", "reason", verdict.reason)];
    if (names.length) parts.push(node("p", "sig", names.join(" · ")));
    var quotes = marks.map(function (mark) { return text.slice(mark.start, mark.end); });
    if (quotes.length) parts.push(node("p", "sr", "PayBrake marked: " + quotes.join(", ") + "."));
    setVerdict("risk|" + label + "|" + verdict.reason + "|" + names.join(), parts);
  }

  var SILENT = {
    veto: "A safe way to pay is agreed in the message, so the rules stay quiet.",
    weak_only: "Only weak signals. With no payment request in the message, the rules stay quiet."
  };

  function renderSilent(verdict) {
    var reason = SILENT[verdict.silentReason] || "The rules found no payment request to flag. That is not a safety check of the message.";
    setVerdict("silent|" + reason, [node("p", "state none", "No card"), node("p", "reason", reason)]);
  }

  function renderNote(text) {
    setVerdict("note|" + text, [node("p", "reason", text)]);
  }

  function showHint() {
    setVerdict("hint", [node("p", "small hint", "The verdict appears here.")]);
  }

  async function check(asked) {
    var id = ++runId;
    var text = field.value;
    if (text.trim().length < MIN_LENGTH) {
      paint(text, []);
      if (asked && text.trim()) renderNote("Too short to check. Paste the whole message.");
      else showHint();
      return;
    }
    try {
      await loadRules();
      var verdict = await pbPayRisk.detect(text, { from: "seller" }, {});
      if (id !== runId) return;   // a newer edit is on its way
      var marks = mergeHits(pbAtoms.findAtoms(text), verdict.kind);
      if (verdict.kind === "risk") renderRisk(verdict, marks, text);
      else renderSilent(verdict);
      paint(text, marks);
    } catch (err) {
      renderNote("The rules file did not load, so nothing was checked. Reload the page and try again.");
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearTimeout(timer);
    check(true);
  });
  field.addEventListener("focus", function () { loadRules().catch(function () {}); }, { once: true });
  field.addEventListener("input", function () {
    presets.forEach(function (button) { button.setAttribute("aria-pressed", "false"); });
    var text = field.value;
    paint(text, shiftMarks(painted.text, text, painted.marks));
    runId++;
    clearTimeout(timer);
    timer = setTimeout(check, 150);
  });
  presets.forEach(function (button) {
    button.addEventListener("click", function () {
      presets.forEach(function (other) { other.setAttribute("aria-pressed", String(other === button)); });
      field.value = button.getAttribute("data-msg");
      runId++;
      clearTimeout(timer);
      paint(field.value, []);
      check();
    });
  });
  paint(field.value, []);
})();
