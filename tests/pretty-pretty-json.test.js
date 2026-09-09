'use strict';
/**
 * Regression suite for index.html. Runs entirely against the static file
 * (no server needed) using Playwright + Chromium.
 *
 * Usage:
 *   npm install
 *   npx playwright install chromium   (first time only)
 *   npm test
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'public', 'index.html');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeJwt(header, payload, signature) {
  return b64url(header) + '.' + b64url(payload) + '.' + (signature === undefined ? 'sig' : signature);
}

async function freshPage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  page._errors = errors;
  return page;
}

// ---------------------------------------------------------------------
// Parsing: strict, lenient recovery, and hard failures
// ---------------------------------------------------------------------

test('valid JSON renders a tree with correct stats', async (page) => {
  await page.fill('#input', JSON.stringify({ name: 'x', list: [1, 2, 3] }));
  await page.waitForTimeout(200);
  assert.strictEqual(await page.isVisible('#errorBanner'), false);
  const stats = await page.innerText('#outputStats');
  assert.match(stats, /Object · 2 keys/);
});

test('JSON Lines are lenient-parsed and wrapped into an array', async (page) => {
  const jsonl = [JSON.stringify({ id: 1 }), JSON.stringify({ id: 2 }), JSON.stringify({ id: 3 })].join('\n');
  await page.fill('#input', jsonl);
  await page.waitForTimeout(200);
  const notice = await page.innerText('#notice');
  assert.match(notice, /3 separate JSON values/);
  const stats = await page.innerText('#outputStats');
  assert.match(stats, /Array · 3 items/);
});

test('trailing commas are auto-fixed', async (page) => {
  await page.fill('#input', '{"a":1,"b":2,}');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.isVisible('#errorBanner'), false);
  const notice = await page.innerText('#notice');
  assert.match(notice, /trailing comma/);
});

test('concatenated JSON with no separator is lenient-parsed', async (page) => {
  await page.fill('#input', '{"a":1}{"b":2}');
  await page.waitForTimeout(200);
  const stats = await page.innerText('#outputStats');
  assert.match(stats, /Array · 2 items/);
});

test('genuinely invalid JSON shows an error and no preview', async (page) => {
  await page.fill('#input', '{"a": , "b": 2}');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.isVisible('#errorBanner'), true);
  assert.ok(await page.$('.output .placeholder'));
});

test('valid JSON followed by unparsable text keeps the valid part', async (page) => {
  await page.fill('#input', '{"a":1}\nnot json here');
  await page.waitForTimeout(200);
  const notice = await page.innerText('#notice');
  assert.match(notice, /stopped after 1 value/);
  const stats = await page.innerText('#outputStats');
  assert.match(stats, /Object · 1 key/);
});

test('no em dash anywhere in the rendered UI', async (page) => {
  await page.fill('#input', '{"a": , }');
  await page.waitForTimeout(200);
  const bodyText = await page.innerText('body');
  assert.ok(!bodyText.includes('—'), 'found an em dash in visible text');
});

// ---------------------------------------------------------------------
// Format / Minify
// ---------------------------------------------------------------------

test('Format and Minify round-trip correctly', async (page) => {
  await page.fill('#input', '{"a":1,"b":[1,2,3]}');
  await page.waitForTimeout(200);
  await page.click('#btnFormat');
  await page.waitForTimeout(100);
  const formatted = await page.inputValue('#input');
  assert.strictEqual(JSON.parse(formatted).a, 1);
  assert.ok(formatted.includes('\n'));
  await page.click('#btnMinify');
  await page.waitForTimeout(100);
  const minified = await page.inputValue('#input');
  assert.strictEqual(minified, '{"a":1,"b":[1,2,3]}');
});

test('removed buttons stay removed (Load Sample, Open File, Copy, Download)', async (page) => {
  const count = await page.$$eval('#btnSample, #fileInput, #btnCopy, #btnDownload', (els) => els.length);
  assert.strictEqual(count, 0);
});

// ---------------------------------------------------------------------
// Tree rendering: batching for large collections
// ---------------------------------------------------------------------

test('large arrays render lazily in batches ("Show more")', async (page) => {
  const bigArray = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i })));
  await page.fill('#input', bigArray);
  await page.waitForTimeout(200);
  const rootToggle = await page.$('.jv-toggle:not([disabled])');
  await rootToggle.click();
  await page.waitForTimeout(150);
  const moreBtn = await page.$('.jv-more');
  assert.ok(moreBtn, 'expected a "Show more" button after expanding a 5000-item array');
  assert.match(await moreBtn.innerText(), /Show 200 more of 4800 remaining/);
  await moreBtn.click();
  await page.waitForTimeout(150);
  const nodeCount = await page.$$eval('.jv-node', (els) => els.length);
  assert.strictEqual(nodeCount, 401); // root + 400 rendered children
});

// ---------------------------------------------------------------------
// Depth stepper
// ---------------------------------------------------------------------

test('depth label defaults to 0 before any JSON is rendered', async (page) => {
  assert.strictEqual(await page.innerText('#depthLabel'), '0');
});

test('depth stepper: collapse all / step / expand all stay in sync with the label', async (page) => {
  await page.fill('#input', JSON.stringify({ a: { b: { c: 1 } } }));
  await page.waitForTimeout(200);
  await page.click('#btnDepthMin');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.innerText('#depthLabel'), '0');
  await page.click('#btnDepthUp');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.innerText('#depthLabel'), '1');
  await page.click('#btnDepthMax');
  await page.waitForTimeout(100);
  const maxLabel = await page.innerText('#depthLabel');
  await page.click('#btnDepthDown');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.innerText('#depthLabel'), String(Number(maxLabel) - 1));
});

test('a huge document always starts collapsed, even after a smaller doc left depth expanded', async (page) => {
  await page.fill('#input', JSON.stringify({ a: { b: { c: 1 } } }));
  await page.waitForTimeout(200); // small doc auto-expands fully, depth > 0
  const hugeArray = JSON.stringify(Array.from({ length: 200000 }, (_, i) => ({ id: i, name: 'item ' + i })));
  await page.fill('#input', hugeArray);
  await page.waitForTimeout(800);
  assert.strictEqual(await page.innerText('#depthLabel'), '0');
  const nodeCount = await page.$$eval('.jv-node', (els) => els.length);
  assert.strictEqual(nodeCount, 1, 'only the (collapsed) root should be in the DOM');
});

test('editing input preserves tree depth and preview scroll position', async (page) => {
  const obj = {};
  for (let i = 0; i < 100; i++) obj['key' + i] = { value: i };
  await page.fill('#input', JSON.stringify(obj));
  await page.waitForTimeout(200);
  await page.click('#btnDepthMax');
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.getElementById('output').scrollTop = 300; });

  const current = await page.inputValue('#input');
  const edited = current.replace('"key0"', '"keyExtra":{"value":-1},"key0"');
  await page.fill('#input', edited);
  await page.waitForTimeout(250);

  assert.notStrictEqual(await page.innerText('#depthLabel'), '0');
  const scrollAfter = await page.$eval('#output', (el) => el.scrollTop);
  assert.strictEqual(scrollAfter, 300);
});

test('pasting new content expands fully; plain typing preserves depth', async (page) => {
  await page.fill('#input', '{"x":1}');
  await page.waitForTimeout(200);
  await page.click('#btnDepthMin');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.innerText('#depthLabel'), '0');

  await page.evaluate((json) => {
    const el = document.getElementById('input');
    const dt = new DataTransfer();
    dt.setData('text/plain', json);
    el.value = json;
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, JSON.stringify({ a: { b: { c: { d: 1 } } } }));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.innerText('#depthLabel'), '4');

  await page.click('#btnDepthMin');
  await page.waitForTimeout(100);
  await page.type('#input', ' ');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.innerText('#depthLabel'), '0');
});

// ---------------------------------------------------------------------
// Resizable split
// ---------------------------------------------------------------------

test('divider drags, persists, resets on double-click, and responds to arrow keys', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-split-pct'));
  await page.reload();
  const box = await page.$eval('#panelDivider', (el) => el.getBoundingClientRect());
  const before = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().width);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().width);
  assert.ok(after > before, 'dragging right should widen the input panel');

  const persisted = await page.evaluate(() => localStorage.getItem('ppj-split-pct'));
  assert.ok(persisted && Number(persisted) > 50);

  await page.reload();
  const afterReload = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().width);
  assert.ok(Math.abs(afterReload - after) < 2, 'split should be restored after reload');

  const box2 = await page.$eval('#panelDivider', (el) => el.getBoundingClientRect());
  await page.mouse.dblclick(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForTimeout(100);
  const total = await page.$eval('.panels', (el) => el.getBoundingClientRect().width);
  const resetWidth = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().width);
  assert.ok(Math.abs(resetWidth - total / 2) < 4, 'double-click should reset to ~50/50');

  await page.focus('#panelDivider');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const afterArrow = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().width);
  assert.ok(afterArrow > resetWidth, 'ArrowRight should widen the input panel');
});

test('on narrow screens the divider becomes horizontal (drag up/down, not left/right)', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-split-pct'));
  await page.setViewportSize({ width: 600, height: 800 });
  await page.reload();

  const box = await page.$eval('#panelDivider', (el) => el.getBoundingClientRect());
  assert.ok(box.width > box.height, 'divider should be wide and short, not tall and thin, below the breakpoint');
  assert.strictEqual(await page.$eval('#panelDivider', (el) => getComputedStyle(el).cursor), 'row-resize');
  assert.strictEqual(await page.getAttribute('#panelDivider', 'aria-orientation'), 'horizontal');

  const before = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().height);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().height);
  assert.ok(after > before, 'dragging down should grow the input panel height');

  await page.focus('#panelDivider');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  const afterArrow = await page.$eval('#inputPanel', (el) => el.getBoundingClientRect().height);
  assert.ok(afterArrow > after, 'ArrowDown should also grow the input panel on a horizontal divider');

  // Growing back past the breakpoint should restore the vertical divider.
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(100);
  const wideBox = await page.$eval('#panelDivider', (el) => el.getBoundingClientRect());
  assert.ok(wideBox.height > wideBox.width, 'divider should go back to tall and thin above the breakpoint');
  assert.strictEqual(await page.$eval('#panelDivider', (el) => getComputedStyle(el).cursor), 'col-resize');
  assert.strictEqual(await page.getAttribute('#panelDivider', 'aria-orientation'), 'vertical');
});

// ---------------------------------------------------------------------
// Theme (light/dark only, system default)
// ---------------------------------------------------------------------

test('theme defaults from system preference and toggles between exactly two states', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-theme'));
  await page.reload();
  const initial = await page.getAttribute('#btnTheme', 'aria-label');
  assert.match(initial, /Theme: Light\./); // default Playwright color-scheme is light

  await page.click('#btnTheme');
  const afterOne = await page.getAttribute('#btnTheme', 'aria-label');
  assert.match(afterOne, /Theme: Dark\./);

  await page.click('#btnTheme');
  const afterTwo = await page.getAttribute('#btnTheme', 'aria-label');
  assert.match(afterTwo, /Theme: Light\./);

  const persisted = await page.evaluate(() => localStorage.getItem('ppj-theme'));
  assert.strictEqual(persisted, 'light');
});

test('system dark-mode preference is honored on first visit', async (page, browser) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(FILE_URL);
  const label = await p.getAttribute('#btnTheme', 'aria-label');
  assert.match(label, /Theme: Dark\./);
  await ctx.close();
});

// ---------------------------------------------------------------------
// Font selector
// ---------------------------------------------------------------------

test('font toggle cycles mono/sans/serif and input+preview always match', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-font'));
  await page.reload();
  await page.fill('#input', '{"a":1}');
  await page.waitForTimeout(150);
  const f1 = await page.$eval('#input', (el) => getComputedStyle(el).fontFamily);
  const o1 = await page.$eval('#output', (el) => getComputedStyle(el).fontFamily);
  assert.strictEqual(f1, o1);

  await page.click('#btnFont');
  await page.waitForTimeout(100);
  const f2 = await page.$eval('#input', (el) => getComputedStyle(el).fontFamily);
  const o2 = await page.$eval('#output', (el) => getComputedStyle(el).fontFamily);
  assert.notStrictEqual(f2, f1);
  assert.strictEqual(f2, o2);

  await page.click('#btnFont');
  await page.click('#btnFont');
  await page.waitForTimeout(100);
  const f3 = await page.$eval('#input', (el) => getComputedStyle(el).fontFamily);
  assert.strictEqual(f3, f1, 'three clicks should cycle back to the original font');
});

test('Raw view and edit-preview text actually render in the selected font, not the browser default', async (page) => {
  // Regression test: browsers ship a UA stylesheet rule (`pre { font-family:
  // monospace }`) that overrides inheritance on <pre> elements specifically,
  // so checking #output's own computed style isn't enough - the descendant
  // that actually holds the text has to be checked directly.
  await page.evaluate(() => localStorage.removeItem('ppj-font'));
  await page.reload();
  await page.fill('#input', JSON.stringify({ a: 1 }));
  await page.waitForTimeout(150);
  await page.click('#btnFont'); // -> sans-serif
  await page.waitForTimeout(100);
  const inputFont = await page.$eval('#input', (el) => getComputedStyle(el).fontFamily);
  assert.ok(!inputFont.startsWith('monospace'));

  await page.click('[data-view="raw"]');
  await page.waitForTimeout(100);
  const rawFont = await page.$eval('#output pre', (el) => getComputedStyle(el).fontFamily);
  assert.strictEqual(rawFont, inputFont, 'raw <pre> text should match the selected font, not fall back to "monospace"');

  await page.click('#btnEditPreview');
  await page.waitForTimeout(100);
  const editFont = await page.$eval('#previewEdit', (el) => getComputedStyle(el).fontFamily);
  assert.strictEqual(editFont, inputFont, 'edit-preview textarea should match the selected font');
});

test('the preview placeholder (shown before any JSON is typed) also follows the font toggle', async (page) => {
  // Regression test: the empty-state placeholder had its own hardcoded
  // sans-serif font, so clicking the font button appeared to do nothing if
  // the preview panel didn't have content in it yet.
  await page.evaluate(() => localStorage.removeItem('ppj-font'));
  await page.reload();
  const before = await page.$eval('.output .placeholder', (el) => getComputedStyle(el).fontFamily);
  await page.click('#btnFont');
  await page.waitForTimeout(100);
  const after = await page.$eval('.output .placeholder', (el) => getComputedStyle(el).fontFamily);
  const inputFont = await page.$eval('#input', (el) => getComputedStyle(el).fontFamily);
  assert.notStrictEqual(after, before, 'placeholder font should change when the font toggle is clicked');
  assert.strictEqual(after, inputFont);
});

test('preview placeholder text starts at roughly the same vertical position as the input text', async (page) => {
  // Regression test: the placeholder <div> had its own extra padding on top
  // of .output's padding, pushing its text noticeably lower than the input's
  // native placeholder and making the panels feel inconsistent.
  const inputTop = await page.$eval('#input', (el) => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop));
  const placeholderTop = await page.$eval('.output .placeholder', (el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(inputTop - placeholderTop) <= 3, `expected the two to start within 3px, got input=${inputTop} placeholder=${placeholderTop}`);
});

test('input and preview placeholder text use the exact same color, in both themes', async (page) => {
  // Regression test: the preview placeholder used --text-dim explicitly, but
  // the input's native ::placeholder was left unstyled and fell back to the
  // browser's own default grey, which is close but not identical.
  const previewColor = await page.$eval('.output .placeholder', (el) => getComputedStyle(el).color);
  const inputColor = await page.evaluate(() => getComputedStyle(document.getElementById('input'), '::placeholder').color);
  assert.strictEqual(inputColor, previewColor);

  await page.click('#btnTheme');
  await page.waitForTimeout(100);
  const previewColorDark = await page.$eval('.output .placeholder', (el) => getComputedStyle(el).color);
  const inputColorDark = await page.evaluate(() => getComputedStyle(document.getElementById('input'), '::placeholder').color);
  assert.strictEqual(inputColorDark, previewColorDark);
  assert.notStrictEqual(previewColorDark, previewColor, 'sanity check: dark theme should actually use a different color');
});

// ---------------------------------------------------------------------
// Bidirectional preview editing
// ---------------------------------------------------------------------

test('closing braces/brackets in the tree never show a bogus expand icon', async (page) => {
  // Regression test: the closing-brace line used a plain spacer <span> that
  // happened to share the .jv-toggle class (for alignment), so it picked up
  // the toggle's disclosure-triangle ::before too, even though it's not a
  // button and does nothing when "clicked".
  await page.fill('#input', JSON.stringify({ a: { b: 1 } }));
  await page.waitForTimeout(200);
  await page.click('#btnDepthMax');
  await page.waitForTimeout(100);
  const spacers = await page.$$('.jv-toggle-space');
  assert.ok(spacers.length > 0, 'expected at least one closing-brace spacer in this nested doc');
  const visibilities = await page.$$eval('.jv-toggle-space', (els) => els.map((el) => getComputedStyle(el, '::before').visibility));
  visibilities.forEach((v) => assert.strictEqual(v, 'hidden'));
});

test('clicking or navigating in the edit-preview textarea scrolls and moves the caret in the input to match', async (page) => {
  const obj = {};
  for (let i = 0; i < 80; i++) obj['key' + i] = { value: i };
  await page.fill('#input', JSON.stringify(obj));
  await page.waitForTimeout(200);
  await page.click('[data-view="raw"]');
  await page.click('#btnEditPreview');
  await page.waitForTimeout(150);

  const previewText = await page.inputValue('#previewEdit');
  const inputText = await page.inputValue('#input');
  assert.strictEqual(inputText, previewText, 'entering edit mode should normalize the input to the same pretty text');

  const targetIndex = previewText.indexOf('"key60"');
  await page.evaluate((idx) => {
    const ta = document.getElementById('previewEdit');
    ta.focus();
    ta.setSelectionRange(idx, idx);
    ta.dispatchEvent(new Event('click', { bubbles: true }));
  }, targetIndex);
  await page.waitForTimeout(100);

  const inputSelStart = await page.$eval('#input', (el) => el.selectionStart);
  const inputScrollTop = await page.$eval('#input', (el) => el.scrollTop);
  assert.strictEqual(inputSelStart, targetIndex, "input's caret should jump to the same offset clicked in the preview");
  assert.ok(inputScrollTop > 0, 'input should have scrolled down to reveal that section');
});

test('edit-preview mode syncs both directions and cleans up when turned off', async (page) => {
  await page.fill('#input', JSON.stringify({ a: 1, b: 2 }));
  await page.waitForTimeout(200);
  await page.click('[data-view="raw"]');
  await page.click('#btnEditPreview');
  await page.waitForTimeout(150);

  assert.strictEqual(await page.getAttribute('#btnEditPreview', 'aria-pressed'), 'true');
  assert.ok(await page.$('#previewEdit'));

  const previewValue = await page.inputValue('#previewEdit');
  await page.fill('#previewEdit', previewValue.replace('"b": 2', '"b": 42'));
  await page.waitForTimeout(300);
  const inputAfter = await page.inputValue('#input');
  assert.strictEqual(JSON.parse(inputAfter).b, 42);

  await page.fill('#input', JSON.stringify({ a: 99, b: 42 }));
  await page.waitForTimeout(300);
  const previewAfter = await page.inputValue('#previewEdit');
  assert.strictEqual(JSON.parse(previewAfter).a, 99);

  await page.click('#btnEditPreview');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$('#previewEdit'), null);
  assert.ok(await page.$('#output pre'));
});

test('switching to Tree view turns off edit-preview mode', async (page) => {
  await page.fill('#input', '{"a":1}');
  await page.waitForTimeout(200);
  await page.click('[data-view="raw"]');
  await page.click('#btnEditPreview');
  await page.waitForTimeout(100);
  await page.click('[data-view="tree"]');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.getAttribute('#btnEditPreview', 'aria-pressed'), 'false');
});

// ---------------------------------------------------------------------
// JWT decoding (local only, no verification)
// ---------------------------------------------------------------------

test('a JWT is auto-detected and decoded into header/payload/signature', async (page) => {
  const jwt = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'John Doe', iat: 1516239022 }, 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  await page.fill('#input', jwt);
  await page.waitForTimeout(200);

  assert.strictEqual(await page.isVisible('#errorBanner'), false);
  const notice = await page.innerText('#notice');
  assert.match(notice, /Decoded JWT/);
  assert.match(notice, /alg: HS256/);
  assert.match(notice, /signature not verified/i);
  assert.strictEqual(await page.getAttribute('#notice', 'class'), 'banner banner-info');

  const outputText = await page.innerText('#output');
  assert.ok(outputText.includes('John Doe'));
  assert.ok(outputText.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'));

  const stats = await page.innerText('#outputStats');
  assert.match(stats, /Object · 3 keys/);
});

test('JWT exp claim is decoded to a human-readable date with an expired/not-expired hint', async (page) => {
  const expired = makeJwt({ alg: 'HS256' }, { exp: 1000000000 });
  await page.fill('#input', expired);
  await page.waitForTimeout(200);
  assert.match(await page.innerText('#notice'), /exp: .*\(expired\)/);

  const future = makeJwt({ alg: 'HS256' }, { exp: 4102444800 }); // year 2100
  await page.fill('#input', future);
  await page.waitForTimeout(200);
  assert.match(await page.innerText('#notice'), /exp: .*\(not expired\)/);
});

test('JWT with alg:none and an empty signature segment still decodes', async (page) => {
  const jwt = makeJwt({ alg: 'none' }, { sub: 'x' }, '');
  await page.fill('#input', jwt);
  await page.waitForTimeout(200);
  assert.strictEqual(await page.isVisible('#errorBanner'), false);
  assert.match(await page.innerText('#notice'), /alg: none/);
});

test('JWT payload with unicode characters decodes correctly', async (page) => {
  const jwt = makeJwt({ alg: 'HS256' }, { name: 'José 日本語' });
  await page.fill('#input', jwt);
  await page.waitForTimeout(200);
  const outputText = await page.innerText('#output');
  assert.ok(outputText.includes('José 日本語'));
});

test('Format works on a decoded JWT like any other JSON value', async (page) => {
  const jwt = makeJwt({ alg: 'HS256' }, { sub: 'x' }, 'sig');
  await page.fill('#input', jwt);
  await page.waitForTimeout(200);
  await page.click('#btnFormat');
  await page.waitForTimeout(100);
  const formatted = await page.inputValue('#input');
  const parsed = JSON.parse(formatted);
  assert.deepStrictEqual(parsed, { header: { alg: 'HS256' }, payload: { sub: 'x' }, signature: 'sig' });
});

test('non-JWT dot-separated strings are not misdetected and still show a real error', async (page) => {
  for (const bad of ['not.a.jwt-!!!', 'abc.def', 'YQ.YQ.YQ']) {
    await page.fill('#input', bad);
    await page.waitForTimeout(200);
    assert.strictEqual(await page.isVisible('#errorBanner'), true, `expected "${bad}" to show an error, not a JWT decode`);
  }
});

// ---------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------

async function centers(page, sel) {
  return page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  });
}

test('the footer link sits centered under the divider at the default 50/50 split', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-split-pct'));
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.reload();
  await page.waitForTimeout(100);
  const dividerCenter = await centers(page, '#panelDivider');
  const footerCenter = await centers(page, '#footerLink');
  assert.ok(Math.abs(dividerCenter - footerCenter) <= 1, `expected footer under divider, got divider=${dividerCenter} footer=${footerCenter}`);
});

test('the footer link tracks the divider (not page center) when the split is off-center, even as the window widens', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-split-pct'));
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.reload();
  await page.waitForTimeout(100);

  const box = await page.$eval('#panelDivider', (el) => el.getBoundingClientRect());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1400 * 0.7, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  let dividerCenter = await centers(page, '#panelDivider');
  let footerCenter = await centers(page, '#footerLink');
  assert.notStrictEqual(Math.round(dividerCenter), 700, 'sanity check: split should now be off page-center');
  assert.ok(Math.abs(dividerCenter - footerCenter) <= 1, `expected footer to follow the moved divider, got divider=${dividerCenter} footer=${footerCenter}`);

  await page.setViewportSize({ width: 2200, height: 700 });
  await page.waitForTimeout(150);
  dividerCenter = await centers(page, '#panelDivider');
  footerCenter = await centers(page, '#footerLink');
  assert.ok(Math.abs(dividerCenter - footerCenter) <= 1, `expected footer to keep following the divider after widening, got divider=${dividerCenter} footer=${footerCenter}`);
});

test('the footer link recenters on the page once the layout goes narrow (divider becomes horizontal)', async (page) => {
  await page.evaluate(() => localStorage.removeItem('ppj-split-pct'));
  await page.setViewportSize({ width: 600, height: 800 });
  await page.reload();
  await page.waitForTimeout(100);
  const footerCenter = await centers(page, '#footerLink');
  assert.ok(Math.abs(footerCenter - 300) <= 2, `expected footer centered on the page at 300, got ${footerCenter}`);
});

// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

async function main() {
  const browser = await chromium.launch();
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const t of tests) {
    const page = await freshPage(browser);
    try {
      await t.fn(page, browser);
      if (page._errors.length) {
        throw new Error('Unexpected console/page errors: ' + page._errors.join(' | '));
      }
      console.log('  ok  -', t.name);
      passed++;
    } catch (err) {
      console.log('FAIL  -', t.name);
      console.log('        ' + err.message);
      failures.push(t.name);
      failed++;
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failed: ' + failures.join(', '));
    process.exit(1);
  }
}

main();
