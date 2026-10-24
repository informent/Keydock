import { randomUUID } from 'node:crypto';
import { digest, licenseKey, normalizeKey, sha256, signLease } from './crypto.mjs';
import { fail } from './errors.mjs';

export const productView = row => ({ id: row.id, name: row.name, slug: row.slug, description: row.description, active: !!row.active, leaseSeconds: row.lease_seconds, createdAt: row.created_at, licenses: row.licenses ?? 0 });
export const customerView = row => ({ id: row.id, name: row.name, email: row.email, externalId: row.external_id, notes: row.notes, createdAt: row.created_at, licenses: row.licenses ?? 0 });
export const activationView = row => ({ id: row.id, licenseId: row.license_id, name: row.name, createdAt: row.created_at, lastSeenAt: row.last_seen_at, releasedAt: row.released_at });

export function licensing(store, issuer) {
  const { identity } = store;
  const effectiveStatus = row => row.status === 'active' && row.expires_at !== null && row.expires_at <= store.clock() ? 'expired' : row.status;
  const view = row => ({
    id: row.id, productId: row.product_id, productName: row.product_name ?? '', customerId: row.customer_id, customerName: row.customer_name ?? null,
    keyHint: row.key_hint, label: row.label, status: effectiveStatus(row), maxDevices: row.max_devices,
    deviceCount: Number(row.device_count ?? 0), expiresAt: row.expires_at, durationDays: row.duration_days, activatedAt: row.activated_at,
    entitlements: JSON.parse(row.entitlements), notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at
  });
  const baseSelect = `SELECT l.*, p.name product_name, c.name customer_name, (SELECT COUNT(*) FROM activations a WHERE a.license_id=l.id AND a.released_at IS NULL) device_count FROM licenses l JOIN products p ON p.id=l.product_id LEFT JOIN customers c ON c.id=l.customer_id`;
  const getRaw = id => store.get(`${baseSelect} WHERE l.id=?`, id) ?? fail(404, 'NOT_FOUND', 'License not found');
  const scope = (actor, productId) => { if (actor.productId && actor.productId !== productId) fail(403, 'SCOPE_DENIED', 'This API token cannot access that product'); };
  const checkCustomer = id => { if (id && !store.get('SELECT id FROM customers WHERE id=?', id)) fail(404, 'NOT_FOUND', 'Customer not found'); };
  const event = (action, actor, target, detail) => store.audit(action, actor.id, target, detail);

  return {
    scope, view, getRaw,
    get(id, actor) { const row = getRaw(id); scope(actor, row.product_id); return { ...view(row), devices: store.all('SELECT * FROM activations WHERE license_id=? ORDER BY created_at DESC LIMIT 500', id).map(activationView) }; },
    list(query, actor) {
      const params = [], where = [];
      const add = (sql, ...values) => { where.push(sql); params.push(...values); };
      if (actor.productId) add('l.product_id=?', actor.productId);
      if (query.productId) { scope(actor, query.productId); add('l.product_id=?', query.productId); }
      if (query.customerId) add('l.customer_id=?', query.customerId);
      if (query.search) { const term = `%${query.search.replace(/[\\%_]/g, value => `\\${value}`)}%`; add("(l.label LIKE ? ESCAPE '\\' OR l.key_hint LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')", term, term, term); }
      if (query.status === 'expired') add("l.status='active' AND l.expires_at<=?", store.clock());
      else if (query.status === 'active' || query.status === 'unactivated') {
        add("l.status='active' AND (l.expires_at IS NULL OR l.expires_at>?)", store.clock());
        if (query.status === 'unactivated') where.push('l.activated_at IS NULL');
      } else if (query.status !== 'all') add('l.status=?', query.status);
      const filter = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const total = store.get(`SELECT COUNT(*) total FROM licenses l LEFT JOIN customers c ON c.id=l.customer_id${filter}`, ...params).total;
      const items = store.all(`${baseSelect}${filter} ORDER BY l.created_at DESC,l.id LIMIT ? OFFSET ?`, ...params, query.limit, (query.page - 1) * query.limit).map(view);
      return { items, total: Number(total), page: query.page, limit: query.limit };
    },
    issue(input, actor) {
      scope(actor, input.productId);
      if (!store.get('SELECT id FROM products WHERE id=?', input.productId)) fail(404, 'NOT_FOUND', 'Product not found');
      checkCustomer(input.customerId);
      if (input.expiresAt && input.expiresAt <= store.clock()) fail(400, 'INVALID_EXPIRY', 'Expiry must be in the future');
      const items = [];
      for (let i = 0; i < input.count; i++) {
        const key = licenseKey(), id = randomUUID(), now = store.clock();
        const label = input.count > 1 ? `${input.label} ${i + 1}` : input.label;
        store.run(`INSERT INTO licenses(id,product_id,customer_id,key_hash,key_hint,label,status,max_devices,expires_at,duration_days,entitlements,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`, id, input.productId, input.customerId, digest(normalizeKey(key), identity.pepper), `${key.slice(0, 11)}…${key.slice(-4)}`, label, input.maxDevices, input.expiresAt, input.durationDays, JSON.stringify(input.entitlements), input.notes, now, now);
        event('license.issued', actor, id, { productId: input.productId, label });
        items.push({ ...view(getRaw(id)), key });
      }
      return { items };
    },
    edit(id, changes, actor) {
      const row = getRaw(id); scope(actor, row.product_id);
      if (row.status === 'revoked') fail(409, 'LICENSE_REVOKED', 'Revoked licenses cannot be edited');
      if (changes.maxDevices !== undefined && changes.maxDevices < row.device_count) fail(409, 'DEVICES_IN_USE', 'Release devices before lowering the device limit');
      checkCustomer(changes.customerId);
      if (changes.expiresAt && changes.expiresAt <= store.clock()) fail(400, 'INVALID_EXPIRY', 'Expiry must be in the future');
      const mapping = { label: 'label', maxDevices: 'max_devices', expiresAt: 'expires_at', entitlements: 'entitlements', notes: 'notes', customerId: 'customer_id' };
      const entries = Object.entries(changes);
      const setters = entries.map(([key]) => `${mapping[key]}=?`);
      const values = entries.map(([key, value]) => key === 'entitlements' ? JSON.stringify([...new Set(value)]) : value);
      if ('expiresAt' in changes) setters.push('duration_days=NULL');
      store.run(`UPDATE licenses SET ${setters.join(',')},updated_at=? WHERE id=?`, ...values, store.clock(), id);
      event('license.updated', actor, id, { fields: Object.keys(changes) });
      return view(getRaw(id));
    },
    setStatus(id, status, actor) {
      const row = getRaw(id); scope(actor, row.product_id);
      if (row.status === 'revoked' && status !== 'revoked') fail(409, 'LICENSE_REVOKED', 'Revocation is permanent. Issue a new license.');
      if (row.status !== status) {
        store.run('UPDATE licenses SET status=?,updated_at=? WHERE id=?', status, store.clock(), id);
        event(`license.${status === 'active' ? 'resumed' : status}`, actor, id, { productId: row.product_id });
      }
      return view(getRaw(id));
    },
    renew(id, days, actor) {
      const row = getRaw(id); scope(actor, row.product_id);
      if (row.status === 'revoked') fail(409, 'LICENSE_REVOKED', 'Revoked licenses cannot be renewed');
      const expires = Math.max(row.expires_at ?? store.clock(), store.clock()) + days * 86400000;
      store.run('UPDATE licenses SET expires_at=?,duration_days=NULL,updated_at=? WHERE id=?', expires, store.clock(), id);
      event('license.renewed', actor, id, { days, expiresAt: expires });
      return view(getRaw(id));
    },
    rotate(id, actor) {
      const row = getRaw(id); scope(actor, row.product_id);
      if (row.status === 'revoked') fail(409, 'LICENSE_REVOKED', 'Revoked licenses cannot be rotated');
      const key = licenseKey();
      store.run('UPDATE licenses SET key_hash=?,key_hint=?,updated_at=? WHERE id=?', digest(key, identity.pepper), `${key.slice(0, 11)}…${key.slice(-4)}`, store.clock(), id);
      event('license.key_rotated', actor, id, {});
      return { ...view(getRaw(id)), key };
    },
    release(id, deviceId, actor) {
      const row = getRaw(id); scope(actor, row.product_id);
      const device = store.get('SELECT * FROM activations WHERE id=? AND license_id=?', deviceId, id);
      if (!device) fail(404, 'NOT_FOUND', 'Device not found');
      if (!device.released_at) {
        store.run('UPDATE activations SET released_at=? WHERE id=?', store.clock(), deviceId);
        event('device.released', actor, id, { deviceId });
      }
      return { released: true };
    },
    client(input, operation) {
      const now = store.clock();
      const row = store.get('SELECT l.*,p.active product_active,p.lease_seconds FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.key_hash=? AND l.product_id=?', digest(normalizeKey(input.key), identity.pepper), input.productId);
      if (!row) fail(403, 'INVALID_LICENSE', 'License could not be validated');
      const deviceHash = sha256(input.fingerprint);
      let activation = store.get('SELECT * FROM activations WHERE license_id=? AND device_hash=? AND released_at IS NULL', row.id, deviceHash);
      if (operation === 'deactivate') {
        if (activation) { store.run('UPDATE activations SET released_at=? WHERE id=?', now, activation.id); store.audit('device.deactivated', `license:${row.id}`, row.id, { deviceId: activation.id }); }
        return { released: true };
      }
      if (row.status !== 'active') fail(403, `LICENSE_${row.status.toUpperCase()}`, `License is ${row.status}`);
      if (!row.product_active) fail(403, 'PRODUCT_DISABLED', 'Product is disabled');
      if (row.expires_at !== null && row.expires_at <= now) fail(403, 'LICENSE_EXPIRED', 'License has expired');
      if (!activation) {
        if (operation === 'validate') fail(403, 'DEVICE_NOT_ACTIVATED', 'Activate this device before validating');
        const count = Number(store.get('SELECT COUNT(*) count FROM activations WHERE license_id=? AND released_at IS NULL', row.id).count);
        if (count >= row.max_devices) fail(403, 'DEVICE_LIMIT', 'Device limit reached. Release an existing device first.');
        activation = { id: randomUUID(), license_id: row.id, device_hash: deviceHash, name: input.name, created_at: now, last_seen_at: now, released_at: null };
        store.run('INSERT INTO activations(id,license_id,device_hash,name,created_at,last_seen_at) VALUES(?,?,?,?,?,?)', activation.id, row.id, deviceHash, input.name, now, now);
        store.audit('device.activated', `license:${row.id}`, row.id, { deviceId: activation.id, productId: row.product_id });
      } else store.run('UPDATE activations SET last_seen_at=? WHERE id=?', now, activation.id);
      if (!row.activated_at) {
        row.expires_at = row.duration_days ? now + row.duration_days * 86400000 : row.expires_at;
        store.run('UPDATE licenses SET activated_at=?,expires_at=?,updated_at=? WHERE id=?', now, row.expires_at, now, row.id);
      }
      const issuedAt = Math.floor(now / 1000);
      const expiresAt = Math.min(issuedAt + row.lease_seconds, row.expires_at ? Math.floor(row.expires_at / 1000) : Infinity);
      if (expiresAt <= issuedAt) fail(403, 'LICENSE_EXPIRED', 'License has expired');
      const claims = { v: 1, iss: issuer, aud: row.product_id, sub: row.id, jti: randomUUID(), iat: issuedAt, nbf: issuedAt, exp: expiresAt, device: deviceHash, activationId: activation.id, entitlements: JSON.parse(row.entitlements) };
      return { valid: true, licenseId: row.id, activationId: activation.id, expiresAt: row.expires_at, leaseExpiresAt: expiresAt * 1000, entitlements: claims.entitlements, lease: signLease(claims, identity) };
    },
    countValidation(productId, outcome) {
      const day = new Date(store.clock()).toISOString().slice(0, 10);
      store.run('INSERT INTO validation_counts(day,product_id,outcome,count) VALUES(?,?,?,1) ON CONFLICT(day,product_id,outcome) DO UPDATE SET count=count+1', day, productId, outcome);
    },
    overview(actor) {
      const now = store.clock(), filter = actor.productId ? ' AND product_id=?' : '', args = actor.productId ? [actor.productId] : [];
      const count = (sql, ...params) => Number(store.get(sql, ...params).n);
      const totals = {
        licenses: count(`SELECT COUNT(*) n FROM licenses WHERE 1=1${filter}`, ...args),
        active: count(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>?)${filter}`, now, ...args),
        expired: count(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND expires_at<=?${filter}`, now, ...args),
        expiring: count(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND expires_at>? AND expires_at<=?${filter}`, now, now + 7 * 86400000, ...args),
        devices: count(`SELECT COUNT(*) n FROM activations a JOIN licenses l ON l.id=a.license_id WHERE a.released_at IS NULL${filter}`, ...args),
        products: count(`SELECT COUNT(*) n FROM products${actor.productId ? ' WHERE id=?' : ''}`, ...args)
      };
      const since = new Date(now - 29 * 86400000).toISOString().slice(0, 10);
      const activity = store.all(`SELECT day,outcome,SUM(count) count FROM validation_counts WHERE day>=?${filter} GROUP BY day,outcome ORDER BY day`, since, ...args);
      return { ...totals, activity, now };
    }
  };
}
