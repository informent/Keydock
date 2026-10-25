export interface LeaseClaims {
  v: 1;
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  device: string;
  activationId: string;
  entitlements: string[];
}
export interface ClientInput {
  key: string;
  fingerprint: string;
  name?: string;
}
export interface LeaseResult {
  lease: string;
  licenseId: string;
  activationId: string;
  entitlements: string[];
  leaseExpiresAt: number;
  claims: LeaseClaims;
}
export class KeydockError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status?: number);
}
export function verifyLease(
  token: string,
  publicKey: string,
  options: {
    productId: string;
    fingerprint: string;
    issuer: string;
    now?: number;
    maxClockSkewSeconds?: number;
  },
): LeaseClaims;
export class KeydockClient {
  constructor(options: {
    baseUrl: string;
    productId: string;
    publicKey: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  });
  activate(input: ClientInput): Promise<LeaseResult>;
  validate(input: ClientInput): Promise<LeaseResult>;
  deactivate(input: ClientInput): Promise<{ released: true }>;
  verify(
    lease: string,
    fingerprint: string,
    options?: { now?: number; maxClockSkewSeconds?: number },
  ): LeaseClaims;
}
