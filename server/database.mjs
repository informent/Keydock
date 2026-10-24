import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createIdentity, digest } from './crypto.mjs';

export function openStore(directory, clock = () => Date.now()) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identityPath = join(directory, 'identity.json');
  const databasePath = join(directory, 'keydock.sqlite');
  if (!existsSync(identityPath)) {
    if (existsSync(databasePath)) throw new Error('Missing identity.json. Restore the identity matching this database; a replacement would invalidate credentials.');
    try { writeFileSync(identityPath, `${JSON.stringify(createIdentity(), null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  if (identity.version !== 1 || !identity.pepper || !identity.signing?.privateKey || !identity.setupToken) throw new Error('Invalid identity file');
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (schemaVersion > 1) { db.close(); throw new Error('This database requires a newer Keydock version.'); }
  if (schemaVersion === 0) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','operator','viewer')), disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, lease_seconds INTEGER NOT NULL CHECK(lease_seconds BETWEEN 60 AND 604800), created_at INTEGER NOT NULL);
    CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, external_id TEXT UNIQUE, notes TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE licenses(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), customer_id TEXT REFERENCES customers(id), key_hash TEXT UNIQUE NOT NULL, key_hint TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')), max_devices INTEGER NOT NULL CHECK(max_devices BETWEEN 1 AND 10000), expires_at INTEGER, duration_days INTEGER, activated_at INTEGER, entitlements TEXT NOT NULL, notes TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX licenses_product ON licenses(product_id, created_at);
    CREATE INDEX licenses_customer ON licenses(customer_id);
    CREATE TABLE activations(id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id), device_hash TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, released_at INTEGER);
    CREATE UNIQUE INDEX active_device ON activations(license_id,device_hash) WHERE released_at IS NULL;
    CREATE INDEX activation_license ON activations(license_id, released_at);
    CREATE TABLE api_tokens(id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('operator','viewer')), product_id TEXT REFERENCES products(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, last_used_at INTEGER);
    CREATE TABLE audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE validation_counts(day TEXT NOT NULL, product_id TEXT NOT NULL, outcome TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,product_id,outcome));
    CREATE TABLE idempotency(key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL, expires_at INTEGER NOT NULL);
    PRAGMA user_version=1;
    COMMIT;
  `);
  const store = {
    db, identity, directory, clock,
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); if (result?.then) throw new Error('Transactions must be synchronous'); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    audit(action, actor, target, detail = {}) {
      const previous = store.get('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')?.hash ?? 'GENESIS';
      const entry = { id: randomUUID(), action, actor, target, detail: JSON.stringify(detail), created_at: clock(), previous_hash: previous };
      const hash = digest(JSON.stringify(entry), identity.pepper);
      store.run('INSERT INTO audit(id,action,actor,target,detail,created_at,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?)', ...Object.values(entry), hash);
    },
    close: () => db.close()
  };
  return store;
}
