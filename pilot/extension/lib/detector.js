(() => {
  const RULES_VERSION = 1;
  const clean = x => typeof x === 'string' ? x : '';
  const bounded = pattern => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu');
  const patterns = {
    friends_family: 'friends (?:and|&) family|F&F|FnF|send as gift|personal payment|venner (?:og|&) familie',
    mobilepay: 'MobilePay|mobile pay|MP (?:til|to)\\s+(?:\\+?\\d[\\d ]{6,}\\d)',
    bank_transfer: 'bank transfer|wire transfer|bankoverførsel|overførsel|overfør til min konto|IBAN|[A-Z]{2}\\d{2}[A-Z0-9]{11,30}|reg\\.?\\s?nr|registreringsnummer|kontonummer|kontonr|konto nr|account number|sort code',
    deposit: 'depositum|deposit|forudbetaling|forskud|pay first|betal først|pay upfront|up front|(?:reserve|reservation) fee|hold it for you|reservere|holder[^.!?]{0,40}til dig',
    urgency: 'today only|only today|others are interested|several people|a lot of people|lots of interest|first come|quickly|quick|asap|hurtigt|hurtig|i dag|mange er interesserede|mange interesserede|flere er interesserede|først til mølle',
    ship_only: "only shipping|shipping only|can only ship|I'm abroad|I am abroad|courier|kun forsendelse|kan kun sende|sender med post|I post it|I send it"
  };
  const pay = bounded('pay|send|paypal|via|betal|betale|overfør');
  const veto = bounded('when you pick|on pickup|at pickup|cash on pickup|pay when we meet|ved afhentning|når du henter|når du kommer|kontant|cash|through the checkout|marketplace checkout|goods and services|goods & services|G&S');
  function parseAmount(input) {
    const str = clean(input), n = '\\d+(?:[.,]\\d+)*';
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:kr\\.?|DKK|€|\\$)\\s*${n}|${n}\\s*(?:kroner|kr\\.?|DKK|EUR|euro|USD)|${n},-)(?![\\p{L}\\p{N}])`, 'giu');
    return [...str.matchAll(re)].map(m => {
      let number = m[0].match(/\d+(?:[.,]\d+)*/)[0];
      number = number.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
      return { value: Number(number), currency: /€|EUR|euro/i.test(m[0]) ? 'EUR' : /\$|USD/i.test(m[0]) ? 'USD' : 'DKK', text: m[0], index: m.index };
    }).filter(a => Number.isFinite(a.value));
  }
  function atoms(s) {
    const out = [];
    for (const [atom, pattern] of Object.entries(patterns)) {
      for (const m of s.matchAll(bounded(pattern))) {
        const before = s.slice(Math.max(0, m.index - 60), m.index);
        if (atom === 'deposit' && /(?:no\s+(?:need for\s+)?(?:a\s+)?|ingen\s+|uden\s+|bottle\s+|return them for the\s+)$|\bpant\b/i.test(before)) continue;
        if ((atom === 'friends_family' && /^(friends|venner)/i.test(m[0])) || (atom === 'bank_transfer' && /^(IBAN|[A-Z]{2}\d{2})/i.test(m[0]))) {
          if (![...s.matchAll(pay)].some(p => Math.max(p.index - (m.index + m[0].length), m.index - (p.index + p[0].length), 0) <= 60)) continue;
        }
        out.push({ atom, text: m[0], index: m.index });
      }
    }
    const amounts = parseAmount(s);
    for (const dep of out.filter(e => e.atom === 'deposit')) {
      const adjacent = amounts.map(amount => {
        const start = Math.min(amount.index, dep.index);
        const end = Math.max(amount.index + amount.text.length, dep.index + dep.text.length);
        const gap = amount.index < dep.index
          ? s.slice(amount.index + amount.text.length, dep.index)
          : s.slice(dep.index + dep.text.length, amount.index);
        return { start, end, gap };
      }).filter(span => /^[ \t]*(?:(?:i|of|på)[ \t]+)?$/iu.test(span.gap))
        .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      if (adjacent) {
        dep.index = adjacent.start;
        dep.text = s.slice(adjacent.start, adjacent.end);
      }
    }
    return out;
  }
  function detect(input, options) {
    const text = clean(input), context = Array.isArray(options?.context) ? options.context.slice(-4).map(clean) : [];
    const messages = [...context, text];
    const groups = messages.map(s => ({ s, atoms: atoms(s), amounts: parseAmount(s) }));
    const evidence = groups.flatMap(g => g.atoms.map(({ atom, text }) => ({ atom, text })));
    const signals = Object.keys(patterns).filter(a => evidence.some(e => e.atom === a));
    const amounts = [...groups].reverse().flatMap(g => g.amounts.map(a => ({ ...a, g })));
    const deposits = amounts.filter(a => a.g.atoms.some(d => d.atom === 'deposit' && Math.max(d.index - a.index - a.text.length, a.index - d.index - d.text.length, 0) <= 30));
    // Prefer the amount closest to a deposit rather than an earlier full price.
    deposits.sort((a,b) => Math.min(...a.g.atoms.filter(d=>d.atom==='deposit').map(d=>Math.abs(d.index-a.index))) - Math.min(...b.g.atoms.filter(d=>d.atom==='deposit').map(d=>Math.abs(d.index-b.index))));
    const chosen = deposits[0] || amounts[0];
    const other = amounts.filter(a => a !== chosen).sort((a,b)=>b.value-a.value);
    const priced = amounts.find(a => /(?:price|pris|costs|koster)[^.!?]{0,25}$/i.test(a.g.s.slice(Math.max(0,a.index-30),a.index)));
    const deal = { amount: chosen?.value ?? null, currency: chosen?.currency ?? null, depositAmount: deposits[0]?.value ?? null, priceAmount: priced?.value ?? other[0]?.value ?? null };
    const silent = silentReason => ({ kind:'silent', silentReason, signals, evidence, deal, rulesVersion:RULES_VERSION });
    if (text.trim().length < 12) return silent('short');
    const newest = groups.at(-1);
    if (!newest.atoms.length && !newest.amounts.length) return silent('no_pay_method');
    if (!signals.includes('deposit') && messages.some(s => [...s.matchAll(veto)].length)) return silent('veto');
    const methods = evidence.filter(e => ['friends_family','mobilepay','bank_transfer'].includes(e.atom));
    if (!methods.length) return silent(signals.length && signals.every(s=>['urgency','ship_only'].includes(s)) ? 'weak_only' : 'no_pay_method');
    if (!signals.includes('deposit') && !amounts.length) return silent('no_money');
    const high = signals.includes('deposit') || signals.includes('urgency') || signals.includes('ship_only') || new Set(methods.map(e=>e.atom)).size >= 2;
    const method = methods.find(e=>e.atom==='friends_family') || methods[0], dep = evidence.find(e=>e.atom==='deposit');
    let reason;
    if (dep && method.atom === 'friends_family') reason = `“${dep.text}” via “${method.text}”: if the item never arrives, you may have no way to get your money back.`;
    else if (dep) reason = `Upfront “${dep.text}” by “${method.text}”: a direct transfer outside PayPal is very hard to get back.`;
    else reason = `“${chosen.text}” by “${method.text}” before you see the item: hard to get back if it never arrives.`;
    if (chosen) evidence.push({atom:'amount',text:chosen.text});
    reason = reason.replace(/[\r\n]+/g,' ');
    if (reason.length > 160) reason = reason.slice(0,159) + '…';
    return {kind:'risk',level:high?'high':'medium',reason,signals,evidence,deal,rulesVersion:RULES_VERSION};
  }
  globalThis.PayBrakeDetector = { RULES_VERSION, detect, parseAmount };
})();
