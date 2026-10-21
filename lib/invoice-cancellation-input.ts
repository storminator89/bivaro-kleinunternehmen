/** Shared bounded input rule; no historical reasons are rewritten or inferred. */
export const MAX_CANCELLATION_REASON_LENGTH = 1000;
export function cancellationReasonInput(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'Bitte einen Stornierungsgrund angeben.' };
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (normalized.length > MAX_CANCELLATION_REASON_LENGTH) return { ok: false, error: `Der Stornierungsgrund darf höchstens ${MAX_CANCELLATION_REASON_LENGTH} Zeichen enthalten.` };
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(normalized)) return { ok: false, error: 'Der Stornierungsgrund enthält nicht unterstützte Steuerzeichen.' };
  return { ok: true, value: normalized };
}
