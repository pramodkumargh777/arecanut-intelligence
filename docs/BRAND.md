# Areca Pulse brand in the product

**Areca Pulse** · Market Intelligence — *Know the market. See the opportunity.*

The approved vector assets are in [docs/brand/](brand/). This page is the brand guide for the product: where each
asset is used, the palette, and the usage rules.

**Positioning:** a clear, dependable view of arecanut market prices, movements and intelligence. Calm and premium,
inspired by the arecanut palm landscape, without looking like a conventional agriculture portal.

The sidebar closes with the brand tagline, **Know the market. See the opportunity.**, and the supporting
caption, **Prices, trends, and insights for your next move.** Both are localized in Kannada. Source dates
and price units remain alongside the data rather than in the sidebar.

## Where each asset is used

| Asset | Used for | File in the app |
|---|---|---|
| `icon.svg` | Light sidebar lockup and mobile home link | `frontend/src/assets/areca-pulse-icon.svg` |
| `app-icon.svg` | Dark mobile home link | `frontend/src/assets/areca-pulse-app-icon.svg` |
| `favicon.svg` | Browser tab | `frontend/public/favicon.svg` |
| `app-icon` (PNG export) | iOS home-screen icon | `frontend/public/apple-touch-icon.png` |
| `logo-horizontal-light.svg` | Not shown in the app; for wide placements on light backgrounds | `docs/brand/` |
| `logo-horizontal-dark.svg` | Reversed sidebar lockup in dark mode | `frontend/src/assets/areca-pulse-logo-dark.svg` |
| `logo-stacked-light.svg` | Not used in the app | `docs/brand/` |

In light mode the sidebar does not shrink the full horizontal logo. At sidebar width its descriptor and tagline would be about
4px tall, and an SVG loaded through `<img>` cannot use the app's Inter font. The sidebar instead pairs `icon.svg`
with a live-text wordmark in the logo's colours (`BrandLockup` in `frontend/src/components/AppShell.tsx`). The guide
asks for exactly this at small sizes.

The header theme control switches instantly between light and dark. Before the app renders, the external
`frontend/public/theme-init.js` reads the `areca-pulse-theme` local storage preference; without a saved choice it
uses the system colour scheme and follows system changes. A manually selected preference takes precedence.
The dark tokens in `frontend/src/styles.css` and chart palette in `frontend/src/components/chartPalette.ts`
apply across routes. Favicon and iOS app icon use their existing branded assets in both modes.

## Logo usage

- Light logo on white or pale surfaces; dark (reversed) logo on forest-green or dark surfaces.
- Keep proportions; never stretch, skew, outline, shadow or add gradients or extra taglines.
- At small sizes use `icon.svg`, `app-icon.svg` or `favicon.svg` instead of shrinking the wordmark.
- Keep clear space around the mark of about the height of the capital "A".
- Avoid busy photography behind the logo; use a solid or quiet background.

## Typography

- Inter for Latin text (already bundled through `@fontsource-variable/inter`).
- Noto Sans Kannada, or a tested system fallback, for Kannada.
- Tabular numerals for prices and aligned data columns.
- Shared hierarchy: 28px page titles, 20px section titles and 16px subheadings; page and section titles
  reduce to 25px and 18px on phones. Supporting text stays smaller and muted without reducing contrast.
- Key snapshot and forecast values use 30px numerals (26px on phones); latest market prices use 22px.
  Sell or wait emphasizes typical movement and the break-even percentage, not every supporting statistic.

## Phone layouts

- At widths up to 700px, latest-rate rows place prices below market details so neither is clipped.
- Header commodity/search tools expand from a localized **Market tools** button; desktop controls stay visible.
- Charts observe their container size directly so resizing or rotating does not leave an oversized canvas.
- Wide tables scroll inside their cards, with no inset gap behind the frozen first column.
  Sell or wait includes a localized swipe hint; retain all month columns.
- Check English and Kannada at 320, 360, 375, 393, 412 and 430 CSS pixels, including larger browser text.

## Colour tokens

The kit's palette is merged into the existing tokens in `frontend/src/styles.css`. There is no second stylesheet.

| App token | Brand colour | Notes |
|---|---|---|
| `--brand` | Forest Green `#0B3D2E` | Identity, primary actions, selected states |
| `--brand-deep` | Deep Forest `#06271E` | Dark surfaces |
| `--brand-leaf` | Leaf Green `#6E9F43` | 3.1:1 on white: only large or bold text (e.g. "Pulse" in the wordmark) and graphics |
| `--brand-leaf-light`, `--brand-sap`, `--brand-ivory`, `--brand-cocoa` | Supporting accents | Use sparingly |
| `--ink` / `--muted` / `--subtle` | `#17211D` / `#525F57` / `#65736B` | 16.5:1, 6.7:1 and 5.0:1 on white |
| `--line` / `--surface-2` | `#DDE4DD` / `#F6F8F4` | Borders and soft surfaces |

Data surfaces stay neutral. Price rises and falls always carry an arrow and a word ("up", "down"). They are currently
also coloured green (`#166534`) and red (`--bad-ink`). The guide warns against equating direction with benefit, since
a rise helps a seller and costs a buyer. Whether to make them neutral is an open product decision (see below).

## Naming

Use **Areca Pulse** in anything a customer reads: the UI, page titles, downloads, assistant answers and documentation.
Keep internal identifiers unchanged unless a separate migration is approved. These include the repository and
package names, `ANI_*` environment variables, the `X-ANI-Relay-Token` header, database, migration and source keys
(`ani-reference-index:…`), log messages, and browser storage keys (`ani-language`, `ani-admin-token`). Renaming the
storage keys would reset every reader's saved language.

## Domain and contact

- Site: **https://adikenaadi.com** (the build default in `frontend/vite.config.ts`; `VITE_SITE_URL` overrides it).
- Public email: **contact@adikenaadi.com**. Grower reports also go to WhatsApp **+91 86608 62841**.
- Both are defined once in `CONTACT` (`frontend/src/services/brand.tsx`) and shown in every page's footer: as an
  "Email us" button next to "Chat on WhatsApp" in the report panel (the page address is filled into the message), and as
  contact lines under the brand. The email is repeated in `index.html`'s structured data and in the generated
  `/.well-known/security.txt`; change all three together.
- Write the domain in lower case, without `www.` or `https://`, wherever it appears as text.

## Open items

- Decide whether price-direction colours (`.hold-up` / `.hold-down` in `styles.css`) should become neutral, per the
  guide's "price direction must not be equated with financial benefit".
- Kannada text uses the system's Kannada font (Noto Sans Kannada, Kannada Sangam MN or Nirmala UI, whichever the
  device has). Bundling Noto Sans Kannada would make it consistent, but it adds a font package and download weight.
- The concept board in the original kit (nut-and-leaf mark, different greens) is not a production asset and does not
  match the approved SVGs. Follow the SVGs and this palette.
- The SVG logos still have live `<text>`. Before print use, outline the text as the guide describes.
