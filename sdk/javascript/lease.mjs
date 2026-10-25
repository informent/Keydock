import { createHash, createPublicKey, verify } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export function verifyLease(
  token,
  publicKey,
  {
    productId,
    fingerprint,
    issuer,
    now = Date.now(),
    maxClockSkewSeconds = 30,
  },
) {
  if (typeof token !== "string" || token.length > 32768)
    throw new Error("Invalid lease");
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(maxClockSkewSeconds) ||
    maxClockSkewSeconds < 0 ||
    maxClockSkewSeconds > 300
  )
    throw new Error("Invalid verification time");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((x) => !/^[A-Za-z0-9_-]+$/.test(x)))
    throw new Error("Invalid lease");
  const [header, payload, signature] = parts;
  const h = JSON.parse(Buffer.from(header, "base64url").toString());
  const key = createPublicKey(publicKey),
    pem = key.export({ format: "pem", type: "spki" }).toString();
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !h ||
    h.alg !== "EdDSA" ||
    h.typ !== "JWT" ||
    h.crit !== undefined ||
    h.kid !== hash(pem).slice(0, 16)
  )
    throw new Error("Untrusted signing key");
  if (
    !verify(
      null,
      Buffer.from(`${header}.${payload}`),
      key,
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("Invalid signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()),
    time = Math.floor(now / 1000);
  if (
    !claims ||
    !productId ||
    !fingerprint ||
    !issuer ||
    claims.aud !== productId ||
    claims.iss !== issuer ||
    claims.device !== hash(fingerprint)
  )
    throw new Error("Lease does not match this application or device");
  if (
    claims.v !== 1 ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.nbf) ||
    !Number.isInteger(claims.exp) ||
    claims.exp <= time ||
    claims.nbf > time + maxClockSkewSeconds ||
    claims.iat > time + maxClockSkewSeconds ||
    claims.exp <= claims.iat ||
    typeof claims.sub !== "string" ||
    typeof claims.activationId !== "string" ||
    !Array.isArray(claims.entitlements) ||
    claims.entitlements.some((x) => typeof x !== "string")
  )
    throw new Error("Expired or malformed lease");
  return claims;
}
