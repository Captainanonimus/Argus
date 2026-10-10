# Argus Design System: MASTER

Global source of truth for every Argus surface. A page file in `design-system/argus/pages/<page>.md` overrides this file for that page only.

The first version came from a design-system generator (query "fintech trading surveillance terminal editorial", dials variance 7, motion 3, density 8) and was then rewritten against the project's locked constraints. Where the generator and the constraints disagreed, the constraints won (see "Overrides of generator output" at the end). The current version moves the in-app pages onto the landing page's light editorial surface; only market data stays dark.

---

## 1. Design read

> Reading this as: a real-time trade-surveillance product for compliance analysts and market-abuse investigators, sold by an editorial landing page to heads of compliance. One brand, one light surface, with dark terminal panels wherever live market data is shown.

| Surface | Where | Mode | Theme |
|---|---|---|---|
| Marketing | `/` | Persuade, editorial | Parchment, crossfading to ink on scroll (landing page only). |
| App | `/dashboard`, `/alerts`, `/alerts/[id]`, `/simulator`, `/import`, `/rules`, `/settings`, `/assistant`, not-found and error pages | Operate | Parchment and charcoal, the same surface as the landing page. |
| Terminal panels | Inset cards inside app pages that show market data | Monitor | Ink. Locked. |

**Why the split**
- App pages are read like a research note: case write-ups, triage, settings, rules. They share the landing page's paper so moving from `/` into the product feels like one product, not a hand-off to a different tool.
- Market data (prices, depth, prints, live alerts) is watched for long stretches and relies on bid/ask/alert colour carrying signal. It stays on ink panels, embedded in the light page the same way the landing page embeds its workspace figure.

Neither surface switches theme with `prefers-color-scheme`. That is deliberate.

**Which panels are dark.** Only market data: the candlestick chart, depth / order-book ladder, time and sales, the alert blotter on the dashboard, the case page's event timeline, and the simulator's live "Verdicts as they arrive" log. Everything else (filters, forms, KPI tiles, case details, notes, alert lists, settings, the assistant) is light.

---

## 2. Color tokens

Hex values marked **locked** come from the brief and must not change. Values marked *derived* fill roles the brief didn't cover; each passed a contrast check (ratios below).

### 2.1 How tokens resolve

Components use one set of semantic Tailwind colours: `ink`, `panel`, `panelhi`, `text`, `dim`, `seam`, `edge`, `bid`, `ask`, `alert`. Each resolves through a CSS variable holding RGB channels (`rgb(var(--c-ink) / <alpha-value>)`), so opacity modifiers like `border-ask/70` keep working. Values are set in `app/globals.css`:

- `:root` and `[data-surface="terminal"]`: the ink values (2.3). The landing page's workspace figure and footer rely on these defaults.
- `[data-surface="app"]`: the parchment values (2.2). The app shell and the root not-found / error pages set this attribute.
- A terminal panel inside an app page sets `data-surface="terminal"` (the `tone="terminal"` prop on `Panel`/`Card`), which switches every token back to ink for that subtree.

`chart` (`#FFA028`) is a fixed value, not a variable; it only appears inside terminal panels. The landing page's own `--m-*` variables (`--m-bg`, `--m-fg`, `--m-muted`, `--m-rule`, `--m-surface`, `--m-gradient`) are unchanged and still drive the scroll crossfade on `/`.

Never hard-code a surface colour in a component; use the tokens so a block reads correctly on either surface. The exceptions are the verdict chips (2.4), whose fixed colours read the same on parchment and ink.

### 2.2 App (parchment), `[data-surface="app"]`

| Token | Hex | Role | Contrast on bg / panel / panelhi |
|---|---|---|---|
| `ink` | `#FBF7F1` | **locked** parchment, page background and form fields | |
| `panel` | `#F4EEE5` | *derived* card surface (landing `--m-surface`) | |
| `panelhi` | `#EDE5D9` | *derived* row hover, selected tab | |
| `text` | `#1A1614` | **locked** warm charcoal | 16.83 / 15.58 / 14.38 |
| `dim` | `#5C534E` | *derived* secondary copy, labels, captions | 7.02 / 6.50 / 6.00 |
| `seam` | `#E6DDD1` | *derived* hairlines, card borders (non-text) | |
| `edge` | `#8C8070` | *derived* form control borders (non-text, 3:1) | 3.62 / 3.35 / 3.09 |

