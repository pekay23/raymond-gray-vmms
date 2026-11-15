import { proxyApi } from "./worker.js";

interface ApiProxyEnv {
  /** Fixed server-side origin. Never take this value from request data. */
  VMMS_API_ORIGIN?: string;
}

export default {
  fetch(request: Request, env: ApiProxyEnv): Promise<Response> | Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return proxyApi(request, env.VMMS_API_ORIGIN);
    }
    return Response.json(
      { error: { code: "NOT_FOUND", message: "This service only handles VMMS API requests." } },
      { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  },
};
