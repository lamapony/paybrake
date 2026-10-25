(() => {
  const ADAPTER = {
    roots: '[role="main"], [role="dialog"], [aria-label*="Chat" i]',
    rows: '[role="row"]', text: 'div[dir="auto"]',
    strip: 'h1,h2,h3,h4,h5,h6,[role="button"],[aria-hidden="true"],time,[data-paybrake]',
    headings: 'h1,h2,h3,h4,h5,h6', title: 'h1,h2', grid: '[role="grid"]',
    card: '[data-paybrake="card"]', editable: '[role="textbox"],[contenteditable],input,textarea',
    ownText: 'span,div'
  };
  // Both manifest entries match chat URLs; install observers and listeners only once.
  if (globalThis.__paybrakePilot) return;
  globalThis.__paybrakePilot = true;
  const cache = new Map(), collapsed = new Set(), processed = new WeakMap();
  let opts = {checkOwn:false,debug:false}, timer;
  const report = e => { if (opts.debug) console.debug('[PayBrake]', e); };
  const safe = fn => (...args) => {
    try {
      const result = fn(...args);
      if (result && typeof result.catch === 'function') result.catch(report);
      return result;
    } catch (e) { report(e); }
  };
  const hash = s => { let h=2166136261; for (let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619); return (h>>>0).toString(16); };
  const send = async message => { try { return await chrome.runtime.sendMessage(message); } catch { return {ok:false}; } };
  const labels = {friends_family:'Friends & Family', mobilepay:'MobilePay',bank_transfer:'Bank transfer',deposit:'Upfront deposit',urgency:'Pressure to hurry',ship_only:'Shipping only'};
  const CSS = '  :host {\n    --bg: #eef1f5;\n    --surface: #ffffff;\n    --surface-2: #f6f8fb;\n    --line: #dde3ea;\n    --ink: #1c2530;\n    --ink-2: #4a5666;\n    --ink-3: #5d6a7c;\n    --brand: #4a6582;\n    --bubble-in: #e9edf2;\n    --bubble-out: #4a6582;\n    --risk: #b42318;\n    --risk-bg: #fef3f2;\n    --amber: #f5a524;\n    --amber-bg: #fff8eb;\n    --amber-line: #f3c46b;\n    --pp-blue: #0062a8;\n    --pp-blue-hover: #004f88;\n    --pp-navy: #002f6c;\n    --ok: #067647;\n    --ok-bg: #ecfdf3;\n    --radius: 14px;\n    --shadow: 0 1px 2px rgba(16,24,40,.06), 0 4px 16px rgba(16,24,40,.06);\n  }\n  .pb {\n    margin: 4px 0 8px 36px;\n    max-width: 560px;\n    border-radius: 16px;\n    background: var(--surface);\n    border: 1px solid #f1c27d;\n    box-shadow: 0 2px 4px rgba(180,35,24,.06), 0 10px 28px rgba(180,35,24,.10);\n    overflow: hidden;\n    position: relative;\n  }\n  .pb::before {\n    content: "";\n    position: absolute; inset: 0 auto 0 0;\n    width: 5px;\n    background: linear-gradient(180deg, var(--amber), var(--risk));\n  }\n  .pb-body { padding: 16px 18px 14px 22px; }\n  .pb-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }\n  .risk-badge {\n    display: inline-flex; align-items: center; gap: 7px;\n    background: var(--risk-bg);\n    color: var(--risk);\n    border: 1px solid #fecdca;\n    font-weight: 700;\n    font-size: 13px;\n    padding: 5px 11px 5px 8px;\n    border-radius: 999px;\n  }\n  .risk-badge svg { flex: none; }\n  .pb-tag { font-size: 12px; color: var(--ink-3); margin-left: auto; }\n  .pb-explain { margin: 0 0 12px; font-size: 15px; font-weight: 550; }\n  .signals-label {\n    font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;\n    color: var(--ink-3); margin: 0 0 6px;\n  }\n  .chips { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }\n  .chip {\n    display: inline-flex; align-items: center; gap: 6px;\n    background: var(--amber-bg);\n    border: 1px solid var(--amber-line);\n    color: #6b4200;\n    font-size: 13px; font-weight: 600;\n    padding: 4px 10px;\n    border-radius: 8px;\n  }\n  .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #d9480f; flex: none; }\n  .actions { display: flex; gap: 10px; flex-wrap: wrap; }\n  .btn {\n    display: inline-flex; align-items: center; justify-content: center; gap: 8px;\n    min-height: 44px;\n    padding: 10px 18px;\n    border-radius: 999px;\n    font-weight: 650;\n    font-size: 15px;\n    text-align: center;\n    cursor: pointer;\n    transition: background-color .15s ease, border-color .15s ease, transform .1s ease;\n  }\n  .btn:active { transform: scale(.98); }\n  .btn-primary { background: var(--pp-blue); color: #fff; border: 1px solid var(--pp-blue); }\n  .btn-primary:hover { background: var(--pp-blue-hover); border-color: var(--pp-blue-hover); }\n  .btn-primary[disabled] { background: #4d7fb0; border-color: #4d7fb0; cursor: default; }\n  .btn-ghost { background: transparent; color: var(--ink-2); border: 1px solid #c3ccd7; }\n  .btn-ghost:hover { background: var(--surface-2); border-color: #9aa7b6; }\n  .pb-foot {\n    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;\n    padding: 9px 18px 9px 22px;\n    background: var(--surface-2);\n    border-top: 1px solid var(--line);\n    font-size: 12px; color: var(--ink-3);\n  }\n  .pb-brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--ink-2); }\n  .pb-dot { width: 14px; height: 14px; border-radius: 50%; border: 3px solid var(--ink-2); flex: none; }\n  .pb-foot.is-status { background: #eef4ff; color: #1e3a8a; font-weight: 600; }\n  .pb-foot.is-status .ok-ico { flex: none; }\n  .pb-foot code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 12px; }\n\n  /* Collapsed after "Pay anyway" */\n  .pb.is-collapsed { border-color: var(--line); box-shadow: none; }\n  .pb.is-collapsed::before { background: #9aa7b6; }\n  .pb-collapsed { padding: 11px 18px 11px 22px; font-size: 13px; color: var(--ink-2); }\n  .pb-collapsed:focus-visible { outline-offset: -3px; }\n\n\n:host { all: initial; display:block; max-width:560px; margin:6px 0 10px 36px; font-family:system-ui,sans-serif; color:#1c2530; color-scheme:light; container-type:inline-size; line-height:1.45; }\n* {box-sizing:border-box} .pb {margin:0;max-width:100%} button{font-family:inherit} :focus-visible{outline:3px solid #0062a8;outline-offset:3px} .pb-explain{overflow-wrap:anywhere}\n@container (max-width:520px){.actions{flex-direction:column}.actions .btn{width:100%}.pb-tag{margin-left:0;width:100%}.pb-body{padding:14px 14px 12px 18px}}\n@media(max-width:520px){:host{margin-left:0}}\n@media(prefers-reduced-motion:reduce){.btn{transition:none}.btn:active{transform:none}}\n';
  function element(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text)n.textContent=text; return n; }
  function render(row, node, verdict, id, title, text) {
    const host=element('div'); host.dataset.paybrake='card'; host.dataset.pbHash=id;
    const shadow=host.attachShadow({mode:'open'});
    shadow.addEventListener('click',safe(e=>e.stopPropagation()));
    const style=element('style');style.textContent=CSS;shadow.append(style);
    const card=element('section','pb');shadow.append(card);
    function collapse() { card.className='pb is-collapsed';card.replaceChildren(element('div','pb-collapsed','You chose to pay anyway. Logged on this device.')); }
    if(collapsed.has(id)) collapse();
    else {
      const body=element('div','pb-body'),top=element('div','pb-top'),badge=element('span','risk-badge');
      badge.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 L22 20 H2 Z" fill="#f5a524" stroke="#b42318" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.5v4.5" stroke="#1c2530" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#1c2530"/></svg>';
      badge.append(document.createTextNode(verdict.level==='high'?'High risk payment request':'Possible payment risk'));
      top.append(badge,element('span','pb-tag','Checked just now'));
      const chips=element('ul','chips');verdict.signals.forEach(s=>chips.append(element('li','chip',labels[s])));
      const actions=element('div','actions'),protect=element('button','btn btn-primary','Move to protected PayPal order'),anyway=element('button','btn btn-ghost','Pay anyway');
      protect.dataset.pbAction='protect';anyway.dataset.pbAction='anyway';actions.append(protect,anyway);
      const foot=element('footer','pb-foot','PayBrake · on-device check · only you can see this');foot.setAttribute('aria-live','polite');
      protect.addEventListener('click',safe(async()=>{
        const parts=title.split(' · ');const result=await send({type:'pb:protect',deal:verdict.deal,item:parts.length>1?parts.slice(1).join(' · '):'Item from chat',seller:parts.length>1?parts[0]:'Seller',hash:id,signals:verdict.signals,reason:verdict.reason});
        foot.textContent=result?.ok?'Opened a protected order draft in a new tab':'Could not open the draft. Reload this page and try again.';
      }));
      anyway.addEventListener('click',safe(async()=>{
        const result=await send({type:'pb:log',entry:{action:'pay_anyway',hash:id,signals:verdict.signals,level:verdict.level,head:text.slice(0,160),url:location.origin+location.pathname,ts:Date.now()}});
        if(result?.ok){collapsed.add(id);collapse();}else foot.textContent='Could not save the log. Reload this page and try again.';
      }));
      body.append(top,element('p','pb-explain',verdict.reason),element('p','signals-label','Detected signals'),chips,actions);card.append(body,foot);
    }
    node.dataset.paybrakeFlagged='1';row.append(host);
  }
  function direction(row,node) {
    const own=/^(You sent|Du sendte|Du har sendt|You:)$/i;
    if([...row.querySelectorAll(ADAPTER.ownText)].some(n=>!n.children.length&&own.test(n.textContent.trim())))return {mine:true};
    const heading=[...row.querySelectorAll(ADAPTER.headings)].find(h=>h.textContent.trim().length<80);
    if(heading)return {mine:own.test(heading.textContent.trim())};
    const b=node.getBoundingClientRect(),r=row.getBoundingClientRect(),g=row.closest(ADAPTER.grid)?.getBoundingClientRect();
    const frame=r.width?r:g;
    if(!b.width||!frame?.width)return {mine:false,unknown:true};
    return {mine:b.x+b.width/2>frame.x+frame.width*.6};
  }
  const scan=safe(()=>{
    if(!(location.hostname==='www.messenger.com'||/^\/(messages|marketplace)/.test(location.pathname)))return;
    document.documentElement.dataset.paybrake='on';
    const roots = document.querySelectorAll(ADAPTER.roots);
    if (opts.debug) console.debug('[PayBrake] scan', {roots: roots.length, checkOwn: opts.checkOwn});
    for(const root of roots) {
      // A row belongs to its nearest thread root, so nested chat roots stay separate.
      const incoming=[];
      for(const row of root.querySelectorAll(ADAPTER.rows)) {
        if(row.closest(ADAPTER.roots)!==root||row.closest(ADAPTER.editable))continue;
        const nodes = [...row.querySelectorAll(ADAPTER.text)].filter(n => {
          // The active-page marker on <html> also matches [data-paybrake].
          // Only exclusions inside this row belong to the message being read.
          const stripped = n.closest(ADAPTER.strip);
          const outerText = n.parentElement?.closest(ADAPTER.text);
          return !(stripped && row.contains(stripped)) && !n.closest(ADAPTER.editable)
            && !(outerText && row.contains(outerText));
        });
        const texts=nodes.map(n=>{const copy=n.cloneNode(true);copy.querySelectorAll(ADAPTER.strip).forEach(x=>x.remove());return copy.textContent.trim();});
        const text = texts.join('\n');
        if (text.length < 2) {
          if (opts.debug) console.debug('[PayBrake] row', {direction: 'unknown', head: text, verdict: 'skipped', reason: 'no message text'});
          continue;
        }
        const dir=direction(row,nodes[0]);
        const context=incoming.slice(-4),id=hash(text),key=JSON.stringify([text,context]);
        if(!dir.mine)incoming.push(text);
        if(dir.mine&&!opts.checkOwn&&!opts.debug)continue;
        let verdict=cache.get(key);if(!verdict){verdict=PayBrakeDetector.detect(text,{context});cache.set(key,verdict);if(cache.size>1000)cache.delete(cache.keys().next().value);}
        if (opts.debug) console.debug('[PayBrake] row', {
          hash: id,
          direction: dir.unknown ? 'unknown (incoming fallback)' : dir.mine ? 'outgoing' : 'incoming',
          head: text.slice(0, 160),
          verdict: verdict.kind,
          reason: verdict.silentReason || verdict.level,
          skipped: dir.mine && !opts.checkOwn ? 'own message' : null
        });
        if(dir.mine&&!opts.checkOwn)continue;
        if(processed.get(row)===key&&row.querySelector(ADAPTER.card))continue;
        processed.set(row,key);
        if(verdict.kind==='risk'&&(!dir.unknown||verdict.level==='high')&&!row.querySelector(ADAPTER.card))render(row,nodes[0],verdict,id,root.querySelector(ADAPTER.title)?.textContent||document.title.split(' | ')[0],text);
      }
    }
  });
  // LLM confirm hook (off)
  const style=element('style');style.dataset.paybrake='style';style.textContent='[data-paybrake-flagged="1"]{outline:2px solid #f5a524;outline-offset:3px;border-radius:3px}';document.head.append(style);
  const debugStyle=element('style');debugStyle.dataset.paybrake='debug';document.head.append(debugStyle);
  const apply=safe(value=>{opts={checkOwn:false,debug:false,...value};debugStyle.textContent=opts.debug?`${ADAPTER.roots.split(',').map(r=>r+' '+ADAPTER.rows).join(',')}{outline:1px dashed #f5a524}`:'';scan();});
  try{chrome.storage.local.get('pb_opts').then(safe(r=>apply(r.pb_opts))).catch(report);chrome.storage.onChanged.addListener(safe((c,area)=>{if(area==='local'&&c.pb_opts)apply(c.pb_opts.newValue);}));}catch(e){report(e);}
  new MutationObserver(safe(()=>{clearTimeout(timer);timer=setTimeout(scan,300);})).observe(document.body,{childList:true,subtree:true,characterData:true});
  setInterval(scan,2000);scan();
})();