**Contrast-safe parchment shades for semantic text.** The terminal's bid/ask/alert hues fail on parchment (bid `#2FBF71` is about 2.3:1), so the app surface uses darker shades of the same meanings:

| Token | Parchment shade | Meaning | Contrast on bg / panel / panelhi |
|---|---|---|---|
| `bid` | `#17693C` | buy side, up | 6.30 / 5.83 / 5.38 |
| `ask` | `#A8241C` | sell side, down; system-error borders | 6.71 / 6.21 / 5.73 |
| `alert` | `#9C2A57` | surveillance hit ("look here"), taken from the magenta end of the brand gradient | 6.83 / 6.32 / 5.83 |

**The brand gradient** (`--m-gradient`, coral `#FF6B4A`, magenta `#E8407E`, violet `#8B5CF6`, locked) is never a text colour and never sits behind body text. Measured on parchment the stops are 2.64, 3.60 and 3.97:1, so all fail as text, and gradient text is banned anyway.

Allowed uses of the gradient:
- The FLAG verdict chip's background (2.4).
- A 2px rule under the current nav item in the app shell.
- Non-text fills: the case page's metric meter bar, figures and the brand mark.
- The primary button's hover/focus underline (the button itself is charcoal, see 5.2).

**One gradient moment per viewport, relaxed.** The landing page still keeps to one gradient moment per viewport. In the app the rule is relaxed for exactly two cases: FLAG chips (one per flagged row, because the verdict must be visible on every row) and the current nav item's rule. Every other use still counts against the one-per-viewport limit.

### 2.3 Terminal (ink), `:root` and `[data-surface="terminal"]`

| Token | Hex | Role | Contrast on panel |
|---|---|---|---|
| `ink` | `#0A0C10` | **locked** ink | |
| `panel` | `#12151C` | **locked** panel, blotter and chart wells | |
| `panelhi` | `#191D26` | *derived* hover row, selected tab | |
| `text` | `#D7DCE5` | **locked** primary text | 13.27 |
| `dim` | `#8A93A3` | *derived* column headers, units | 5.9 |
| `seam` | `#232833` | *derived* 1px borders and table separators | |
| `edge` | `#4A5262` | *derived* control borders | |
| `bid` | `#2FBF71` | **locked** buy side / up | 7.66 |
| `ask` | `#E5484D` | **locked** sell side / down | 4.67 |
| `alert` | `#3DDBD9` | **locked** surveillance alerts | 10.73 |
| `chart` | `#FFA028` | **locked** chart chrome only | 8.97 |

**Semantic rules (non-negotiable, both surfaces)**
- `bid` / `ask` mean side and direction only. Never use them for "success" or "error" in forms or system status. System errors use `text` with an icon and a 1px `ask` border. System OK uses plain text (a `bid` dot glyph next to a text label is allowed in status chips).
- `alert` marks surveillance hits only: flagged rows, rule-match highlights, rule names that fired. It is the one colour that means "look here".
- `chart` amber is restricted to chart chrome: axis labels, crosshair, price-line marker, last-price tag, time-scale ticks. Never on text in tables, buttons, badges or panels outside a chart.
- Direction is never colour-only. Up/down always carries a sign (`+0.42`, `-1.17`) and/or a glyph (▲▼). Candles use filled vs hollow bodies.
- Filled chips on ink put ink text on the colour: ink on alert 11.49:1, on bid 8.21:1, on ask 5.0:1. Never white on ask (3.91:1, fails).

### 2.4 Verdict chips

Verdicts always show their text label; colour is never the only signal. The chips use fixed colours so they read the same on parchment and inside terminal panels.

