# Argus Design System: MASTER

Global source of truth for both Argus surfaces. A page file in `design-system/argus/pages/<page>.md` overrides this file for that page only.

Generated with ui-ux-pro-max (`--design-system`, query "fintech trading surveillance terminal editorial", dials variance 7, motion 3, density 8), then rewritten against the project's locked constraints. Where the generator and the constraints disagreed, the constraints won. The generator suggested Inter + Playfair, a slate/green OLED palette and an "Enterprise Gateway" landing pattern. All three were rejected (see "Overrides of generator output" at the end).

---

## 1. Design read

> Reading this as: a real-time trade-surveillance terminal for compliance analysts and market-abuse investigators, plus an editorial marketing page that sells it to heads of compliance. Two surfaces, two registers, one brand.

| Surface | Mode | Variance / Motion / Density | Theme |
|---|---|---|---|
| Marketing (`/`, `/about`, pricing, writing) | Persuade, editorial | 7 / 4 / 3 | Light, parchment. Locked. |
| Terminal (`/terminal/**`) | Operate | 3 / 2 / 9 | Dark, ink. Locked. |

**Locked-mode justification**
- Terminal: analysts watch it for 8 to 12 hour shifts on multi-monitor desks in dim trading-floor light. Dark ink cuts glare and lets the semantic colors carry the signal.
- Marketing: read once, often printed or forwarded to a compliance committee. Warm paper reads like a research note rather than another dark fintech site.

Neither surface switches theme with `prefers-color-scheme`. That is deliberate.

---

## 2. Color tokens

Hex values marked **locked** come from the brief and must not change. Values marked *derived* were added to fill roles the brief didn't cover. Each one passed a contrast check (ratios below).

### 2.1 Marketing (parchment)

```css
:root[data-surface="marketing"] {
  --m-bg:          #FBF7F1; /* locked  parchment */
  --m-fg:          #1A1614; /* locked  warm charcoal, 16.83:1 on bg */
  --m-fg-muted:    #6B625C; /* derived secondary copy, 5.58:1 on bg */
  --m-fg-subtle:   #5C534E; /* derived captions/meta, 7.02:1 on bg (use when text <14px) */
  --m-rule:        #E6DDD1; /* derived hairlines, non-text */
  --m-surface-alt: #F4EEE5; /* derived inset blocks, pull quotes */

  --m-coral:   #FF6B4A; /* locked */
  --m-magenta: #E8407E; /* locked */
  --m-violet:  #8B5CF6; /* locked */
  --m-accent-gradient: linear-gradient(100deg, #FF6B4A 0%, #E8407E 52%, #8B5CF6 100%);

  --m-focus: #1A1614;   /* 2px ring + 2px bg-coloured offset */
}
```

**The gradient is the only accent. It is never a text color and never sits behind body text.**
Measured on parchment: coral 2.64:1, magenta 3.60:1, violet 3.97:1. All fail for body text, and gradient text is banned anyway.

Allowed uses of the gradient:
- A 2-3px rule under the active nav item, under the hero headline's key phrase, or as the progress line on long-form reads.
- Fill for non-text graphics: one hero data visual, chart series emphasis in marketing figures, the brand mark.
- The primary CTA's hover/focus underline (the button itself is charcoal, see 5.1).

Limit it to **one gradient moment per viewport**. If two show at once, remove one.

### 2.2 Terminal (ink)

```css
:root[data-surface="terminal"] {
  --t-bg:        #0A0C10; /* locked  ink, app background */
  --t-panel:     #12151C; /* locked  panels, blotters, chart wells */
  --t-panel-hi:  #191D26; /* derived hover row / selected panel header */
  --t-line:      #232833; /* derived 1px panel borders and table separators */
  --t-fg:        #D7DCE5; /* locked  primary text, 13.27:1 on panel */
  --t-fg-muted:  #8A93A3; /* derived column headers, units, 5.9:1 on panel */

  --t-bid:   #2FBF71;     /* locked  buy side / up, 7.66:1 on panel */
  --t-ask:   #E5484D;     /* locked  sell side / down, 4.67:1 on panel */
  --t-alert: #3DDBD9;     /* locked  surveillance alerts, 10.73:1 on panel */
  --t-amber: #FFA028;     /* locked  CHART CHROME ONLY, 8.97:1 on panel */

  --t-focus: #3DDBD9;     /* focus ring reuses alert cyan, 1px inset + 1px outset */
}
```

