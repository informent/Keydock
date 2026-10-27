import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createDemo } from "./demo.mjs";

const demo = await createDemo({
  port: Number(process.env.KEYDOCK_CUSTOMERS_PORT ?? 3419),
});
let browser;
try {
  const credentials = JSON.parse(await readFile(demo.credentialsPath, "utf8"));
  const session = await demo.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: demo.origin },
    payload: { email: credentials.email, password: credentials.password },
  });
  assert.equal(session.statusCode, 200);
  const headers = {
    origin: demo.origin,
    cookie: `keydock_session=${session.cookies[0].value}`,
    "x-keydock-csrf": session.json().csrf,
  };
  const request = async (method, path, payload) => {
    const response = await demo.app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      ...(payload ? { payload } : {}),
    });
    assert.ok(
      response.statusCode < 400,
      `${method} ${path}: ${response.statusCode}`,
    );
    return response.json();
  };
  const customers = (await request("GET", "/admin/customers")).items;
  const morgan = customers.find((customer) => customer.name === "Morgan Lee");
  const products = (await request("GET", "/admin/products")).items;
  const studio = products.find((product) => product.name === "Atlas Studio"),
    cli = products.find((product) => product.name === "Signal CLI");
  await request("PUT", `/admin/customers/${morgan.id}`, {
    name: morgan.name,
    email: morgan.email,
    externalId: "ACCT-1042",
    notes:
      "Design team account.\nAnnual review in November. Contact Morgan before changing device limits.",
  });
  for (const input of [
    { productId: cli.id, label: "CLI release", maxDevices: 3 },
    {
      productId: studio.id,
      label: "Annual support",
      maxDevices: 2,
      expiresAt: Date.now() + 3 * 86400000,
    },
    { productId: studio.id, label: "Legacy team", maxDevices: 5 },
  ]) {
    const issued = await request("POST", "/admin/licenses", {
      ...input,
      customerId: morgan.id,
      entitlements: ["pro", "export"],
    });
    if (input.label === "Legacy team")
      await request("POST", `/admin/licenses/${issued.items[0].id}/status`, {
        status: "suspended",
      });
  }
  const empty = await request("POST", "/admin/customers", {
    name: "Casey Jordan",
    email: "casey@example.test",
  });
  const edge =
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" && existsSync(edge)
      ? { executablePath: edge }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (
      entry.type() === "error" &&
      !entry.text().includes("401 (Unauthorized)")
    )
      errors.push(entry.text());
  });
  const profileUrl = `${demo.origin}/#/customers/${morgan.id}`;
  async function settled() {
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".content .loading")).toHaveCount(0);
  }
  async function noOverflow(label) {
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${label} must not overflow the viewport`,
    );
  }
  async function theme(name) {
    if ((await page.locator("html").getAttribute("data-theme")) !== name)
      await page
        .getByRole("button", { name: `Switch to ${name} theme`, exact: true })
        .click();
  }
  async function screenshot(name) {
    await page
      .locator(".toast-region")
      .evaluate((region) => region.querySelector("button")?.click());
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      );
      window.scrollTo(0, 0);
    });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      height: document.documentElement.scrollHeight,
    }));
    const capture = await page.screenshot({
      path: resolve("docs/images", name),
      fullPage: true,
    });
    assert.equal(capture.readUInt32BE(16), dimensions.width);
    assert.ok(
      capture.readUInt32BE(20) >= dimensions.height,
      `${name}: screenshot must include the complete page`,
    );
  }
  async function login(target, email, password) {
    await target.getByLabel("Email address", { exact: true }).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(password);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const metric = (label) =>
    page
      .locator(".customer-metrics > div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");
  await mkdir(resolve("docs/images"), { recursive: true });
  await page.goto(profileUrl);
  await login(page, credentials.email, credentials.password);
  await page
    .getByRole("heading", { name: "Morgan Lee", exact: true })
    .waitFor();
  await settled();
  await expect(metric("Assigned licenses")).toHaveText("4");
  await expect(metric("Active")).toHaveText("3of 4");
  await expect(metric("Registered devices")).toHaveText("1");
  await expect(metric("Expiring in 7 days")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: "View Northwind team", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".customer-record-fields")).toContainText([
    "ACCT-1042",
    "Last license issued",
  ]);
  await screenshot("customer-workspace.png");
  await page
    .getByRole("button", { name: "Copy profile link", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(profileUrl);
  await page.reload();
  await settled();
  await expect(
    page.getByRole("heading", { name: "Morgan Lee", exact: true }),
  ).toBeVisible();
  console.log(
    "PASS: customer deep links, real license/device/expiry totals, copied links and customer isolation",
  );

  await page
    .getByRole("combobox", { name: "Customer license status", exact: true })
    .selectOption("suspended");
  await settled();
  await expect(
    page.getByRole("button", { name: "View Legacy team", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Studio Pro", exact: true }),
  ).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exported = await readFile(await (await downloadEvent).path(), "utf8");
  assert.ok(exported.includes("Legacy team"));
  assert.equal(exported.includes("Northwind team"), false);
  assert.equal(exported.includes("Studio Pro"), false);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await settled();
  await page
    .getByRole("button", { name: "View CLI release", exact: true })
    .click();
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await page
    .getByRole("button", { name: "Suspend license", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByRole("dialog").getByText("Suspended", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(metric("Active")).toHaveText("2of 4");
  await page
    .getByRole("button", { name: "Edit customer", exact: true })
    .click();
  await page
    .getByLabel("Private notes", { exact: true })
    .fill("Priority support.\nDevice limit reviewed with the customer.");
  await page
    .getByRole("button", { name: "Save customer", exact: true })
    .click();
  await expect(page.locator(".customer-notes")).toContainText(
    "Device limit reviewed",
  );
  console.log(
    "PASS: scoped filters/export, lifecycle changes refresh customer totals, and editable team notes",
  );

  await page
    .getByRole("button", { name: "Issue license", exact: true })
    .click();
  const assigned = page.getByLabel("Assign customer", { exact: true });
  await expect(assigned).toHaveValue(morgan.id);
  await expect(
    page.getByRole("complementary", { name: "Issuance summary", exact: true }),
  ).toContainText("Morgan Lee");
  await page.getByLabel("License label", { exact: true }).fill("Support seat");
  const issuedEvent = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/admin/licenses",
  );
  await page
    .getByRole("button", { name: "Generate license keys", exact: true })
    .click();
  const issued = await issuedEvent;
  assert.equal(issued.status(), 201);
  const license = (await issued.json()).items[0];
  assert.equal(license.customerId, morgan.id);
  await page.getByLabel("I have saved these keys securely.").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(metric("Assigned licenses")).toHaveText("5");
  assert.equal(
    (await page.locator("body").innerText()).includes(license.key),
    false,
  );
  await page.goto(`${demo.origin}/#/customers/${empty.id}`);
  await settled();
  await expect(
    page.getByText("No licenses assigned", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search workspace commands", exact: true })
    .fill("ACCT-1042");
  await page.getByRole("option", { name: /Morgan Lee/ }).waitFor();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(profileUrl);
  await settled();
  console.log(
    "PASS: customer-assigned issuance, one-time keys, empty state and reference search from the command palette",
  );

  for (const appearance of ["light", "dark"]) {
    await theme(appearance);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(`${appearance} ${width}px customer profile`);
      if (appearance === "dark" && width === 1440)
        await screenshot("customer-workspace-dark.png");
      if (appearance === "light" && width === 390)
        await screenshot("customer-workspace-mobile.png");
      await page
        .getByRole("link", { name: "All customers", exact: true })
        .click();
      await settled();
      await noOverflow(`${appearance} ${width}px customer list`);
      if (appearance === "light" && width === 1440)
        await screenshot("customers.png");
      if (appearance === "light" && width === 390)
        await screenshot("customers-mobile.png");
      await page
        .getByRole("link", { name: "View Morgan Lee", exact: true })
        .click();
      await settled();
    }
  }
  await request("POST", "/admin/users", {
    name: "Customer Viewer",
    email: "customer-viewer@example.test",
    password: "Customer-viewer-test-passphrase!",
    role: "viewer",
  });
  const viewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const viewer = await viewerContext.newPage();
  viewer.on("pageerror", (error) => errors.push(error.message));
  await viewer.goto(profileUrl);
  await login(
    viewer,
    "customer-viewer@example.test",
    "Customer-viewer-test-passphrase!",
  );
  await viewer
    .getByRole("heading", { name: "Morgan Lee", exact: true })
    .waitFor();
  await expect(
    viewer.getByRole("button", { name: "Issue license", exact: true }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("button", { name: "Edit customer", exact: true }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("button", { name: "View Support seat", exact: true }),
  ).toBeVisible();
  await viewerContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: customer list/profile in both themes at 320–1440px, viewer permissions and clean browser/CSP logs",
  );
} finally {
  await browser?.close();
  await demo.close();
}
await assert.rejects(stat(demo.directory), { code: "ENOENT" });