| Verdict | Treatment | Contrast |
|---|---|---|
| FLAG | Brand gradient as the chip **background only**, charcoal `#1A1614` text, centred, semibold mono | 4.68:1 at the magenta centre (6.38 at coral, 4.24 at violet, so the text stays centred and the chip keeps a minimum width) |
| REVIEW | Amber tint `#F6E3BF`, border `#E2C48A`, text `#6B4400` | 6.79:1 |
| CLEAR | Muted green `#E1ECE3`, border `#C3D8C8`, text `#2F5D3E` | 6.28:1 |

The gradient is never the FLAG text colour.

---

## 3. Typography

Families are locked: **Fraunces**, **IBM Plex Sans**, **JetBrains Mono**. IBM Plex Sans Condensed is retired: the app now uses Plex Sans for all UI text, matching the landing page, and the condensed font is no longer loaded. No Inter anywhere, including fallbacks in Tailwind config.

| Role | Family | Where | Notes |
|---|---|---|---|
| Display / page titles | Fraunces (opsz axis, 500, SOFT kept low) | Landing page headlines, app page titles (`PageHeader`), case titles, not-found and error headlines | Never in UI chrome, tables, buttons or terminal panels. |
| Body, UI, panel titles, labels | IBM Plex Sans 400/500/600 | Everywhere | Sentence case. All-caps only for 2-4 letter codes (`BUY`, `IOC`). |
| Numbers, prices, quantities, timestamps, tickers, IDs, code | JetBrains Mono 400/500 | Everywhere, via the `num` class or `font-mono` | `tabular-nums slashed-zero`, right-aligned in tables. |

Fonts load through `next/font/google` in `app/layout.tsx` with `display: swap` and the CSS variables `--font-display`, `--font-body`, `--font-mono`. Subset to latin.

### 3.1 Marketing scale (ratio about 1.333, fluid)

| Token | Size | Line height | Tracking | Family |
|---|---|---|---|---|
| `display` | `clamp(2.75rem, 1.6rem + 4.6vw, 5.5rem)` | 1.02 | -0.035em | Fraunces 500 |
| `h1` / `h2` | `clamp(2.25rem, 1.6rem + 2.6vw, 3.75rem)` | 1.08 | -0.025em | Fraunces 500 |
| `h3` | 1.375rem | 1.3 | -0.01em | Plex Sans 600 |
| `lede` | 1.25rem | 1.5 | 0 | Plex Sans 400 |
| `body` | 1.0625rem (17px) | 1.6 | 0 | Plex Sans 400 |
| `small` | 0.875rem | 1.5 | 0 | Plex Sans 400 |
| `figure` | 0.875rem | 1.4 | 0 | JetBrains Mono 400 |

