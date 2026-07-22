# Spec: RuleKeeper production landing page (design v1 “Evidence Terminal”)

You are implementing the production version of the approved design mockup at
`../design/landing-v1.html`. Open and study it first — it is the single source
of truth for visual language (colors, JetBrains Mono everywhere, spacing,
section order) **and for all copy and numbers**. The stats are real, validated
findings — reproduce copy and figures exactly; do not invent or "improve" any
number or claim.

## Deliverables (create under `site/public/`, nothing outside `site/`)

- `public/index.html`
- `public/styles.css`
- `public/main.js`
- `public/favicon.svg` (simple: ▚ glyph, #34d399 on #0b0f0e rounded square)
- `wrangler.jsonc` (at `site/`, next to `public/`)

No frameworks, no build step, no npm install, no external JS. Google Fonts for
JetBrains Mono is the only external resource (`font-display: swap` + monospace
fallback stack).

## Production requirements (beyond the mockup)

1. **Semantics & a11y**
   - Proper landmarks (`nav`, `header`, `main`, `footer`), exactly one `h1`,
     correct heading order, skip-to-content link.
   - The terminal panel keeps its full text content in the DOM (no JS-injected
     copy); decorative glyphs `aria-hidden`.
   - Visible `:focus-visible` styles on all interactive elements (accent
     outline), min 44px hit targets for buttons.
   - Body-size text must be ≥ 4.5:1 contrast on `#0b0f0e`. The mockup's
     `--ink-2: #9fb0ac` passes; `--muted: #5f6f6b` does NOT — use `--muted`
     only for decorative/duplicated info, never as the sole carrier of
     information; bump any body-copy currently in `--muted` up to `--ink-2`.
2. **Responsive**
   - Breakpoint ≤ 860px: single column (as in mockup's media query), and the
     nav collapses: links hide behind an accessible disclosure button
     (`aria-expanded`, closes on Escape and on link click). No horizontal
     overflow at 390px — verify `document.documentElement.scrollWidth ===
     window.innerWidth` mentally against every section.
3. **Terminal animation (progressive enhancement)**
   - On first scroll into view, terminal lines reveal sequentially (~120ms
     stagger) via a class toggle; content is fully visible without JS.
   - Under `prefers-reduced-motion: reduce`, no animation at all (lines just
     show). The blinking cursor also stops animating in that case.
4. **Copy-to-clipboard**
   - The `[copy]` affordance becomes a real `<button>`: copies
     `npx rulekeeper scan`, swaps label to `[copied]` for 2s, announces via
     `aria-live="polite"`. Use `navigator.clipboard` with a
     `document.execCommand` fallback; never throw.
5. **Waitlist block** (new section, between pricing and footer, same visual
   language: bordered panel, accent button)
   - Heading: "Get the launch report" · sub: "One email when the CLI ships —
     with the full 4-week backtest attached."
   - `<form>` with labelled email input + submit. JS reads the endpoint from
     `data-waitlist-endpoint` on the form: if present, POST JSON
     `{ email }` and show inline success/error text (aria-live); if the
     attribute is empty (it will be for now), on submit show
     "Waitlist opens at launch — star the repo to follow along." with a GitHub
     link instead. No console errors either way.
6. **Head/meta**
   - `<title>RuleKeeper — Do your coding agents follow your rules?</title>`
   - Meta description (use the hero sub copy), `theme-color #0b0f0e`,
     canonical placeholder `https://rulekeeper.dev/`, full OG + Twitter card
     tags (og:image placeholder `/og.png`), and JSON-LD `SoftwareApplication`
     (name RuleKeeper, operatingSystem macOS/Linux, price 0 USD, category
     DeveloperApplication).
7. **wrangler.jsonc** — Cloudflare Workers static assets config:
   name `rulekeeper-site`, `compatibility_date` = today, `assets.directory` =
   `./public`, no worker script needed. JSONC comments explaining the two
   fields are welcome. Do not deploy.

## Quality bar

- HTML validates (no stray tags), CSS custom properties mirror the mockup's
  `:root` block, JS is a single IIFE or module with no globals leaked.
- Keep total JS under ~120 lines; this is a static page, not an app.
- Match the mockup pixel-close at 1440px; where the mockup and these
  requirements conflict, these requirements win.
