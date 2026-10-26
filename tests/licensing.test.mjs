import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { verifyLease } from "../server/crypto.mjs";

const origin = "http://127.0.0.1:3400";
const password = "A-long-test-password-482!";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "keydock-test-"));
  let now = Date.UTC(2026, 9, 24, 12);
  const app = await createApp({
    directory,
    origin,
    clock: () => now,
    serveUi: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { origin },
    payload: {
      name: "Owner",
      email: "owner@example.com",
      password,
      setupToken: app.store.identity.setupToken,
    },
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const session = setup.json(),
    cookie = setup.cookies[0].name + "=" + setup.cookies[0].value;
  const headers = { origin, cookie, "x-keydock-csrf": session.csrf };
  const request = (method, url, payload, extra = {}) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...headers, ...extra },
      ...(payload === undefined ? {} : { payload }),
    });
  const product = await request("POST", "/admin/products", {
    name: "Example Tool",
    slug: "example-tool",
    leaseSeconds: 3600,
  });
  assert.equal(product.statusCode, 201, product.body);
  const productId = product.json().id;
  async function issue(options = {}, extra) {
    const response = await request(
      "POST",
      "/admin/licenses",
      {
        productId,
        label: "Professional",
        maxDevices: 1,
        entitlements: ["export", "pro"],
        ...options,
      },
      extra,
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().items;
  }
  const client = (
    key,
    fingerprint = "device-fingerprint-0001",
    operation = "activate",
    pid = productId,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/client/${operation}`,
      payload: { productId: pid, key, fingerprint, name: "Development PC" },
    });
  return {
    app,
    directory,
    request,
    productId,
    issue,
    client,
    headers,
    time: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("customer profiles summarize effective license status and current devices across products", async (t) => {
  const f = await fixture(t);
  const createCustomer = async (name) => {
    const response = await f.request("POST", "/admin/customers", {
      name,
      email: `${name.toLowerCase()}@example.test`,
    });
    assert.equal(response.statusCode, 201);
    return response.json();
  };
  const customer = await createCustomer("Morgan"),
    other = await createCustomer("River");
  const empty = (await f.request("GET", `/admin/customers/${other.id}`)).json();
  assert.equal(empty.licenses, 0);
  assert.deepEqual(empty.summary, {
    products: 0,
    active: 0,
    expired: 0,
    expiring: 0,
    suspended: 0,
    revoked: 0,
    latestLicenseAt: null,
    devices: 0,
    lastSeenAt: null,
  });
  const secondProduct = (
    await f.request("POST", "/admin/products", {
      name: "Second application",
      slug: "second-app",
    })
  ).json();
  const [lifetime] = await f.issue({ customerId: customer.id, maxDevices: 2 });
  await f.issue({
    customerId: customer.id,
    productId: secondProduct.id,
    expiresAt: f.time() + 86400000,
  });
  await f.issue({ customerId: customer.id, durationDays: 30 });
  await f.issue({ customerId: customer.id, expiresAt: f.time() + 1000 });
  for (const status of ["suspended", "revoked"]) {
    const [license] = await f.issue({
      customerId: customer.id,
      expiresAt: f.time() + 1000,
    });
    assert.equal(
      (
        await f.request("POST", `/admin/licenses/${license.id}/status`, {
          status,
        })
      ).statusCode,
      200,
    );
  }
  await f.issue();
  const firstDevice = await f.client(lifetime.key, "customer-device-0001");
  assert.equal(firstDevice.statusCode, 200);
  assert.equal(
    (await f.client(lifetime.key, "customer-device-0002")).statusCode,
    200,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        `/admin/licenses/${lifetime.id}/devices/${firstDevice.json().activationId}`,
      )
    ).statusCode,
    200,
  );
  f.advance(2000);
  const response = await f.request("GET", `/admin/customers/${customer.id}`),
    profile = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(profile.licenses, 6);
  assert.deepEqual(profile.summary, {
    products: 2,
    active: 3,
    expired: 1,
    expiring: 1,
    suspended: 1,
    revoked: 1,
    latestLicenseAt: f.time() - 2000,
    devices: 1,
    lastSeenAt: f.time() - 2000,
  });
  assert.equal(profile.now, f.time());
  assert.equal(response.body.includes(lifetime.key), false);
  assert.equal(response.body.includes("key_hash"), false);
  assert.equal(
    (
      await f.request("PATCH", `/admin/licenses/${lifetime.id}`, {
        customerId: other.id,
      })
    ).statusCode,
    200,
  );
  const updated = (
    await f.request("GET", `/admin/customers/${customer.id}`)
  ).json();
  assert.equal(updated.licenses, 5);
  assert.equal(updated.summary.active, 2);
  assert.equal(updated.summary.devices, 0);
  const reassigned = (
    await f.request("GET", `/admin/customers/${other.id}`)
  ).json();
  assert.equal(reassigned.licenses, 1);
  assert.equal(reassigned.summary.devices, 1);
});

test("customer profiles require authentication and workspace scope while allowing viewer reads", async (t) => {
  const f = await fixture(t);
  const customer = (
    await f.request("POST", "/admin/customers", {
      name: "Customer",
      email: "customer@example.test",
      notes: "Visible to the workspace team",
    })
  ).json();
  const path = `/api/v1/admin/customers/${customer.id}`;
  assert.equal((await f.app.inject({ url: path })).statusCode, 401);
  const viewer = (
    await f.request("POST", "/admin/tokens", {
      name: "Read-only workspace",
      role: "viewer",
    })
  ).json();
  const headers = { authorization: `Bearer ${viewer.token}` };
  const read = await f.app.inject({ url: path, headers });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().notes, customer.notes);
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: path,
        headers,
        payload: { name: "Changed", email: "changed@example.test" },
      })
    ).statusCode,
    403,
  );
  const scoped = (
    await f.request("POST", "/admin/tokens", {
      name: "Product integration",
      role: "operator",
      productId: f.productId,
    })
  ).json();
  const denied = await f.app.inject({
    url: path,
    headers: { authorization: `Bearer ${scoped.token}` },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error.code, "SCOPE_DENIED");
  assert.equal(
    (
      await f.request(
        "GET",
        "/admin/customers/00000000-0000-4000-8000-000000000001",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.request("GET", "/admin/customers/not-a-customer")).statusCode,
    400,
  );
});

test("customer references are searchable literally and license filtering stays bound to the customer", async (t) => {
  const f = await fixture(t);
  const first = (
    await f.request("POST", "/admin/customers", {
      name: "First",
      email: "first@example.test",
      externalId: "invoice_100%\\complete",
    })
  ).json();
  const second = (
    await f.request("POST", "/admin/customers", {
      name: "Second",
      email: "second@example.test",
      externalId: "invoiceX100other",
    })
  ).json();
  for (const search of ["invoice_100%", "%", "\\complete"]) {
    const result = (
      await f.request(
        "GET",
        `/admin/customers?search=${encodeURIComponent(search)}`,
      )
    ).json();
    assert.equal(result.total, 1);
    assert.equal(result.items[0].id, first.id);
  }
  const page1 = (
    await f.request("GET", "/admin/customers?search=invoice&limit=1&page=1")
  ).json();
  const page2 = (
    await f.request("GET", "/admin/customers?search=invoice&limit=1&page=2")
  ).json();
  assert.equal(page1.total, 2);
  assert.equal(page2.total, 2);
  assert.notEqual(page1.items[0].id, page2.items[0].id);
  const licenses = await f.issue({ customerId: first.id, count: 2 });
  const [unrelated] = await f.issue({ customerId: second.id });
  const filtered = (
    await f.request(
      "GET",
      `/admin/licenses?customerId=${first.id}&limit=1&page=2`,
    )
  ).json();
  assert.equal(filtered.total, 2);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].customerId, first.id);
  const exported = await f.request(
    "GET",
    `/admin/licenses/export?customerId=${first.id}`,
  );
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.body.includes(unrelated.id), false);
  for (const license of licenses) {
    assert.equal(exported.body.includes(license.id), true);
    assert.equal(exported.body.includes(license.key), false);
  }
});

test("activation issues a pinned, device-bound lease and persists only hashed keys", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue();
  const response = await f.client(license.key);
  assert.equal(response.statusCode, 200, response.body);
  const claims = verifyLease(
    response.json().lease,
    f.app.store.identity.signing.publicKey,
    {
      productId: f.productId,
      fingerprint: "device-fingerprint-0001",
      issuer: origin,
      now: f.time(),
    },
  );
  assert.deepEqual(claims.entitlements, ["export", "pro"]);
  assert.equal(claims.sub, license.id);
  const row = f.app.store.get("SELECT * FROM licenses WHERE id=?", license.id);
  assert.equal(JSON.stringify(row).includes(license.key), false);
  const list = await f.request("GET", "/admin/licenses");
  assert.equal(list.body.includes(license.key), false);
  assert.equal(list.json().items[0].deviceCount, 1);
  assert.equal(
    (await f.request("GET", "/admin/audit")).body.includes(license.key),
    false,
  );
});

test("concurrent activation cannot oversubscribe the seat limit and retries are idempotent", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      f.client(license.key, `parallel-device-${String(i).padStart(4, "0")}`),
    ),
  );
  assert.equal(results.filter((x) => x.statusCode === 200).length, 1);
  assert.equal(
    results.filter((x) => x.json().error?.code === "DEVICE_LIMIT").length,
    11,
  );
  const index = results.findIndex((x) => x.statusCode === 200);
  const retry = await f.client(
    license.key,
    `parallel-device-${String(index).padStart(4, "0")}`,
  );
  assert.equal(retry.json().activationId, results[index].json().activationId);
});

test("first-use duration, expiry, renewal, suspension and permanent revocation", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue({ durationDays: 2 });
  assert.equal(license.expiresAt, null);
  f.advance(3600000);
  let response = await f.client(license.key);
  assert.equal(response.json().expiresAt, f.time() + 2 * 86400000);
  assert.equal(
    (
      await f.request("POST", `/admin/licenses/${license.id}/status`, {
        status: "suspended",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.client(license.key)).json().error.code,
    "LICENSE_SUSPENDED",
  );
  await f.request("POST", `/admin/licenses/${license.id}/status`, {
    status: "active",
  });
  f.advance(2 * 86400000);
  assert.equal(
    (await f.client(license.key)).json().error.code,
    "LICENSE_EXPIRED",
  );
  // Renew through a fresh owner session after the fixed session lifetime.
  const login = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@example.com", password },
  });
  f.headers.cookie = `keydock_session=${login.cookies[0].value}`;
  f.headers["x-keydock-csrf"] = login.json().csrf;
  response = await f.request("POST", `/admin/licenses/${license.id}/renew`, {
    days: 30,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await f.client(license.key)).statusCode, 200);
  await f.request("POST", `/admin/licenses/${license.id}/status`, {
    status: "revoked",
  });
  assert.equal(
    (await f.client(license.key)).json().error.code,
    "LICENSE_REVOKED",
  );
  assert.equal(
    (
      await f.request("POST", `/admin/licenses/${license.id}/status`, {
        status: "active",
      })
    ).statusCode,
    409,
  );
});

test("device release and key rotation take effect online", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue();
  const first = await f.client(license.key);
  assert.equal(
    (await f.client(license.key, "device-fingerprint-0002")).statusCode,
    403,
  );
  await f.request(
    "DELETE",
    `/admin/licenses/${license.id}/devices/${first.json().activationId}`,
  );
  assert.equal(
    (await f.client(license.key, "device-fingerprint-0001", "validate")).json()
      .error.code,
    "DEVICE_NOT_ACTIVATED",
  );
  const rotated = await f.request(
    "POST",
    `/admin/licenses/${license.id}/rotate`,
  );
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(rotated.json().key, license.key);
  assert.equal(
    (await f.client(license.key)).json().error.code,
    "INVALID_LICENSE",
  );
  assert.equal(
    (await f.client(rotated.json().key, "device-fingerprint-0002")).statusCode,
    200,
  );
});

test("offline verification rejects tampering, wrong binding and expired leases", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue(),
    response = await f.client(license.key);
  const token = response.json().lease,
    key = f.app.store.identity.signing.publicKey;
  const options = {
    productId: f.productId,
    fingerprint: "device-fingerprint-0001",
    issuer: origin,
    now: f.time(),
  };
  const [h, p, s] = token.split(".");
  assert.throws(() =>
    verifyLease(
      `${h}.${Buffer.from('{"exp":9999999999}').toString("base64url")}.${s}`,
      key,
      options,
    ),
  );
  assert.throws(() =>
    verifyLease(token, key, { ...options, productId: "other-product" }),
  );
  assert.throws(() =>
    verifyLease(token, key, { ...options, fingerprint: "different-device" }),
  );
  assert.throws(() =>
    verifyLease(token, key, { ...options, issuer: "https://attacker.example" }),
  );
  assert.throws(() =>
    verifyLease(token, key, { ...options, now: options.now + 3600000 }),
  );
  assert.throws(() =>
    verifyLease(
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${p}.${s}`,
      key,
      options,
    ),
  );
});

