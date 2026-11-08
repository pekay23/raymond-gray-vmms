import { z } from "zod";

const siteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  canWrite: z.boolean(),
});
export const sessionSchema = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    user: z.object({ id: z.string().uuid(), displayName: z.string() }),
    sites: z.array(siteSchema),
  }),
]);
export type Session = z.infer<typeof sessionSchema>;
export type StaffSession = Extract<Session, { authenticated: true }>;
export type Site = z.infer<typeof siteSchema>;

const summarySchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  customerName: z.string(),
  vehicleLabel: z.string(),
  vin: z.string(),
  registration: z.string(),
  status: z.literal("intakeDraft"),
  complaintCount: z.number().int(),
  openHoldCount: z.number().int(),
});
export const listSchema = z.object({
  items: z.array(summarySchema),
  totals: z.object({
    open: z.number().int(),
    held: z.number().int(),
    intakeDrafts: z.number().int(),
  }),
  asOf: z.string(),
});
export const detailSchema = summarySchema.extend({
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    phone: z.string(),
    email: z.string(),
  }),
  vehicle: z.object({
    id: z.string().uuid(),
    vin: z.string(),
    registration: z.string(),
    make: z.string(),
    model: z.string(),
  }),
  odometerKm: z.number(),
  socPercent: z.number().nullable(),
  complaints: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      wording: z.string(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      title: z.string(),
      complaintId: z.string().uuid(),
      state: z.literal("planned"),
    }),
  ),
  holds: z.array(
    z.object({
      id: z.string().uuid(),
      category: z.enum([
        "safety",
        "approval",
        "parts",
        "equipment",
        "competency",
        "other",
      ]),
      severity: z.enum(["stop", "warning"]),
      reason: z.string(),
      source: z.string(),
      taskId: z.string().uuid().nullable(),
      openedAt: z.string(),
      openedBy: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.string(),
      at: z.string(),
      actor: z.string(),
      reason: z.string(),
    }),
  ),
  gates: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      state: z.literal("pending"),
      missing: z.array(z.string()),
    }),
  ),
});
export type WorkOrder = z.infer<typeof detailSchema>;

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional(),
    currentVersion: z.number().optional(),
  }),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string | string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("vmms_csrf="));
  return value ? decodeURIComponent(value.substring("vmms_csrf=".length)) : "";
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    commandId?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ Accept: "application/json" });
  if (method !== "GET") headers.set("X-CSRFToken", csrfToken());
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.commandId) headers.set("Idempotency-Key", options.commandId);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch {
    throw new ApiError(
      "The server could not be reached. Your entries are still here. Check the connection before retrying.",
      0,
      "network",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(data);
    if (response.status === 401 && path !== "/session")
      window.dispatchEvent(new Event("vmms-session-expired"));
    throw parsed.success
      ? new ApiError(
          parsed.data.error.message,
          response.status,
          parsed.data.error.code,
          parsed.data.error.fields,
        )
      : new ApiError(
          "The request could not be completed. Try again or contact your site administrator.",
          response.status,
          "request_failed",
        );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(
      "The server response could not be read. Refresh before making another change.",
      502,
      "invalid_response",
    );
  return parsed.data;
}

export const sitePath = (siteId: string) =>
  `/sites/${encodeURIComponent(siteId)}`;
export const orderPath = (siteId: string, orderId: string) =>
  `${sitePath(siteId)}/work-orders/${encodeURIComponent(orderId)}`;
