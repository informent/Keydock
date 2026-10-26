import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  Code2,
  Download,
  KeyRound,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  api,
  date,
  dateTime,
  download,
  message,
  number,
  useDebouncedValue,
  useLoad,
} from "./api";
import {
  Badge,
  Confirm,
  CopyButton,
  Empty,
  ErrorBox,
  Field,
  Form,
  LicenseTable,
  Loading,
  Modal,
  PageTitle,
  Pagination,
  SearchInput,
  Stats,
} from "./components";
import type {
  ApiToken,
  Audit,
  Customer,
  License,
  Meta,
  Notify,
  Overview,
  Page,
  Product,
  User,
} from "./types";

import { RequestActivity } from "./RequestActivity";

const value = (data: FormData, key: string) => String(data.get(key) ?? "");
export function OverviewPage({
  userName,
  revision,
  onIssue,
  onProduct,
  onSelect,
  canWrite,
}: {
  userName: string;
  revision: number;
  onIssue: () => void;
  onProduct: () => void;
  onSelect: (license: License) => void;
  canWrite: boolean;
}) {
  const overview = useLoad<Overview>("/admin/overview", revision),
    recent = useLoad<Page<License>>("/admin/licenses?limit=5", revision);
  const data = overview.data;
  const steps = [
    {
      title: data?.products ? "Manage products" : "Create your first product",
      text: "Configure applications and their license settings.",
      complete: !!data?.products,
      action: data?.products
        ? () => {
            location.hash = "/products";
          }
        : onProduct,
    },
    {
      title: "Issue a license key",
      text: "Choose devices, features, and validity.",
      complete: !!data?.licenses,
      action: onIssue,
    },
    {
      title: "Integration guide",
      text: "API tokens, client SDKs, and activation examples.",
      complete: !!data?.devices,
      action: () => {
        location.hash = "/developers";
      },
    },
  ];
  return (
    <>
      <PageTitle
        eyebrow="YOUR LICENSING WORKSPACE"
        title="Overview"
        text={`Welcome back, ${userName.split(/\s+/)[0]}. Review licenses, devices, and recent requests.`}
        actions={
          canWrite ? (
            <button className="button primary" onClick={onIssue}>
              <Plus size={17} />
              Issue license
            </button>
          ) : undefined
        }
      />
      <ErrorBox error={overview.error} />
      <Stats data={data} />
      <div className="overview-grid">
        <RequestActivity data={data} />
        <section className="panel setup-card">
          <div className="section-heading">
            <div>
              <h2>
                {steps.every((s) => s.complete)
                  ? "Workspace shortcuts"
                  : "Get started"}
              </h2>
              <p>Products, keys, and application access.</p>
            </div>
            <Box size={21} />
          </div>
          {steps.map((step, index) => (
            <button
              key={step.title}
              className="setup-step"
              onClick={step.action}
              disabled={
                !canWrite && (index === 1 || (index === 0 && !data?.products))
              }
            >
              <span
                className={`step-number ${step.complete ? "complete" : ""}`}
              >
                {step.complete ? <Check size={15} /> : index + 1}
              </span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          <div className="setup-footer">
            <ShieldCheck size={16} />
            Licenses are managed on your instance.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Recently issued</h2>
            <p>The latest additions to your workspace.</p>
          </div>
          <a className="text-link" href="#/licenses">
            All licenses
            <ArrowRight size={15} />
          </a>
        </div>
        <ErrorBox error={recent.error} />
        {recent.loading ? (
          <Loading />
        ) : recent.data?.items.length ? (
          <LicenseTable items={recent.data.items} onSelect={onSelect} />
        ) : (
          <Empty
            title="No licenses issued"
            text="Your licenses will appear here as you issue them."
          />
        )}
      </section>
    </>
  );
}

export function ProductsPage({
  products,
  canWrite,
  onCreate,
  onEdit,
}: {
  products: Product[];
  canWrite: boolean;
  onCreate: () => void;
  onEdit: (product: Product) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="CATALOG"
        title="Products"
        text="Manage the applications you license."
        actions={
          canWrite ? (
            <button className="button primary" onClick={onCreate}>
              <Plus size={17} />
              Create product
            </button>
          ) : undefined
        }
      />
      {products.length ? (
        <div className="product-grid">
          {products.map((product, index) => (
            <section className="panel product-card" key={product.id}>
              <div className="product-card-top">
                <div className={`product-icon tone-${index % 4}`}>
                  <Box size={25} />
                </div>
                <Badge status={product.active ? "active" : "disabled"} />
              </div>
              <h2>{product.name}</h2>
              <p>{product.description || "No description added yet."}</p>
              <code className="product-slug">{product.slug}</code>
              <div className="product-metrics">
                <div>
                  <strong>{number(product.licenses)}</strong>
                  <span>licenses</span>
                </div>
                <div>
                  <strong>
                    {product.leaseSeconds < 3600
                      ? `${product.leaseSeconds / 60}m`
                      : `${product.leaseSeconds / 3600}h`}
                  </strong>
                  <span>offline lease</span>
                </div>
              </div>
              <div className="product-card-footer">
                <span>Created {date(product.createdAt)}</span>
                <button className="text-link" onClick={() => onEdit(product)}>
                  {canWrite ? "Manage" : "View"}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon={<Box size={28} />}
            title="What are you building?"
            text="Create a product to start issuing licenses for your application."
            action={
              canWrite ? (
                <button className="button primary" onClick={onCreate}>
                  <Plus size={16} />
                  Create product
                </button>
              ) : undefined
            }
          />
        </section>
      )}
    </>
  );
}
export function ProductForm({
  product,
  canWrite,
  onClose,
  onSaved,
}: {
  product?: Product;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? ""),
    [slug, setSlug] = useState(product?.slug ?? ""),
    [slugEdited, setSlugEdited] = useState(!!product);
  return (
    <Modal
      title={product ? "Product settings" : "Create a product"}
      description="Each product has its own keys and offline lease policy."
      onClose={onClose}
    >
      <Form
        readOnly={!canWrite}
        submit={product ? "Save product" : "Create product"}
        onClose={onClose}
        onSubmit={async (data) => {
          await api(
            product ? `/admin/products/${product.id}` : "/admin/products",
            {
              method: product ? "PUT" : "POST",
              body: {
                name,
                slug,
                description: value(data, "description"),
                leaseSeconds: Number(data.get("leaseSeconds")),
                active: data.get("active") === "on",
              },
            },
          );
          onSaved();
        }}
      >
        <fieldset className="form-fields" disabled={!canWrite}>
          <Field label="Product name">
            <input
              required
              value={name}
              maxLength={120}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited)
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
                  );
              }}
            />
          </Field>
          <Field
            label="Product slug"
            hint="A short, unique identifier using lowercase letters, numbers, and hyphens."
          >
            <input
              required
              minLength={2}
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={product?.description}
            />
          </Field>
          <Field
            label="Offline lease duration"
            hint="A revoked license can still be used offline until its signed lease expires."
          >
            <select
              name="leaseSeconds"
              defaultValue={product?.leaseSeconds ?? 3600}
            >
              {[
                ...new Set([
                  300,
                  3600,
                  86400,
                  604800,
                  ...(product ? [product.leaseSeconds] : []),
                ]),
              ]
                .sort((a, b) => a - b)
                .map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds === 300
                      ? "5 minutes · strict"
                      : seconds === 3600
                        ? "1 hour · recommended"
                        : seconds === 86400
                          ? "24 hours"
                          : seconds === 604800
                            ? "7 days"
                            : `${seconds} seconds`}
                  </option>
                ))}
            </select>
          </Field>
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="active"
              defaultChecked={product?.active ?? true}
            />
            Allow activation and validation
          </label>
          {product && (
            <Field label="Product ID">
              <input value={product.id} readOnly className="mono" />
            </Field>
          )}
        </fieldset>
      </Form>
    </Modal>
  );
}

