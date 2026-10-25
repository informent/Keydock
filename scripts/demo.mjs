import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { secret } from "../server/crypto.mjs";
import { removeTemporaryDirectory } from "../server/backup.mjs";

async function seed(app, origin) {
  const email = "owner@example.test",
    password = secret(24);
  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { origin },
    payload: {
      name: "Demo Owner",
      email,
      password,
      setupToken: app.store.identity.setupToken,
    },
  });
  if (setup.statusCode !== 200)
    throw new Error("Unable to initialize the demo owner");
  const headers = {
    origin,
    cookie: `keydock_session=${setup.cookies[0].value}`,
    "x-keydock-csrf": setup.json().csrf,
  };
  async function request(method, url, payload) {
    const response = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload ? { payload } : {}),
    });
    if (response.statusCode >= 400)
      throw new Error(
        `Unable to populate demo: ${response.json().error?.code ?? response.statusCode}`,
      );
    return response.json();
  }
  const studio = await request("POST", "/admin/products", {
    name: "Atlas Studio",
    slug: "atlas-studio",
    description: "Creative tools for independent makers.",
  });
  const cli = await request("POST", "/admin/products", {
    name: "Signal CLI",
    slug: "signal-cli",
    description: "Automation for small development teams.",
  });
  const customers = [];
  for (const [name, email] of [
    ["Morgan Lee", "morgan@example.test"],
    ["Northwind Studio", "team@example.test"],
    ["River Chen", "river@example.test"],
  ])
    customers.push(
      await request("POST", "/admin/customers", {
        name,
        email,
        notes: "Illustrative demo customer",
      }),
    );
  const examples = [
    {
      label: "Studio Pro",
      productId: studio.id,
      customerId: customers[0].id,
      maxDevices: 2,
      durationDays: 365,
    },
    {
      label: "Northwind team",
      productId: studio.id,
      customerId: customers[1].id,
      maxDevices: 5,
      durationDays: 365,
    },
    {
      label: "Creator lifetime",
      productId: studio.id,
      customerId: customers[2].id,
      maxDevices: 1,
    },
    {
      label: "14-day evaluation",
      productId: cli.id,
      maxDevices: 1,
      durationDays: 14,
    },
    {
      label: "Partner subscription",
      productId: cli.id,
      maxDevices: 3,
      durationDays: 90,
    },
    { label: "Retired integration", productId: cli.id, maxDevices: 1 },
  ];
  const licenses = [];
  for (const example of examples) {
    const { items } = await request("POST", "/admin/licenses", {
      ...example,
      entitlements: ["pro", "export"],
      notes: "Disposable demo license",
    });
    licenses.push({ ...example, id: items[0].id, key: items[0].key });
  }
  for (const [index, name] of [
    [0, "Morgan's workstation"],
    [1, "Northwind build agent"],
  ]) {
    const fingerprint = `keydock-demo-installation-${index}`;
    await request("POST", "/client/activate", {
      productId: licenses[index].productId,
      key: licenses[index].key,
      fingerprint,
      name,
    });
    licenses[index].fingerprint = fingerprint;
  }
  await request("POST", `/admin/licenses/${licenses[4].id}/status`, {
    status: "suspended",
  });
  await request("POST", `/admin/licenses/${licenses[5].id}/status`, {
    status: "revoked",
  });
  await request("POST", "/auth/logout");
  return { origin, email, password, licenses };
}

// No production environment settings are read. Every invocation owns a new,
// disposable directory and listens only on the IPv4 loopback interface.
export async function createDemo({
  port = 3401,
  listen = true,
  serveUi = true,
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Demo port must be between 1 and 65535");
  if (serveUi && !existsSync(new URL("../dist/index.html", import.meta.url)))
    throw new Error("Run npm run build before starting the demo");
  const parent = await realpath(tmpdir()),
    directory = await mkdtemp(join(parent, "keydock-demo-"));
  const origin = `http://127.0.0.1:${port}`;
  let app, closing;
  const close = () =>
    (closing ??= (async () => {
      await app?.close();
      await removeTemporaryDirectory(directory, parent);
    })());
  try {
    app = await createApp({ directory, origin, serveUi });
    const credentials = await seed(app, origin);
    const credentialsPath = join(directory, "demo-credentials.json");
    await writeFile(
      credentialsPath,
      `${JSON.stringify(credentials, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    if (listen) await app.listen({ port, host: "127.0.0.1" });
    return { app, origin, directory, credentialsPath, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "Usage: npm run demo -- [--port 3401]\nStarts a disposable local workspace. Read the private credentials file to sign in.\nCtrl+C stops the server and removes its temporary data.",
    );
    return;
  }
  let demo,
    stopping = false;
  const shutdown = async () => {
    stopping = true;
    try {
      await demo?.close();
    } catch {
      console.error(
        "Could not remove the temporary demo directory; remove it after the process stops.",
      );
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    demo = await createDemo({ port: Number(values.port ?? 3401) });
    if (stopping) {
      await demo.close();
      return;
    }
    console.log(
      `Keydock demo: ${demo.origin}\nPrivate sign-in details and sample keys: ${demo.credentialsPath}\nDisposable data; Ctrl+C stops the demo and removes it.`,
    );
  } catch (error) {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    throw error;
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Keydock demo: ${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