Prose max-width is `68ch`. `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs. Fraunces italic is reserved for one emphasised word or phrase per headline, not whole lines. The not-found and error pages use the `h1` step.

### 3.2 App scale (light pages)

| Token | Size / line | Family |
|---|---|---|
| `page-title` | `clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)` / 1.12, -0.02em | Fraunces 500 |
| `page-lede` | 15 / 1.55, `text-dim`, max `68ch` | Plex Sans 400 |
| `card-title` | 14 / 20 | Plex Sans 600 |
| `body` | 13 / 19 | Plex Sans 400 |
| `label` | 12 / 16 | Plex Sans 500, `text-dim` |
| `kpi` | 20 / 24 | JetBrains Mono 500 |
| `micro` | 11 / 14 | JetBrains Mono 400 (timestamps, IDs) |

### 3.3 Terminal panel scale (dense, fixed px)

| Token | Size / line | Family |
|---|---|---|
| `t-title` | 13 / 16 | Plex Sans 600 |
| `t-label` | 11 / 14 | Plex Sans 500, `dim` |
| `t-body` | 12-13 / 18 | Plex Sans 400 |
| `t-num` | 12-13 / 18 | JetBrains Mono 400, tabular |
| `t-micro` | 11 / 14 | JetBrains Mono 400 |

11px is the floor and only for labels and timestamps that sit next to a larger primary value. Table body is never below 12px.

---

## 4. Space, shape, layering

### 4.1 Spacing (4px base)
`--space-0_5: 2px; --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-12: 48px; --space-16: 64px; --space-24: 96px; --space-32: 128px`

- Container (landing page and app shell alike): `max-w-[88rem]`, gutter 16px under 640px, 24px to 1024px, 40px above that.
- App pages: 24px above the page title, 24px below it, 16px between cards (`gap-4`), 8px between KPI tiles, 16px card padding.
- Marketing: section rhythm varies on purpose (96 / 128 / 64), not a uniform `py-24`.
- Terminal panels: 8px cell padding, 24px compact rows, 28px numbered panel header.

### 4.2 Radius
- Cards and terminal panels: 2px, the same value on both, so a dark panel sits in the light grid with no special treatment.
- Buttons and form controls: 4px, as on the landing page.
- Chips and badges: 2px.

### 4.3 Elevation
- No shadows on cards, panels, chips or buttons, light or dark. Separation comes from 1px rules (`seam`), the `panel` tint and whitespace.
- The light-to-dark edge of a terminal panel is its own 1px `seam` border plus the same radius as the light cards around it. No glow, no shadow, no extra frame.
- The only overlay surfaces are the mobile nav drawer (charcoal scrim at 40%) and the command-box hint (1px `edge` border, no shadow).

### 4.4 Z-index scale
`--z-base: 0; --z-sticky: 100; --z-dropdown: 200; --z-overlay: 300; --z-modal: 400; --z-toast: 500; --z-tooltip: 600`

---

## 5. Surface patterns

### 5.1 Marketing: editorial long-read, not enterprise gateway

Structure modelled on a research note or a feature in a financial paper. Left-aligned on an asymmetric 12-col grid. Nothing is centred except a single pull quote.

Section order:
1. **Masthead hero**: left-aligned Fraunces display headline with a claim (not a slogan), a short lede, and a primary + secondary CTA, with the order-book figure beside it.
2. **How a verdict is reached**: prose plus the two-model figure.
3. **Terminal handoff**: the page crossfades from parchment to ink and shows the workspace figure, then the closing CTA.
4. **Footer**: plain text.

Components:
- **Primary button**: `--m-fg` background, `--m-bg` text (16.83:1), 4px radius, 44px min height, Plex Sans 500. Hover/focus adds a 2px gradient underline below the button; `:active` uses `scale(0.97)`. Class `.btn-primary`.
- **Secondary**: text link with a 1px charcoal underline offset 3px that thickens to 2px on hover. Class `.link-secondary`.
- **Figures**: real product figures with a mono caption. No overlay pills.
- **Feature groupings**: dividers and whitespace. If a container is truly needed, use an `--m-surface` tint block with no shadow.

Icons: Phosphor (regular weight, 20px marketing and shell, 14-16px in the app and terminal panels). No emoji, no hand-rolled SVG icons.

### 5.2 App: light pages built from `components/ui`

Every in-app page uses the shared primitives in `components/ui/` (re-exported from `components/app/ui.tsx`). Do not hand-roll a button, card, chip or field on a page.

| Primitive | Use |
|---|---|
| `Button`, `buttonClass(variant, size)` | `primary` is the landing button at app sizes (`.btn-app-primary`: charcoal fill, gradient underline on hover/focus, 0.97 press scale); `secondary` is a bordered control on parchment; `ghost` reads like the landing text link; `danger` is text on a 1px `ask` border. Sizes 32 / 36 / 44px. `buttonClass` has no client directive, so server components can use it. |
| `IconButton` | Square icon-only button; its required `label` is also the tooltip. |
| `Card`, `Panel` | 2px radius, 1px `seam` border, `panel` fill. `Panel` adds a numbered header. `tone="terminal"` makes it a dark market panel (5.3). |
| `Badge`, `VerdictBadge`, `StatusTag`, `SideTag` | Hairline chip; verdict chips (2.4); status with glyph; side with ▲▼. |
| `Input`, `Textarea`, `Select`, `Label`, `inputClass`, `textareaClass`, `selectClass` | Parchment field, 1px `edge` border (3:1), 4px radius, small `dim` label above. |
| `Table`, `tableClass`, `theadRowClass`, `thClass`, `rowClass` | Bottom rules only, no zebra, `panelhi` row hover, numbers in mono and right-aligned. |
| `PageHeader` | Fraunces page title, optional eyebrow and lede, controls on the right. |
| `StatChip`, `Kpi` | Hairline status chip (after the landing page's "Watching" badge) with a glyph and text; KPI tile with a mono value. |
| `EmptyState`, `LoadingState`, `ErrorState` | Empty: title, one line, primary action. Loading: skeleton rows with `aria-busy`. Error: text and icon on a 1px `ask` border, with "Try again" when a retry makes sense. |

**App shell** (`components/app/AppShell.tsx`)
- Header: the landing page's container, 64px height and "Argus" wordmark (Plex Sans 600, 18px, -0.01em) in the same position, so the brand does not move between `/` and `/dashboard`. In the app it is sticky with a 1px `seam` rule and also holds the command box (`/` to focus), the status chips and a UTC clock on wide screens.
- Left nav: light, 160px, text links with the key number in mono; the current page is charcoal and medium weight with the 2px gradient rule under its label. Under 768px it moves into the drawer (focus trapped, Esc closes).
- Shortcut bar: a light footer row of `kbd` chips for Alt+1..7.
- First-run banner: a light card with a primary action and a ghost dismiss.

Pages: `PageHeader` first, then a `gap-4` grid of cards. Alert lists, filters, forms, case details, notes, rules and settings are light cards.

### 5.3 Terminal panels: dark market data inset in the light page

- Rendered with `Panel tone="terminal"` (or `Card tone="terminal"`), which sets `data-surface="terminal"` and switches every token to ink.
- Same 2px radius and 1px `seam` border as the light cards around them, so they read as cards of the same family, not as a separate application. Numbered 28px header (`01 Price`) with 13px Plex Sans 600 title and 11px `dim` meta, as on the landing page's workspace figure.
- Used for: the price chart, depth, time and sales, the dashboard alert blotter, the case timeline, and the simulator's live verdict log.
- **Tables**: numbers right-aligned in mono. Only the row under the pointer or with focus gets `panelhi`; no zebra striping. Bottom-border separators only.
- **Flash-on-update**: a new row pulses at a 12% bid/ask/alert tint for 400ms; the tint is skipped under reduced motion.
- **Alerts**: a flagged row gets a 1px `alert` outline and a FLAG chip. No left stripe.
- **Keyboard**: every panel and control is reachable by keyboard. Keyboard-triggered changes are never animated.
- **Live regions**: new alerts are announced through `aria-live="polite"` at most once every 5s, batched. Price ticks are never announced.
- Primary buttons inside a terminal panel invert to a `#D7DCE5` fill with ink text.

