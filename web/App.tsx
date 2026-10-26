import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Rows3,
  Settings,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, message, setCsrf, useLoad } from "./api";
import { Brand, ErrorBox, Field, Loading } from "./components";
import { CommandPalette } from "./CommandPalette";
import { CustomerWorkspace } from "./CustomerWorkspace";
import { ThemeToggle } from "./theme";
import {
  IssueLicense,
  LicenseDetail,
  Licenses,
  SecretDelivery,
} from "./Licenses";
import {
  ActivityPage,
  CustomerForm,
  CustomersPage,
  DevelopersPage,
  OverviewPage,
  ProductForm,
  ProductsPage,
  SettingsPage,
} from "./Workspace";
import type {
  Customer,
  License,
  Meta,
  Notify,
  Product,
  Session,
} from "./types";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const metadata = await api<Meta>("/meta");
        if (cancelled) return;
        setMeta(metadata);
        if (!metadata.setupRequired) {
          try {
            const current = await api<Session>("/auth/session");
            if (!cancelled) {
              setCsrf(current.csrf);
              setSession(current);
            }
          } catch (error) {
            if ((error as { status?: number }).status !== 401) throw error;
          }
        }
      } catch (error) {
        if (!cancelled) setError(message(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  useEffect(() => {
    const expired = () => {
      setCsrf("");
      setSession(null);
    };
    window.addEventListener("keydock:expired", expired);
    return () => window.removeEventListener("keydock:expired", expired);
  }, []);
  const signedOut = () => {
    setCsrf("");
    setSession(null);
  };
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (error || !meta)
    return (
      <div className="boot">
        <Brand />
        <ErrorBox error={error || "Could not load your workspace."} />
        <button
          className="button primary"
          onClick={() => setAttempt(attempt + 1)}
        >
          Retry connection
        </button>
      </div>
    );
  if (!session)
    return (
      <Authentication
        setup={meta.setupRequired}
        onSuccess={(session) => {
          setCsrf(session.csrf);
          setSession(session);
          setMeta({ ...meta, setupRequired: false });
        }}
      />
    );
  return <Console meta={meta} session={session} onSignedOut={signedOut} />;
}

function Authentication({
  setup,
  onSuccess,
}: {
  setup: boolean;
  onSuccess: (session: Session) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(data);
      const session = await api<Session>(
        setup ? "/auth/setup" : "/auth/login",
        { method: "POST", body: fields },
      );
      onSuccess(session);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <div className="auth-appearance">
        <ThemeToggle />
      </div>
      <section className="auth-intro">
        <Brand />
        <div className="auth-story">
          <span className="auth-kicker">LICENSING, ON YOUR TERMS</span>
          <h1>
            Your software.
            <br />
            Your keys.
            <br />
            <span>Your control.</span>
          </h1>
          <p>
            A home for every product, license, and customer. Built to run on
            infrastructure you own.
          </p>
          <div className="auth-points">
            <span>
              <ShieldCheck size={19} />
              Signed offline licenses
            </span>
            <span>
              <Box size={19} />
              Unlimited products
            </span>
            <span>
              <Code2 size={19} />
              Open source, all the way
            </span>
          </div>
          <div className="auth-network" aria-hidden="true">
            <span className="network-node">
              <Box size={19} />
              <small>Your app</small>
            </span>
            <span className="network-path" />
            <span className="network-hub">
              <KeyRound size={27} />
            </span>
            <span className="network-path" />
            <span className="network-node">
              <ShieldCheck size={19} />
              <small>Signed access</small>
            </span>
          </div>
        </div>
        <span className="auth-footer">
          KEYDOCK <span>/</span> SELF-HOSTED LICENSING
        </span>
      </section>
      <section className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="auth-symbol">
            <KeyRound size={25} />
          </span>
          <h2>{setup ? "Welcome to your workspace" : "Welcome back"}</h2>
          <p>
            {setup
              ? "Create the owner account for this Keydock instance."
              : "Sign in to manage your software licenses."}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={busy} className="form-fields">
              {setup && (
                <Field label="Your name">
                  <input
                    name="name"
                    autoComplete="name"
                    maxLength={120}
                    required
                    autoFocus
                  />
                </Field>
              )}
              <Field label="Email address">
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={254}
                  required
                  autoFocus={!setup}
                  placeholder="you@company.com"
                />
              </Field>
              <Field
                label="Password"
                hint={
                  setup
                    ? "At least 14 characters. A long passphrase works well."
                    : undefined
                }
              >
                <div className="password-control">
                  <input
                    aria-label="Password"
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={setup ? "new-password" : "current-password"}
                    minLength={setup ? 14 : 1}
                    maxLength={256}
                    required
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              {setup && (
                <Field
                  label="Setup token"
                  hint="Copy setupToken from identity.json in your server’s data directory. This is required only once."
                >
                  <input
                    name="setupToken"
                    type="password"
                    autoComplete="off"
                    minLength={20}
                    maxLength={200}
                    required
                  />
                </Field>
              )}
              <ErrorBox error={error} />
              <button className="button primary auth-submit" type="submit">
                {busy ? <LoaderCircle size={18} className="spin" /> : null}
                {setup ? "Create workspace" : "Sign in"}
                {!busy && <ArrowRight size={17} />}
              </button>
            </fieldset>
          </form>
          <div className="auth-private">
            <ShieldCheck size={16} />
            Connected directly to your Keydock instance.
          </div>
        </div>
        <a
          className="auth-source"
          href="https://github.com/informent/Keydock"
          target="_blank"
          rel="noreferrer"
        >
          Open source on GitHub
          <ExternalLink size={13} />
        </a>
      </section>
    </main>
  );
}

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "licenses", label: "Licenses", icon: KeyRound },
  { id: "products", label: "Products", icon: Box },
  { id: "customers", label: "Customers", icon: Users },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "developers", label: "Developers", icon: Code2 },
  { id: "settings", label: "Settings", icon: Settings },
];
function Console({
  meta,
  session,
  onSignedOut,
}: {
  meta: Meta;
  session: Session;
  onSignedOut: () => void;
}) {
  const readRoute = () =>
    location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
  const [route, setRoute] = useState(readRoute),
    [compact, setCompact] = useState(() => {
      try {
        return localStorage.getItem("keydock:compact-tables") !== "false";
      } catch {
        return true;
      }
    }),
    [mobile, setMobile] = useState(false),
    [command, setCommand] = useState(false),
    [revision, setRevision] = useState(0),
    [issue, setIssue] = useState(false),
    [issueCustomer, setIssueCustomer] = useState<Customer | null>(null),
    [productForm, setProductForm] = useState<Product | "new" | null>(null),
    [customerForm, setCustomerForm] = useState<Customer | "new" | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [secrets, setSecrets] = useState<{
      items?: License[];
      token?: string;
    } | null>(null),
    [toast, setToast] = useState<{
      text: string;
      kind: "success" | "error";
    } | null>(null),
    [signingOut, setSigningOut] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("keydock:compact-tables", String(compact));
    } catch {
      // The current session still supports density changes without storage.
    }
  }, [compact]);
  const customerId = route.match(/^customers\/([^/]+)$/)?.[1] ?? null,
    pageRoute = customerId ? "customers" : route;
  const products = useLoad<{ items: Product[] }>("/admin/products", revision),
    canWrite = session.user.role !== "viewer",
    isOwner = session.user.role === "owner";
  useEffect(() => {
    const changed = () => {
      setRoute(readRoute());
      setMobile(false);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.title = `${navigation.find((item) => item.id === pageRoute)?.label ?? "Not found"} · Keydock`;
  }, [route, pageRoute]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        if (document.querySelector("dialog[open]") && !command) return;
        event.preventDefault();
        setMobile(false);
        setCommand((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [command]);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ) ?? []),
      ].filter((element) => element.getClientRects().length);
    sidebar.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.focus();
    document.body.classList.add("navigation-open");
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobile(false);
      }
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const wide = matchMedia("(min-width: 901px)");
    const resize = () => {
      if (wide.matches) setMobile(false);
    };
    window.addEventListener("keydown", handle);
    wide.addEventListener("change", resize);
    return () => {
      document.body.classList.remove("navigation-open");
      window.removeEventListener("keydown", handle);
      wide.removeEventListener("change", resize);
      previous?.focus();
    };
  }, [mobile]);
  const notify: Notify = (text, kind = "success") => setToast({ text, kind });
  const refresh = () => setRevision((value) => value + 1),
    openIssue = () => {
      setIssueCustomer(null);
      setIssue(true);
    },
    openCustomerIssue = (customer: Customer) => {
      setIssueCustomer(customer);
      setIssue(true);
    },
    openProduct = () => setProductForm("new"),
    openLicense = (license: License) => setSelected(license.id);
  const common = { revision, canWrite, notify },
    productList = products.data?.items ?? [],
    initials = session.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  let content;
  switch (pageRoute) {
    case "overview":
      content = (
        <OverviewPage
          {...common}
          userName={session.user.name}
          onIssue={openIssue}
          onProduct={openProduct}
          onSelect={openLicense}
        />
      );
      break;
    case "licenses":
      content = (
        <Licenses
          {...common}
          products={productList}
          onIssue={openIssue}
          onSelect={openLicense}
        />
      );
      break;
    case "products":
      content = (
        <ProductsPage
          products={productList}
          canWrite={canWrite}
          onCreate={openProduct}
          onEdit={setProductForm}
        />
      );
      break;
    case "customers":
      content = customerId ? (
        <CustomerWorkspace
          key={customerId}
          {...common}
          customerId={customerId}
          products={productList}
          onEdit={setCustomerForm}
          onIssue={openCustomerIssue}
          onSelect={openLicense}
        />
      ) : (
        <CustomersPage
          {...common}
          onCreate={() => setCustomerForm("new")}
          onEdit={setCustomerForm}
        />
      );
      break;
    case "activity":
      content = <ActivityPage {...common} isOwner={isOwner} />;
      break;
    case "developers":
      content = (
        <DevelopersPage
          {...common}
          meta={meta}
          products={productList}
          isOwner={isOwner}
          onChanged={refresh}
          onToken={(token) => setSecrets({ token })}
        />
      );
      break;
    case "settings":
      content = (
        <SettingsPage
          {...common}
          user={session.user}
          meta={meta}
          onChanged={refresh}
          onSignedOut={onSignedOut}
        />
      );
      break;
    default:
      content = (
        <div className="empty">
          <h1>Page not found</h1>
          <p>Choose a page from your workspace navigation.</p>
          <a className="button primary" href="#/overview">
            Go to overview
          </a>
        </div>
      );
  }
  return (
    <div
      className="app-shell"
      data-density={compact ? "compact" : "comfortable"}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        ref={sidebar}
        className={`sidebar ${mobile ? "open" : ""}`}
        aria-label="Workspace sidebar"
      >
        <div className="sidebar-brand">
          <Brand small />
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-icon">K</span>
          <div>
            <strong>Licensing console</strong>
            <span>Self-hosted instance</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {navigation.map((item, index) => (
            <a
              className={`${pageRoute === item.id ? "active" : ""} ${index === 5 ? "nav-separated" : ""}`}
              href={`#/${item.id}`}
              onClick={() => setMobile(false)}
              aria-current={pageRoute === item.id ? "page" : undefined}
              key={item.id}
            >
              <item.icon size={18} />
              {item.label}
              {pageRoute === item.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="instance-card">
            <ShieldCheck size={19} />
            <strong>Instance settings</strong>
            <a href="#/settings" onClick={() => setMobile(false)}>
              Manage instance <ArrowRight size={14} />
            </a>
          </div>
          <a
            className="sidebar-docs"
            href="https://github.com/informent/Keydock"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={16} />
            Documentation
            <ExternalLink size={13} />
          </a>
          <div className="sidebar-user">
            <span className="avatar">{initials}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span>{session.user.role}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await api("/auth/logout", { method: "POST" });
                  onSignedOut();
                } catch (error) {
                  notify(message(error), "error");
                  setSigningOut(false);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={mobile}>
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={13} />
            <span>
              {navigation.find((item) => item.id === pageRoute)?.label ??
                "Not found"}
            </span>
          </div>
          <div className="topbar-meta">
            <button
              className="command-trigger"
              onClick={() => setCommand(true)}
              aria-label="Search workspace"
              aria-keyshortcuts="Control+k Meta+k"
            >
              <Search size={16} />
              <span>Search workspace</span>
              <kbd>
                {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}
              </kbd>
            </button>
            <button
              className="density-toggle icon-button"
              aria-label="Compact tables"
              aria-pressed={compact}
              title={
                compact
                  ? "Switch to comfortable tables"
                  : "Switch to compact tables"
              }
              onClick={() => setCompact((value) => !value)}
            >
              <Rows3 size={17} />
            </button>
            <ThemeToggle />
            <span className="self-hosted">
              <span />
              Self-hosted
            </span>
            <span
              className="topbar-avatar"
              aria-label={`${session.user.name}, ${session.user.role}`}
            >
              {initials}
            </span>
          </div>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <ErrorBox error={products.error} />
          {content}
          <footer className="content-footer">
            <span>Keydock · Licensing infrastructure you own.</span>
            <a
              href="https://github.com/informent/Keydock/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              Open source / MIT
              <ArrowRight size={12} />
            </a>
          </footer>
        </main>
      </div>
      {command && (
        <CommandPalette
          pages={navigation}
          canWrite={canWrite}
          onClose={() => setCommand(false)}
          onIssue={openIssue}
          onProduct={openProduct}
          onCustomer={() => setCustomerForm("new")}
          onSelect={openLicense}
        />
      )}
      {issue && (
        <IssueLicense
          products={productList}
          initialCustomer={issueCustomer}
          onClose={() => setIssue(false)}
          onProduct={() => {
            setIssue(false);
            setProductForm("new");
          }}
          onIssued={(items) => {
            setIssue(false);
            setSecrets({ items });
            refresh();
          }}
        />
      )}
      {productForm && (
        <ProductForm
          product={productForm === "new" ? undefined : productForm}
          canWrite={canWrite}
          onClose={() => setProductForm(null)}
          onSaved={() => {
            setProductForm(null);
            refresh();
            notify("Product saved.");
          }}
        />
      )}
      {customerForm && (
        <CustomerForm
          customer={customerForm === "new" ? undefined : customerForm}
          canWrite={canWrite}
          onClose={() => setCustomerForm(null)}
          onSaved={() => {
            setCustomerForm(null);
            refresh();
            notify("Customer saved.");
          }}
        />
      )}
      {selected && (
        <LicenseDetail
          licenseId={selected}
          canWrite={canWrite}
          notify={notify}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onSecret={(items) => setSecrets({ items })}
        />
      )}
      {secrets && (
        <SecretDelivery
          {...secrets}
          notify={notify}
          onClose={() => setSecrets(null)}
        />
      )}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={`toast ${toast.kind}`}>
            <CheckCircle2 size={18} />
            <span>{toast.text}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
