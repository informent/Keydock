export interface User {
  id: string;
  name: string;
  email: string;
  role: "owner" | "operator" | "viewer";
  disabled: boolean;
  createdAt: number;
}
export interface Session {
  user: User;
  csrf: string;
  expiresAt: number;
}
export interface Meta {
  name: string;
  version: string;
  setupRequired: boolean;
  issuer: string;
  publicKey: string;
  signingKeyId: string;
}
export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  active: boolean;
  leaseSeconds: number;
  licenses: number;
  createdAt: number;
}
export interface Customer {
  id: string;
  name: string;
  email: string;
  externalId: string | null;
  notes: string;
  licenses: number;
  createdAt: number;
}
export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  releasedAt: number | null;
}
export interface License {
  id: string;
  productId: string;
  productName: string;
  customerId: string | null;
  customerName: string | null;
  keyHint: string;
  label: string;
  status: string;
  maxDevices: number;
  deviceCount: number;
  expiresAt: number | null;
  durationDays: number | null;
  activatedAt: number | null;
  entitlements: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
  devices?: Device[];
  key?: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface Overview {
  licenses: number;
  active: number;
  expired: number;
  expiring: number;
  devices: number;
  products: number;
  now: number;
  activity: { day: string; outcome: string; count: number }[];
}
export interface Audit {
  seq: number;
  id: string;
  action: string;
  actor: string;
  target: string;
  detail: Record<string, unknown>;
  createdAt: number;
  hash: string;
}
export interface ApiToken {
  id: string;
  name: string;
  hint: string;
  role: string;
  productId: string | null;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  token?: string;
}
export type Notify = (text: string, kind?: "success" | "error") => void;
