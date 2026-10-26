import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createDemo } from "./demo.mjs";

const demo = await createDemo({
  port: Number(process.env.KEYDOCK_EXPERIENCE_PORT ?? 3418),
});
const images = resolve("docs/images");
let browser;
try {
  await mkdir(images, { recursive: true });
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
    colorScheme: "light",
    reducedMotion: "reduce",
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
  const credentials = JSON.parse(await readFile(demo.credentialsPath, "utf8"));
  const routes = [
    "Overview",
    "Licenses",
    "Products",
    "Customers",
    "Activity",
    "Developers",
    "Settings",
  ];
  async function settled() {
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".content .loading")).toHaveCount(0);
  }
  async function go(name, mobile = false) {
    if (mobile)
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page.getByRole("link", { name, exact: true }).click();
    await settled();
  }
  async function screenshot(name, fullPage = true) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(images, name), fullPage });
  }
  async function noOverflow(label) {
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      viewport.scroll <= viewport.width,
      `${label}: horizontal overflow ${JSON.stringify(viewport)}`,
    );
  }
  async function theme(name) {
    if ((await page.locator("html").getAttribute("data-theme")) !== name)
      await page
        .getByRole("button", { name: `Switch to ${name} theme`, exact: true })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", name);
  }
  async function checkContrast(appearance) {
    const pairs = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        ["ink", "surface"],
        ["secondary", "surface"],
        ["muted", "surface"],
        ["muted", "canvas"],
        ["muted", "accent-soft"],
        ["accent", "accent-soft"],
        ["on-accent", "accent"],
        ["danger", "danger-soft"],
        ["amber", "amber-soft"],
        ["blue", "blue-soft"],
        ["purple", "purple-soft"],
      ].map(([text, background]) => ({
        label: `${text} on ${background}`,
        colors: [text, background].map((name) =>
          style.getPropertyValue(`--${name}`).trim(),
        ),
      }));
    });
    const luminance = (hex) => {
      assert.match(hex, /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i);
      const digits = hex.slice(1);
      const full =
        digits.length === 3
          ? [...digits].map((value) => value + value).join("")
          : digits;
      const channels = full
        .match(/../g)
        .map((value) => parseInt(value, 16) / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const pair of pairs) {
      const [a, b] = pair.colors.map(luminance);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(
        ratio >= 4.5,
        `${appearance}: ${pair.label} contrast is ${ratio.toFixed(2)}:1`,
      );
    }
  }

  await page.goto(demo.origin);
  await page
    .getByRole("heading", { name: "Welcome back", exact: true })
    .waitFor();
  await screenshot("sign-in.png");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await settled();
  const density = page.getByRole("button", {
    name: "Compact tables",
    exact: true,
  });
  await expect(density).toHaveAttribute("aria-pressed", "true");
  const firstRow = page.locator(".license-table tbody tr").first();
  const compactHeight = await firstRow.evaluate(
    (row) => row.getBoundingClientRect().height,
  );
  await density.click();
  assert.ok(
    (await firstRow.evaluate((row) => row.getBoundingClientRect().height)) >
      compactHeight,
    "Comfortable tables should provide more vertical space",
  );
  await page.reload();
  await settled();
  await expect(density).toHaveAttribute("aria-pressed", "false");
  await density.click();
  for (const width of [1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(`desktop overview at ${width}`);
    assert.equal(
      await page
        .locator(".stat")
        .evaluateAll(
          (items) =>
            new Set(
              items.map((item) => Math.round(item.getBoundingClientRect().top)),
            ).size,
        ),
      1,
      "Desktop overview metrics should stay in one row",
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(
    "PASS: desktop density, preference persistence, laptop and wide-screen layout",
  );
  await screenshot("overview.png");
  await page
    .getByRole("combobox", { name: "Request period", exact: true })
    .selectOption("7");
  const chart = page.getByRole("group", { name: /License requests chart/ });
  await expect(chart).toHaveAttribute("aria-label", /in 7 days/);
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".request-readout")).toContainText(
    "0 valid · 0 denied",
  );
  await page
    .getByRole("combobox", { name: "Request period", exact: true })
    .selectOption("14");
  console.log(
    "PASS: populated overview, real request history, period switching and keyboard chart exploration",
  );

  await page.keyboard.press("Control+k");
  let palette = page.getByRole("dialog", {
    name: "Search workspace",
    exact: true,
  });
  await expect(palette).toBeVisible();
  await page
    .getByRole("combobox", { name: "Search workspace commands", exact: true })
    .fill("Studio Pro");
  await expect(
    palette.getByRole("option", { name: /Studio Pro/ }),
  ).toBeVisible();
  // Hold a real search request to prove previous results cannot be activated.
  let releaseSearch;
  const searchGate = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const searchRoute = "**/api/v1/admin/licenses?**";
  const holdSearch = async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("search") === "northwind"
    )
      await searchGate;
    await route.continue();
  };
  await page.route(searchRoute, holdSearch);
  try {
    const requested = page.waitForRequest(
      (request) =>
        new URL(request.url()).searchParams.get("search") === "northwind",
    );
    await page
      .getByRole("combobox", { name: "Search workspace commands", exact: true })
      .fill("Northwind");
    await requested;
    await expect(
      palette.getByRole("option", { name: /Studio Pro/ }),
    ).toHaveCount(0);
    await expect(
      palette.getByRole("option", { name: /Northwind team/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(palette).toBeVisible();
  } finally {
    releaseSearch();
  }
  await expect(
    palette.getByRole("option", { name: /Northwind team/ }),
  ).toBeVisible();
  await page.unroute(searchRoute, holdSearch);
  await page
    .getByRole("combobox", { name: "Search workspace commands", exact: true })
    .fill("Studio Pro");
  await expect(
    palette.getByRole("option", { name: /Studio Pro/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await page.getByRole("dialog").waitFor();
  await expect(page.getByRole("dialog")).toContainText("Studio Pro");
  await expect(page.getByRole("dialog")).toHaveCSS("animation-name", "none");
  await screenshot("license-detail.png", false);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await screenshot("command-search.png", false);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Search workspace", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search workspace commands", exact: true })
    .fill("products");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/products$/);
  await settled();
  const beforeSkip = page.url();
  await page
    .getByRole("link", { name: "Skip to content", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  assert.equal(
    page.url(),
    beforeSkip,
    "Skip link must not change the application route",
  );
  await expect(page.locator("#main-content")).toBeFocused();
  console.log(
    "PASS: command search, license navigation, keyboard selection, focus restoration and skip link",
  );

  await go("Licenses");
  await page
    .getByRole("combobox", { name: "Filter by status", exact: true })
    .selectOption("suspended");
  await settled();
  await expect(
    page.getByRole("button", {
      name: "View Partner subscription",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Studio Pro", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "All licenses", exact: false }),
  ).toContainText("6");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await settled();
  await expect(
    page.getByRole("button", { name: "View Studio Pro", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "Search licenses or customers…",
      exact: true,
    })
    .fill("Northwind");
  await settled();
  await expect(
    page.getByRole("button", { name: "View Northwind team", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Studio Pro", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await settled();
  await screenshot("licenses.png");

  await theme("dark");
  await page.reload();
  await settled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await screenshot("dark.png");
  for (const appearance of ["dark", "light"]) {
    await theme(appearance);
    await checkContrast(appearance);
    for (const route of routes) {
      await go(route);
      await noOverflow(`${appearance} desktop ${route}`);
    }
  }
  console.log(
    "PASS: filtered license workspace, reset controls, persistent themes and every desktop route",
  );

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await go(route, width <= 900);
      await noOverflow(`${width}px ${route}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await go("Licenses", true);
  await screenshot("mobile.png");
  await expect(page.locator(".license-table tr").nth(1)).toHaveCSS(
    "display",
    "grid",
  );
  await page
    .getByRole("button", { name: "View Studio Pro", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Studio Pro");
  await noOverflow("mobile license detail");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(page.locator(".main-shell")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeFocused();
  await theme("dark");
  for (const route of routes) {
    await go(route, true);
    await noOverflow(`dark mobile ${route}`);
  }
  await go("Overview", true);
  await screenshot("mobile-dark.png");
  console.log(
    "PASS: all routes at 320/390/768/1024px, mobile license cards, detail dialog and accessible navigation",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await theme("light");
  await go("Licenses");
  await page
    .getByRole("button", { name: "Issue license", exact: true })
    .click();
  const issuance = page.getByRole("dialog", {
    name: "Issue a license",
    exact: true,
  });
  const preview = issuance.getByRole("complementary", {
    name: "Issuance summary",
    exact: true,
  });
  await page
    .getByLabel("Product", { exact: true })
    .selectOption({ label: "Atlas Studio" });
  await page
    .getByLabel("License label", { exact: true })
    .fill("Studio launch batch");
  await page.getByLabel("Device limit", { exact: true }).fill("5");
  await page.getByLabel("Number of keys", { exact: true }).fill("101");
  await expect(preview).toContainText("Choose valid key and device counts");
  await page
    .getByRole("button", { name: "Generate license keys", exact: true })
    .click();
  await expect(issuance).toBeVisible();
  await page.getByLabel("Number of keys", { exact: true }).fill("2");
  await expect(preview).toContainText("10 device slots");
  await page.getByLabel("Validity", { exact: true }).selectOption("fixed");
  await expect(preview).toContainText("Choose an expiry date");
  await page
    .getByLabel("Expires at (your local time)", { exact: true })
    .fill(`${new Date().getFullYear() + 1}-11-15T13:30`);
  await expect(preview).toContainText(String(new Date().getFullYear() + 1));
  await page.getByLabel("Validity", { exact: true }).selectOption("activation");
  await page
    .getByLabel("Days after first activation", { exact: true })
    .fill("30");
  await expect(preview).toContainText("30 days from first activation");
  await page
    .getByLabel("Assign customer", { exact: true })
    .selectOption({ label: "Morgan Lee · morgan@example.test" });
  const customerId = await page
    .getByLabel("Assign customer", { exact: true })
    .inputValue();
  await page
    .getByLabel("Find customer (optional)", { exact: true })
    .fill("River");
  await settled();
  await expect(page.getByLabel("Assign customer", { exact: true })).toHaveValue(
    customerId,
  );
  await expect(preview).toContainText("Morgan Lee");
  await page.getByLabel("Entitlements", { exact: true }).fill("pro, export");
  await expect(preview.locator("code")).toHaveText(["pro", "export"]);
  await issuance.evaluate((dialog) => {
    dialog.scrollTop = 0;
  });
  await screenshot("issue-license.png", false);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(`${width}px issuance`);
    assert.ok(
      await issuance.evaluate(
        (dialog) => dialog.scrollWidth <= dialog.clientWidth,
      ),
      `${width}px issuance must fit inside its dialog`,
    );
    await preview.scrollIntoViewIfNeeded();
    await expect(
      preview.getByRole("heading", { name: "Issuance summary", exact: true }),
    ).toBeInViewport();
  }
  const issuedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/admin/licenses",
  );
  let releaseIssuance;
  const issuanceGate = new Promise((resolve) => {
    releaseIssuance = resolve;
  });
  const issuanceRoute = "**/api/v1/admin/licenses";
  const holdIssuance = async (route) => {
    if (route.request().method() === "POST") await issuanceGate;
    await route.continue();
  };
  await page.route(issuanceRoute, holdIssuance);
  try {
    const requested = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/admin/licenses",
    );
    await page
      .getByRole("button", { name: "Generate license keys", exact: true })
      .click();
    await requested;
    await expect(
      issuance.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(issuance).toBeVisible();
  } finally {
    releaseIssuance();
  }
  const issued = await issuedResponse;
  await page.unroute(issuanceRoute, holdIssuance);
  assert.equal(issued.status(), 201);
  const batch = (await issued.json()).items;
  assert.equal(batch.length, 2);
  for (const license of batch) {
    assert.equal(license.maxDevices, 5);
    assert.equal(license.durationDays, 30);
    assert.equal(license.expiresAt, null);
    assert.equal(license.customerId, customerId);
    assert.deepEqual(license.entitlements, ["pro", "export"]);
  }
  await page
    .getByRole("heading", { name: "2 license keys are ready", exact: true })
    .waitFor();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search workspace", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("I have saved these keys securely.").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const rendered = await page.locator("body").innerText();
  for (const license of batch)
    assert.equal(rendered.includes(license.key), false);
  console.log(
    "PASS: live issuance summary, preserved customer selection, mobile batch creation and one-time key delivery",
  );

  // Create a read-only account through the real admin API; its palette must not
  // advertise write actions, and an unknown search must not invent results.
  const login = await demo.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: demo.origin },
    payload: { email: credentials.email, password: credentials.password },
  });
  assert.equal(login.statusCode, 200);
  const viewerPassword = "A-private-ui-viewer-password-2026!";
  const created = await demo.app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: {
      origin: demo.origin,
      cookie: `keydock_session=${login.cookies[0].value}`,
      "x-keydock-csrf": login.json().csrf,
    },
    payload: {
      name: "Demo Viewer",
      email: "viewer@example.test",
      password: viewerPassword,
      role: "viewer",
    },
  });
  assert.equal(created.statusCode, 201);
  const viewerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const viewer = await viewerContext.newPage();
  viewer.on("pageerror", (error) => errors.push(error.message));
  await viewer.goto(demo.origin);
  await viewer
    .getByLabel("Email address", { exact: true })
    .fill("viewer@example.test");
  await viewer.getByLabel("Password", { exact: true }).fill(viewerPassword);
  await viewer.getByRole("button", { name: "Sign in", exact: true }).click();
  await viewer
    .getByRole("heading", { name: "Overview", exact: true })
    .waitFor();
  await viewer.keyboard.press("Control+k");
  await viewer
    .getByRole("combobox", { name: "Search workspace commands", exact: true })
    .fill("issue license");
  await expect(
    viewer.getByRole("option", { name: /Issue license/ }),
  ).toHaveCount(0);
  await expect(
    viewer.getByText("No matches found", { exact: true }),
  ).toBeVisible();
  await viewer.keyboard.press("Escape");
  await expect(
    viewer.getByRole("button", { name: "Issue license", exact: true }),
  ).toHaveCount(0);
  await viewerContext.close();
  assert.deepEqual(errors, [], "No runtime or CSP errors are allowed");
  console.log(
    "PASS: viewer permissions, empty command results, reduced motion and no browser/CSP errors",
  );
} finally {
  await browser?.close();
  await demo.close();
}
await assert.rejects(stat(demo.directory), { code: "ENOENT" });
