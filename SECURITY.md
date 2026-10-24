# Security

Keydock is early software. Independent security review and production load testing are still needed. Report vulnerabilities privately through GitHub's private vulnerability reporting for this repository when enabled; avoid including real keys, customer records or instance identity files in public issues.

## Trust and deployment

- The host and its administrators are trusted. Protect the entire data directory and backups. On Windows, restrict its ACL to the service account and administrators. On Linux, use a dedicated unprivileged account.
- Back up `identity.json` together with a consistent SQLite snapshot. The identity contains the HMAC pepper, Ed25519 private key and bootstrap secret. Losing it invalidates the database's credentials. Keep backups encrypted and access controlled.
- Run one Keydock application process per data directory on local storage. Do not place SQLite WAL files on a network share. This version does not provide a clustered deployment.
- Terminate HTTPS at a reverse proxy. Set `KEYDOCK_ORIGIN` to the exact HTTPS browser origin. The application does not trust forwarded IP headers. Its per-IP limiter sees the proxy address; enforce additional client-IP limits at the proxy for public traffic.
- Never embed management tokens, owner credentials or private signing keys in distributed clients. Clients need only a license key, product ID and pinned public signing key.
- License keys are random bearer credentials. Device fingerprints identify installations; they do not prove hardware authenticity. Use a persistent random installation ID instead of invasive hardware collection when possible.
- Offline leases survive revocation until expiry. Use short leases for sensitive products. Reject expired leases and never silently accept an online denial using an older lease.
- The audit chain is useful for integrity checks; it is not proof against a malicious host administrator. Export signed chain checkpoints outside the host if truncation detection matters.
- The database, runtime data, test sessions and setup secrets are excluded from Git and release archives.

## Controls covered by automated tests

Seat allocation under concurrent requests; role and product scope; CSRF and origin checks; signed lease forgery and binding failures; expiry and lifecycle transitions; idempotency replay; CSV injection; session invalidation; unique-identifier conflicts.
