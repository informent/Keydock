import { useCallback, useEffect, useState } from "react";

let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-Keydock-CSRF"] = csrf;
  if (options.idempotencyKey)
    headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "Unable to reach Keydock. Check the connection and try again.",
    );
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/admin/"))
      window.dispatchEvent(new Event("keydock:expired"));
    const fields = data.error?.fields
      ?.map(
        (field: { path: string; message: string }) =>
          `${field.path || "Input"}: ${field.message}`,
      )
      .join(". ");
    throw new RequestError(
      fields || data.error?.message || "Request failed",
      data.error?.code ?? "ERROR",
      response.status,
    );
  }
  return data;
}
export function useLoad<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setData(null);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [path, revision, attempt]);
  return { data, error, loading, reload };
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
export const date = (value: number | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value)
    : "No expiry";
export const dateTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
export const number = (value: number) => new Intl.NumberFormat().format(value);
export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
