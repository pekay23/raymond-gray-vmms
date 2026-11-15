import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import apiProxyWorker from "./api-proxy.js";
import worker from "./worker.js";

let apiOrigin = "";
let server: ReturnType<typeof createServer>;
let lastRequest: { url: string; method: string; headers: IncomingMessage["headers"]; body: string } | undefined;

function capturedRequest() {
  return lastRequest as { url: string; method: string; headers: IncomingMessage["headers"]; body: string } | undefined;
}

function respond(_request: IncomingMessage, response: ServerResponse, status: number, headers: Record<string, string | string[]>, body: string) {
  response.writeHead(status, headers);
  response.end(body);
}

before(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    lastRequest = {
      url: request.url ?? "",
      method: request.method ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };

    if (request.url?.startsWith("/api/v1/auth/oidc/start")) {
      respond(request, response, 302, {
        location: "https://accounts.google.com/o/oauth2/v2/auth",
        "set-cookie": ["vmms_csrf=signed; Path=/; SameSite=Strict", "vmms_session=session; Path=/; HttpOnly; SameSite=Strict"],
      }, "");
      return;
    }
    if (request.url?.startsWith("/api/v1/failure")) {
      response.destroy(new Error("synthetic upstream disconnect"));
      return;
    }
    respond(request, response, 409, { "content-type": "application/json", "cache-control": "public, max-age=3600" }, JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  apiOrigin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

test("API requests use the fixed origin and preserve path, query, auth and body", async () => {
  lastRequest = undefined;
  const response = await worker.fetch(new Request("https://vmms.example/api/v1/session?view=current", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "vmms_session=session-token",
      origin: "https://vmms.example",
      "x-csrftoken": "signed-token",
      authorization: "Bearer synthetic-token",
      connection: "x-internal-user",
      "x-internal-user": "spoofed",
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.99",
      forwarded: "for=203.0.113.99;proto=https",
      "cf-connecting-ip": "203.0.113.99",
    },
    body: JSON.stringify({ action: "refresh" }),
  }), { VMMS_API_ORIGIN: apiOrigin, ASSETS: { fetch: async () => new Response() } });

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { ok: true });
  const captured = capturedRequest();
  assert.equal(captured?.url, "/api/v1/session?view=current");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.headers.cookie, "vmms_session=session-token");
  assert.equal(captured?.headers.origin, "https://vmms.example");
  assert.equal(captured?.headers["x-csrftoken"], "signed-token");
  assert.equal(captured?.headers.authorization, "Bearer synthetic-token");
  assert.equal(captured?.headers["x-forwarded-for"], undefined);
  assert.equal(captured?.headers["x-real-ip"], undefined);
  assert.equal(captured?.headers.forwarded, undefined);
  assert.equal(captured?.headers["cf-connecting-ip"], undefined);
  assert.equal(captured?.headers["x-internal-user"], undefined);
  assert.deepEqual(JSON.parse(captured?.body ?? "{}"), { action: "refresh" });
});

test("OIDC redirects and cookies return to the browser without following the provider redirect", async () => {
  const response = await worker.fetch(new Request("https://vmms.example/api/v1/auth/oidc/start", { method: "POST" }), {
    VMMS_API_ORIGIN: apiOrigin,
    ASSETS: { fetch: async () => new Response() },
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth");
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.().join("\n") ?? response.headers.get("set-cookie") ?? "";
  assert.match(setCookies, /vmms_csrf=signed/);
  assert.match(setCookies, /vmms_session=session/);
  assert.equal(capturedRequest()?.url, "/api/v1/auth/oidc/start");
});

test("request parameters cannot change the upstream destination", async () => {
  lastRequest = undefined;
  await worker.fetch(new Request("https://vmms.example/api/v1/session?url=https%3A%2F%2Fevil.example"), {
    VMMS_API_ORIGIN: apiOrigin,
    ASSETS: { fetch: async () => new Response() },
  });

  assert.equal(capturedRequest()?.url, "/api/v1/session?url=https%3A%2F%2Fevil.example");
  assert.equal(capturedRequest()?.headers.host, `127.0.0.1:${new URL(apiOrigin).port}`);
});

test("unset or unsafe API origins fail closed without calling an upstream", async () => {
  lastRequest = undefined;
  for (const value of [undefined, "http://api.example", "https://user:pass@api.example", "https://api.example/proxy", "https://vmms.example"]) {
    const response = await worker.fetch(new Request("https://vmms.example/api/v1/session"), {
      ...(value === undefined ? {} : { VMMS_API_ORIGIN: value }),
      ASSETS: { fetch: async () => new Response() },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json() as { error: { code: string } }).error.code, "API_UNAVAILABLE");
  }
  assert.equal(lastRequest, undefined);
});

test("upstream network errors return a non-cacheable service response", async () => {
  const response = await worker.fetch(new Request("https://vmms.example/api/v1/failure"), {
    VMMS_API_ORIGIN: apiOrigin,
    ASSETS: { fetch: async () => new Response() },
  });

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json() as { error: { code: string } }).error.code, "API_UPSTREAM_UNAVAILABLE");
});

test("non-API paths continue to use static assets", async () => {
  const assetRequest = new Request("https://vmms.example/sites/site-a/overview");
  const expected = new Response("spa");
  const response = await worker.fetch(assetRequest, {
    VMMS_API_ORIGIN: apiOrigin,
    ASSETS: { fetch: async (request) => {
      assert.equal(request, assetRequest);
      return expected;
    } },
  });

  assert.equal(response, expected);
});

test("dedicated API-only Worker uses the shared safe proxy and rejects non-API paths", async () => {
  lastRequest = undefined;
  const response = await apiProxyWorker.fetch(new Request("https://api.example/api/v1/session"), { VMMS_API_ORIGIN: apiOrigin });
  assert.equal(response.status, 409);
  assert.equal(capturedRequest()?.url, "/api/v1/session");

  const notFound = await apiProxyWorker.fetch(new Request("https://api.example/"), { VMMS_API_ORIGIN: apiOrigin });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get("cache-control"), "no-store");
  assert.equal(capturedRequest()?.url, "/api/v1/session", "Non-API paths must not reach the upstream service.");
});
