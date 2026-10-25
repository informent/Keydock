import { verifyLease } from "./lease.mjs";
export { verifyLease } from "./lease.mjs";

export class KeydockError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "KeydockError";
    this.code = code;
    this.status = status;
  }
}

export class KeydockClient {
  constructor({
    baseUrl,
    productId,
    publicKey,
    timeoutMs = 10000,
    fetchImpl = globalThis.fetch,
  }) {
    const url = new URL(baseUrl);
    if (
      baseUrl !== url.origin ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("Use an HTTPS origin, or HTTP loopback for development");
    if (
      !productId ||
      !publicKey ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 500 ||
      timeoutMs > 60000
    )
      throw new Error(
        "Product ID, pinned public key and a 500–60000ms timeout are required",
      );
    this.baseUrl = baseUrl;
    this.productId = productId;
    this.publicKey = publicKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }
  async request(operation, { key, fingerprint, name = "Unnamed device" }) {
    let response, data;
    try {
      response = await this.fetch(
        `${this.baseUrl}/api/v1/client/${operation}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            productId: this.productId,
            key,
            fingerprint,
            name,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "error",
        },
      );
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) throw new Error("Response too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new KeydockError(
        "CONNECTION_FAILED",
        "Could not reach the licensing server securely",
      );
    }
    if (!response.ok)
      throw new KeydockError(
        data?.error?.code ?? "REQUEST_FAILED",
        data?.error?.message ?? "License request was denied",
        response.status,
      );
    if (operation === "deactivate") {
      if (data?.released !== true)
        throw new KeydockError("INVALID_RESPONSE", "Invalid release response");
      return { released: true };
    }
    let claims;
    try {
      claims = this.verify(data.lease, fingerprint);
    } catch {
      throw new KeydockError(
        "INVALID_LEASE",
        "The licensing server returned an invalid or untrusted lease",
      );
    }
    // Privileges come from signed claims. Unsigned response fields never grant access.
    return {
      lease: data.lease,
      licenseId: claims.sub,
      activationId: claims.activationId,
      entitlements: claims.entitlements,
      leaseExpiresAt: claims.exp * 1000,
      claims,
    };
  }
  activate(input) {
    return this.request("activate", input);
  }
  validate(input) {
    return this.request("validate", input);
  }
  deactivate(input) {
    return this.request("deactivate", input);
  }
  verify(lease, fingerprint, options = {}) {
    return verifyLease(lease, this.publicKey, {
      ...options,
      productId: this.productId,
      fingerprint,
      issuer: this.baseUrl,
    });
  }
}
