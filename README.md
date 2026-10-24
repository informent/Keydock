# Keydock

**Licensing infrastructure you own.** An MIT-licensed, self-hosted key system for software developers and tool owners.

The licensing API and JavaScript/Python clients are complete. The admin console and deployment bundle are being built in subsequent commits. This is an early release; it has not undergone an independent security audit.

## Available now

- Products, customers and batch license issuance (up to 100 keys per request).
- 192-bit random license keys, HMAC-hashed storage, rotation, suspension, permanent revocation and renewal.
- Device limits enforced inside SQLite write transactions; idempotent activation and device release.
- Fixed expiry, lifetime licenses, or durations that begin on first activation.
- Entitlements and Ed25519-signed, device-bound offline leases.
- Owner, operator and viewer roles; expiring API tokens with optional product scope.
- Password hashing with scrypt, persistent login throttling, server-side sessions, CSRF protection and strict security headers.
- Search, pagination, safe CSV export, validation aggregates and a chained HMAC audit log.
- Optional idempotency keys for batch issuance, with encrypted response replay for 24 hours.
- [JavaScript/TypeScript client](sdk/javascript/README.md) and [Python client](sdk/python/README.md) that verify signatures, application/device binding and expiry before granting entitlements.

## Run the API

Requires Node.js 24.12 or newer within Node 24.

```sh
npm ci
npm start
```

The default address is `http://127.0.0.1:3400`. First startup creates `data/identity.json` and `data/keydock.sqlite`. Keep both private. The `setupToken` in the identity file authorizes the one-time owner setup endpoint. It is never printed in application logs.

`KEYDOCK_ORIGIN` sets the exact browser origin and lease issuer. Remote deployments require HTTPS. `HOST`, `PORT` and `KEYDOCK_DATA_DIR` configure the listener and storage. Bind the listener behind a trusted TLS reverse proxy; proxy headers are deliberately not trusted by the application.

## API

All routes use `/api/v1`. POST and PATCH bodies are JSON. Errors use `{ "error": { "code", "message", "requestId" } }`. Admin cookie requests require an exact `Origin` header and the `X-Keydock-CSRF` value from the session response. Integrations use `Authorization: Bearer kd_api_…`.

| Route | Purpose |
| --- | --- |
| `POST /auth/setup` | One-time owner setup with name, email, password (14+ characters), setupToken |
| `POST /auth/login` | Start a 12-hour session |
| `GET /auth/session` | Current user and CSRF token |
| `POST /admin/products` | Create a product with name and slug |
| `POST /admin/customers` | Create a customer with name and email |
| `POST /admin/licenses` | Issue keys with productId, label, maxDevices, optional customerId, expiresAt or durationDays, entitlements, count |
| `GET /admin/licenses` | Search, filter and paginate licenses |
| `POST /admin/licenses/:id/status` | Suspend, resume or permanently revoke |
| `POST /admin/licenses/:id/renew` | Extend expiry by days |
| `POST /admin/licenses/:id/rotate` | Replace the key; show the replacement once |
| `POST /client/activate` | Activate using productId, key, fingerprint, name |
| `POST /client/validate` | Refresh a lease for an existing activation |
| `POST /client/deactivate` | Release the caller's device |
| `GET /admin/audit/verify` | Verify the retained audit chain |

Admin creation returns raw license keys once. List endpoints never return them. An `Idempotency-Key` of 16–128 letters, digits, underscores or hyphens replays the same issuance response for 24 hours. Reusing it with a different request returns 409. Retries outside that period can create new licenses.

Offline leases remain valid until their signed expiry, even after online revocation, device release, key rotation or product disablement. Choose a lease duration matching your revocation tolerance (default one hour, maximum seven days). Pin your instance public key in the client and verify issuer, product, device, signature and expiry. Offline checks require a trustworthy clock. Client-side enforcement can be patched by someone controlling the client; enforce valuable server-side operations on a trusted server.

The audit chain detects changes to retained records using the instance secret. Detecting deletion of the end of the log requires an externally retained checkpoint. A host administrator with the identity file controls the instance's trust.

## Development

```sh
npm test
```

API tests cover concurrent device allocation, lifecycle transitions, signed lease tampering, expiry, CSRF, role and product boundaries, key rotation, encrypted idempotency replay and session invalidation.

## References and attribution

Original application code is MIT licensed. Runtime dependencies retain their own licenses. Design and security decisions were informed by [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html) and [Keygen's public licensing API documentation](https://keygen.sh/docs/api/licenses/). No Keygen implementation code is included.
