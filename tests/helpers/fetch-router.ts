export interface RecordedRequest {
  method: string;
  url: string;
  /** Host plus path, with no query string. */
  where: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
}

export type FetchHandler = (request: RecordedRequest) => Response | undefined | Promise<Response | undefined>;

/** A fetch that records every call and answers from `handler`. Unmatched calls get a JSON 404. */
export function fetchRouter(handler: FetchHandler): { fetchImpl: typeof fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = init?.body;
    const body = typeof raw === "string" ? raw : raw instanceof URLSearchParams ? raw.toString() : raw ? String(raw) : "";
    const request: RecordedRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: url.toString(),
      where: `${url.host}${url.pathname}`,
      query: url.searchParams,
      headers,
      body,
    };
    calls.push(request);
    return (await handler(request)) ?? json({ error: "not mocked" }, 404);
  };
  return { fetchImpl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function bodyOf(request: RecordedRequest | undefined): unknown {
  if (!request?.body) return undefined;
  try {
    return JSON.parse(request.body);
  } catch {
    return request.body;
  }
}

/** Resolve once `predicate` holds. The bot handles chat on promise chains the test cannot await directly. */
export async function until(predicate: () => boolean, label = "condition", timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
