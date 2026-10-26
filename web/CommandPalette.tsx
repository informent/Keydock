import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  Box,
  CornerDownLeft,
  KeyRound,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useDebouncedValue, useLoad } from "./api";
import { ErrorBox, Modal } from "./components";
import { useTheme } from "./theme";
import type { Customer, License, Page } from "./types";

type Command = {
  id: string;
  label: string;
  detail: string;
  group: string;
  icon: LucideIcon;
  action: () => void;
};

export function CommandPalette({
  pages,
  canWrite,
  onClose,
  onIssue,
  onProduct,
  onCustomer,
  onSelect,
}: {
  pages: { id: string; label: string; icon: LucideIcon }[];
  canWrite: boolean;
  onClose: () => void;
  onIssue: () => void;
  onProduct: () => void;
  onCustomer: () => void;
  onSelect: (license: License) => void;
}) {
  const [search, setSearch] = useState(""),
    [active, setActive] = useState(0);
  const query = search.trim().toLowerCase(),
    stableQuery = useDebouncedValue(query);
  const licensePath =
    stableQuery.length >= 2
      ? `/admin/licenses?limit=5&search=${encodeURIComponent(stableQuery)}`
      : null;
  const licenses = useLoad<Page<License>>(licensePath);
  const customerPath =
    stableQuery.length >= 2
      ? `/admin/customers?limit=5&search=${encodeURIComponent(stableQuery)}`
      : null;
  const customers = useLoad<Page<Customer>>(customerPath);
  const searching =
    query.length >= 2 &&
    (query !== stableQuery || licenses.loading || customers.loading);
  const { theme, toggle } = useTheme(),
    listId = useId();
  const commands: Command[] = [
    ...pages.map((page) => ({
      id: page.id,
      label: page.label,
      detail: "Open page",
      group: "Workspace",
      icon: page.icon,
      action: () => {
        location.hash = `/${page.id}`;
      },
    })),
    ...(canWrite
      ? [
          {
            id: "issue",
            label: "Issue license",
            detail: "Create a new license key",
            group: "Quick actions",
            icon: Plus,
            action: onIssue,
          },
          {
            id: "product",
            label: "Create product",
            detail: "Add an application",
            group: "Quick actions",
            icon: Box,
            action: onProduct,
          },
          {
            id: "customer",
            label: "Add customer",
            detail: "Add a customer record",
            group: "Quick actions",
            icon: Users,
            action: onCustomer,
          },
        ]
      : []),
    {
      id: "theme",
      label: `Switch to ${theme === "light" ? "dark" : "light"} theme`,
      detail: "Change appearance",
      group: "Quick actions",
      icon: theme === "light" ? Moon : Sun,
      action: toggle,
    },
  ].filter((command) =>
    `${command.label} ${command.detail}`.toLowerCase().includes(query),
  );
  if (
    query.length >= 2 &&
    stableQuery === query &&
    licenses.dataPath === licensePath &&
    !searching &&
    !licenses.error
  ) {
    commands.push(
      ...(licenses.data?.items ?? []).map((license) => ({
        id: license.id,
        label: license.label,
        detail: `${license.productName} · ${license.customerName ?? "Unassigned"} · ${license.status}`,
        group: "Licenses",
        icon: KeyRound,
        action: () => onSelect(license),
      })),
    );
  }
  if (
    query.length >= 2 &&
    stableQuery === query &&
    !searching &&
    customers.dataPath === customerPath &&
    !customers.error
  ) {
    commands.push(
      ...(customers.data?.items ?? []).map((customer) => ({
        id: `customer-${customer.id}`,
        label: customer.name,
        detail: `${customer.email} · ${customer.licenses} ${customer.licenses === 1 ? "license" : "licenses"}`,
        group: "Customers",
        icon: Users,
        action: () => {
          location.hash = `/customers/${customer.id}`;
        },
      })),
    );
  }
  const selected = Math.min(active, Math.max(commands.length - 1, 0));
  useEffect(() => setActive(0), [search]);
  useEffect(() => {
    document
      .getElementById(`${listId}-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, listId]);
  const run = (command: Command) => {
    onClose();
    command.action();
  };

  return (
    <Modal
      title="Search workspace"
      description="Find a page, customer, or license. Run an action."
      onClose={onClose}
      className="command-modal"
    >
      <div className="command-input">
        <Search size={21} />
        <input
          autoFocus
          role="combobox"
          aria-label="Search workspace commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            commands.length ? `${listId}-${selected}` : undefined
          }
          placeholder="Where would you like to go?"
          maxLength={120}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (!commands.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(
                (selected +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  commands.length) %
                  commands.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(commands[selected]);
            }
          }}
        />
        {searching ? (
          <LoaderCircle
            size={17}
            className="spin"
            aria-label="Searching licenses"
          />
        ) : (
          <kbd>esc</kbd>
        )}
      </div>
      <div
        className="command-results"
        id={listId}
        role="listbox"
        aria-label="Workspace commands"
        aria-busy={searching}
      >
        {commands.map((command, index) => (
          <div key={command.id}>
            {commands[index - 1]?.group !== command.group && (
              <div className="command-group">{command.group}</div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={selected === index}
              id={`${listId}-${index}`}
              tabIndex={-1}
              className={`command-item ${selected === index ? "selected" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className="command-icon">
                <command.icon size={19} />
              </span>
              <span>
                <strong>{command.label}</strong>
                <small>{command.detail}</small>
              </span>
              {selected === index ? (
                <CornerDownLeft size={15} />
              ) : (
                <ArrowUpRight size={15} />
              )}
            </button>
          </div>
        ))}
        {!commands.length && !searching && (
          <div className="command-empty">
            <Search size={25} />
            <strong>No matches found</strong>
            <span>Try a page name, action, customer, or license label.</span>
          </div>
        )}
        <ErrorBox
          error={
            query.length >= 2 && stableQuery === query
              ? [licenses.error, customers.error].filter(Boolean).join(" ")
              : ""
          }
        />
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
        <span>KEYDOCK</span>
      </div>
    </Modal>
  );
}
