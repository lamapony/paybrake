// Three small things: the read (replay and row sweeps), the phone bottom bar, and the playground
// that runs the extension's real rules on a message the visitor pastes.
(function () {
  "use strict";

  var root = document.documentElement;
  var motion = root.classList.contains("read");

  // "Read it again" restarts the hero's CSS animations.
  var again = document.querySelector("[data-replay]");
  if (again && motion) {
    again.hidden = false;
    again.addEventListener("click", function () {
      root.classList.remove("read");
      void root.offsetWidth;
      root.classList.add("read");
    });
  }

  // Row sweeps. A row is armed (marks retracted) only once the visitor scrolls and the row is still
  // below the viewport, so a printed or full-page copy always shows the final state.
  if (motion && "IntersectionObserver" in window) {
    root.classList.add("io");
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          entry.target.classList.remove("armed");
        }
      });
    }, { threshold: 0.6, rootMargin: "0px 0px -8% 0px" });
    var arm = function () {
      var bottom = window.innerHeight;
      document.querySelectorAll("[data-sweep]").forEach(function (row) {
        if (row.getBoundingClientRect().top > bottom) {
          row.classList.add("armed");
          observer.observe(row);
        }
      });
    };
    window.addEventListener("scroll", arm, { passive: true, once: true });
  }

  // Phone bottom bar: once the hero (and its CTA) has scrolled away, until the try chapter or footer is in view.
  // The whole hero is observed because an anchor jump can carry a small target past the viewport without it ever intersecting.
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
  var FILES = ["brand", "tidy", "atoms", "extract", "redact", "pay-risk"];
  var loading = null;

  function loadRules() {
    if (loading) return loading;
    loading = FILES.reduce(function (chain, name) {
      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          var script = document.createElement("script");
          script.src = base + name + ".js?v=10";
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

  function setVerdict(children) {
    verdictBox.replaceChildren.apply(verdictBox, children);
  }

  // Mirror the textarea so the grid cell grows with it. The zero-width space keeps a trailing newline's line box.
  function mirror(text) {
    echo.textContent = (text == null ? field.value : text) + "​";
    echo.classList.remove("armed");
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

  function paintMarks(text, marks) {
    var frag = document.createDocumentFragment();
    var at = 0;
    marks.forEach(function (mark) {
      if (mark.start > at) frag.appendChild(document.createTextNode(text.slice(at, mark.start)));
      frag.appendChild(node("mark", mark.kind, text.slice(mark.start, mark.end)));
      at = mark.end;
    });
    frag.appendChild(document.createTextNode(text.slice(at) + "​"));
    echo.replaceChildren(frag);
    if (motion) {
      echo.classList.add("armed");
      void echo.offsetWidth;
      echo.classList.remove("armed");
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
    setVerdict(parts);
  }

  function renderSilent() {
    setVerdict([
      node("p", "state none", "No card"),
      node("p", "reason", "The rules found no payment request to flag. That is not a safety check of the message.")
    ]);
  }

  function renderError(message) {
    setVerdict([node("p", "reason", message)]);
  }

  function clearResult() {
    setVerdict([node("p", "small hint", "The verdict appears here.")]);
  }

  async function check(event) {
    event.preventDefault();
    var text = field.value.trim();
    if (text.length < 20) {
      mirror();
      renderError("Too short to check. Paste the whole message.");
      return;
    }
    try {
      await loadRules();
      var clean = pbTidy.cleanText(field.value);
      field.value = clean;
      mirror(clean);
      var verdict = await pbPayRisk.detect(clean, { from: "seller" }, {});
      var marks = mergeHits(pbAtoms.findAtoms(clean), verdict.kind);
      if (verdict.kind === "risk") renderRisk(verdict, marks, clean);
      else renderSilent();
      paintMarks(clean, marks);
    } catch (err) {
      renderError("The rules file did not load, so nothing was checked. Reload the page and try again.");
    }
  }

  form.addEventListener("submit", check);
  field.addEventListener("focus", function () { loadRules().catch(function () {}); }, { once: true });
  field.addEventListener("input", function () {
    mirror();
    clearResult();
  });
  mirror();
})();
