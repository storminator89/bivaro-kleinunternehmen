/** Nonce scripts while retaining inline style attributes used by Radix/charts. */
export function pageContentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// API document previews are deliberately script-free, including imported XML.
// Do not sandbox PDF responses: browsers implement PDF previews using a
// built-in viewer which sandbox would disable. HTML/XML add their own sandbox.
export const DOCUMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
