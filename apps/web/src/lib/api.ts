export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export const READ_ONLY_EVENT = "ff:read-only-view";

export async function api<T>(path: string, opts: { method?: Method; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network_error", "We couldn't reach First Five. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    // Writes are refused while an admin views the app as a client; the banner tells them why.
    if (err?.code === "read_only_view") window.dispatchEvent(new CustomEvent(READ_ONLY_EVENT, { detail: err.message }));
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong. Please try again.", err?.fields);
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: "DELETE", body });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.fields ? err.fields : {};
}
