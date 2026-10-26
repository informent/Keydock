import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  Search,
  X,
  KeyRound,
  ChevronRight,
  Monitor,
  Clock3,
  Box,
} from "lucide-react";
import { date, message, number } from "./api";
import type { License, Notify, Overview } from "./types";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <a
      className={`brand ${small ? "small" : ""}`}
      href="#/overview"
      aria-label="Keydock home"
    >
      <span className="brand-mark">
        <KeyRound size={small ? 20 : 23} />
      </span>
      <span>
        Keydock<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status}`}>
      <span />
      {status[0]?.toUpperCase() + status.slice(1)}
    </span>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error-box">
      <AlertCircle size={18} />
      <span>{error}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={22} className="spin" />
      Loading workspace…
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <KeyRound size={26} />}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  text,
  actions,
}: {
  eyebrow?: string;
  title: string;
  text: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={120}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="icon-button"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Pagination({
  page,
  total,
  limit = 25,
  onChange,
}: {
  page: number;
  total: number;
  limit?: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${number((page - 1) * limit + 1)}–${number(Math.min(page * limit, total))} of ${number(total)}`
          : "0 results"}
      </span>
      <div>
        <button
          className="button subtle"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={14} />
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="button subtle"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
export function CopyButton({
  value,
  notify,
  label = "Copy",
}: {
  value: string;
  notify: Notify;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="button subtle"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          notify(
            "Clipboard access is unavailable. Select and copy the text manually.",
            "error",
          );
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
      {copied ? "Copied" : label}
    </button>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  busy = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        const top = [...document.querySelectorAll("dialog[open]")].at(-1);
        if (previous?.isConnected && (!top || top.contains(previous)))
          previous.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      className={`modal ${wide ? "wide" : ""} ${className}`}
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close.current();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  text,
  label = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  label?: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="modal-body">
        <p className="help-text">{text}</p>
        <ErrorBox error={error} />
      </div>
      <div className="modal-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`button ${danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (error) {
              setError(message(error));
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : null}
          {label}
        </button>
      </div>
    </Modal>
  );
}
export function Form({
  children,
  onSubmit,
  submit = "Save changes",
  onClose,
  footer,
  readOnly = false,
  onBusyChange,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  submit?: string;
  onClose: () => void;
  footer?: ReactNode;
  readOnly?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await onSubmit(data);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <form onSubmit={handle}>
      <fieldset disabled={busy} className="form-fields">
        <div className="modal-body">
          {children}
          <ErrorBox error={error} />
          {footer}
        </div>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button className="button primary" type="submit">
              {busy && <LoaderCircle className="spin" size={16} />} {submit}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          "aria-label": label,
          "aria-describedby": hint ? hintId : undefined,
        })
      : children;
  return (
    <label className="field">
      <span>{label}</span>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function Stats({ data }: { data: Overview | null }) {
  return (
    <div className="stats">
      {[
        {
          label: "Active licenses",
          value: data?.active,
          detail: "Ready to validate",
          tone: "green",
          icon: KeyRound,
        },
        {
          label: "Activated devices",
          value: data?.devices,
          detail: "Currently occupying seats",
          tone: "blue",
          icon: Monitor,
        },
        {
          label: "Expiring soon",
          value: data?.expiring,
          detail: "In the next 7 days",
          tone: "amber",
          icon: Clock3,
        },
        {
          label: "Products",
          value: data?.products,
          detail: "In your workspace",
          tone: "gray",
          icon: Box,
        },
      ].map((stat) => (
        <div className={`stat stat-${stat.tone}`} key={stat.label}>
          <div className="stat-label">
            <span>{stat.label}</span>
            <span className={`stat-indicator ${stat.tone}`}>
              <stat.icon size={18} />
            </span>
          </div>
          <strong>{stat.value === undefined ? "—" : number(stat.value)}</strong>
          <span className="stat-detail">{stat.detail}</span>
        </div>
      ))}
    </div>
  );
}
export function LicenseTable({
  items,
  onSelect,
  hideCustomer = false,
}: {
  items: License[];
  onSelect: (license: License) => void;
  hideCustomer?: boolean;
}) {
  return (
    <div className="table-scroll license-table-wrap">
      <table
        className={`license-table ${hideCustomer ? "without-customer" : ""}`}
      >
        <thead>
          <tr>
            <th>License</th>
            <th>Product</th>
            {!hideCustomer && <th>Customer</th>}
            <th>Status</th>
            <th>Devices</th>
            <th>Expires</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((license) => (
            <tr key={license.id}>
              <td data-label="License">
                <button
                  className="record-button"
                  onClick={() => onSelect(license)}
                >
                  <span className="record-icon">
                    <KeyRound size={17} />
                  </span>
                  <span>
                    <strong>{license.label}</strong>
                    <code>{license.keyHint}</code>
                  </span>
                </button>
              </td>
              <td data-label="Product">
                <span className="product-tag">{license.productName}</span>
              </td>
              {!hideCustomer && (
                <td className="secondary" data-label="Customer">
                  {license.customerName ? (
                    <span className="license-customer">
                      <span className="customer-initial" aria-hidden="true">
                        {license.customerName
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      {license.customerName}
                    </span>
                  ) : (
                    <span className="muted">Unassigned</span>
                  )}
                </td>
              )}
              <td data-label="Status">
                <Badge status={license.status} />
              </td>
              <td data-label="Devices">
                <div className="seat-count">
                  <span>
                    <span
                      className={
                        license.deviceCount >= license.maxDevices
                          ? "device-full"
                          : ""
                      }
                    >
                      {license.deviceCount}
                    </span>
                    <span className="muted"> / {license.maxDevices}</span>
                  </span>
                  <progress
                    value={license.deviceCount}
                    max={license.maxDevices}
                    aria-label={`${license.deviceCount} of ${license.maxDevices} device seats used`}
                  />
                </div>
              </td>
              <td className="secondary nowrap" data-label="Expires">
                {!license.activatedAt && license.durationDays
                  ? `${license.durationDays} days on activation`
                  : date(license.expiresAt)}
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`View ${license.label}`}
                  onClick={() => onSelect(license)}
                >
                  <span className="mobile-detail-label">
                    View license details
                  </span>
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
