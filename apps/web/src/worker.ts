interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  /** Fixed server-side origin. Never read this value from a request parameter or header. */
  VMMS_API_ORIGIN?: string;
}

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const forwardedRequestHeaders = [
  "accept",
  "authorization",
  "content-type",
  "cookie",
  "idempotency-key",
  "origin",
  "x-csrftoken",
];

function apiOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function unavailable(status: 502 | 503, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: jsonHeaders });
}

export async function proxyApi(request: Request, originValue: string | undefined): Promise<Response> {
  const origin = apiOrigin(originValue);
  const incomingUrl = new URL(request.url);
  if (!origin || origin.origin === incomingUrl.origin) {
    return unavailable(503, "API_UNAVAILABLE", "The VMMS API is not connected in this preview.");
  }

  const target = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const bodyAllowed = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: request.signal,
    ...(bodyAllowed && request.body ? { body: request.body, duplex: "half" } : {}),
  };

  try {
    const upstream = await fetch(new Request(target, init), { redirect: "manual" });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return unavailable(502, "API_UPSTREAM_UNAVAILABLE", "The VMMS service could not be reached. Try again shortly.");
  }
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return proxyApi(request, env.VMMS_API_ORIGIN);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
