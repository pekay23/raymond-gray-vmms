import { z } from "zod";

export const intakeFieldsSchema = z.object({
  customerName: z.string(),
  phone: z.string(),
  email: z.string(),
  vin: z.string(),
  registration: z.string(),
  make: z.string(),
  model: z.string(),
  odometerKm: z.string(),
  socPercent: z.string(),
  complaint: z.string(),
});
export type IntakeFields = z.infer<typeof intakeFieldsSchema>;
export const emptyIntake: IntakeFields = {
  customerName: "",
  phone: "",
  email: "",
  vin: "",
  registration: "",
  make: "",
  model: "",
  odometerKm: "",
  socPercent: "",
  complaint: "",
};
const draftSchema = z.object({
  draftId: z.string().uuid(),
  commandId: z.string().uuid(),
  fields: intakeFieldsSchema,
  savedAt: z.string(),
});
export type IntakeDraft = z.infer<typeof draftSchema>;
const prefix = "vmms:draft:v1:";
const key = (userId: string, siteId: string) => `${prefix}${userId}:${siteId}`;

export function loadDraft(
  userId: string,
  siteId: string,
): { draft: IntakeDraft | null; error: string | null } {
  try {
    const raw = sessionStorage.getItem(key(userId, siteId));
    if (!raw) return { draft: null, error: null };
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return {
        draft: null,
        error: "The saved tab draft could not be read. Start a new draft.",
      };
    return { draft: parsed.data, error: null };
  } catch {
    return {
      draft: null,
      error:
        "Tab storage is unavailable. Keep this page open until you submit your entries.",
    };
  }
}

export function saveDraft(userId: string, siteId: string, draft: IntakeDraft) {
  sessionStorage.setItem(key(userId, siteId), JSON.stringify(draft));
}

export function removeDraft(userId: string, siteId: string) {
  sessionStorage.removeItem(key(userId, siteId));
}

export function clearAccountDrafts(userId: string) {
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const storedKey = sessionStorage.key(i);
    if (storedKey?.startsWith(`${prefix}${userId}:`))
      sessionStorage.removeItem(storedKey);
  }
}
