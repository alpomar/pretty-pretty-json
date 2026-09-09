# Pretty Pretty JSON

**[Try it live](https://pretty-pretty-json.pages.dev/)**

A single-file, privacy-first JSON prettifier & JWT decoder. Paste unformatted
JSON (or a JWT) on the left, get a clean, color-coded, collapsible tree on
the right.

Everything happens in your browser. There are no external scripts, fonts, or
stylesheets, no network calls, no cookies, and no analytics - the page even
ships its own `Content-Security-Policy` (`default-src 'none'`) so it can't
phone home even by accident.

## Features

- **JSON prettifier** - collapsible, color-coded tree plus a plain indented
  "Raw" view, with clear line/column error messages
- **JWT decoder** - paste a token to see its decoded header and payload as
  JSON (decoded locally, signature not verified)

...and a few more worth finding on your own.

## Run it locally

Just open [public/index.html](public/index.html) directly in a browser -
double-click it.

No server, no build, no install required. The whole deployable site is the
[public/](public/) folder - `index.html` plus a `_headers` file adding a
strict `Content-Security-Policy` and other hardening headers, for static
hosts that support it.

## Tests

A Playwright regression suite lives in [tests/](tests/) and runs against
`public/index.html` directly - no dev server needed.

```sh
npm install
npx playwright install chromium   # first time only, downloads the browser
npm test
```

See [tests/README.md](tests/README.md) for what's covered.
