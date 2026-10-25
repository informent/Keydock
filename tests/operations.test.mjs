import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  removeTemporaryDirectory,
} from "../server/backup.mjs";
import {
  createIdentity,
  validateIdentity,
  verifyLease,
} from "../server/crypto.mjs";
import { openStore, RESTORE_MARKER } from "../server/database.mjs";
import { createDemo } from "../scripts/demo.mjs";
import { main as backupCommand } from "../scripts/backup.mjs";

const origin = "http://127.0.0.1:3400",
  password = "A-private-recovery-test-password!";

async function fixture(t) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, "keydock-operations-"));
  const directory = join(root, "data"),
    output = join(root, "backups"),
    apps = [];
  t.after(async () => {
    for (const app of apps.reverse()) await app.close();
    await removeTemporaryDirectory(root, parent);
  });
  const app = await createApp({ directory, origin, serveUi: false });
  apps.push(app);
  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { origin },
    payload: {
      name: "Recovery owner",
      email: "owner@example.test",
      password,
      setupToken: app.store.identity.setupToken,
    },
  });
  assert.equal(setup.statusCode, 200);
  const headers = {
    origin,
    cookie: `keydock_session=${setup.cookies[0].value}`,
    "x-keydock-csrf": setup.json().csrf,
  };
  const call = (method, url, payload, target = app) =>
    target.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload ? { payload } : {}),
    });
  const product = (
    await call("POST", "/admin/products", {
      name: "Recovery Tool",
      slug: "recovery-tool",
    })
  ).json();
  const issued = (
    await call("POST", "/admin/licenses", {
      productId: product.id,
      label: "Original license",
      entitlements: ["pro"],
    })
  ).json().items[0];
  const client = {
    productId: product.id,
    key: issued.key,
    fingerprint: "recovery-test-installation",
  };
  assert.equal(
    (await call("POST", "/client/activate", client)).statusCode,
    200,
  );
  return {
    root,
    directory,
    output,
    app,
    apps,
    call,
    client,
    issued,
    backup: () => createBackup({ directory, output, origin }),
  };
}

test("online backup captures committed WAL data and restores working credentials and pinned leases", async (t) => {
  const f = await fixture(t);
  assert.ok((await stat(join(f.directory, "keydock.sqlite-wal"))).size > 0);
  const result = await f.backup();
  assert.deepEqual((await readdir(result.directory)).sort(), [
    "identity.json",
    "keydock.sqlite",
    "manifest.json",
  ]);
  const verified = await verifyBackup(result.directory);
  assert.ok(verified.manifest.audit.checked > 0);
  // A later live change must not leak into the completed snapshot.
  await f.call("POST", `/admin/licenses/${f.issued.id}/status`, {
    status: "revoked",
  });
  const restored = await restoreBackup({
    backupDirectory: result.directory,
    destination: join(f.root, "restored"),
  });
  const app = await createApp({
    directory: restored.directory,
    origin: restored.origin,
    serveUi: false,
  });
  f.apps.push(app);
  assert.equal((await app.inject("/health")).statusCode, 200);
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@example.test", password },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(
    (await f.call("GET", "/auth/session", undefined, app)).statusCode,
    200,
  );
  const response = await f.call("POST", "/client/validate", f.client, app);
  assert.equal(response.statusCode, 200);
  const claims = verifyLease(
    response.json().lease,
    f.app.store.identity.signing.publicKey,
    {
      productId: f.client.productId,
      fingerprint: f.client.fingerprint,
      issuer: origin,
    },
  );
  assert.equal(claims.sub, f.issued.id);
  assert.deepEqual(claims.entitlements, ["pro"]);
  assert.equal(
    (await f.call("GET", "/admin/audit/verify", undefined, app)).json().valid,
    true,
  );
  assert.equal(
    (await f.call("POST", "/client/validate", f.client)).statusCode,
    403,
  );
  assert.deepEqual((await readdir(f.root)).sort(), [
    "backups",
    "data",
    "restored",
  ]);
});