test("session CSRF, setup protection and secure response headers", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request(
        "POST",
        "/admin/products",
        { name: "Other", slug: "other" },
        { "x-keydock-csrf": "wrong" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/admin/products",
        { name: "Other", slug: "other" },
        { origin: "https://attacker.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/v1/admin/licenses" })).statusCode,
    401,
  );
  const again = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { origin },
    payload: {
      name: "Intruder",
      email: "intruder@example.com",
      password,
      setupToken: f.app.store.identity.setupToken,
    },
  });
  assert.equal(again.statusCode, 409);
  const response = await f.request("GET", "/admin/licenses");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(
    response.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
});

test("scoped tokens cannot read or mutate another product or access owner controls", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue();
  const second = await f.request("POST", "/admin/products", {
    name: "Other",
    slug: "other",
  });
  const otherLicense = (await f.issue({ productId: second.json().id }))[0];
  const created = await f.request("POST", "/admin/tokens", {
    name: "Integration",
    role: "operator",
    productId: f.productId,
  });
  const headers = { authorization: `Bearer ${created.json().token}` };
  const call = (method, url, payload) =>
    f.app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });
  assert.equal(
    (await call("GET", `/admin/licenses/${license.id}`)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", `/admin/licenses/${otherLicense.id}`)).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", `/admin/licenses/${otherLicense.id}/status`, {
        status: "revoked",
      })
    ).statusCode,
    403,
  );
  assert.equal((await call("GET", "/admin/licenses")).json().total, 1);
  assert.equal((await call("GET", "/admin/users")).statusCode, 403);
  assert.equal((await call("GET", "/admin/customers")).statusCode, 403);
  await f.request("DELETE", `/admin/tokens/${created.json().id}`);
  assert.equal((await call("GET", "/admin/licenses")).statusCode, 401);
});