export function CustomersPage({
  revision,
  canWrite,
  onCreate,
  onEdit,
}: {
  revision: number;
  canWrite: boolean;
  onCreate: () => void;
  onEdit: (customer: Customer) => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    result = useLoad<Page<Customer>>(
      `/admin/customers?search=${encodeURIComponent(useDebouncedValue(search))}&page=${page}`,
      revision,
    );
  return (
    <>
      <PageTitle
        eyebrow="RELATIONSHIPS"
        title="Customers"
        text="Customer records, licenses, and support context."
        actions={
          canWrite ? (
            <button className="button primary" onClick={onCreate}>
              <Plus size={17} />
              Add customer
            </button>
          ) : undefined
        }
      />
      <section className="panel">
        <div className="filter-row">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search names, emails, or references…"
          />
          <span className="secondary">
            {number(result.data?.total ?? 0)} customers
          </span>
        </div>
        <ErrorBox error={result.error} />
        {result.loading && !result.data ? (
          <Loading />
        ) : result.data?.items.length ? (
          <div
            className="table-scroll customer-table-wrap"
            aria-busy={result.loading}
          >
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Reference</th>
                  <th>Licenses</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Customer">
                      <a
                        className="customer-name"
                        href={`#/customers/${c.id}`}
                        aria-label={`View ${c.name}`}
                      >
                        <span className="avatar">
                          {c.name
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()}
                        </span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>{c.email}</small>
                        </span>
                      </a>
                    </td>
                    <td data-label="Reference">
                      <code>{c.externalId ?? "—"}</code>
                    </td>
                    <td data-label="Licenses">{number(c.licenses)}</td>
                    <td className="secondary" data-label="Added">
                      {date(c.createdAt)}
                    </td>
                    <td className="customer-row-actions">
                      {canWrite && (
                        <button className="text-link" onClick={() => onEdit(c)}>
                          Edit
                        </button>
                      )}
                      <a
                        className="text-link"
                        href={`#/customers/${c.id}`}
                        aria-label={`Open ${c.name} profile`}
                      >
                        Open <ArrowUpRight size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Users size={28} />}
            title={search ? "No customers found" : "Keep your customers close"}
            text={
              search
                ? "Try a different name or email address."
                : "Add customer records, then assign licenses as you issue them."
            }
          />
        )}
        <Pagination
          page={page}
          total={result.data?.total ?? 0}
          onChange={setPage}
        />
      </section>
    </>
  );
}
export function CustomerForm({
  customer,
  canWrite,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Modal
      title={customer ? "Customer details" : "Add a customer"}
      description="Customer records stay on your own server."
      onClose={onClose}
    >
      <Form
        readOnly={!canWrite}
        submit={customer ? "Save customer" : "Add customer"}
        onClose={onClose}
        onSubmit={async (data) => {
          await api(
            customer ? `/admin/customers/${customer.id}` : "/admin/customers",
            {
              method: customer ? "PUT" : "POST",
              body: {
                name: value(data, "name"),
                email: value(data, "email"),
                externalId: value(data, "externalId") || null,
                notes: value(data, "notes"),
              },
            },
          );
          onSaved();
        }}
      >
        <fieldset className="form-fields" disabled={!canWrite}>
          <Field label="Name">
            <input
              name="name"
              defaultValue={customer?.name}
              maxLength={120}
              required
              autoFocus
            />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              defaultValue={customer?.email}
              maxLength={254}
              required
            />
          </Field>
          <Field
            label="External ID (optional)"
            hint="Match this customer to your billing or order system."
          >
            <input
              name="externalId"
              defaultValue={customer?.externalId ?? ""}
              maxLength={120}
            />
          </Field>
          <Field label="Private notes">
            <textarea
              name="notes"
              defaultValue={customer?.notes}
              rows={4}
              maxLength={2000}
            />
          </Field>
        </fieldset>
      </Form>
    </Modal>
  );
}