### 5.4 Charts (terminal panels)
- Library: TradingView Lightweight Charts (canvas), capped at 500 visible candles. Keep the "Charting by TradingView Lightweight Charts" attribution link under the chart.
- Candles: up = `bid` hollow body, down = `ask` filled body. Volume bars below at 40% opacity in the same side colours.
- Chrome: axes, crosshair, last-price line and label, time ticks all in `chart` amber. The grid uses `seam` and gets no amber.
- Alert markers use `alert` and open the case on click.
- Accessible fallback: a data-table toggle on the chart, a Pause/Resume button for streaming, and a fit-all control.

---

## 6. Motion

| | Marketing | App pages | Terminal panels |
|---|---|---|---|
| Purpose | Reveal reading order and give feedback | Orient on arrival, give feedback | Feedback only |
| Durations | 180-320ms UI, up to 480ms for a figure entering | 320ms page entry, 40ms card stagger (capped at 240ms), 150ms hovers, 160ms press, 200ms underline | 400ms tick flashes |
| Easing | `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` | same | same |
| Allowed | Scroll-linked sequences (framer-motion), opacity + small translateY, button press scale | `.page-enter`: opacity plus a 10px rise when a page mounts (via `app/(app)/template.tsx`); `.stagger` on card grids; press scale | Background tint on new rows |
| Banned | Parallax, scroll-jacking, looping marquees | Any animation on live-updating values or layout; anything that shifts content after mount | Any layout animation, slide or spring |

