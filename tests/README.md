# Tests

A regression suite for `public/index.html`, using Playwright + Chromium
against the file directly (`file://`) - no dev server needed, since the app
itself has no build step or server dependency.

## Running

```sh
npm install
npx playwright install chromium   # first time only, downloads the browser
npm test
```

Each check runs in its own page for isolation and prints `ok` / `FAIL` as it
goes, then a pass/fail summary; the process exits non-zero if anything fails,
so it's CI-friendly.

## What's covered

- Strict and lenient JSON parsing (JSON Lines, trailing commas, concatenated
  JSON, partial recovery, genuinely invalid input)
- Format / Minify
- Tree view batching for large arrays ("Show more")
- The depth stepper (Collapse all / - / + / Expand all) and its label
- Depth-preservation and scroll-preservation across edits, the large-document
  safety valve, and paste-triggers-full-expand
- The resizable input/preview divider (drag, persistence, reset, keyboard)
- Theme (system-default, light/dark toggle, persistence)
- The font selector (mono/sans/serif, kept in sync between panels)
- Bidirectional preview editing

These tests are not part of the deployed site - `package.json` and this
directory only exist for local/CI verification and aren't needed to open or
host `public/index.html`.
