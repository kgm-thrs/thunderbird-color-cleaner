# Color Cleaner for E-Mails (Thunderbird / Betterbird)

A lightweight Manifest-V3 WebExtension that removes hard-coded text and
background colors from outgoing HTML mail, so messages stay readable in the
recipient's dark **or** light mode.

## The problem

When you paste text from Word or web pages, hard-coded inline colors travel with
it (`color:#000000`, `background-color:#fff`, `<font color>`, …). The sender never
notices — contrast is fine on their screen. But a recipient in dark mode (or
forced light mode) can end up with black text on a black background, or mid-tone
grey (`#333`) on a forced-black background — unreadable.

This **cannot** be solved by a contrast check at send time: the recipient's
background is unknown (their client and theme decide it). The only correct fix is
to drop the explicit color declarations and hand color authority back to the
recipient's client — the only party that knows whether the screen is light or
dark.

## What it does

On send (`compose.onBeforeSend`) it strips, from the outgoing HTML body only:

- `color` and `background-color` inline styles
- the color token inside the `background` shorthand (keeps `url()`, position, …)
- legacy `color=` / `bgcolor=` attributes
- color declarations inside `<style>` blocks (skips `@media`/nested rules safely)

Everything else (`font-size`, `font-weight`, `margin`, gradients, …) is left
untouched. The compose editor is **not** modified — only the sent message.

It recognises hex (3/4/6/8), `rgb()/rgba()`, `hsl()/hsla()`, the modern color
functions (`hwb`, `lab`, `lch`, `oklab`, `oklch`, `color()`) including space
syntax, all 148 named CSS colors, and strips `!important` before matching.

## Per-message kill switch

A toolbar button **inside the compose window** (`composeAction`) lets you disable
cleaning for that one message (icon turns grey). The next new message is active
again automatically. A popup on the main toolbar holds the global on/off toggle,
a "X color corrections in last e-mail" counter, and a live preview field.

## Install

1. Download `color-cleaner.xpi`.
2. Thunderbird/Betterbird → Add-ons (`Ctrl+Shift+A`) → gear icon →
   *Install Add-on From File…* → select the `.xpi`.

Or for development: *Debug Add-ons → Load Temporary Add-on* → pick `manifest.json`.

## Layout

```
manifest.json
background.js            event listeners, counter, per-window toggle
content/colorCleaner.js  pure parsing/cleaning logic (no dependencies)
popup/                   popup.html / popup.js / popup.css
icons/                   toolbar icons (active + greyed-out)
test.html                in-browser test cases
paste-test*.html         copy-paste test documents
```

The cleaning logic in `content/colorCleaner.js` is self-contained
(`cleanHtml(html) → { html, count }`) and runs in a plain browser too, which is
how `test.html` exercises it.

## License

[CC0 1.0](LICENSE) — effectively public domain. Use it for anything, including in
Betterbird or Thunderbird itself, no attribution required.