export function ActivityPage({
  revision,
  isOwner,
  notify,
}: {
  revision: number;
  isOwner: boolean;
  notify: Notify;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [checking, setChecking] = useState(false),
    result = useLoad<Page<Audit>>(
      `/admin/audit?search=${encodeURIComponent(search)}&page=${page}`,
      revision,
    );
  return (
    <>
      <PageTitle
        eyebrow="VISIBILITY"
        title="Activity"
        text="A traceable history of changes across your workspace."
        actions={
          isOwner ? (
            <button
              className="button"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  const data = await api<{
                    valid: boolean;
                    checked: number;
                    head: string;
                  }>("/admin/audit/verify");
                  notify(
                    data.valid
                      ? `Integrity verified for ${number(data.checked)} retained events.`
                      : "The audit chain has an integrity failure.",
                    data.valid ? "success" : "error",
                  );
                } catch (error) {
                  notify(message(error), "error");
                } finally {
                  setChecking(false);
                }
              }}
            >
              <ShieldCheck size={16} />
              {checking ? "Verifying…" : "Verify integrity"}
            </button>
          ) : undefined
        }
      />
      <section className="panel">
        <div className="filter-row">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search events or record IDs…"
          />
          <span className="secondary">
            {number(result.data?.total ?? 0)} events
          </span>
        </div>
        <ErrorBox error={result.error} />
        {result.loading ? (
          <Loading />
        ) : result.data?.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Record</th>
                  <th>Actor</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="audit-event">
                        <span className="audit-dot" />
                        <strong>
                          {event.action
                            .replaceAll(".", " · ")
                            .replaceAll("_", " ")}
                        </strong>
                      </div>
                    </td>
                    <td>
                      <code title={event.target}>
                        {event.target.slice(0, 8)}…
                      </code>
                    </td>
                    <td>
                      <code title={event.actor}>
                        {event.actor.startsWith("license:")
                          ? "License client"
                          : event.actor.startsWith("token:")
                            ? "API integration"
                            : event.actor.slice(0, 8) + "…"}
                      </code>
                    </td>
                    <td className="secondary nowrap">
                      {dateTime(event.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No matching activity"
            text="Try another event name or record ID."
          />
        )}
        <Pagination
          page={page}
          total={result.data?.total ?? 0}
          onChange={setPage}
        />
      </section>
      <div className="page-note">
        <ShieldCheck size={15} />
        Integrity checks cover retained records. Detecting log truncation
        requires a checkpoint stored outside this server.
      </div>
    </>
  );
}