test("restore refuses existing directories and links without changing any existing data", async (t) => {
  const f = await fixture(t),
    result = await f.backup(),
    occupied = join(f.root, "occupied"),
    empty = join(f.root, "empty");
  await mkdir(occupied);
  await mkdir(empty);
  await writeFile(join(occupied, "keep.txt"), "preserve me");
  for (const destination of [f.directory, occupied, empty])
    await assert.rejects(
      restoreBackup({ backupDirectory: result.directory, destination }),
      /already exists/,
    );
  const link = join(f.root, "linked-target");
  await symlink(
    occupied,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    restoreBackup({ backupDirectory: result.directory, destination: link }),
    /already exists/,
  );
  assert.equal(
    await readFile(join(occupied, "keep.txt"), "utf8"),
    "preserve me",
  );
  assert.equal(
    (await f.call("POST", "/client/validate", f.client)).statusCode,
    200,
  );
  assert.equal(
    (await readdir(f.root)).some((entry) =>
      entry.startsWith(".keydock-restore-"),
    ),
    false,
  );
});

test("checksums reject changed identity or database bytes before a restore directory is created", async (t) => {
  const f = await fixture(t),
    result = await f.backup();
  for (const name of ["identity.json", "keydock.sqlite"]) {
    const path = join(result.directory, name),
      original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from("modified")]));
    await assert.rejects(
      restoreBackup({
        backupDirectory: result.directory,
        destination: join(f.root, "refused"),
      }),
      /checksum mismatch/,
    );
    await assert.rejects(stat(join(f.root, "refused")), { code: "ENOENT" });
    await writeFile(path, original);
  }
  await verifyBackup(result.directory);
});

test("matching checksums cannot hide broken SQLite integrity, foreign keys, or audit records", async (t) => {
  const f = await fixture(t),
    result = await f.backup();
  const dbPath = join(result.directory, "keydock.sqlite"),
    original = await readFile(dbPath);
  const manifestPath = join(result.directory, "manifest.json"),
    manifest = result.manifest;
  for (const sql of [
    "UPDATE audit SET action='changed' WHERE seq=1",
    "PRAGMA foreign_keys=OFF; UPDATE licenses SET product_id='missing-product'",
    "PRAGMA user_version=99",
  ]) {
    await writeFile(dbPath, original);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
    const bytes = await readFile(dbPath);
    manifest.files["keydock.sqlite"] = {
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBackup(result.directory),
      /audit verification|integrity check|Unsupported backup database schema/,
    );
  }
});

test("backup refuses a mismatched identity and removes an incomplete output", async (t) => {
  const f = await fixture(t);
  const bytes = await readFile(join(f.directory, "identity.json"));
  await writeFile(
    join(f.directory, "identity.json"),
    JSON.stringify(createIdentity()),
  );
  await assert.rejects(f.backup(), /audit verification/);
  assert.deepEqual(await readdir(f.output), []);
  await writeFile(join(f.directory, "identity.json"), bytes);
  await f.backup();
});

test("backup never initializes a missing instance or writes inside the live data directory", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    createBackup({
      directory: join(f.root, "missing"),
      output: f.output,
      origin,
    }),
    { code: "ENOENT" },
  );
  await assert.rejects(stat(join(f.root, "missing")), { code: "ENOENT" });
  await assert.rejects(
    createBackup({
      directory: f.directory,
      output: join(f.directory, "nested"),
      origin,
    }),
    /outside the data directory/,
  );
  await assert.rejects(stat(join(f.directory, "nested")), { code: "ENOENT" });
  const alias = join(f.root, "data-alias");
  await symlink(
    f.directory,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    createBackup({
      directory: f.directory,
      output: join(alias, "nested"),
      origin,
    }),
    /outside the data directory/,
  );
});

test("manifest structure, audit checkpoint and unexpected sidecars are validated", async (t) => {
  const f = await fixture(t),
    result = await f.backup(),
    path = join(result.directory, "manifest.json");
  for (const change of [
    { version: 99 },
    { origin: "http://public.example" },
    { files: { "../identity.json": result.manifest.files["identity.json"] } },
    { audit: { ...result.manifest.audit, head: "a".repeat(64) } },
  ]) {
    await writeFile(path, JSON.stringify({ ...result.manifest, ...change }));
    await assert.rejects(verifyBackup(result.directory), /manifest/);
  }
  await writeFile(path, JSON.stringify(result.manifest));
  await writeFile(
    join(result.directory, "keydock.sqlite-wal"),
    "unexpected sidecar",
  );
  await assert.rejects(verifyBackup(result.directory), /exactly/);
});

