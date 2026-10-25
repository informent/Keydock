import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createApp } from "../server/app.mjs";

const directory = await mkdtemp(join(tmpdir(), "keydock-browser-"));
const port = Number(process.env.KEYDOCK_TEST_PORT ?? 3417),
  origin = `http://127.0.0.1:${port}`;
const app = await createApp({ directory, origin });
let browser;
try {
  await app.listen({ port, host: "127.0.0.1" });
  const edge =
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" && existsSync(edge)
      ? { executablePath: edge }
      : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (
      entry.type() === "error" &&
      !entry.text().includes("401 (Unauthorized)")
    )
      errors.push(entry.text());
  });
  await page.goto(origin);
  await page.getByLabel("Your name", { exact: true }).fill("Alex Morgan");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("A-long-private-demo-password-2026!");
  await page
    .getByLabel("Setup token", { exact: true })
    .fill(app.store.identity.setupToken);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await page
    .getByRole("button", { name: "Create product", exact: true })
    .first()
    .click();
  await page.getByLabel("Product name", { exact: true }).fill("Atlas Studio");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Creative tools for independent makers.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Atlas Studio", exact: true })
    .waitFor();
  console.log("PASS: bootstrap, owner session, and product creation");
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Morgan Lee");
  await page.getByLabel("Email", { exact: true }).fill("morgan@example.com");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add customer", exact: true })
    .click();
  await page.getByText("Morgan Lee", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Licenses", exact: true }).click();
  await page
    .getByRole("button", { name: "Issue license", exact: true })
    .click();
  await page
    .getByLabel("License label", { exact: true })
    .fill("Atlas Pro · Morgan");
  await page
    .getByLabel("Assign customer", { exact: true })
    .selectOption({ label: "Morgan Lee · morgan@example.com" });
  await page.getByLabel("Entitlements", { exact: true }).fill("pro, export");
  await page
    .getByRole("button", { name: "Generate license keys", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "1 license key is ready", exact: true })
    .waitFor();
  const key = await page.locator(".secret-value").textContent();
  assert.match(key, /^KD-/);
  await page.getByLabel("I have saved these keys securely.").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Atlas Pro · Morgan", exact: false })
    .first()
    .waitFor();
  assert.equal((await page.locator("body").innerText()).includes(key), false);
  console.log(
    "PASS: customer assignment, license issuance, and one-time secret delivery",
  );
  const product = app.store.get("SELECT id FROM products LIMIT 1");
  const activated = await app.inject({
    method: "POST",
    url: "/api/v1/client/activate",
    payload: {
      productId: product.id,
      key,
      fingerprint: "browser-smoke-installation",
      name: "Morgan’s workstation",
    },
  });
  assert.equal(activated.statusCode, 200, activated.body);
  await page
    .getByRole("button", { name: "Refresh licenses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Atlas Pro · Morgan", exact: true })
    .click();
  await page.getByRole("button", { name: "Devices", exact: false }).click();
  await page.getByText("Morgan’s workstation", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page
    .getByRole("button", { name: "Release device", exact: true })
    .click();
  await page.getByText("Released", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const validate = await app.inject({
    method: "POST",
    url: "/api/v1/client/validate",
    payload: {
      productId: product.id,
      key,
      fingerprint: "browser-smoke-installation",
    },
  });
  assert.equal(validate.json().error.code, "DEVICE_NOT_ACTIVATED");
  console.log(
    "PASS: live device activation, console release, and immediate online denial",
  );
  // Add illustrative records through the real service for the README screenshot.
  const actor = {
    id: app.store.get("SELECT id FROM users LIMIT 1").id,
    role: "owner",
    productId: null,
  };
  for (const [label, count, days, entitlements] of [
    ["Studio team", 3, 365, ["pro", "teams"]],
    ["Evaluation · Northwind", 1, 14, ["pro"]],
    ["Creator lifetime", 2, null, ["pro", "export"]],
    ["Atlas Enterprise", 10, 365, ["pro", "teams", "api"]],
    ["Partner license", 5, 90, ["pro"]],
  ]) {
    app.store.transaction(() =>
      app.licensing.issue(
        {
          productId: product.id,
          label,
          maxDevices: count,
          customerId: null,
          expiresAt: days ? Date.now() + days * 86400000 : null,
          durationDays: null,
          entitlements,
          notes: "Demo record",
          count: 1,
        },
        actor,
      ),
    );
  }
  await page
    .getByRole("button", { name: "Refresh licenses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Partner license", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click()
    .catch(() => {});
  await mkdir(resolve("docs/images"), { recursive: true });
  await page.screenshot({
    path: resolve("docs/images/licenses.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Developers", exact: true }).click();
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await page
    .getByText("from keydock import KeydockClient", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  await page
    .getByLabel("Token name", { exact: true })
    .fill("Order integration");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create token", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your API token is ready", exact: true })
    .waitFor();
  await page.getByLabel("I have saved this token securely.").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  console.log(
    "PASS: SDK documentation, scoped token creation, and secret handling",
  );
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page
    .getByRole("button", { name: "Verify integrity", exact: true })
    .click();
  await page.getByText(/Integrity verified for/).waitFor();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Team access", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Licenses", exact: true }).click();
  await page.getByRole("heading", { name: "Licenses", exact: true }).waitFor();
  await page.screenshot({
    path: resolve("docs/images/mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    wide: [...document.querySelectorAll("body *")]
      .filter(
        (el) =>
          el.getBoundingClientRect().right > window.innerWidth + 1 &&
          getComputedStyle(el).position !== "fixed",
      )
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        width: el.getBoundingClientRect().width,
      }))
      .slice(0, 15),
  }));
  assert.equal(
    overflow.scroll <= overflow.width,
    true,
    `Mobile viewport must not overflow horizontally: ${JSON.stringify(overflow)}`,
  );
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Welcome back", exact: true })
    .waitFor();
  assert.deepEqual(errors, [], "Browser must have no runtime or CSP errors");
  console.log(
    "PASS: audit integrity, settings, mobile navigation, and sign-out",
  );
} finally {
  await browser?.close();
  await app.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
    throw new Error("Refusing cleanup outside temp directory");
  await rm(directory, { recursive: true, force: true });
}
