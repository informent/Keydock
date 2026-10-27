# Console design

The console is designed first for desktop work. A charcoal navigation rail, warm neutral surfaces, blue actions, and a brass key mark give it a consistent visual identity. Green is reserved for active license status. Metrics sit in a divided summary row, while compact tables keep more records visible on a laptop. Light and dark themes cover every page, form, dialog, status, and empty state. Typography uses locally served Inter, with Lucide icons for consistent navigation and actions.

The overview pairs real request activity with a license-health breakdown, including total, active, expired, and suspended or revoked keys. New workspaces retain the setup steps until a license has been issued. On desktop, license details open in a side inspector so the record list stays visible behind them. Smaller screens retain the full dialog and labeled record layouts.

The license table becomes a labeled card list on small screens, keeping customer, product, status, device capacity, expiry, and detail actions available without horizontal scrolling. Other wide data tables scroll within their panels. The overview chart uses real request aggregates; empty history stays empty rather than displaying sample trends.

License creation pairs the form with a live issuance summary. It separates the key count from each key's device limit, explains the total capacity, and shows validity, the assigned customer, entitlements, and offline lease duration. The summary sits beside the form on desktop and follows the fields on phones. The generate/cancel controls stay available while scrolling. Customer filtering preserves an existing assignment. The dialog blocks dismissal while generation is pending so its one-time keys cannot be lost by closing it during the request.

## Navigation and accessibility

- Ctrl+K or Command+K opens workspace search. Results include pages, role-appropriate actions, and matching licenses and customers from the instance API. Debounced requests are cancelled when the search changes; previous-query results cannot be selected while a new request is loading.
- Desktop navigation can collapse to an icon rail; accessible names and tooltips keep its destinations identifiable. Sidebar width and compact/comfortable table density persist locally. The mobile drawer always includes full navigation labels, regardless of the desktop preference.
- Search supports arrow keys and Enter. Native modal dialogs trap focus, support Escape, and restore focus when they close. Global search stays out of the way while another dialog is open, including one-time secret delivery.
- Mobile navigation locks background scrolling, makes the main content inert, traps keyboard focus, and returns focus on close. The skip link focuses the current page without changing its route.
- Theme selection begins with the browser preference and saves an explicit choice locally. It synchronizes between tabs without sending a preference to the server.
- Reduced-motion preferences disable transitions and animations. The browser checks enforce at least 4.5:1 contrast for the primary, secondary, muted, accent, and status text color pairs in both themes. Chart counts are available through keyboard exploration and a live readout.

## Preview and verification

Customer workspaces use a compact summary row, a license table with the repeated customer column removed, and a quiet side column for contact details, notes, and recent activity. On smaller screens the record sections follow the licenses. Customer directory rows become labeled records on phones. Status colors communicate actual license states; totals are computed across all assigned licenses and remain stable when the table is filtered.

[Customer workspace](images/customer-workspace.png) · [Dark customer workspace](images/customer-workspace-dark.png) · [Mobile customer workspace](images/customer-workspace-mobile.png) · [Customer directory](images/customers.png) · [Mobile directory](images/customers-mobile.png)

[Overview](images/overview.png) · [Licenses](images/licenses.png) · [Dark theme](images/dark.png) · [Mobile licenses](images/mobile.png) · [Mobile overview](images/mobile-dark.png) · [Workspace search](images/command-search.png) · [License details](images/license-detail.png) · [Issue a batch](images/issue-license.png) · [Sign in](images/sign-in.png)

[Dark overview](images/overview-dark.png) · [Collapsed sidebar](images/sidebar-collapsed.png)

`npm run test:ui` runs three headless browser checks against real temporary instances. `scripts/ui-smoke.mjs` covers setup, product/customer creation, license issuance, one-time secrets, device release, API tokens, audit verification, and sign-out. `scripts/ui-experience-smoke.mjs` covers the populated workspace, search, slower responses, chart interaction, themes, viewer permissions, keyboard focus, and all seven pages at 320, 390, 768, 1024, and 1440 pixels. `scripts/ui-customers-smoke.mjs` checks direct profile links, copied links, customer-bound filtering/export, lifecycle updates, team notes, preassigned issuance, empty states, reference search, and viewer permissions. Desktop and phone layouts are checked in both themes, with no horizontal page overflow or browser/CSP errors allowed.

The checks capture the screenshots using disposable, illustrative records. Images contain masked keys and no reusable instance secrets. The demo database, identity, and random credentials are removed after the run.

## Asset provenance

The 12ui workflow retrieved interface references, but hosted design generation was unavailable. The redesign was implemented directly after the user requested continuing. No generated design or external screenshot is shipped. The UI is original React/CSS, with Lucide icons under the ISC license and Inter fonts under the SIL Open Font License. The application does not request fonts or assets from third-party CDNs.
