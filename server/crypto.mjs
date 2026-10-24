import { createHash, createHmac, generateKeyPairSync, randomBytes, scrypt, timingSafeEqual, sign, verify, createPublicKey, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const digest = (value, pepper) => createHmac('sha256', pepper).update(value).digest('hex');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const licenseKey = () => `KD-${randomBytes(24).toString('hex').toUpperCase().match(/.{8}/g).join('-')}`;
export const normalizeKey = value => value.trim().toUpperCase();

export function seal(value, pepper, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(sha256(pepper), 'hex'), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(x => x.toString('base64url')).join('.');
}
export function unseal(value, pepper, context) {
  const [iv, tag, ciphertext] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(sha256(pepper), 'hex'), iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'));
}

export async function hashPassword(password) {
  const salt = secret(16);
  const key = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

export async function checkPassword(password, encoded) {
  const [algorithm, n, r, p, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !salt || !expected) return false;
  const key = await derive(password, salt, 64, { N: +n, r: +r, p: +p, maxmem: 160 * 1024 * 1024 });
  return equal(key.toString('hex'), expected);
}

export function createIdentity() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return {
    version: 1, pepper: secret(48), setupToken: secret(),
    signing: { kid: sha256(publicKey).slice(0, 16), publicKey, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() }
  };
}

export function signLease(claims, identity) {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: identity.signing.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), identity.signing.privateKey).toString('base64url')}`;
}

export function publicJwk(identity) {
  return { ...createPublicKey(identity.signing.publicKey).export({ format: 'jwk' }), kid: identity.signing.kid, alg: 'EdDSA', use: 'sig' };
}

export { verifyLease } from '../sdk/javascript/lease.mjs';
