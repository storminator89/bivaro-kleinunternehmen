import 'server-only';

/** Internal owner evidence only. Absence/other values stay disabled; never a public-access gate. */
export function ownerQuoteReleaseCaptureEnabled(): boolean {
  return process.env.BIVARO_INTERNAL_QUOTE_CAPTURE === '1';
}