test("identity validation rejects inconsistent signing keys before opening the database", async (t) => {
  const f = await fixture(t),
    identity = createIdentity();
  identity.signing.privateKey = createIdentity().signing.privateKey;
  assert.throws(() => validateIdentity(identity), /Invalid identity file/);
  await writeFile(join(f.directory, "identity.json"), JSON.stringify(identity));
  assert.throws(() => openStore(f.directory), /Invalid identity file/);
});

test("an interrupted restore cannot silently start as a new empty instance", async (t) => {
  const f = await fixture(t),
    partial = join(f.root, "interrupted-restore");
  await mkdir(partial);
  await writeFile(join(partial, RESTORE_MARKER), "in progress");
  await writeFile(
    join(partial, "identity.json"),
    await readFile(join(f.directory, "identity.json")),
  );
  assert.throws(() => openStore(partial), /Incomplete restore/);
  await assert.rejects(stat(join(partial, "keydock.sqlite")), {
    code: "ENOENT",
  });
});

test("backup CLI validates arguments, creates and verifies a backup, and restores without logging secrets", async (t) => {
  const f = await fixture(t),
    messages = [];
  t.mock.method(console, "log", (message) => messages.push(message));
  await backupCommand([
    "create",
    "--data-dir",
    f.directory,
    "--output",
    f.output,
    "--origin",
    origin,
  ]);
  const result = JSON.parse(messages.at(-1));
  await backupCommand(["verify", result.backup]);
  assert.equal(JSON.parse(messages.at(-1)).valid, true);
  await backupCommand([
    "restore",
    result.backup,
    "--to",
    join(f.root, "cli-restored"),
  ]);
  assert.equal(JSON.parse(messages.at(-1)).origin, origin);
  await assert.rejects(backupCommand(["restore", result.backup]), /--to/);
  await assert.rejects(
    backupCommand(["create", "--unexpected"]),
    /Unknown option/,
  );
  await assert.rejects(
    backupCommand(["verify", result.backup, "extra"]),
    /exactly one/,
  );
  for (const value of [
    f.app.store.identity.pepper,
    f.app.store.identity.setupToken,
    f.app.store.identity.signing.privateKey,
    f.client.key,
    password,
  ])
    assert.equal(messages.join("\n").includes(value), false);
});

test("demo seeds real workflows in isolated temporary data and cleans up without touching production settings", async (t) => {
  const parent = await realpath(tmpdir()),
    production = await mkdtemp(join(parent, "keydock-production-sentinel-"));
  t.after(() => removeTemporaryDirectory(production, parent));
  await writeFile(join(production, "keep.txt"), "untouched");
  const previous = Object.fromEntries(
    ["HOST", "PORT", "KEYDOCK_ORIGIN", "KEYDOCK_DATA_DIR"].map((name) => [
      name,
      process.env[name],
    ]),
  );
  Object.assign(process.env, {
    HOST: "0.0.0.0",
    PORT: "9999",
    KEYDOCK_ORIGIN: "https://production.example",
    KEYDOCK_DATA_DIR: production,
  });
  let demo;
  try {
    demo = await createDemo({ listen: false, serveUi: false });
    assert.equal(demo.origin, "http://127.0.0.1:3401");
    assert.notEqual(demo.directory, production);
    const credentials = JSON.parse(await readFile(demo.credentialsPath));
    const login = await demo.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: demo.origin },
      payload: { email: credentials.email, password: credentials.password },
    });
    assert.equal(login.statusCode, 200);
    const headers = { cookie: `keydock_session=${login.cookies[0].value}` };
    const licenses = await demo.app.inject({
      url: "/api/v1/admin/licenses",
      headers,
    });
    assert.equal(licenses.json().total, 6);
    assert.deepEqual(
      new Set(licenses.json().items.map((item) => item.status)),
      new Set(["active", "suspended", "revoked"]),
    );
    const example = credentials.licenses[0];
    const activated = await demo.app.inject({
      method: "POST",
      url: "/api/v1/client/validate",
      payload: {
        productId: example.productId,
        key: example.key,
        fingerprint: example.fingerprint,
      },
    });
    assert.equal(activated.statusCode, 200);
    assert.equal(
      await readFile(join(production, "keep.txt"), "utf8"),
      "untouched",
    );
    assert.deepEqual(await readdir(production), ["keep.txt"]);
    const directory = demo.directory;
    await demo.close();
    await demo.close();
    await assert.rejects(stat(directory), { code: "ENOENT" });
  } finally {
    await demo?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
