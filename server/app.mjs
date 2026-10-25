import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openStore, verifyAudit } from "./database.mjs";
import { authentication, userView } from "./auth.mjs";
import { licensing, productView, customerView } from "./licensing.mjs";
import { ApiError, fail } from "./errors.mjs";
import { digest, secret, publicJwk, seal, unseal } from "./crypto.mjs";
import * as schema from "./schemas.mjs";

const idParam = z.object({ id: z.uuid() });
const csv = (value) =>
  `"${String(value ?? "")
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""')}"`;
const tokenView = (row) => ({
  id: row.id,
  hint: row.hint,
  name: row.name,
  role: row.role,
  productId: row.product_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
});

export async function createApp({
  directory = resolve("data"),
  origin = "http://127.0.0.1:3400",
  clock,
  logger = false,
  serveUi = true,
} = {}) {
  const parsedOrigin = new URL(origin);
  if (
    origin !== parsedOrigin.origin ||
    !["http:", "https:"].includes(parsedOrigin.protocol)
  )
    throw new Error(
      "KEYDOCK_ORIGIN must be an HTTP(S) origin without a trailing slash or path",
    );
  if (
    parsedOrigin.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(parsedOrigin.hostname)
  )
    throw new Error("Public Keydock instances require an HTTPS origin");
  const store = openStore(directory, clock),
    api = licensing(store, origin);
  const app = Fastify({
    logger: logger
      ? {
          level: "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (req) => ({
              method: req.method,
              path: req.url?.split("?")[0],
            }),
          },
        }
      : false,
    bodyLimit: 64 * 1024,
    requestTimeout: 15000,
    connectionTimeout: 10000,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
  });
  app.decorate("store", store);
  app.decorate("licensing", api);
  app.decorateRequest("actor", null);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: parsedOrigin.protocol === "https:" ? [] : null,
      },
    },
    hsts: parsedOrigin.protocol === "https:",
  });
  await app.register(rateLimit, { max: 300, timeWindow: 60000, cache: 10000 });
  const auth = await authentication(store, origin);
  const read = { preHandler: auth.guard() },
    write = { preHandler: auth.guard(["owner", "operator"]) },
    owner = { preHandler: auth.guard(["owner"]) };
  const globalScope = (actor) => {
    if (actor.productId)
      fail(
        403,
        "SCOPE_DENIED",
        "This action requires a workspace-wide credential",
      );
  };
  const transaction = (fn) => store.transaction(fn);
  const id = (request) => idParam.parse(request.params).id;
  const listQuery = (request) => schema.pagination.parse(request.query);

  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "INVALID_INPUT",
          message: "Check the submitted fields",
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
          requestId: request.id,
        },
      });
    if (error instanceof ApiError)
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    if (
      ["SQLITE_ERROR", "ERR_SQLITE_ERROR"].includes(error.code) &&
      /UNIQUE constraint failed/.test(error.message)
    )
      return reply.code(409).send({
        error: {
          code: "ALREADY_EXISTS",
          message: "A record with this unique value already exists",
          requestId: request.id,
        },
      });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        error: {
          code: error.statusCode === 429 ? "RATE_LIMITED" : "BAD_REQUEST",
          message:
            error.statusCode === 429
              ? "Too many requests. Try again later."
              : "Request could not be processed",
          requestId: request.id,
        },
      });
    request.log.error(
      {
        requestId: request.id,
        code: error.code ?? "UNEXPECTED",
        type: error.name,
      },
      "Request failed",
    );
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Request failed. Use the request ID to investigate.",
        requestId: request.id,
      },
    });
  });

  app.get("/health", async () => {
    store.get("SELECT 1");
    return { status: "ok", version: "0.1.0" };
  });
  app.get("/api/v1/meta", async () => ({
    name: "Keydock",
    version: "0.1.0",
    setupRequired: !store.get("SELECT id FROM users LIMIT 1"),
    issuer: origin,
    publicKey: store.identity.signing.publicKey,
    signingKeyId: store.identity.signing.kid,
  }));
  app.get("/.well-known/jwks.json", async () => ({
    keys: [publicJwk(store.identity)],
  }));
  app.post("/api/v1/auth/setup", async (req, reply) =>
    auth.bootstrap(schema.setup.parse(req.body), req, reply),
  );
  app.post("/api/v1/auth/login", async (req, reply) =>
    auth.login(schema.credentials.parse(req.body), req, reply),
  );
  app.get("/api/v1/auth/session", read, async (req) => {
    if (req.actor.kind !== "session")
      fail(400, "SESSION_REQUIRED", "Use a browser session");
    return {
      user: userView(req.actor.user),
      csrf: req.actor.user.csrf,
      expiresAt: req.actor.user.expires_at,
    };
  });
  app.post("/api/v1/auth/logout", read, async (req, reply) =>
    auth.logout(req, reply),
  );
  app.post("/api/v1/auth/password", read, async (req) =>
    auth.changePassword(schema.passwordInput.parse(req.body), req.actor),
  );

  app.get("/api/v1/admin/overview", read, async (req) =>
    api.overview(req.actor),
  );
  app.get("/api/v1/admin/products", read, async (req) => ({
    items: store
      .all(
        `SELECT p.*,(SELECT COUNT(*) FROM licenses l WHERE l.product_id=p.id) licenses FROM products p${req.actor.productId ? " WHERE p.id=?" : ""} ORDER BY p.created_at DESC`,
        ...(req.actor.productId ? [req.actor.productId] : []),
      )
      .map(productView),
  }));
  app.post("/api/v1/admin/products", write, async (req, reply) => {
    globalScope(req.actor);
    const input = schema.productInput.parse(req.body);
    const result = transaction(() => {
      const productId = randomUUID();
      store.run(
        "INSERT INTO products(id,name,slug,description,lease_seconds,active,created_at) VALUES(?,?,?,?,?,?,?)",
        productId,
        input.name,
        input.slug,
        input.description,
        input.leaseSeconds,
        +input.active,
        store.clock(),
      );
      store.audit("product.created", req.actor.id, productId, {
        name: input.name,
        productId,
      });
      return productView(
        store.get("SELECT * FROM products WHERE id=?", productId),
      );
    });
    return reply.code(201).send(result);
  });
  app.put("/api/v1/admin/products/:id", write, async (req) => {
    const productId = id(req);
    api.scope(req.actor, productId);
    const input = schema.productInput.parse(req.body);
    return transaction(() => {
      if (!store.get("SELECT id FROM products WHERE id=?", productId))
        fail(404, "NOT_FOUND", "Product not found");
      store.run(
        "UPDATE products SET name=?,slug=?,description=?,lease_seconds=?,active=? WHERE id=?",
        input.name,
        input.slug,
        input.description,
        input.leaseSeconds,
        +input.active,
        productId,
      );
      store.audit("product.updated", req.actor.id, productId, {
        productId,
        active: input.active,
      });
      return productView(
        store.get("SELECT * FROM products WHERE id=?", productId),
      );
    });
  });
  app.get("/api/v1/admin/customers", read, async (req) => {
    globalScope(req.actor);
    const query = listQuery(req),
      search = `%${query.search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
    const filter = " WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'";
    const items = store
      .all(
        `SELECT c.*,(SELECT COUNT(*) FROM licenses l WHERE l.customer_id=c.id) licenses FROM customers c${filter} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        search,
        search,
        query.limit,
        (query.page - 1) * query.limit,
      )
      .map(customerView);
    return {
      items,
      total: Number(
        store.get(`SELECT COUNT(*) n FROM customers${filter}`, search, search)
          .n,
      ),
      page: query.page,
      limit: query.limit,
    };
  });
  app.post("/api/v1/admin/customers", write, async (req, reply) => {
    globalScope(req.actor);
    const input = schema.customerInput.parse(req.body);
    return reply.code(201).send(
      transaction(() => {
        const customerId = randomUUID();
        store.run(
          "INSERT INTO customers(id,name,email,external_id,notes,created_at) VALUES(?,?,?,?,?,?)",
          customerId,
          input.name,
          input.email,
          input.externalId,
          input.notes,
          store.clock(),
        );
        store.audit("customer.created", req.actor.id, customerId);
        return customerView(
          store.get("SELECT * FROM customers WHERE id=?", customerId),
        );
      }),
    );
  });
  app.put("/api/v1/admin/customers/:id", write, async (req) => {
    globalScope(req.actor);
    const customerId = id(req),
      input = schema.customerInput.parse(req.body);
    return transaction(() => {
      if (!store.get("SELECT id FROM customers WHERE id=?", customerId))
        fail(404, "NOT_FOUND", "Customer not found");
      store.run(
        "UPDATE customers SET name=?,email=?,external_id=?,notes=? WHERE id=?",
        input.name,
        input.email,
        input.externalId,
        input.notes,
        customerId,
      );
      store.audit("customer.updated", req.actor.id, customerId);
      return customerView(
        store.get("SELECT * FROM customers WHERE id=?", customerId),
      );
    });
  });
  app.get("/api/v1/admin/licenses", read, async (req) =>
    api.list(listQuery(req), req.actor),
  );
  app.get("/api/v1/admin/licenses/export", read, async (req, reply) => {
    const query = listQuery(req),
      pages = [];
    let page = 1;
    do {
      const result = api.list({ ...query, page, limit: 100 }, req.actor);
      pages.push(...result.items);
      if (pages.length >= result.total) break;
      page++;
    } while (pages.length < 10000);
    const header = [
      "ID",
      "Label",
      "Key hint",
      "Product",
      "Customer",
      "Status",
      "Devices",
      "Device limit",
      "Expiry",
      "Entitlements",
    ];
    const rows = pages.map((l) => [
      l.id,
      l.label,
      l.keyHint,
      l.productName,
      l.customerName,
      l.status,
      l.deviceCount,
      l.maxDevices,
      l.expiresAt ? new Date(l.expiresAt).toISOString() : "",
      l.entitlements.join(";"),
    ]);
    reply
      .header(
        "Content-Disposition",
        'attachment; filename="keydock-licenses.csv"',
      )
      .type("text/csv; charset=utf-8");
    return [header, ...rows].map((row) => row.map(csv).join(",")).join("\r\n");
  });
  app.get("/api/v1/admin/licenses/:id", read, async (req) =>
    api.get(id(req), req.actor),
  );
  app.post("/api/v1/admin/licenses", write, async (req, reply) => {
    const input = schema.licenseInput.parse(req.body),
      rawIdempotency = req.headers["idempotency-key"];
    if (
      rawIdempotency !== undefined &&
      (typeof rawIdempotency !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(rawIdempotency))
    )
      fail(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "Use 16–128 letters, numbers, hyphens or underscores",
      );
    const cacheKey = rawIdempotency
      ? digest(`${req.actor.id}:${rawIdempotency}`, store.identity.pepper)
      : null;
    const requestHash = digest(JSON.stringify(input), store.identity.pepper);
    const result = transaction(() => {
      if (cacheKey) {
        const previous = store.get(
          "SELECT * FROM idempotency WHERE key=? AND expires_at>?",
          cacheKey,
          store.clock(),
        );
        if (previous) {
          if (previous.request_hash !== requestHash)
            fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "That idempotency key was used for a different request",
            );
          return unseal(previous.response, store.identity.pepper, cacheKey);
        }
      }
      const response = api.issue(input, req.actor);
      if (cacheKey)
        store.run(
          "INSERT OR REPLACE INTO idempotency(key,request_hash,response,expires_at) VALUES(?,?,?,?)",
          cacheKey,
          requestHash,
          seal(response, store.identity.pepper, cacheKey),
          store.clock() + 86400000,
        );
      return response;
    });
    return reply.code(201).send(result);
  });
  app.patch("/api/v1/admin/licenses/:id", write, async (req) =>
    transaction(() =>
      api.edit(id(req), schema.licenseEdit.parse(req.body), req.actor),
    ),
  );
  app.post("/api/v1/admin/licenses/:id/status", write, async (req) =>
    transaction(() =>
      api.setStatus(
        id(req),
        schema.statusInput.parse(req.body).status,
        req.actor,
      ),
    ),
  );
  app.post("/api/v1/admin/licenses/:id/renew", write, async (req) =>
    transaction(() =>
      api.renew(id(req), schema.renewInput.parse(req.body).days, req.actor),
    ),
  );
  app.post("/api/v1/admin/licenses/:id/rotate", write, async (req) =>
    transaction(() => api.rotate(id(req), req.actor)),
  );
  app.delete(
    "/api/v1/admin/licenses/:id/devices/:deviceId",
    write,
    async (req) => {
      const params = z
        .object({ id: z.uuid(), deviceId: z.uuid() })
        .parse(req.params);
      return transaction(() =>
        api.release(params.id, params.deviceId, req.actor),
      );
    },
  );

  for (const operation of ["activate", "validate", "deactivate"])
    app.post(
      `/api/v1/client/${operation}`,
      { config: { rateLimit: { max: 120, timeWindow: 60000 } } },
      async (req) => {
        const input = schema.clientInput.parse(req.body);
        auth.rateLimit(`client:${input.key.trim().toUpperCase()}`, 180, 60000);
        try {
          const result = transaction(() => api.client(input, operation));
          api.countValidation(
            input.productId,
            operation === "deactivate" ? "released" : "valid",
          );
          return result;
        } catch (error) {
          // Only retain aggregates for real products; random IDs cannot grow telemetry forever.
          if (store.get("SELECT id FROM products WHERE id=?", input.productId))
            api.countValidation(input.productId, "denied");
          throw error;
        }
      },
    );

  app.get("/api/v1/admin/tokens", owner, async () => ({
    items: store
      .all("SELECT * FROM api_tokens ORDER BY created_at DESC")
      .map(tokenView),
  }));
  app.post("/api/v1/admin/tokens", owner, async (req, reply) => {
    const input = schema.tokenInput.parse(req.body);
    return reply.code(201).send(
      transaction(() => {
        if (
          input.productId &&
          !store.get("SELECT id FROM products WHERE id=?", input.productId)
        )
          fail(404, "NOT_FOUND", "Product not found");
        const tokenId = randomUUID(),
          token = `kd_api_${secret()}`;
        store.run(
          "INSERT INTO api_tokens(id,hash,hint,name,role,product_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
          tokenId,
          digest(token, store.identity.pepper),
          `${token.slice(0, 11)}…${token.slice(-4)}`,
          input.name,
          input.role,
          input.productId,
          store.clock(),
          store.clock() + input.days * 86400000,
        );
        store.audit("token.created", req.actor.id, tokenId, {
          role: input.role,
          productId: input.productId,
        });
        return {
          ...tokenView(
            store.get("SELECT * FROM api_tokens WHERE id=?", tokenId),
          ),
          token,
        };
      }),
    );
  });
  app.delete("/api/v1/admin/tokens/:id", owner, async (req) =>
    transaction(() => {
      const tokenId = id(req);
      if (!store.get("SELECT id FROM api_tokens WHERE id=?", tokenId))
        fail(404, "NOT_FOUND", "Token not found");
      store.run(
        "UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
        store.clock(),
        tokenId,
      );
      store.audit("token.revoked", req.actor.id, tokenId);
      return { revoked: true };
    }),
  );
  app.get("/api/v1/admin/users", owner, async () => ({
    items: store.all("SELECT * FROM users ORDER BY created_at").map(userView),
  }));
  app.post("/api/v1/admin/users", owner, async (req, reply) =>
    reply
      .code(201)
      .send(await auth.addUser(schema.userInput.parse(req.body), req.actor)),
  );
  app.patch("/api/v1/admin/users/:id", owner, async (req) =>
    transaction(() => {
      const userId = id(req),
        input = schema.userEdit.parse(req.body),
        user = store.get("SELECT * FROM users WHERE id=?", userId);
      if (!user) fail(404, "NOT_FOUND", "User not found");
      if (user.role === "owner")
        fail(
          409,
          "OWNER_PROTECTED",
          "The instance owner cannot be disabled or demoted",
        );
      store.run(
        "UPDATE users SET role=?,disabled=? WHERE id=?",
        input.role ?? user.role,
        input.disabled === undefined ? user.disabled : +input.disabled,
        userId,
      );
      store.run("DELETE FROM sessions WHERE user_id=?", userId);
      store.audit("user.updated", req.actor.id, userId, input);
      return userView(store.get("SELECT * FROM users WHERE id=?", userId));
    }),
  );
  app.get("/api/v1/admin/audit", read, async (req) => {
    const query = listQuery(req),
      params = [],
      clauses = [];
    if (req.actor.productId) {
      clauses.push(
        "(target=? OR target IN (SELECT id FROM licenses WHERE product_id=?))",
      );
      params.push(req.actor.productId, req.actor.productId);
    }
    if (query.search) {
      clauses.push("(action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\')");
      const term = `%${query.search.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      params.push(term, term);
    }
    const filter = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    return {
      items: store
        .all(
          `SELECT * FROM audit${filter} ORDER BY seq DESC LIMIT ? OFFSET ?`,
          ...params,
          query.limit,
          (query.page - 1) * query.limit,
        )
        .map((row) => ({
          seq: row.seq,
          id: row.id,
          action: row.action,
          actor: row.actor,
          target: row.target,
          detail: JSON.parse(row.detail),
          createdAt: row.created_at,
          hash: row.hash,
        })),
      total: Number(
        store.get(`SELECT COUNT(*) n FROM audit${filter}`, ...params).n,
      ),
      page: query.page,
      limit: query.limit,
    };
  });
  app.get("/api/v1/admin/audit/verify", owner, async () =>
    verifyAudit(store.db, store.identity),
  );

  const webRoot = fileURLToPath(new URL("../dist", import.meta.url));
  if (serveUi && existsSync(resolve(webRoot, "index.html"))) {
    await app.register(staticFiles, {
      root: webRoot,
      prefix: "/",
      index: "index.html",
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === "GET" &&
        !req.url.startsWith("/api/") &&
        !req.url.startsWith("/.well-known/") &&
        !req.url.includes(".")
      )
        return reply.type("text/html").sendFile("index.html");
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
          requestId: req.id,
        },
      });
    });
  }
  const cleanup = setInterval(() => {
    try {
      const now = store.clock();
      transaction(() => {
        store.run("DELETE FROM sessions WHERE expires_at<=?", now);
        store.run("DELETE FROM rate_limits WHERE reset_at<=?", now);
        store.run("DELETE FROM idempotency WHERE expires_at<=?", now);
      });
    } catch {
      app.log.error("Scheduled cleanup failed");
    }
  }, 60000).unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    store.close();
  });
  return app;
}