**Semantic rules (non-negotiable)**
- `--t-bid` / `--t-ask` mean side and direction only. Never use them for "success" or "error" in forms or system status. System errors use `--t-fg` text with an icon and a `--t-ask` 1px border. System OK uses plain text.
- `--t-alert` cyan marks surveillance hits only: flagged orders, alert queue badges, rule-match highlights. It is the one colour that means "look here".
- `--t-amber` is restricted to chart chrome: axis labels, crosshair, price-line marker, last-price tag, drawing tools, time-scale ticks. Never on text in tables, buttons, badges or panels outside a chart.
- Direction is never colour-only. Up/down always carries a sign (`+0.42`, `-1.17`) and/or a glyph (▲▼). Candles use filled vs hollow bodies.
- Filled badges put ink text on the colour: ink on alert 11.49:1, on bid 8.21:1, on ask 5.0:1. Never white on ask (3.91:1, fails).

---

## 3. Typography

Families are locked: **Fraunces**, **IBM Plex Sans**, **IBM Plex Sans Condensed**, **JetBrains Mono**. No Inter anywhere, including fallbacks in Tailwind config.

| Role | Family | Surface | Notes |
|---|---|---|---|
| Display / H1-H2 | Fraunces (opsz axis, 400-600, SOFT 0-50) | Marketing only | Never in the terminal. |
| Body, UI, H3-H6 | IBM Plex Sans 400/500/600 | Both | |
| Terminal labels, column headers, panel titles, tabs | IBM Plex Sans Condensed 500/600 | Terminal only | Sentence case. All-caps only for 2-4 letter codes (`BUY`, `IOC`). |
| Numbers, prices, quantities, timestamps, tickers, IDs, code | JetBrains Mono 400/500 | Both | `font-variant-numeric: tabular-nums slashed-zero`, right-aligned in tables. |

Load all four via `next/font/google` with `display: swap` and CSS variables `--font-display`, `--font-sans`, `--font-condensed`, `--font-mono`. Subset to latin.

### 3.1 Marketing scale (ratio about 1.333, fluid)

| Token | Size | Line height | Tracking | Family |
|---|---|---|---|---|
| `display` | `clamp(2.75rem, 1.6rem + 4.6vw, 5.5rem)` | 1.02 | -0.03em | Fraunces 500, opsz 144 |
| `h1` | `clamp(2.25rem, 1.6rem + 2.6vw, 3.75rem)` | 1.08 | -0.025em | Fraunces 500 |
| `h2` | `clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)` | 1.15 | -0.02em | Fraunces 500 |
| `h3` | 1.375rem | 1.3 | -0.01em | Plex Sans 600 |
| `lede` | 1.25rem | 1.5 | 0 | Plex Sans 400 |
| `body` | 1.0625rem (17px) | 1.6 | 0 | Plex Sans 400 |
| `small` | 0.875rem | 1.5 | 0 | Plex Sans 400 |
| `figure` | 0.875rem | 1.4 | 0 | JetBrains Mono 400 |

Prose max-width is `68ch`. `text-wrap: balance` on display-h3, `text-wrap: pretty` on paragraphs. Fraunces italic is reserved for one emphasised word or phrase per headline, not whole lines.

### 3.2 Terminal scale (fixed px, dense)

| Token | Size / line | Family |
|---|---|---|
| `t-title` | 13 / 16 | Plex Condensed 600 |
| `t-label` | 11 / 14, +0.02em | Plex Condensed 500, `--t-fg-muted` |
| `t-body` | 13 / 18 | Plex Sans 400 |
| `t-num` | 13 / 18 | JetBrains Mono 400, tabular |
| `t-num-lg` | 20 / 24 | JetBrains Mono 500 (last price, P&L) |
| `t-micro` | 11 / 14 | JetBrains Mono 400 (timestamps, IDs) |

11px is the floor and only for labels and timestamps that sit next to a larger primary value. Table body is never below 12px.

---

## 4. Space, shape, layering

### 4.1 Spacing (4px base)
`--space-0_5: 2px; --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-12: 48px; --space-16: 64px; --space-24: 96px; --space-32: 128px`

- Marketing: section rhythm varies on purpose (96 / 128 / 64), not a uniform `py-24`. Gutter 16px under 640px, 24px to 1024px, 40px above that.
- Terminal: panel padding 8px, row height 24px (compact) / 28px (default), panel gap 1px of `--t-line` (panels tile, they do not float).