test("idempotent batch issuance is atomic, conflict-aware and encrypted at rest", async (t) => {
  const f = await fixture(t),
    headers = { "idempotency-key": "order_0123456789abcdef" };
  const first = await f.issue({ count: 4 }, headers),
    retry = await f.issue({ count: 4 }, headers);
  assert.deepEqual(first, retry);
  assert.equal((await f.request("GET", "/admin/licenses")).json().total, 4);
  const cache = f.app.store.get("SELECT response FROM idempotency");
  for (const item of first)
    assert.equal(cache.response.includes(item.key), false);
  const conflict = await f.request(
    "POST",
    "/admin/licenses",
    { productId: f.productId, label: "Different" },
    headers,
  );
  assert.equal(conflict.statusCode, 409);
  const audit = await f.request("GET", "/admin/audit/verify");
  assert.equal(audit.json().valid, true);
});

test("validation does not allocate a device and disabled products deny access", async (t) => {
  const f = await fixture(t),
    [license] = await f.issue();
  assert.equal(
    (await f.client(license.key, "device-fingerprint-0001", "validate")).json()
      .error.code,
    "DEVICE_NOT_ACTIVATED",
  );
  await f.request("PUT", `/admin/products/${f.productId}`, {
    name: "Example Tool",
    slug: "example-tool",
    active: false,
  });
  assert.equal(
    (await f.client(license.key)).json().error.code,
    "PRODUCT_DISABLED",
  );
  assert.equal(f.app.store.get("SELECT COUNT(*) n FROM activations").n, 0);
});

