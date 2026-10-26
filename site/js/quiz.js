(function () {
  const QUESTIONS = [
    { text: "Send 500 kr as Friends & Family. Several people are asking.", risky: true },
    { text: "I can post it with tracked platform postage. You pay through the marketplace checkout.", risky: false },
    { text: "Pay with this link: paypa1-secure-checkout.example/pay", risky: true,
      note: "\"paypa1\" is a lookalike of \"paypal\", and the message asks you to pay through it. Since rules v3, a lookalike or odd link next to \"pay\", \"claim\" or \"log in\" shows a card." },
    { text: "Congratulations, you won a 2,000 kr prize! Call 9090 1234 today to claim it.", risky: true,
      note: "A red flag the rules miss: there is no link, code or payment ask in it, just a number to call. The AI check in the extension catches most messages like this. This page runs the rules only." }
  ];

  const progress = document.getElementById("quiz-progress");
  const thread = document.getElementById("quiz-thread");
  const bubble = document.getElementById("quiz-bubble");
  const actions = document.getElementById("quiz-actions");
  const reveal = document.getElementById("quiz-reveal");
  const nextBtn = document.getElementById("quiz-next");
  const riskyBtn = document.getElementById("quiz-risky");
  const fineBtn = document.getElementById("quiz-fine");
  const demo = globalThis.pbDemo;
  if (!progress || !thread || !bubble || !actions || !reveal || !nextBtn || !riskyBtn || !fineBtn || !demo) return;

  let index = 0;
  let locked = false;
  let token = 0;
  const history = [];

  function renderQuestion(moveFocus) {
    const item = QUESTIONS[index];
    progress.hidden = false;
    progress.textContent = "Message " + (index + 1) + " of 4";
    thread.hidden = false;
    actions.hidden = false;
    demo.highlight(bubble, item.text, []);
    reveal.replaceChildren();
    riskyBtn.setAttribute("aria-pressed", "false");
    fineBtn.setAttribute("aria-pressed", "false");
    riskyBtn.setAttribute("aria-disabled", "false");
    fineBtn.setAttribute("aria-disabled", "false");
    nextBtn.hidden = true;
    nextBtn.dataset.mode = "next";
    nextBtn.textContent = "Next message";
    if (moveFocus) riskyBtn.focus();
  }

  function paintReveal(choice, result) {
    const box = demo.el("div", "reveal-box");
    if (!result) {
      box.append(demo.el("p", "reveal-verdict", "The rules check did not run. Reload the page and try again."));
      reveal.replaceChildren(box);
      return false;
    }
    const item = QUESTIONS[index];
    const risky = demo.isRisk(result);
    const saidRisky = choice === "risky";
    const match = item.risky === saidRisky;
    box.append(demo.el("p", "reveal-match", match ? "Good call: this " + (item.risky ? "is a red flag." : "looks fine.") : "Not quite: this " + (item.risky ? "is a red flag." : "looks fine.")));
    if (risky) {
      box.append(demo.el("p", "reveal-verdict", "PayBrake shows a card: " + demo.levelLabel(result.level) + "."));
      if (result.reason) box.append(demo.el("p", "reveal-reason", result.reason));
      demo.highlight(bubble, QUESTIONS[index].text, result.evidence);
    } else {
      box.append(demo.el("p", "reveal-verdict", demo.QUIET));
      demo.highlight(bubble, QUESTIONS[index].text, []);
    }
    const chips = demo.chipList(result.signals, "pb-quiz-signals");
    if (chips.count) box.append(chips.label, chips.list);
    box.append(demo.el("p", "reveal-why", item.note || demo.whyFor(result, item.text)));
    reveal.replaceChildren(box);
    return match;
  }

  async function choose(choice) {
    if (locked) return;
    locked = true;
    const current = ++token;
    riskyBtn.setAttribute("aria-disabled", "true");
    fineBtn.setAttribute("aria-disabled", "true");
    riskyBtn.setAttribute("aria-pressed", choice === "risky" ? "true" : "false");
    fineBtn.setAttribute("aria-pressed", choice === "fine" ? "true" : "false");
    let result = null;
    try {
      if (!globalThis.pbPayRisk || typeof pbPayRisk.detect !== "function") throw new Error("missing");
      result = await pbPayRisk.detect(QUESTIONS[index].text, {});
    } catch (error) {
      result = null;
    }
    if (current !== token) return;
    const match = paintReveal(choice, result);
    history[index] = { choice, result, match };
    nextBtn.hidden = false;
    nextBtn.dataset.mode = index === QUESTIONS.length - 1 ? "score" : "next";
    nextBtn.textContent = index === QUESTIONS.length - 1 ? "See score" : "Next message";
  }

  function showScore() {
    thread.hidden = true;
    actions.hidden = true;
    progress.hidden = true;
    const spotted = history.filter((item) => item && item.match).length;
    const box = demo.el("div", "reveal-box");
    box.append(demo.el("p", "score", "You spotted " + spotted + " of 4"));
    const list = document.createElement("ol");
    list.className = "recap";
    for (const item of history) {
      const li = document.createElement("li");
      if (!item || !item.result) {
        li.textContent = "The check did not run.";
      } else {
        const verdict = demo.isRisk(item.result) ? "PayBrake: card" : "PayBrake: quiet";
        const said = item.choice === "risky" ? "Looks risky" : "Looks fine";
        li.textContent = "You said " + said + ". " + (item.match ? "Right." : "Not quite.") + " " + verdict + ".";
      }
      list.append(li);
    }
    box.append(list);
    reveal.replaceChildren(box);
    nextBtn.hidden = false;
    nextBtn.dataset.mode = "retry";
    nextBtn.textContent = "Try again";
  }

  riskyBtn.addEventListener("click", () => { void choose("risky"); });
  fineBtn.addEventListener("click", () => { void choose("fine"); });
  nextBtn.addEventListener("click", () => {
    if (nextBtn.dataset.mode === "retry") {
      index = 0;
      locked = false;
      token += 1;
      history.length = 0;
      renderQuestion(true);
      return;
    }
    if (nextBtn.dataset.mode === "score") {
      showScore();
      return;
    }
    index += 1;
    locked = false;
    renderQuestion(true);
  });

  renderQuestion(false);
})();