- Page entry runs once per navigation and uses `animation-fill-mode: backwards`, so no transform remains afterwards to break sticky headers or fixed overlays.
- The landing page's scroll sequences stay framer-motion. App entry motion is plain CSS keyframes, which keeps it out of the client bundle.
- Every motion has a `prefers-reduced-motion: reduce` path that renders the final state immediately (page entry, stagger, row flashes and press scale are all switched off).

---

## 7. Accessibility floor
- Text contrast 4.5:1, large text and UI glyphs 3:1. Every token pair in section 2 was measured.
- Visible `:focus-visible` on every interactive element: a 2px charcoal ring with a 2px offset on app pages (as on the landing page), and a 1px cyan ring inside terminal panels. Never remove the outline without a replacement.
- Touch targets: 44px for primary marketing actions; app buttons are 32-44px; terminal rows are 24px with 28px icon buttons.
- Colour never carries meaning alone (side glyphs, signs, filled/hollow candles, verdict text labels, status glyphs).
- Responsive checks at 375, 768, 1024, 1440. Every app page holds at 375px with no horizontal page scroll; wide tables scroll inside their own card.
- Skip link to `#main`, `aria-current="page"` on the nav, `aria-sort` on sortable headers, and `role="alert"` on errors.

---

## 8. Hard bans (project-level)

- Inter, in any role or fallback stack.
- Purple-to-blue gradients. The only gradient is coral, magenta, violet, in that order.
- Gradient text (`background-clip: text`), and the gradient as any text colour, including the FLAG label.
- Emoji, anywhere: UI, copy, user-facing docs, alt text.
- A row of identical rounded cards (icon + heading + text, repeated) on the marketing page.
- Centred-everything layouts. Default alignment is left; centring is a one-off decision.
- Accent bars on cards: no `border-left`/`border-right` colour stripes on cards, rows, callouts or alerts.
- Shadows and glows on cards, panels or chips.
- Amber outside chart chrome. Bid/ask colours used for non-directional status.
- Terminal-bright bid/ask/alert hues as text on parchment; use the parchment shades in 2.2.
- Hard-coded surface colours in components; use the tokens.
- Em dashes (U+2014) and en-dash separators (U+2013) in any user-visible copy.

---

## 9. Overrides of generator output

| Generator said | Decision | Why |
|---|---|---|
| Heading Inter, body Playfair Display | Fraunces / Plex Sans / JetBrains Mono | Locked brief; Inter is banned. |
| Palette slate `#0F172A`, accent green `#22C55E`, bg `#020617` | Section 2 tokens | Locked brief. |
| Style "Dark Mode (OLED)" across the product | Parchment for the landing page and app pages, ink only for market data panels | One product surface; dark kept where colour carries market signal. |
| Pattern "Enterprise Gateway" (mega menu, logo carousel, industry/role paths, video hero) | Editorial long-read (5.1) | A carousel and a video hero are generic. The buyer is a compliance lead who reads. |
| "Minimal glow (text-shadow)" key effect | No glows | Glows blur dense numerics. |
| Candle colours `#26A69A` / `#EF5350` | `bid` / `ask` | Locked semantic tokens. |
| GSAP ScrollTrigger reveal | Framer Motion on the landing page, CSS keyframes in the app | No second animation library. |

Adopted as-is: dial intent (dense data, subtle motion), Lightweight Charts with the 500-candle cap, filled-vs-hollow candles plus a data-table fallback, Pause/Resume for streams, and the pre-delivery checks (SVG icons, `cursor-pointer`, 150-300ms hovers, visible focus, reduced motion, 4 breakpoints).

Known tension, accepted: Fraunces is a common choice of display serif. It stays because the brief locks it. To keep it deliberate, it appears only as display type (landing headlines and app page titles), with the SOFT axis kept low, and never in UI chrome, tables or terminal panels.
