import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  date,
  dateTime,
  download,
  message,
  number,
  useDebouncedValue,
  useLoad,
} from "./api";
import {
  CopyButton,
  Empty,
  ErrorBox,
  LicenseTable,
  Loading,
  Pagination,
  SearchInput,
} from "./components";
import type {
  Customer,
  CustomerProfile,
  License,
  Notify,
  Page,
  Product,
} from "./types";

export function CustomerWorkspace({
  customerId,
  revision,
  products,
  canWrite,
  notify,
  onEdit,
  onIssue,
  onSelect,
}: {
  customerId: string;
  revision: number;
  products: Product[];
  canWrite: boolean;
  notify: Notify;
  onEdit: (customer: Customer) => void;
  onIssue: (customer: Customer) => void;
  onSelect: (license: License) => void;
}) {
  const profile = useLoad<CustomerProfile>(
    `/admin/customers/${encodeURIComponent(customerId)}`,
    revision,
  );
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [productId, setProductId] = useState(""),
    [page, setPage] = useState(1),
    [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({
    customerId,
    search: useDebouncedValue(search),
    status,
    page: String(page),
    ...(productId ? { productId } : {}),
  });
  const licenses = useLoad<Page<License>>(
    profile.data?.id === customerId ? `/admin/licenses?${query}` : null,
    revision,
  );
  const customer = profile.data;
  useEffect(() => {
    if (customer) document.title = `${customer.name} · Customers · Keydock`;
  }, [customer]);
  const reset = () => {
    setSearch("");
    setStatus("all");
    setProductId("");
    setPage(1);
  };
  const refresh = () => {
    profile.reload();
    licenses.reload();
  };
  const filtered = !!search || status !== "all" || !!productId;
  const exportLicenses = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/v1/admin/licenses/export?${query}`, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("Export failed. Refresh the customer and try again.");
      download(
        `keydock-customer-${customerId}.csv`,
        await response.text(),
        "text/csv",
      );
      notify("Customer licenses exported. Raw keys are excluded.");
    } catch (error) {
      notify(message(error), "error");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="customer-workspace">
      <a className="back-link" href="#/customers">
        <ArrowLeft size={15} /> All customers
      </a>
      {profile.error && (
        <div className="panel customer-load-error">
          <ErrorBox error={profile.error} />
          <button className="button" onClick={profile.reload}>
            Try again
          </button>
        </div>
      )}
      {!customer && !profile.error && <Loading />}
      {customer && (
        <>
          <header className="customer-heading">
            <div className="customer-identity">
              <span className="customer-profile-avatar" aria-hidden="true">
                {customer.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div>
                <span className="record-kind">Customer</span>
                <h1>{customer.name}</h1>
                <p>{customer.email}</p>
              </div>
            </div>
            <div className="customer-heading-actions">
              <CopyButton
                value={`${location.origin}${location.pathname}#/customers/${customer.id}`}
                label="Copy profile link"
                notify={notify}
              />
              {canWrite && (
                <button
                  className="button primary"
                  onClick={() => onIssue(customer)}
                >
                  <Plus size={16} /> Issue license
                </button>
              )}
            </div>
          </header>
          <dl
            className="customer-metrics"
            aria-label="Customer license summary"
          >
            <div>
              <dt>Assigned licenses</dt>
              <dd>{number(customer.licenses)}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>
                {number(customer.summary.active)}
                <span>of {number(customer.licenses)}</span>
              </dd>
            </div>
            <div>
              <dt>Registered devices</dt>
              <dd>{number(customer.summary.devices)}</dd>
            </div>
            <div>
              <dt>Expiring in 7 days</dt>
              <dd
                className={
                  customer.summary.expiring ? "attention-value" : undefined
                }
              >
                {number(customer.summary.expiring)}
              </dd>
            </div>
          </dl>
          <div className="customer-workspace-grid">
            <div className="customer-license-column">
              <section
                className="panel customer-licenses"
                aria-label="Customer licenses"
              >
                <div className="section-heading">
                  <div>
                    <h2>
                      Licenses{" "}
                      <span className="section-count">
                        {number(customer.licenses)}
                      </span>
                    </h2>
                    <p>Keys currently assigned to this customer.</p>
                  </div>
                  <div className="button-row">
                    <button
                      className="icon-button"
                      aria-label="Refresh customer"
                      onClick={refresh}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      className="button subtle"
                      disabled={exporting || !customer.licenses}
                      onClick={exportLicenses}
                    >
                      <Download size={15} />
                      {exporting ? "Exporting…" : "Export"}
                    </button>
                  </div>
                </div>
                <div className="filter-row customer-license-filters">
                  <SearchInput
                    value={search}
                    onChange={(value) => {
                      setSearch(value);
                      setPage(1);
                    }}
                    placeholder="Search this customer’s licenses…"
                  />
                  <div className="filters">
                    <select
                      aria-label="Customer license product"
                      value={productId}
                      onChange={(event) => {
                        setProductId(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All products</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Customer license status"
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value);
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
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value === "all"
                            ? "All statuses"
                            : value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {filtered && (
                  <div className="active-filters">
                    <span>
                      {number(licenses.data?.total ?? 0)} matching{" "}
                      {licenses.data?.total === 1 ? "license" : "licenses"}
                    </span>
                    <button className="text-link" onClick={reset}>
                      Clear filters
                    </button>
                  </div>
                )}
                <ErrorBox error={licenses.error} />
                {licenses.loading && !licenses.data ? (
                  <Loading />
                ) : licenses.data?.items.length ? (
                  <div aria-busy={licenses.loading}>
                    <LicenseTable
                      items={licenses.data.items}
                      onSelect={onSelect}
                      hideCustomer
                    />
                  </div>
                ) : (
                  !licenses.error && (
                    <Empty
                      icon={<KeyRound size={25} />}
                      title={
                        filtered
                          ? "No matching licenses"
                          : "No licenses assigned"
                      }
                      text={
                        filtered
                          ? "Try another search or clear the filters for this customer."
                          : "New licenses issued from this profile will be assigned here automatically."
                      }
                      action={
                        filtered ? (
                          <button className="button" onClick={reset}>
                            Clear filters
                          </button>
                        ) : canWrite ? (
                          <button
                            className="button primary"
                            onClick={() => onIssue(customer)}
                          >
                            <Plus size={15} /> Issue license
                          </button>
                        ) : undefined
                      }
                    />
                  )
                )}
                <Pagination
                  page={page}
                  total={licenses.data?.total ?? 0}
                  onChange={setPage}
                />
              </section>
              <div
                className="customer-state-summary"
                aria-label="Other license states"
              >
                <span>
                  <i className="state-dot expired" />
                  {number(customer.summary.expired)} expired
                </span>
                <span>
                  <i className="state-dot suspended" />
                  {number(customer.summary.suspended)} suspended
                </span>
                <span>
                  <i className="state-dot revoked" />
                  {number(customer.summary.revoked)} revoked
                </span>
                <span className="customer-product-count">
                  Across {number(customer.summary.products)}{" "}
                  {customer.summary.products === 1 ? "product" : "products"}
                </span>
              </div>
            </div>
            <aside className="customer-sidebar" aria-label="Customer record">
              <section className="customer-record-section">
                <div className="record-section-heading">
                  <h2>Customer record</h2>
                  {canWrite && (
                    <button
                      className="icon-button"
                      aria-label="Edit customer"
                      onClick={() => onEdit(customer)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                <dl className="customer-record-fields">
                  <div>
                    <dt>Email</dt>
                    <dd>
                      <Mail size={14} />
                      <span>{customer.email}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>External reference</dt>
                    <dd>
                      <code>{customer.externalId || "Not set"}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Customer since</dt>
                    <dd>{date(customer.createdAt)}</dd>
                  </div>
                </dl>
              </section>
              <section className="customer-record-section">
                <div className="record-section-heading">
                  <h2>Team notes</h2>
                  {canWrite && (
                    <button
                      className="text-link"
                      onClick={() => onEdit(customer)}
                    >
                      {customer.notes ? "Edit" : "Add note"}
                      <ArrowUpRight size={13} />
                    </button>
                  )}
                </div>
                <p
                  className={`customer-notes ${customer.notes ? "" : "is-empty"}`}
                >
                  {customer.notes || "No notes yet."}
                </p>
                <small className="record-footnote">
                  Visible to your workspace team.
                </small>
              </section>
              <section className="customer-record-section">
                <h2>Recent activity</h2>
                <dl className="customer-record-fields">
                  <div>
                    <dt>Last license issued</dt>
                    <dd>
                      {customer.summary.latestLicenseAt
                        ? dateTime(customer.summary.latestLicenseAt)
                        : "No licenses yet"}
                    </dd>
                  </div>
                  <div>
                    <dt>Last device seen</dt>
                    <dd>
                      {customer.summary.lastSeenAt
                        ? dateTime(customer.summary.lastSeenAt)
                        : "No device activity"}
                    </dd>
                  </div>
                </dl>
                <p className="record-footnote">
                  Registered devices exclude released activations.
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
