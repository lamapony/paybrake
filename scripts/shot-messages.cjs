// Reproduce roleplay screenshots using the real content script in rules-only mode.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const messages = require('../night/messages.json');
const files = ['brand.js', 'tidy.js', 'atoms.js', 'extract.js', 'redact.js', 'pay-risk.js', 'ask-llm.js', 'chat-state.js'];
const expected = ['High', 'Medium', 'High', 'Medium', 'Medium', 'High', 'High', 'High', null];
const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: '18080' }, stdio: 'inherit' });
(async () => {
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch('http://127.0.0.1:18080/demo/marketplace.html')).ok) break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    for (const width of [1280, 390]) for (let i = 0; i < messages.length; i++) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 } });
      await page.goto('http://127.0.0.1:18080/demo/marketplace.html?live=1');
      await page.evaluate(message => {
        document.querySelector('.compare')?.remove();
        const thread = document.querySelector('#thread-bike');
        const sellers = thread.querySelectorAll('[data-pb-msg][data-from="seller"]');
        sellers[0].remove();
        sellers[1].textContent = message;
      }, messages[i]);
      for (const file of files) await page.addScriptTag({ path: path.join(root, 'extension/lib', file) });
      await page.addScriptTag({ path: path.join(root, 'extension/content.js') });
      const card = page.locator('#thread-bike #pb-card');
      if (expected[i]) {
        await card.waitFor({ state: 'visible', timeout: 5000 });
        const text = await card.innerText();
        if (!text.includes(expected[i])) throw Error(`Unexpected level for message ${i + 1}: ${text}`);
      } else {
        await page.waitForTimeout(1000);
        if (await card.count()) throw Error('Honest control showed a card');
      }
      await page.screenshot({ path: path.join(root, `shots/msg-${i + 1}-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
