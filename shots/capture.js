// Visual audit screenshots — bypasses 5s MCP limit with direct Playwright
const { chromium } = require('/Users/anas/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');

const OUT = __dirname;
const VIEWPORTS = [
  { name: 'desktop-1425', w: 1425, h: 821 },
  { name: 'laptop-1366', w: 1366, h: 768 },
  { name: 'tablet-1024', w: 1024, h: 768 },
  { name: 'mobile-390', w: 390, h: 844 },
];
const PAGES = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/login', name: 'login' },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/anas/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-x64/chrome-headless-shell',
  });
  // Reuse auth session if we have one saved
  let context;
  try {
    const fs = require('fs');
    if (fs.existsSync(OUT + '/storage-state.json')) {
      context = await browser.newContext({
        storageState: OUT + '/storage-state.json',
        viewport: { width: 1425, height: 821 },
      });
    } else {
      context = await browser.newContext({ viewport: { width: 1425, height: 821 } });
    }
  } catch {
    context = await browser.newContext({ viewport: { width: 1425, height: 821 } });
  }

  const page = await context.newPage();

  for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
      try {
        await page.goto('http://localhost:3000' + p.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(7000); // let fonts/charts settle
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${p.name}-${vp.name}.png`, timeout: 120000 });
        console.log(`OK ${p.name}-${vp.name}`);
      } catch (e) {
        console.log(`FAIL ${p.name}-${vp.name}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  // Save storage state for reuse
  try {
    require('fs').writeFileSync(OUT + '/storage-state.json', JSON.stringify(await context.storageState()));
  } catch {}
  await browser.close();
  console.log('DONE');
})();
