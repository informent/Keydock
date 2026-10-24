import { randomUUID } from 'node:crypto';
import { checkPassword, digest, equal, hashPassword, secret } from './crypto.mjs';
import { fail } from './errors.mjs';

export const userView = user => ({ id: user.id, email: user.email, name: user.name, role: user.role, disabled: !!user.disabled, createdAt: user.created_at });

export async function authentication(store, origin) {
  const secure = origin.startsWith('https:');
  const dummy = await hashPassword(secret());
  let passwordsInFlight = 0;
  async function passwordWork(fn) {
    if (passwordsInFlight >= 3) fail(429, 'BUSY', 'Please try signing in again shortly');
    passwordsInFlight++;
    try { return await fn(); } finally { passwordsInFlight--; }
  }
  function rateLimit(key, max, windowMs) {
    const hash = digest(key, store.identity.pepper), now = store.clock();
    const record = store.get('SELECT * FROM rate_limits WHERE key=?', hash);
    if (record && record.reset_at > now && record.count >= max) fail(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    store.run('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END', hash, now + windowMs, now, now);
  }
  function checkOrigin(request) {
    if (request.headers.origin !== origin || (request.headers['sec-fetch-site'] && !['same-origin','none'].includes(request.headers['sec-fetch-site']))) fail(403, 'ORIGIN_DENIED', 'Request origin does not match this Keydock instance');
  }
  function createSession(user, reply) {
    const token = secret(), csrf = secret(), expiry = store.clock() + 12 * 3600000;
    store.run('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)', digest(token, store.identity.pepper), user.id, csrf, expiry);
    reply.setCookie('keydock_session', token, { path: '/', httpOnly: true, secure, sameSite: 'strict', maxAge: 12 * 3600 });
    return { user: userView(user), csrf, expiresAt: expiry };
  }
  function resolve(request) {
    if (request.headers.authorization) {
      const match = /^Bearer (kd_api_[A-Za-z0-9_-]{43})$/.exec(request.headers.authorization);
      if (!match) fail(401, 'UNAUTHENTICATED', 'A valid API token is required');
      const token = store.get('SELECT * FROM api_tokens WHERE hash=? AND revoked_at IS NULL AND expires_at>?', digest(match[1], store.identity.pepper), store.clock());
      if (!token) fail(401, 'UNAUTHENTICATED', 'API token is invalid or expired');
      store.run('UPDATE api_tokens SET last_used_at=? WHERE id=?', store.clock(), token.id);
      return { id: `token:${token.id}`, role: token.role, productId: token.product_id, kind: 'token' };
    }
    const cookie = request.cookies.keydock_session;
    if (!cookie || cookie.length > 100) fail(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const sessionHash = digest(cookie, store.identity.pepper);
    const user = store.get('SELECT u.*,s.csrf,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.disabled=0', sessionHash, store.clock());
    if (!user) fail(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
      checkOrigin(request);
      if (!equal(request.headers['x-keydock-csrf'], user.csrf)) fail(403, 'CSRF_DENIED', 'Session verification failed. Refresh the page and try again.');
    }
    return { id: user.id, role: user.role, productId: null, kind: 'session', user, sessionHash };
  }
  return {
    rateLimit, checkOrigin, resolve,
    async bootstrap(input, request, reply) {
      checkOrigin(request); rateLimit(`setup:${request.ip}`, 5, 15 * 60000);
      if (store.get('SELECT id FROM users LIMIT 1')) fail(409, 'ALREADY_CONFIGURED', 'This instance is already configured');
      if (!equal(input.setupToken, store.identity.setupToken)) fail(403, 'INVALID_SETUP_TOKEN', 'The setup token is invalid');
      const hash = await passwordWork(() => hashPassword(input.password));
      return store.transaction(() => {
        if (store.get('SELECT id FROM users LIMIT 1')) fail(409, 'ALREADY_CONFIGURED', 'This instance is already configured');
        const id = randomUUID();
        store.run("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'owner',?)", id, input.email, input.name, hash, store.clock());
        store.audit('instance.configured', id, id);
        return createSession(store.get('SELECT * FROM users WHERE id=?', id), reply);
      });
    },
    async login(input, request, reply) {
      checkOrigin(request); rateLimit(`login-ip:${request.ip}`, 20, 15 * 60000); rateLimit(`login-email:${input.email}`, 8, 15 * 60000);
      const user = store.get('SELECT * FROM users WHERE email=?', input.email);
      const valid = await passwordWork(() => checkPassword(input.password, user?.password_hash ?? dummy));
      if (!valid || !user || user.disabled) fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      // Recheck after the asynchronous password calculation so a concurrent disable wins.
      const current = store.get('SELECT * FROM users WHERE id=? AND disabled=0', user.id);
      if (!current || current.password_hash !== user.password_hash) fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      return store.transaction(() => { store.audit('session.created', user.id, user.id); return createSession(current, reply); });
    },
    guard(roles = ['owner','operator','viewer']) {
      return async request => { request.actor = resolve(request); if (!roles.includes(request.actor.role)) fail(403, 'FORBIDDEN', 'Your role does not allow this action'); };
    },
    logout(request, reply) {
      if (request.actor.kind !== 'session') fail(400, 'SESSION_REQUIRED', 'Use a browser session');
      store.run('DELETE FROM sessions WHERE hash=?', request.actor.sessionHash);
      reply.clearCookie('keydock_session', { path: '/', httpOnly: true, secure, sameSite: 'strict' });
      return { success: true };
    },
    async changePassword(input, actor) {
      if (actor.kind !== 'session') fail(400, 'SESSION_REQUIRED', 'Use a browser session');
      rateLimit(`password:${actor.id}`, 5, 15 * 60000);
      if (!await passwordWork(() => checkPassword(input.currentPassword, actor.user.password_hash))) fail(403, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      const hash = await passwordWork(() => hashPassword(input.newPassword));
      store.transaction(() => {
        const current = store.get('SELECT password_hash FROM users WHERE id=? AND disabled=0', actor.id);
        if (current?.password_hash !== actor.user.password_hash) fail(409, 'CONCURRENT_CHANGE', 'Account changed. Sign in again.');
        store.run('UPDATE users SET password_hash=? WHERE id=?', hash, actor.id);
        store.run('DELETE FROM sessions WHERE user_id=?', actor.id);
        store.audit('user.password_changed', actor.id, actor.id);
      });
      return { success: true, signInRequired: true };
    },
    async addUser(input, actor) {
      const hash = await passwordWork(() => hashPassword(input.password));
      return store.transaction(() => {
        const id = randomUUID();
        store.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, input.email, input.name, hash, input.role, store.clock());
        store.audit('user.created', actor.id, id, { role: input.role });
        return userView(store.get('SELECT * FROM users WHERE id=?', id));
      });
    }
  };
}
