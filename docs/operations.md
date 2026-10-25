# Operating Keydock

## Local development and first run

Install Node.js 24.12 or newer within the Node 24 LTS line, then run `npm ci`, `npm run build`, and `npm start`. The production server serves the compiled console and API from one origin. It binds to `127.0.0.1:3400` by default. It does not open a browser automatically.

Read `setupToken` from `data/identity.json` privately, open the console, and create the owner account. The owner can add operators and viewers in Settings. Initial team passwords should be shared privately and changed after first sign-in. Password changes invalidate all sessions for that user.

## Configuration

| Environment variable | Default                 | Purpose                                                         |
| -------------------- | ----------------------- | --------------------------------------------------------------- |
| `HOST`               | `127.0.0.1`             | Listen address                                                  |
| `PORT`               | `3400`                  | Listen port                                                     |
| `KEYDOCK_ORIGIN`     | `http://127.0.0.1:3400` | Exact console origin and signed lease issuer; no trailing slash |
| `KEYDOCK_DATA_DIR`   | `data`                  | Persistent database and identity directory                      |

Public origins require HTTPS. Run behind a TLS reverse proxy and keep the application port private. Keydock does not trust forwarded IP headers. Add a per-client limiter at the proxy, especially for login and licensing routes. The application limits requests by the direct peer address and by credential digest.

The console and API must share the configured origin. The Vite development server is a build convenience; use the production build and Keydock server for authentication and security testing.

## Disposable demo

After `npm run build`, run `npm run demo` (or `npm run demo -- --port 3402`). The demo always binds to `127.0.0.1` and uses a newly allocated operating-system temporary directory. It ignores `HOST`, `PORT`, `KEYDOCK_ORIGIN` and `KEYDOCK_DATA_DIR`, so it cannot seed the configured production instance.

Read the private `demo-credentials.json` file at the path printed in the terminal to obtain the random owner password and example license keys. No credentials are printed in logs. The demo contains two products, three customers, six licenses and two activated devices, including suspended and revoked examples. It uses the same API and authentication as a normal instance.

Ctrl+C closes the database and removes that demo's directory. A forced process termination or machine crash can leave it behind; remove only the printed temporary directory after confirming its process has stopped. Demo credentials and keys are disposable, and a subsequent run creates a different instance.

## Storage and recovery

Use one application process and one data directory on a local filesystem. SQLite WAL files must not be shared over a network filesystem. Restrict the directory to the service account. On Windows, apply a restrictive filesystem ACL; Unix mode bits alone do not configure Windows ACLs.

Run the backup command with the same `KEYDOCK_DATA_DIR`, `KEYDOCK_ORIGIN` and `PORT` configuration as the server, or provide explicit options:

```sh
npm run backup -- --data-dir ./data --output ./backups --origin http://127.0.0.1:3400
npm run backup:verify -- BACKUP_DIRECTORY
npm run restore -- BACKUP_DIRECTORY --to NEW_DATA_DIRECTORY
```

`BACKUP_DIRECTORY` is the timestamped directory printed by the first command. `NEW_DATA_DIRECTORY` is a destination that does not yet exist, with an existing parent directory. Quote paths containing spaces. No command overwrites an existing backup or merges into an existing restore destination, including an empty directory. Source data is never deleted. Backup output inside the source data directory is refused.

The server may stay running during backup. The [SQLite online backup API](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options) captures a consistent database including committed WAL transactions. Keydock copies the identity, checks that it did not change during the operation, and normalizes the database copy into a standalone file. The resulting directory contains exactly `identity.json`, `keydock.sqlite`, and `manifest.json`. The manifest is written last and records SHA-256 checksums, file sizes, the configured origin, signing key ID, schema version and audit checkpoint. Incomplete snapshots are rejected.

Verification checks file hashes, identity key consistency, SQLite integrity, foreign keys, schema compatibility and the retained audit chain. Restore verifies staged copies before creating the destination, rechecks the installed files, and refuses to start from a directory marked as an interrupted restore. If recovery is interrupted, retry into another new directory; retain the original data and backup.

Stop Keydock before restoring, set `KEYDOCK_DATA_DIR` to the returned destination, and retain the returned `KEYDOCK_ORIGIN`. Verify `/health`, sign in, and activate or validate a test license before accepting production traffic. A recovery test checks existing credentials and leases, not just file checksums. Restoring a snapshot also rolls back later revocations and other database changes; reconcile changes since the snapshot before resuming traffic. Changing the origin changes the lease issuer that clients pin.

Backups contain private signing keys, the credential pepper and the database. The command does not encrypt them. Restrict access, use encrypted storage, and keep them outside every public web root. Checksums detect accidental damage, not an attacker who can replace both the files and manifest. Retain an audit checkpoint separately when you need an independent comparison. Unix files use owner-only permissions; configure restrictive ACLs separately on Windows. Environment configuration is not inferred from a running server, so ensure the origin supplied to the backup command is correct.

For a manual cold backup, stop Keydock, copy the **whole data directory** including `identity.json` and any WAL files, and restart. The CLI verifies its own three-file snapshot format; a manual directory copy must be recovered separately into an empty location with the process stopped. A database restored with a different identity cannot validate existing keys or sessions. Keydock refuses to generate a new identity over an existing database.

For an upgrade, back up first, stop the process, install the new version and dependencies, rebuild the console, and restart. Keep the previous release and matching backup for rollback; older binaries reject a newer schema rather than guessing how to open it.

## Operating limits

- Admin sessions have a fixed 12-hour lifetime. Management tokens expire within 365 days.
- Batch issuance is capped at 100 keys. List pages are capped at 100 records.
- CSV export includes at most 10,000 records and excludes raw keys. Use paginated API reads for larger exports.
- Optional issuance idempotency responses are encrypted for 24 hours, then deleted. A retry after expiry can issue another batch.
- Offline leases last 60 seconds to seven days. Revocation is immediate online and bounded by lease expiry offline.
- Audit history is retained until the operator manages retention. Plan disk capacity and protected backups for a busy instance.
- There is no billing provider, checkout, customer email delivery, SSO, or hosted multi-tenant service in this release. Integrate your backend using scoped tokens and idempotent issuance.

## Health and incident response

`GET /health` checks database access and returns the version. Request failures carry an `X-Request-Id` and a matching JSON request ID. Application logs omit request bodies, keys, passwords, cookies and authorization headers.

Revoke a compromised integration token in Developers. Rotate a leaked license key from its license details. Suspend a license for a reversible stop, or revoke it permanently. Shorten the product lease duration before issuance if your application needs faster offline revocation. Already issued leases keep their original signed expiry.

The audit verifier checks retained records, using an HMAC chain. Save its returned head outside the host if you need a checkpoint; the local verifier cannot independently detect deletion of the end of a log. An attacker controlling the instance identity controls signing and audit trust.