export function DevelopersPage({
  meta,
  products,
  isOwner,
  revision,
  notify,
  onChanged,
  onToken,
}: {
  meta: Meta;
  products: Product[];
  isOwner: boolean;
  revision: number;
  notify: Notify;
  onChanged: () => void;
  onToken: (token: string) => void;
}) {
  const [selected, setSelected] = useState(products[0]?.id ?? ""),
    [language, setLanguage] = useState("javascript"),
    [creating, setCreating] = useState(false),
    [revoke, setRevoke] = useState<ApiToken | null>(null),
    tokens = useLoad<{ items: ApiToken[] }>(
      isOwner ? "/admin/tokens" : null,
      revision,
    );
  const productId = selected || products[0]?.id || "YOUR_PRODUCT_ID";
  const code =
    language === "javascript"
      ? `import { KeydockClient } from '@keydock/client';\n\nconst client = new KeydockClient({\n  baseUrl: '${meta.issuer}',\n  productId: '${productId}',\n  publicKey: PINNED_PUBLIC_KEY_PEM,\n});\n\nconst license = await client.activate({\n  key: userEnteredKey,\n  fingerprint: savedInstallationId,\n  name: 'My application',\n});\n\nif (license.entitlements.includes('pro')) {\n  enableProFeatures();\n}`
      : `from keydock import KeydockClient\n\nclient = KeydockClient(\n    '${meta.issuer}',\n    '${productId}',\n    PINNED_PUBLIC_KEY_PEM,\n)\n\nlicense = client.activate(\n    user_entered_key,\n    saved_installation_id,\n    'My application',\n)\n\nif 'pro' in license['entitlements']:\n    enable_pro_features()`;
  return (
    <>
      <PageTitle
        eyebrow="BUILD WITH KEYDOCK"
        title="Developers"
        text="Connect your applications to the licensing API."
        actions={
          <a
            className="button"
            href="https://github.com/informent/Keydock#api"
            target="_blank"
            rel="noreferrer"
          >
            API documentation
            <ArrowUpRight size={15} />
          </a>
        }
      />
      <div className="developer-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Connect your application</h2>
              <p>Install the SDK from this repository.</p>
            </div>
            <Code2 size={21} />
          </div>
          <div className="integration-product">
            <Field label="Product">
              <select
                value={productId}
                onChange={(e) => setSelected(e.target.value)}
              >
                {!products.length && (
                  <option value="YOUR_PRODUCT_ID">
                    Create a product first
                  </option>
                )}
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="code-toolbar">
            <div className="tabs">
              <button
                className={language === "javascript" ? "active" : ""}
                onClick={() => setLanguage("javascript")}
              >
                JavaScript
              </button>
              <button
                className={language === "python" ? "active" : ""}
                onClick={() => setLanguage("python")}
              >
                Python
              </button>
            </div>
            <CopyButton value={code} notify={notify} label="Copy code" />
          </div>
          <pre className="code-block">
            <code>{code}</code>
          </pre>
          <div className="integration-note">
            Privileges are read from verified signed claims. Never embed an
            admin token in a distributed app.
          </div>
        </section>
        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Public signing key</h2>
                <p>Pin this in your application.</p>
              </div>
              <ShieldCheck size={21} />
            </div>
            <div className="panel-body">
              <pre className="public-key">{meta.publicKey}</pre>
              <div className="button-row">
                <CopyButton value={meta.publicKey} notify={notify} />
                <button
                  className="button subtle"
                  onClick={() =>
                    download("keydock-public-key.pem", meta.publicKey)
                  }
                >
                  <Download size={15} />
                  Download
                </button>
              </div>
              <div className="key-id">
                Key ID <code>{meta.signingKeyId}</code>
              </div>
            </div>
          </section>
          <section className="panel guidance">
            <h3>Built for real integrations</h3>
            <p>
              <CheckCircle2 size={16} />
              Device limits enforced on your server
            </p>
            <p>
              <CheckCircle2 size={16} />
              Signed, time-limited offline leases
            </p>
            <p>
              <CheckCircle2 size={16} />
              Explicit errors and no silent fallback
            </p>
            <p>
              <CheckCircle2 size={16} />
              Product-scoped management tokens
            </p>
            <a
              className="text-link"
              href="https://github.com/informent/Keydock/tree/main/sdk"
              target="_blank"
              rel="noreferrer"
            >
              Get the SDKs
              <ArrowUpRight size={15} />
            </a>
          </section>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Management API tokens</h2>
            <p>For your backend, billing jobs, and trusted automation.</p>
          </div>
          {isOwner && (
            <button
              className="button primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Create token
            </button>
          )}
        </div>
        {!isOwner ? (
          <div className="panel-body">
            <p className="help-text">The workspace owner manages API tokens.</p>
          </div>
        ) : (
          <>
            <ErrorBox error={tokens.error} />
            {tokens.loading ? (
              <Loading />
            ) : tokens.data?.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Scope</th>
                      <th>Expires</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.data.items.map((token) => (
                      <tr key={token.id}>
                        <td>
                          <strong>{token.name}</strong>
                          <code className="subline">{token.hint}</code>
                        </td>
                        <td>{token.role}</td>
                        <td className="secondary">
                          {products.find((p) => p.id === token.productId)
                            ?.name ?? "Entire workspace"}
                        </td>
                        <td className="secondary">{date(token.expiresAt)}</td>
                        <td className="secondary">
                          {token.lastUsedAt ? date(token.lastUsedAt) : "Never"}
                        </td>
                        <td>
                          {token.revokedAt ? (
                            <Badge status="revoked" />
                          ) : token.expiresAt <= Date.now() ? (
                            <Badge status="expired" />
                          ) : (
                            <button
                              className="text-link danger-text"
                              onClick={() => setRevoke(token)}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={<Code2 size={26} />}
                title="Connect your backend"
                text="Create a limited token for each integration. Tokens expire and can be revoked at any time."
              />
            )}
          </>
        )}
      </section>
      {creating && (
        <Modal
          title="Create an API token"
          description="Grant only the access your integration needs."
          onClose={() => setCreating(false)}
        >
          <Form
            submit="Create token"
            onClose={() => setCreating(false)}
            onSubmit={async (data) => {
              const token = await api<ApiToken>("/admin/tokens", {
                method: "POST",
                body: {
                  name: value(data, "name"),
                  role: value(data, "role"),
                  productId: value(data, "productId") || null,
                  days: Number(data.get("days")),
                },
              });
              setCreating(false);
              onChanged();
              onToken(token.token!);
            }}
          >
            <Field label="Token name">
              <input
                name="name"
                placeholder="e.g. Order fulfillment"
                maxLength={120}
                required
                autoFocus
              />
            </Field>
            <Field label="Role">
              <select name="role">
                <option value="viewer">Viewer · read only</option>
                <option value="operator">
                  Operator · manage licenses and products
                </option>
              </select>
            </Field>
            <Field label="Product scope">
              <select name="productId">
                <option value="">Entire workspace</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expires after (days)">
              <input
                type="number"
                name="days"
                min={1}
                max={365}
                defaultValue={90}
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
      {revoke && (
        <Confirm
          title={`Revoke ${revoke.name}?`}
          text="Requests using this token will stop working immediately. Create a replacement before revoking if you need uninterrupted service."
          label="Revoke token"
          danger
          onClose={() => setRevoke(null)}
          onConfirm={async () => {
            await api(`/admin/tokens/${revoke.id}`, { method: "DELETE" });
            onChanged();
            notify("API token revoked.");
          }}
        />
      )}
    </>
  );
}

export function SettingsPage({
  user,
  meta,
  revision,
  notify,
  onChanged,
  onSignedOut,
}: {
  user: User;
  meta: Meta;
  revision: number;
  notify: Notify;
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  const isOwner = user.role === "owner",
    users = useLoad<{ items: User[] }>(
      isOwner ? "/admin/users" : null,
      revision,
    ),
    [adding, setAdding] = useState(false),
    [password, setPassword] = useState(false),
    [toggle, setToggle] = useState<User | null>(null);
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE"
        title="Settings"
        text="Your account, your team, and your instance."
      />
      <section className="panel settings-section">
        <div>
          <h2>Your account</h2>
          <p>Signed in as {user.email}</p>
        </div>
        <div className="account-row">
          <span className="avatar large">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.role[0].toUpperCase() + user.role.slice(1)}</span>
          </div>
          <button className="button" onClick={() => setPassword(true)}>
            Change password
          </button>
        </div>
      </section>
      {isOwner && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Team access</h2>
              <p>Operators manage licensing. Viewers have read-only access.</p>
            </div>
            <button className="button" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add member
            </button>
          </div>
          <ErrorBox error={users.error} />
          {users.loading ? (
            <Loading />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.data?.items.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.name}</strong>
                        <span className="subline secondary">
                          {member.email}
                        </span>
                      </td>
                      <td>{member.role}</td>
                      <td>
                        <Badge
                          status={member.disabled ? "disabled" : "active"}
                        />
                      </td>
                      <td>
                        {member.role !== "owner" && (
                          <button
                            className="text-link"
                            onClick={() => setToggle(member)}
                          >
                            {member.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="panel settings-section">
        <div>
          <h2>Instance details</h2>
          <p>Self-hosted and under your control.</p>
        </div>
        <dl className="instance-details">
          <dt>Version</dt>
          <dd>{meta.version}</dd>
          <dt>Origin / issuer</dt>
          <dd>
            <code>{meta.issuer}</code>
          </dd>
          <dt>Signing algorithm</dt>
          <dd>Ed25519</dd>
          <dt>Storage</dt>
          <dd>SQLite · local persistent storage</dd>
          <dt>License</dt>
          <dd>MIT · open source</dd>
        </dl>
        <a
          className="text-link"
          href="https://github.com/informent/Keydock/blob/main/docs/operations.md"
          target="_blank"
          rel="noreferrer"
        >
          Deployment and backups
          <ArrowUpRight size={15} />
        </a>
      </section>
      {adding && (
        <Modal
          title="Add a team member"
          description="Share the initial password through a secure channel. The member can change it after signing in."
          onClose={() => setAdding(false)}
        >
          <Form
            submit="Add member"
            onClose={() => setAdding(false)}
            onSubmit={async (data) => {
              await api("/admin/users", {
                method: "POST",
                body: {
                  name: value(data, "name"),
                  email: value(data, "email"),
                  password: value(data, "password"),
                  role: value(data, "role"),
                },
              });
              setAdding(false);
              onChanged();
              notify("Team member added.");
            }}
          >
            <Field label="Name">
              <input name="name" required maxLength={120} autoFocus />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required maxLength={254} />
            </Field>
            <Field
              label="Initial password"
              hint="Use at least 14 characters. Spaces and passphrases are welcome."
            >
              <input
                name="password"
                type="password"
                minLength={14}
                maxLength={256}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Role">
              <select name="role">
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
              </select>
            </Field>
          </Form>
        </Modal>
      )}
      {password && (
        <Modal
          title="Change your password"
          description="All sessions, including this one, will be signed out."
          onClose={() => setPassword(false)}
        >
          <Form
            submit="Change password"
            onClose={() => setPassword(false)}
            onSubmit={async (data) => {
              await api("/auth/password", {
                method: "POST",
                body: {
                  currentPassword: value(data, "currentPassword"),
                  newPassword: value(data, "newPassword"),
                },
              });
              notify("Password changed. Sign in with your new password.");
              onSignedOut();
            }}
          >
            <Field label="Current password">
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                required
                autoFocus
              />
            </Field>
            <Field label="New password">
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={14}
                maxLength={256}
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
      {toggle && (
        <Confirm
          title={`${toggle.disabled ? "Enable" : "Disable"} ${toggle.name}?`}
          text={
            toggle.disabled
              ? "This member will be able to sign in again."
              : "This immediately ends their active sessions and prevents further sign-ins."
          }
          label={toggle.disabled ? "Enable member" : "Disable member"}
          onClose={() => setToggle(null)}
          onConfirm={async () => {
            await api(`/admin/users/${toggle.id}`, {
              method: "PATCH",
              body: { disabled: !toggle.disabled },
            });
            onChanged();
            notify("Team access updated.");
          }}
        />
      )}
    </>
  );
}
