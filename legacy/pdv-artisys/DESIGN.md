# Design system — ArtiSys PDV

## Authority and scope

This is the product design authority for the desktop PDV. The running application is the visual source of truth for tokens in `desktop/renderer/styles.css`; this document records the intended use of those tokens and does not introduce a second theme or override them. Keep the approved Home and approved sales/history screens visually unchanged unless the user explicitly reopens them for redesign.

## Product context

- Product: local-first desktop point of sale for Brazilian small and medium businesses.
- Primary users: cashier and store operator; administrator configures establishment, access, modules, devices, and recovery.
- Surface: Electron desktop app with keyboard and touch interaction; local server remains authoritative for operational data.
- Language and locale: Brazilian Portuguese, BRL, `pt-BR` date/number formatting.
- Commercial posture: manual payments and non-fiscal sales documentation; never suggest that optional verticals are separate products.
- Core workflow: find/select item → register sale → take manually recorded payment → update canonical inventory/cash history.

## Visual language

Use the existing clean, high-contrast register interface. Runtime CSS owns the exact values:

| Role | Runtime token | Value |
| --- | --- | --- |
| Primary action | `--artisys-blue` | `#0b6cff` |
| Secondary blue | `--artisys-blue-2` | `#10a7ff` |
| Navigation/deep surface | `--navy`, `--navy-2` | `#081a35`, `#102a52` |
| Main text | `--ink` | `#10172f` |
| Supporting text | `--muted` | `#62718d` |
| Subtle accessible text | `--text-subtle`, `--text-label`, `--text-tertiary` | `#60708a`, `#53627f`, `#65748d` |
| Dividers | `--line`, `--line-soft` | `#dfe6f1`, `#edf1f6` |
| Surface | `--surface`, `--surface-soft`, `--surface-subtle`, `--surface-selected` | `#ffffff`, `#f6f8fc`, `#f7f9fc`, `#f5f8fc` |
| Positive / destructive / attention | `--success`, `--danger`, `--orange` | `#12b76a`, `#ef3340`, `#ff7a00` |
| Card corner | `--radius` | `18px` |
| Radius scale | `--radius-sm`, `--radius-md`, `--radius-lg` | `9px`, `12px`, `15px` |
| Card elevation | `--shadow` | `0 12px 32px rgba(33, 56, 94, .12)` |
| Elevation scale | `--shadow-sm`, `--shadow-md` | shared low/medium operational elevation |
| Spacing scale | `--space-1` … `--space-6` | `4px`, `8px`, `12px`, `16px`, `20px`, `24px` |
| Controls and panels | `--border-control`, `--border-input`, `--border-card`, `--border-panel` | shared operational borders |
| Focus | `--focus-border`, `--focus-ring` | shared keyboard/input focus treatment |

Typography uses `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Use a visible page title, a short purpose line, then a clear action/content hierarchy. Avoid technical identifiers, English enum labels, decorative card color overload, and empty full-width whitespace. Use semantic color for status, not as the only status cue.

Operational renderer CSS must consume these shared primitives instead of re-declaring equivalent raw colors, radii, shadows, focus styles, or spacing values. Static presentation belongs in CSS classes rather than renderer template `style=""` attributes or direct `element.style` assignments. Runtime-only geometry such as progress width remains an allowed exception when it is data-driven rather than presentation drift.

## Layout and interaction

- Preserve the desktop frame, persistent top context, scrollable route region, and persistent navigation/footer.
- Desktop shell density is canonical: the top context uses a 72px track and the footer a 44px track; shell compaction must not reduce interactive controls below 44px.
- Primary operational actions use `--artisys-blue`; secondary actions use a quiet light surface with a visible border. Keep danger styling reserved for destructive intent.
- Use a consistent page header and align related cards in responsive grids; avoid oversized stacked cards when screen width permits side-by-side comparison.
- Keep the approved Home and explicitly approved grouped pages unchanged.
- Cards are for a meaningful destination or summary; do not duplicate the same action across cards and navigation.
- Inputs have visible Portuguese labels, useful defaults only when safe, and inline feedback. Destructive actions are visually distinct and require the established confirmation flow.
- Keyboard focus is visible. Switches expose role and state. Loading and errors are local to the affected region; they must not lock the app shell.
- Do not add remote font/CDN or framework dependencies.

## Optional areas

Optional modules are capabilities of one PDV, not separate applications. Their metadata and visual identity come from the backend module catalog. Group related operational capabilities under one area entry; use the catalog's icon/label and do not add a renderer-only list of module identities. The areas screen may be reorganized without changing the shared sales, cash, inventory, and audit core.

## Restaurante, cardápio público e superfícies móveis

Restaurant has three intentionally different surfaces that share the same canonical table/order/kitchen data:

- **Cliente por QR (`/m/:token`)**: public, touch-first menu for one table. The visual signature is the navy order rail at the bottom; the main content stays editorial and product-led rather than dashboard-like. It never asks for a device credential.
- **Equipe (`/mobile`)**: credentialed surface. Waiter prioritizes the floor/table map and service calls; kitchen uses status lanes for `Novo`, `Em preparo`, and `Pronto`.
- **Desktop Restaurante**: remains the management surface. Public-menu settings and per-table QR controls extend the existing Restaurant page instead of creating a separate product shell.

All three surfaces reuse the ArtiSys blue/navy/ink/muted/line/surface tokens and system typography. Supporting text on light surfaces must preserve WCAG AA contrast; touch controls use a 44×44px minimum hit area. Mobile CSS may duplicate the exact token values because it is served independently from the Electron renderer, but it must not introduce a competing theme. Customer product cards expose name, public description, photo, price, availability and safe option labels only. Recipe composition, costs, stock internals, SKU/barcode metadata and credentials are never rendered into the public surface.

The customer path uses 44px-or-larger touch actions, sticky search/category navigation, app-owned dialogs for configuration and cart review, visible focus, reduced-motion support, and local failure messages that preserve the cart. Public menu appearance is a persisted restaurant setting, not a second menu implementation: `COMPACT` and `PREMIUM` reuse the same public context, cart, dialogs, order mutation, QR route, pricing and service actions. Compact is the compatibility/default layout and prioritizes scanability; Premium is the photo-led editorial presentation. Both must preserve the same touch, focus, contrast, failure-recovery and responsive contracts. Visual V2 may derive hero, category and featured media only from catalog product photos already exposed by the canonical public context; it must never fabricate food imagery or label a product as “mais pedido” without a canonical popularity signal. Products without photos degrade to a deliberate typographic card rather than a fake image. The staff PWA shell is registered only on secure contexts (HTTPS or localhost); ordinary LAN HTTP remains a usable browser surface without claiming installability.

## Customer ordering surface

Customer ordering has one canonical access model: the public table menu (`/m/:token`). The opaque table token resolves the table and the same responsive URL may be opened on the customer's phone, a store-owned tablet, or any browser on the local network. No paired-device credential, second renderer, or separate customer-order mutation is introduced for fixed hardware.
