import { proxyApi } from "./worker.js";

interface ApiProxyEnv {
  /** Fixed server-side origin. Never take this value from request data. */
  VMMS_API_ORIGIN?: string;
  /** Server-only Vercel deployment-protection bypass for the upstream Preview API. */
  VMMS_API_PROTECTION_BYPASS?: string;
  VMMS_DEPLOYMENT_STAGE?: string;
  NODE_ENV?: string;
}

export default {
  fetch(request: Request, env: ApiProxyEnv): Promise<Response> | Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return proxyApi(request, env.VMMS_API_ORIGIN, env.VMMS_API_PROTECTION_BYPASS,
        env.VMMS_DEPLOYMENT_STAGE ?? env.NODE_ENV);
    }
    return Response.json(
      { error: { code: "NOT_FOUND", message: "This service only handles VMMS API requests." } },
      { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  },
};
