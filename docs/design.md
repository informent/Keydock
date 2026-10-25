# Console design

The console uses an original, responsive interface with a persistent workspace navigation, compact tables, explicit empty states, keyboard-accessible dialogs, one-time secret delivery, and the same workflows on mobile.

The 12ui workflow was attempted during development, but its account connection was unavailable. No generated 12ui design or external screenshot was used as an implementation target. The shipped UI is original React/CSS, with Lucide icons under the ISC license and locally served Inter fonts under the SIL Open Font License. The application does not request fonts or assets from third-party CDNs.

`scripts/ui-smoke.mjs` exercises the UI headlessly against a real temporary instance. It captures the README images using illustrative records. Those screenshots contain masked keys and no reusable instance secrets.
