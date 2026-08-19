import { z } from "zod";

export const MOVE_TYPES = ["intraday", "closing"] as const;

export const MOVE_TYPE_LABELS: Record<(typeof MOVE_TYPES)[number], string> = {
  intraday: "Intraday",
  closing: "Closing",
};

/** Matches the character counters shown on the form. */
export const REASON_MAX = 1000;
export const TAKEAWAY_MAX = 1000;

const optionalUrl = z.union([z.url(), z.null()]);

export const moverInputSchema = z.object({
  companyId: z.coerce
    .number({ error: "Select a company" })
    .int()
    .positive("Select a company"),
  catalystId: z.coerce
    .number({ error: "Select a catalyst" })
    .int()
    .positive("Select a catalyst"),
  analystId: z.union([z.coerce.number().int().positive(), z.null()]),

  moveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),

  /**
   * Signed: negative for a fall, positive for a rise. A 0% move isn't a mover,
   * so it's rejected rather than stored as a directionless row.
   */
  movePct: z.coerce
    .number({ error: "Enter the share-price move" })
    .min(-100, "A fall cannot exceed 100%")
    .max(1000, "That looks too large — check the figure")
    .refine((n) => n !== 0, "A 0% move isn't a mover"),

  moveType: z.enum(MOVE_TYPES),
  moveWindowLabel: z.union([z.string().max(60), z.null()]),

  reasonForMove: z
    .string()
    .min(1, "Reason for move is required")
    .max(REASON_MAX, `Keep under ${REASON_MAX} characters`),
  mainTakeaway: z
    .string()
    .min(1, "Main takeaway is required")
    .max(TAKEAWAY_MAX, `Keep under ${TAKEAWAY_MAX} characters`),

  reportPrice: z.union([
    z.coerce.number().positive("Price must be greater than 0"),
    z.null(),
  ]),
  reportUrl: optionalUrl,
  /** Storage key produced by the upload widget, not a user-typed value. */
  reportStoragePath: z.union([z.string().max(300), z.null()]),
});

export type MoverInput = z.infer<typeof moverInputSchema>;

/**
 * Radix Select can't submit an empty value, so an explicitly-unset optional
 * select uses this sentinel. Shared with the form so the two can't drift.
 */
export const NO_SELECTION = "none";

/** Empty form fields arrive as "" — treat those as absent, not as a value. */
function orNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * For REQUIRED numeric fields, absent must stay `undefined` rather than become
 * `null`: `Number(null)` is 0, which would slip past a coercion as a real zero
 * and report a misleading error.
 */
function orUndefined(value: FormDataEntryValue | null): string | undefined {
  return orNull(value) ?? undefined;
}

export type ParseResult =
  | { success: true; data: MoverInput }
  | { success: false; fieldErrors: Record<string, string[]> };

export function parseMoverForm(formData: FormData): ParseResult {
  const analystRaw = orNull(formData.get("analystId"));

  const raw = {
    companyId: orUndefined(formData.get("companyId")),
    catalystId: orUndefined(formData.get("catalystId")),
    analystId: analystRaw === NO_SELECTION ? null : analystRaw,
    moveDate: orNull(formData.get("moveDate")) ?? "",
    movePct: orUndefined(formData.get("movePct")),
    moveType: orNull(formData.get("moveType")) ?? "",
    moveWindowLabel: orNull(formData.get("moveWindowLabel")),
    reasonForMove: orNull(formData.get("reasonForMove")) ?? "",
    mainTakeaway: orNull(formData.get("mainTakeaway")) ?? "",
    reportPrice: orNull(formData.get("reportPrice")),
    reportUrl: orNull(formData.get("reportUrl")),
    reportStoragePath: orNull(formData.get("reportStoragePath")),
  };

  const parsed = moverInputSchema.safeParse(raw);
  if (parsed.success) return { success: true, data: parsed.data };

  return {
    success: false,
    fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
  };
}