### 4.2 Radius (one system per surface)
- Marketing: `--m-radius: 4px` for inputs and buttons, `2px` for figures. No rounded cards, because there are no cards (see 5.1).
- Terminal: `--t-radius: 2px` on everything. Panels are square-tiled (0px) against each other.

### 4.3 Elevation
- Marketing: no shadows. Separation comes from rules, `--m-surface-alt` tints and whitespace.
- Terminal: no shadows on panels. Popovers, menus and the command palette use `0 8px 24px rgb(0 0 0 / 0.5)` with no border, or a 1px `--t-line` border with no shadow. Never both.

### 4.4 Z-index scale
`--z-base: 0; --z-sticky: 100; --z-dropdown: 200; --z-overlay: 300; --z-modal: 400; --z-toast: 500; --z-tooltip: 600`

---

## 5. Surface patterns

### 5.1 Marketing: editorial long-read, not enterprise gateway

Structure modelled on a research note or a feature in a financial paper. Left-aligned on an asymmetric 12-col grid (text column spans 7, margin notes and figures use 4 or bleed). Nothing is centred except a single pull quote.

Section order (adapted from the generator's "scroll-triggered storytelling" result, minus the scroll-jacking):
1. **Masthead hero**: left-aligned Fraunces display headline with a claim (not a slogan), a 2-sentence lede, and a primary + secondary CTA. A real terminal screenshot (an image of the actual product, never div-built) bleeds off the right edge.
2. **The problem**: a long-form paragraph with a margin note. Cite a real regulatory requirement (MAR, Reg SCI, FINRA 3110) in plain language.
3. **How Argus watches**: a two-column zig-zag of 3-4 capabilities. Each pairs prose with a real figure (chart crop, alert detail). Rows vary in height and figure placement, so they are never a row of identical cards.
4. **Case study**: one investigation walked through as a timeline (this is a real sequence, so numbered steps are allowed here and only here).
5. **Evidence**: one pull quote with named attribution, plus a short plain list of customers. No logo carousel.
6. **Closing CTA**: a single left-aligned line with the primary button.
7. **Footer**: plain columns of links, legal, contact address.

Components:
- **Primary button**: `--m-fg` background, `--m-bg` text (16.83:1), 4px radius, 44px min height, Plex Sans 500. Hover/focus adds a 2px gradient underline 4px below the button; `:active` uses `scale(0.97)`.
- **Secondary**: text link with a 1px charcoal underline offset 3px. On hover the underline thickens to 2px.
- **Figures**: full-width or bleeding images with a caption below in `figure` mono. No overlay pills.
- **Feature groupings**: dividers and whitespace, not cards. If a container is truly needed, use a `--m-surface-alt` tint block with no border and no shadow.

Icons: Phosphor (regular weight, 20px marketing / 16px terminal). No emoji, no hand-rolled SVG icons.

### 5.2 Terminal: tiled workspace

- **Shell**: a 32px top bar (workspace switcher, global symbol search with a `/` shortcut, alert counter, user), then a tiling grid of panels with resizable 1px gutters and a 24px status bar (connection, feed latency, market clock).
- **Panels**: Order book / depth, Price chart, Trade blotter, Alert queue, Order detail / audit trail, Watchlist. Each has a 28px header in `t-title` with tabs, and actions at the right in icon buttons. Every icon button has an `aria-label` and a tooltip.
- **Tables**: virtualised for more than 200 rows. Numbers right-aligned in mono. Only the row under the pointer or with focus gets `--t-panel-hi`; there is no zebra striping. Separators are bottom-border only.
- **Flash-on-update**: when a price changes, its cell background pulses at 12% bid/ask tint for 400ms and the glyph stays. Under reduced motion the tint is shown without the fade and clears on the next tick.
- **Alerts**: a row with an alert gets a full 1px `--t-alert` outline and a cyan severity badge (ink text). No left stripe.
- **Keyboard first**: `j`/`k` row navigation, `Enter` opens the detail view, `Esc` closes it, a command palette on `Ctrl/Cmd+K`, and every panel is reachable by keyboard. Keyboard-triggered changes are never animated.
- **Live regions**: new alerts are announced through `aria-live="polite"` at most once every 5s, batched. Price ticks are never announced.

### 5.3 Charts (terminal)
- Library: TradingView Lightweight Charts (canvas). Real-time series need canvas, and it caps at 500 visible candles (from the generator's chart search).
- Candles: up = `--t-bid` hollow body, down = `--t-ask` filled body. Volume bars below at 40% opacity in the same side colours.
- Chrome: axes, crosshair, last-price line and label, time ticks all in `--t-amber`. The grid uses `--t-line` and gets no amber.
- Alert markers on the series use `--t-alert` triangles and carry a text label on hover/focus.
- Accessible fallback: a sortable OHLC table toggle on every chart, a Pause/Resume button for streaming, and `+`/`-`/Reset zoom buttons.

---

## 6. Motion

| | Marketing | Terminal |
|---|---|---|
| Purpose | Reveal reading order and give feedback | Feedback only |
| Durations | 180-320ms UI, up to 480ms for a figure entering | 80-160ms, plus 400ms for tick flashes |
| Easing | `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` | same |
| Allowed | opacity + `translateY(8-12px)` on first viewport entry, button press scale | opacity, background-color on cells |
| Banned | parallax, scroll-jacking, pinned scenes, looping marquees | any layout animation, any slide or spring |

Framer Motion is already installed; use it on marketing only. The generator's GSAP ScrollTrigger snippet is **not adopted**, so there's no second animation library. Every motion has a `prefers-reduced-motion: reduce` path that renders the final state immediately.

---

## 7. Accessibility floor
- Text contrast 4.5:1, large text and UI glyphs 3:1. All token pairs above were measured.
- Visible `:focus-visible` on every interactive element. Never remove the outline without a replacement.
- Touch targets 44px on marketing. Terminal targets are 24px rows with 28px icon buttons; it is a desktop pointer/keyboard tool, and that exception is documented here.
- Colour never carries meaning alone (side glyphs, signs, filled/hollow, text labels).
- Responsive checks at 375, 768, 1024, 1440. The terminal requires at least 1280px wide and shows a "best on desktop" read-only alert queue below that.

---

## 8. Hard bans (project-level)

- Inter, in any role or fallback stack.
- Purple-to-blue gradients. The only gradient is coral, magenta, violet, in that order.
- Emoji, anywhere: UI, copy, commit-facing docs that ship to users, alt text.
- A row of identical rounded cards (icon + heading + text, repeated).
- Centred-everything layouts. Default alignment is left; centring is a one-off decision.
- Accent bars on cards: no `border-left`/`border-right` colour stripes on cards, rows, callouts or alerts.
- Gradient text (`background-clip: text`).
- Amber outside chart chrome. Bid/ask colours used for non-directional status.
- Em dashes (U+2014) and en-dash separators (U+2013) in any user-visible copy.

---

## 9. Overrides of generator output

| Generator said | Decision | Why |
|---|---|---|
| Heading Inter, body Playfair Display | Fraunces / Plex Sans / Plex Condensed / JetBrains Mono | Locked brief; Inter is banned. |
| Palette slate `#0F172A`, accent green `#22C55E`, bg `#020617` | Section 2 tokens | Locked brief. |
| Style "Dark Mode (OLED)" across the product, "light mode default" listed as an anti-pattern | Dark for the terminal only, parchment for marketing | Two registers, two scenes (see 1). |
| Pattern "Enterprise Gateway" (mega menu, logo carousel, industry/role paths, video hero) | Editorial long-read (5.1) | A carousel and a video hero are generic. The buyer is a compliance lead who reads. |
| "Minimal glow (text-shadow)" key effect | No glows | Glows are an AI tell and blur dense numerics. |
| Candle colours `#26A69A` / `#EF5350` | `--t-bid` / `--t-ask` | Locked semantic tokens. |
| GSAP ScrollTrigger reveal | Framer Motion, subtle, marketing only | Already a dependency, so no second library. |

Adopted as-is: dial intent (dense terminal, subtle motion), Lightweight Charts with the 500-candle cap, filled-vs-hollow candles plus an OHLC table fallback, Pause/Resume for streams, and the pre-delivery checks (SVG icons, `cursor-pointer`, 150-300ms hovers, visible focus, reduced motion, 4 breakpoints).

Known tension, accepted: the design-taste skill flags Fraunces as a reflex "AI-favourite" serif. It stays because the brief locks it. To keep it from reading as a reflex, Fraunces appears only on the editorial surface, at high optical size, with the SOFT axis kept low, and never in UI chrome.