test("read-only roles and hostile inputs are rejected; CSV formulas are escaped", async (t) => {
  const f = await fixture(t);
  await f.issue({ label: '=HYPERLINK("evil")' });
  const csv = await f.request("GET", "/admin/licenses/export");
  assert.match(csv.body, /'=HYPERLINK/);
  const token = await f.request("POST", "/admin/tokens", {
    name: "Read only",
    role: "viewer",
  });
  const response = await f.app.inject({
    method: "POST",
    url: "/api/v1/admin/licenses",
    headers: { authorization: `Bearer ${token.json().token}` },
    payload: { productId: f.productId, label: "Unauthorized" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(
    (
      await f.request("POST", "/admin/licenses", {
        productId: f.productId,
        label: "Bad",
        maxDevices: -1,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await f.request("GET", "/admin/licenses?search=%27%20OR%201%3D1--")).json()
      .total,
    0,
  );
  assert.equal(
    (await f.request("GET", "/admin/licenses?limit=1000000")).statusCode,
    400,
  );
});

test("password changes invalidate existing sessions and disabled users cannot log in", async (t) => {
  const f = await fixture(t);
  const user = await f.request("POST", "/admin/users", {
    name: "Viewer",
    email: "viewer@example.com",
    password,
    role: "viewer",
  });
  assert.equal(user.statusCode, 201, user.body);
  await f.request("PATCH", `/admin/users/${user.json().id}`, {
    disabled: true,
  });
  const login = await f.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "viewer@example.com", password },
  });
  assert.equal(login.statusCode, 401);
  const change = await f.request("POST", "/auth/password", {
    currentPassword: password,
    newPassword: "Changed-long-password-523!",
  });
  assert.equal(change.statusCode, 200);
  assert.equal((await f.request("GET", "/admin/licenses")).statusCode, 401);
});

test("duplicate identifiers return conflicts and rejected issuance leaves no partial batch", async (t) => {
  const f = await fixture(t);
  const duplicate = await f.request("POST", "/admin/products", {
    name: "Duplicate",
    slug: "example-tool",
  });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  const bad = await f.request("POST", "/admin/licenses", {
    productId: f.productId,
    label: "Bad",
    count: 3,
    customerId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(bad.statusCode, 404);
  assert.equal((await f.request("GET", "/admin/licenses")).json().total, 0);
});
