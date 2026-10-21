import { canonicalPhotoJson } from './manual-photo-contract';
import { parsePurchaseReviewDraft } from './review-draft';
import { validateAiDraftProvenance, validateAiExtractionState } from './ai-validation';
import { PurchaseDocumentError } from './errors';
import type { AiExtractionState } from './ai-contract';
export type AiApprovedSnapshot = {version:1;provenance:'AI_ASSISTED_USER_REVIEW';jobId:string;configRevision:string;originalSha256:string;resultSnapshot:unknown;confirmedDraft:unknown;approvedAt:string};
export function buildAiApprovedSnapshot(document:{aiExtraction:unknown;aiDraftProvenance:unknown;originalSha256:string;reviewDraft:unknown}):AiApprovedSnapshot|null {
  if(document.aiDraftProvenance===null || document.aiDraftProvenance===undefined)return null;
  const state=validateAiExtractionState(document.aiExtraction,document.originalSha256);
  const provenance=validateAiDraftProvenance(document.aiDraftProvenance,state,document.originalSha256);
  const job=state.jobs.find(value=>value.id===provenance.jobId)!;
  return {version:1,provenance:'AI_ASSISTED_USER_REVIEW',jobId:job.id,configRevision:job.configRevision,originalSha256:document.originalSha256,resultSnapshot:job.result,confirmedDraft:parsePurchaseReviewDraft(document.reviewDraft),approvedAt:new Date().toISOString()};
}
export function validateAiApprovedSnapshot(value:unknown,document:{aiExtraction:unknown;aiDraftProvenance:unknown;originalSha256:string;reviewDraft:unknown;reviewStatus:unknown}):void {
  if(value===null || value===undefined)return;
  if(document.reviewStatus!=='BOOKED' || !value || typeof value!=='object' || Array.isArray(value))throw new PurchaseDocumentError('KI-Freigabeherkunft ist ungültig.',422,'AI_INVALID_RESULT');
  const input=value as Record<string,unknown>,expected=buildAiApprovedSnapshot(document);
  if(!expected || typeof input.approvedAt!=='string' || !Number.isFinite(new Date(input.approvedAt).getTime()) || canonicalPhotoJson(value)!==canonicalPhotoJson({...expected,approvedAt:input.approvedAt}))throw new PurchaseDocumentError('KI-Freigabeherkunft ist inkonsistent.',422,'AI_INVALID_RESULT');
}
/** Operational attempts restore as interrupted evidence, never runnable jobs. */
export function restoredAiExtractionState(value:unknown,hash:string):AiExtractionState|null {
  if(value===null || value===undefined)return null;
  const state=validateAiExtractionState(value,hash);
  return {...state,jobs:state.jobs.map(job=>['queued','running'].includes(job.status)?{...job,status:'unknown' as const,errorCode:'AI_RESTORED_INTERRUPTED',finishedAt:job.deadlineAt}:job)};
}

/** Explicit source closure freezes current attempts as uncertain; later callbacks cannot rewrite it. */
export function closedSourceAiExtractionState(value:unknown,hash:string,code:'AI_SOURCE_APPROVED'|'AI_SOURCE_DISMISSED'):AiExtractionState|null {
  if(value===null || value===undefined)return null;
  const state=validateAiExtractionState(value,hash);
  return {...state,jobs:state.jobs.map(job=>['queued','running'].includes(job.status)?{...job,status:'unknown' as const,errorCode:code,finishedAt:new Date().toISOString()}:job)};
}
