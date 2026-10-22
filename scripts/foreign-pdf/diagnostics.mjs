/** Harness-only failure metadata. Closed enums only: never stringify an Error,
 * its message/stack, child output, arbitrary stage or input-controlled values. */
const codes = new Set([
  'PDF_UNSUPPORTED_STRUCTURE','PDF_UNSUPPORTED_METADATA','PDF_SIGNED','PDF_FORMS_UNSUPPORTED',
  'PDF_ATTACHMENTS_UNSUPPORTED','PDF_ACTIVE_CONTENT_UNSUPPORTED','PDF_ENCRYPTED',
  'PDF_INVALID_OR_ENCRYPTED','PDF_INVALID_STRUCTURE','PDF_REQUIRES_NORMALIZATION',
  'PDF_INPUT_INVALID','PDF_XML_INVALID','PDF_OUTPUT_LIMIT','PDF_PROCESSING_UNAVAILABLE','ERR_ASSERTION',
]);
const stages = new Set([
  'prerequisites','ordinary-authentication','original-archive-baseline','archive-and-state-preservation',
  ...['vector-text','transparency','scan'].flatMap(name=>[`source-precheck-${name}`,`positive-${name}`]),
  ...['encrypted','signature-dictionary','form','attachment','missing-font','wrong-part','malformed'].map(name=>`negative-${name}`),
]);
function property(error,name){
  try {return error!==null&&(typeof error==='object'||typeof error==='function')?error[name]:undefined;}
  catch {return undefined;}
}
export function foreignFailureDiagnostic(error,stage){
  const code=property(error,'code'),kind=property(error,'kind'),status=property(error,'status');
  return {
    event:'foreign-pdf-failure',
    stage:stages.has(stage)?stage:'unknown-stage',
    code:codes.has(code)?code:'UNCLASSIFIED_FAILURE',
    kind:kind==='unsupported'||kind==='unavailable'?kind:null,
    status:status===422||status===503?status:null,
  };
}
