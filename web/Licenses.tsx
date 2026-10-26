import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Download,
  KeyRound,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  date,
  dateTime,
  download,
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
  Customer,
  License,
  Notify,
  Overview,
  Page,
  Product,
} from "./types";

const text = (data: FormData, key: string) => String(data.get(key) ?? "");
const entitlementList = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const localDate = (value: number | null) => {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function Licenses({
  products,
  revision,
  canWrite,
  notify,
  onIssue,
  onSelect,
}: {
  products: Product[];
  revision: number;
  canWrite: boolean;
  notify: Notify;
  onIssue: () => void;
  onSelect: (license: License) => void;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [product, setProduct] = useState(""),
    [page, setPage] = useState(1);
  const query = new URLSearchParams({
    search: useDebouncedValue(search),
    status,
    page: String(page),
    ...(product ? { productId: product } : {}),
  });
  const result = useLoad<Page<License>>(`/admin/licenses?${query}`, revision),
    stats = useLoad<Overview>("/admin/overview", revision);
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE"
        title="Licenses"
        text="Every key, customer, and device. All in one place."
        actions={
          <>
            <button
              className="button"
              onClick={async () => {
                try {
                  const response = await fetch(
                    `/api/v1/admin/licenses/export?${query}`,
                    { credentials: "same-origin" },
                  );
                  if (!response.ok)
                    throw new Error("Export failed. Refresh and try again.");
                  download(
                    "keydock-licenses.csv",
                    await response.text(),
                    "text/csv",
                  );
                  notify("License export downloaded. Raw keys are excluded.");
                } catch (error) {
                  notify((error as Error).message, "error");
                }
              }}
            >
              <Download size={16} />
              Export
            </button>
            {canWrite && (
              <button className="button primary" onClick={onIssue}>
                <Plus size={17} />
                Issue license
              </button>
            )}
          </>
        }
      />
      <Stats data={stats.data} />
      <section className="panel">
        <div className="panel-toolbar">
          <div className="tabs">
            <button
              className={status === "all" ? "active" : ""}
              onClick={() => {
                setStatus("all");
                setPage(1);
              }}
            >
              All licenses{stats.data && <span>{stats.data.licenses}</span>}
            </button>
            <button
              className={status === "active" ? "active" : ""}
              onClick={() => {
                setStatus("active");
                setPage(1);
              }}
            >
              Active
            </button>
            <button
              className={status === "expired" ? "active" : ""}
              onClick={() => {
                setStatus("expired");
                setPage(1);
              }}
            >
              Expired
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh licenses"
            onClick={() => {
              result.reload();
              stats.reload();
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="filter-row">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search licenses or customers…"
          />
          <div className="filters">
            <select
              aria-label="Filter by product"
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {[
                "all",
                "active",
                "unactivated",
                "expired",
                "suspended",
                "revoked",
              ].map((s) => (
                <option key={s} value={s}>
                  {s === "all"
                    ? "All statuses"
                    : s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(search || status !== "all" || product) && (
          <div className="active-filters">
            <span>Filtered view</span>
            {search && <span className="filter-chip">Search: {search}</span>}
            {status !== "all" && <span className="filter-chip">{status}</span>}
            {product && (
              <span className="filter-chip">
                {products.find((item) => item.id === product)?.name ??
                  "Selected product"}
              </span>
            )}
            <button
              className="text-link"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setProduct("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        <ErrorBox error={result.error} />
        {result.loading && !result.data ? (
          <Loading />
        ) : result.data?.items.length ? (
          <LicenseTable items={result.data.items} onSelect={onSelect} />
        ) : (
          <Empty
            title={
              search || status !== "all" || product
                ? "No matching licenses"
                : "Your first license starts here"
            }
            text={
              search || status !== "all" || product
                ? "Try another search or clear your filters."
                : "Create a product, issue a key, and connect it to your application."
            }
            action={
              canWrite && !search && status === "all" && !product ? (
                <button className="button primary" onClick={onIssue}>
                  <Plus size={16} />
                  Issue a license
                </button>
              ) : undefined
            }
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
        Raw keys are shown only at issuance. Your license records store hashed
        keys.
      </div>
    </>
  );
}

export function IssueLicense({
  products,
  initialCustomer,
  onClose,
  onIssued,
  onProduct,
}: {
  products: Product[];
  initialCustomer?: Customer | null;
  onClose: () => void;
  onIssued: (items: License[]) => void;
  onProduct: () => void;
}) {
  const [mode, setMode] = useState("lifetime"),
    [issuing, setIssuing] = useState(false),
    [customerSearch, setCustomerSearch] = useState(""),
    [assignedCustomer, setAssignedCustomer] = useState<Customer | null>(
      initialCustomer ?? null,
    ),
    [draft, setDraft] = useState({
      productId: products.find((product) => product.active)?.id ?? "",
      label: "",
      maxDevices: "1",
      count: "1",
      expiresAt: "",
      durationDays: "30",
      entitlements: "",
    });
  const customerQuery = useDebouncedValue(customerSearch);
  const customers = useLoad<Page<Customer>>(
    `/admin/customers?limit=100&search=${encodeURIComponent(customerQuery)}`,
  );
  const retry = useRef({ body: "", key: "" });
  const activeProducts = products.filter((product) => product.active),
    selectedProduct =
      activeProducts.find((product) => product.id === draft.productId) ??
      activeProducts[0],
    customerOptions = customers.data?.items ?? [],
    entitlements = entitlementList(draft.entitlements),
    keys = Number(draft.count),
    devices = Number(draft.maxDevices),
    days = Number(draft.durationDays),
    fixedExpiry = new Date(draft.expiresAt).getTime(),
    validKeys = Number.isInteger(keys) && keys >= 1 && keys <= 100,
    validDevices =
      Number.isInteger(devices) && devices >= 1 && devices <= 10000;
  const leaseSeconds = selectedProduct?.leaseSeconds ?? 0,
    leaseUnit =
      leaseSeconds % 86400 === 0
        ? "day"
        : leaseSeconds % 3600 === 0
          ? "hour"
          : leaseSeconds % 60 === 0
            ? "minute"
            : "second",
    leaseAmount =
      leaseSeconds /
      { day: 86400, hour: 3600, minute: 60, second: 1 }[leaseUnit];
  const validity =
    mode === "lifetime"
      ? "Lifetime · no expiry"
      : mode === "fixed"
        ? Number.isFinite(fixedExpiry)
          ? dateTime(fixedExpiry)
          : "Choose an expiry date"
        : Number.isInteger(days) && days >= 1 && days <= 36500
          ? `${number(days)} ${days === 1 ? "day" : "days"} from first activation`
          : "Choose a valid duration";
  const updateDraft = (field: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  if (!activeProducts.length)
    return (
      <Modal title="Add a product first" onClose={onClose}>
        <div className="modal-body">
          <Empty
            icon={<KeyRound />}
            title="Give your licenses a home"
            text="Create or enable a product before issuing keys. A product connects your application, its licenses, and its offline policy."
            action={
              <button className="button primary" onClick={onProduct}>
                Create product
                <ArrowUpRight size={15} />
              </button>
            }
          />
        </div>
      </Modal>
    );
  return (
    <Modal
      title="Issue a license"
      description="Set the terms. Keydock takes care of the key."
      onClose={onClose}
      className="issue-modal"
      busy={issuing}
    >
      <Form
        submit="Generate license keys"
        onBusyChange={setIssuing}
        onClose={onClose}
        onSubmit={async (data) => {
          const input = {
            productId: text(data, "productId"),
            label: text(data, "label"),
            customerId: text(data, "customerId") || null,
            maxDevices: Number(data.get("maxDevices")),
            count: Number(data.get("count")),
            expiresAt:
              mode === "fixed"
                ? new Date(text(data, "expiresAt")).getTime()
                : null,
            durationDays:
              mode === "activation" ? Number(data.get("durationDays")) : null,
            entitlements: entitlementList(text(data, "entitlements")),
            notes: text(data, "notes"),
          };
          const body = JSON.stringify(input);
          if (retry.current.body !== body)
            retry.current = { body, key: crypto.randomUUID() };
          const result = await api<{ items: License[] }>("/admin/licenses", {
            method: "POST",
            body: input,
            idempotencyKey: retry.current.key,
          });
          onIssued(result.items);
        }}
      >
        <div className="issue-layout">
          <div className="issue-fields">
            <div className="form-section-heading">
              <span>01</span>
              <div>
                <h3>License basics</h3>
                <p>Choose the product and the capacity for each key.</p>
              </div>
            </div>
            <Field label="Product">
              <select
                name="productId"
                required
                value={selectedProduct.id}
                onChange={(event) =>
                  updateDraft("productId", event.target.value)
                }
              >
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="License label">
              <input
                name="label"
                value={draft.label}
                onChange={(event) => updateDraft("label", event.target.value)}
                placeholder="e.g. Pro annual · Acme"
                maxLength={120}
                required
                autoFocus
              />
            </Field>
            <div className="field-row">
              <Field
                label="Device limit"
                hint="Concurrent activated installations."
              >
                <input
                  type="number"
                  name="maxDevices"
                  min={1}
                  max={10000}
                  value={draft.maxDevices}
                  onChange={(event) =>
                    updateDraft("maxDevices", event.target.value)
                  }
                  required
                />
              </Field>
              <Field label="Number of keys" hint="Generate up to 100 at once.">
                <input
                  type="number"
                  name="count"
                  min={1}
                  max={100}
                  value={draft.count}
                  onChange={(event) => updateDraft("count", event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="form-section-heading">
              <span>02</span>
              <div>
                <h3>Access and ownership</h3>
                <p>Set the terms and connect the license to a customer.</p>
              </div>
            </div>
            <Field label="Validity">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="lifetime">Lifetime · no expiry</option>
                <option value="fixed">Expires at a fixed date</option>
                <option value="activation">Starts on first activation</option>
              </select>
            </Field>
            {mode === "fixed" && (
              <Field label="Expires at (your local time)">
                <input
                  type="datetime-local"
                  name="expiresAt"
                  value={draft.expiresAt}
                  onChange={(event) =>
                    updateDraft("expiresAt", event.target.value)
                  }
                  required
                  min={localDate(Date.now())}
                />
              </Field>
            )}
            {mode === "activation" && (
              <Field label="Days after first activation">
                <input
                  type="number"
                  name="durationDays"
                  min={1}
                  max={36500}
                  value={draft.durationDays}
                  onChange={(event) =>
                    updateDraft("durationDays", event.target.value)
                  }
                  required
                />
              </Field>
            )}
            <Field label="Find customer (optional)">
              <input
                placeholder="Search by name or email"
                maxLength={120}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
            </Field>
            <Field label="Assign customer">
              <select
                name="customerId"
                value={assignedCustomer?.id ?? ""}
                onChange={(event) =>
                  setAssignedCustomer(
                    customerOptions.find(
                      (customer) => customer.id === event.target.value,
                    ) ??
                      (event.target.value === assignedCustomer?.id
                        ? assignedCustomer
                        : null),
                  )
                }
              >
                <option value="">Unassigned</option>
                {assignedCustomer &&
                  !customerOptions.some(
                    (customer) => customer.id === assignedCustomer.id,
                  ) && (
                    <option value={assignedCustomer.id}>
                      {assignedCustomer.name} · {assignedCustomer.email}
                    </option>
                  )}
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.email}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorBox error={customers.error} />
            <Field
              label="Entitlements"
              hint="Feature names separated by commas. Example: pro, export, cloud_sync"
            >
              <input
                name="entitlements"
                value={draft.entitlements}
                onChange={(event) =>
                  updateDraft("entitlements", event.target.value)
                }
                placeholder="pro, export"
                maxLength={2000}
              />
            </Field>
            <Field label="Private notes">
              <textarea
                name="notes"
                rows={2}
                maxLength={2000}
                placeholder="Visible to your team only"
              />
            </Field>
          </div>
          <aside className="issue-preview" aria-label="Issuance summary">
            <div className="preview-kicker">
              <KeyRound size={17} />
              <span>BEFORE YOU ISSUE</span>
            </div>
            <h3>Issuance summary</h3>
            <p className="preview-label">
              {draft.label.trim() || "Your next license"}
            </p>
            <span className="product-tag">{selectedProduct.name}</span>
            <div className="preview-capacity">
              <div>
                <strong>{validKeys ? number(keys) : "—"}</strong>
                <span>{keys === 1 ? "license key" : "license keys"}</span>
              </div>
              <div>
                <strong>{validDevices ? number(devices) : "—"}</strong>
                <span>
                  {devices === 1 ? "device per key" : "devices per key"}
                </span>
              </div>
            </div>
            <dl>
              <dt>Validity</dt>
              <dd>{validity}</dd>
              <dt>Customer</dt>
              <dd>{assignedCustomer?.name ?? "Unassigned"}</dd>
              <dt>Offline lease</dt>
              <dd>
                {number(leaseAmount)} {leaseUnit}
                {leaseAmount === 1 ? "" : "s"}
              </dd>
              <dt>Capacity across this batch</dt>
              <dd>
                {validKeys && validDevices
                  ? `${number(keys * devices)} device ${keys * devices === 1 ? "slot" : "slots"}`
                  : "Choose valid key and device counts"}
              </dd>
            </dl>
            <div className="preview-entitlements">
              <span>Entitlements</span>
              <div>
                {entitlements.length ? (
                  entitlements
                    .slice(0, 8)
                    .map((entitlement, index) => (
                      <code key={`${entitlement}-${index}`}>{entitlement}</code>
                    ))
                ) : (
                  <p>None configured</p>
                )}
                {entitlements.length > 8 && (
                  <small>+{entitlements.length - 8} more</small>
                )}
              </div>
            </div>
            <p className="preview-note">
              Each key has its own device limit. Offline access lasts until the
              signed lease expires.
            </p>
            <div className="callout">
              <ShieldCheck size={18} />
              <span>
                Copy or download the keys after creation. They will not appear
                in license records.
              </span>
            </div>
          </aside>
        </div>
      </Form>
    </Modal>
  );
}

export function SecretDelivery({
  items,
  token,
  onClose,
  notify,
}: {
  items?: License[];
  token?: string;
  onClose: () => void;
  notify: Notify;
}) {
  const [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  const close = () => {
    if (saved) onClose();
    else setError("Save the secret and check the confirmation before closing.");
  };
  const value = token ?? items?.map((l) => l.key).join("\n") ?? "";
  return (
    <Modal
      title={
        token
          ? "Your API token is ready"
          : `${items?.length ?? 0} license ${(items?.length ?? 0) === 1 ? "key is" : "keys are"} ready`
      }
      description="Save this now. It cannot be retrieved from the workspace."
      onClose={close}
      wide
    >
      <div className="modal-body">
        <div className="success-banner">
          <ShieldCheck size={22} />
          <div>
            <strong>Created successfully</strong>
            <span>
              Store this securely and share it only with its intended recipient.
            </span>
          </div>
        </div>
        <div className="secret-list">
          {token ? (
            <code className="secret-value">{token}</code>
          ) : (
            items?.map((l) => (
              <div className="secret-record" key={l.id}>
                <span>{l.label}</span>
                <code className="secret-value">{l.key}</code>
              </div>
            ))
          )}
        </div>
        <div className="button-row">
          <CopyButton
            value={value}
            notify={notify}
            label={token ? "Copy token" : "Copy all keys"}
          />
          <button
            className="button"
            onClick={() =>
              download(
                token ? "keydock-api-token.txt" : "keydock-license-keys.txt",
                token ??
                  items?.map((l) => `${l.label}\n${l.key}\n`).join("\n") ??
                  "",
              )
            }
          >
            <Download size={16} />
            Download
          </button>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => {
              setSaved(e.target.checked);
              setError("");
            }}
          />
          I have saved {token ? "this token" : "these keys"} securely.
        </label>
        <ErrorBox error={error} />
      </div>
      <div className="modal-footer">
        <button className="button primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function LicenseDetail({
  licenseId,
  canWrite,
  notify,
  onClose,
  onChanged,
  onSecret,
}: {
  licenseId: string;
  canWrite: boolean;
  notify: Notify;
  onClose: () => void;
  onChanged: () => void;
  onSecret: (items: License[]) => void;
}) {
  const result = useLoad<License>(`/admin/licenses/${licenseId}`),
    [tab, setTab] = useState("details"),
    [confirm, setConfirm] = useState<"revoke" | "rotate" | string | null>(null),
    [renew, setRenew] = useState(false);
  const license = result.data;
  const changed = () => {
    result.reload();
    onChanged();
  };
  return (
    <>
      <Modal
        title={license?.label ?? "License details"}
        description={license?.productName}
        onClose={onClose}
        wide
      >
        {result.loading && !license ? (
          <Loading />
        ) : (
          <>
            <ErrorBox error={result.error} />
            {license && (
              <>
                <div className="detail-summary">
                  <div>
                    <code>{license.keyHint}</code>
                    <CopyButton
                      value={license.id}
                      notify={notify}
                      label="Copy ID"
                    />
                  </div>
                  <Badge status={license.status} />
                </div>
                <div className="tabs detail-tabs">
                  <button
                    className={tab === "details" ? "active" : ""}
                    onClick={() => setTab("details")}
                  >
                    Details
                  </button>
                  <button
                    className={tab === "devices" ? "active" : ""}
                    onClick={() => setTab("devices")}
                  >
                    Devices{" "}
                    <span>
                      {license.deviceCount}/{license.maxDevices}
                    </span>
                  </button>
                </div>
                {tab === "details" ? (
                  <>
                    <div className="detail-grid">
                      <div>
                        <span>Customer</span>
                        <strong>{license.customerName ?? "Unassigned"}</strong>
                      </div>
                      <div>
                        <span>Created</span>
                        <strong>{date(license.createdAt)}</strong>
                      </div>
                      <div>
                        <span>First activation</span>
                        <strong>
                          {license.activatedAt
                            ? date(license.activatedAt)
                            : "Not activated"}
                        </strong>
                      </div>
                      <div>
                        <span>Validity</span>
                        <strong>
                          {!license.activatedAt && license.durationDays
                            ? `${license.durationDays} days from activation`
                            : date(license.expiresAt)}
                        </strong>
                      </div>
                    </div>
                    <Form
                      key={`${license.id}-${license.updatedAt}`}
                      submit="Save changes"
                      readOnly={!canWrite || license.status === "revoked"}
                      onClose={onClose}
                      onSubmit={async (data) => {
                        await api(`/admin/licenses/${license.id}`, {
                          method: "PATCH",
                          body: {
                            label: text(data, "label"),
                            maxDevices: Number(data.get("maxDevices")),
                            entitlements: entitlementList(
                              text(data, "entitlements"),
                            ),
                            notes: text(data, "notes"),
                          },
                        });
                        notify("License updated.");
                        changed();
                      }}
                    >
                      <fieldset
                        disabled={!canWrite || license.status === "revoked"}
                        className="form-fields"
                      >
                        <Field label="Label">
                          <input
                            name="label"
                            defaultValue={license.label}
                            required
                            maxLength={120}
                          />
                        </Field>
                        <div className="field-row">
                          <Field label="Device limit">
                            <input
                              name="maxDevices"
                              type="number"
                              min={1}
                              max={10000}
                              defaultValue={license.maxDevices}
                              required
                            />
                          </Field>
                          <Field label="Entitlements">
                            <input
                              name="entitlements"
                              defaultValue={license.entitlements.join(", ")}
                              maxLength={2000}
                            />
                          </Field>
                        </div>
                        <Field label="Private notes">
                          <textarea
                            name="notes"
                            rows={3}
                            maxLength={2000}
                            defaultValue={license.notes}
                          />
                        </Field>
                      </fieldset>
                      {canWrite && license.status !== "revoked" && (
                        <div className="license-actions">
                          <button
                            type="button"
                            className="button"
                            onClick={() => setRenew(true)}
                          >
                            Extend expiry
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() =>
                              setConfirm(
                                license.status === "suspended"
                                  ? "resume"
                                  : "suspend",
                              )
                            }
                          >
                            {license.status === "suspended"
                              ? "Resume"
                              : "Suspend"}
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setConfirm("rotate")}
                          >
                            Rotate key
                          </button>
                          <button
                            type="button"
                            className="button danger-quiet"
                            onClick={() => setConfirm("revoke")}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </Form>
                  </>
                ) : (
                  <div className="modal-body">
                    <p className="help-text">
                      Released devices stop validating online. Existing offline
                      leases remain valid until their signed expiry.
                    </p>
                    {license.devices?.length ? (
                      <div className="device-list">
                        {license.devices.map((device) => (
                          <div className="device-record" key={device.id}>
                            <Monitor size={23} />
                            <div>
                              <strong>{device.name}</strong>
                              <small>
                                Last seen {dateTime(device.lastSeenAt)}
                              </small>
                              <code>{device.id}</code>
                            </div>
                            {device.releasedAt ? (
                              <Badge status="released" />
                            ) : canWrite ? (
                              <button
                                className="button subtle"
                                onClick={() =>
                                  setConfirm(`device:${device.id}`)
                                }
                              >
                                Release
                              </button>
                            ) : (
                              <Badge status="active" />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Monitor />}
                        title="No devices yet"
                        text="Installations appear here when they activate this license."
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal>
      {confirm && license && (
        <Confirm
          title={
            confirm === "revoke"
              ? "Permanently revoke this license?"
              : confirm === "rotate"
                ? "Replace this license key?"
                : confirm.startsWith("device:")
                  ? "Release this device?"
                  : confirm === "resume"
                    ? "Resume this license?"
                    : "Suspend this license?"
          }
          text={
            confirm === "revoke"
              ? "This cannot be undone. Online validation will be denied immediately. Existing offline leases remain usable until expiry."
              : confirm === "rotate"
                ? "The old key will stop working online. Save the replacement key when it appears. Existing offline leases remain valid until expiry."
                : confirm.startsWith("device:")
                  ? "This frees one activation slot. The installation must activate again to use the license online."
                  : confirm === "resume"
                    ? "This allows online validation again, subject to the license expiry and device limit."
                    : "Online validation will stop. You can resume the license at any time. Existing offline leases remain valid until expiry."
          }
          label={
            confirm === "revoke"
              ? "Revoke permanently"
              : confirm === "rotate"
                ? "Rotate key"
                : confirm.startsWith("device:")
                  ? "Release device"
                  : confirm === "resume"
                    ? "Resume license"
                    : "Suspend license"
          }
          danger={confirm === "revoke"}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm.startsWith("device:"))
              await api(
                `/admin/licenses/${license.id}/devices/${confirm.slice(7)}`,
                { method: "DELETE" },
              );
            else if (confirm === "rotate") {
              const result = await api<License>(
                `/admin/licenses/${license.id}/rotate`,
                { method: "POST" },
              );
              onSecret([result]);
            } else
              await api(`/admin/licenses/${license.id}/status`, {
                method: "POST",
                body: {
                  status:
                    confirm === "resume"
                      ? "active"
                      : confirm === "suspend"
                        ? "suspended"
                        : "revoked",
                },
              });
            changed();
            notify("License updated.");
          }}
        />
      )}
      {renew && license && (
        <Modal
          title="Extend license expiry"
          description="Days are added to the later of now or the existing expiry. A lifetime license will gain an expiry."
          onClose={() => setRenew(false)}
        >
          <Form
            submit="Extend expiry"
            onClose={() => setRenew(false)}
            onSubmit={async (data) => {
              await api(`/admin/licenses/${license.id}/renew`, {
                method: "POST",
                body: { days: Number(data.get("days")) },
              });
              setRenew(false);
              changed();
              notify("License expiry extended.");
            }}
          >
            <Field label="Days to add">
              <input
                type="number"
                name="days"
                defaultValue={30}
                min={1}
                max={36500}
                required
                autoFocus
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
