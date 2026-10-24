# Keydock JavaScript client

For Node.js 22+ and Electron main processes. No runtime dependencies. Install from the repository with `npm install ./sdk/javascript`, or copy this directory into your project. It is not yet published to npm.

```js
import { KeydockClient } from '@keydock/client';
const licensing = new KeydockClient({
  baseUrl: 'https://licenses.example.com',
  productId: 'YOUR-PRODUCT-UUID',
  publicKey: YOUR_PINNED_ED25519_PUBLIC_KEY_PEM,
});
const result = await licensing.activate({ key: userEnteredKey, fingerprint: savedInstallationId, name: 'My PC' });
if (result.entitlements.includes('export')) enableExport();
// Explicit offline verification of a previously saved lease:
const claims = licensing.verify(result.lease, savedInstallationId);
```

Generate a random installation ID once and store it privately. Pin the public key distributed with your app; do not trust a key fetched alongside a lease. Online errors throw `KeydockError` with a stable `code`; offline verification throws on any failure. A failed online request never silently falls back to an old lease. Store keys and cached leases using your platform's protected storage. Do not place management API tokens in your application.
