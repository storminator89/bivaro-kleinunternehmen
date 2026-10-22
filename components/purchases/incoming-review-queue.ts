import type { IncomingDocument, IncomingDocumentList, PurchaseReviewDraft } from '@/lib/purchase-documents/types';
import { IncomingRequestError } from './incoming-document-ui';

/** A page-sized, in-memory snapshot. New arrivals never reorder an active review. */
export function reviewQueueSnapshot(list: IncomingDocumentList): readonly number[] {
  return [...new Set(list.documents.filter(document => document.reviewState === 'REVIEW' && document.linkedExpenseId === null).map(document => document.id))].slice(0, 25);
}

export async function nextReviewDocument(
  ids: readonly number[], currentId: number, direction: -1 | 1,
  read: (id: number) => Promise<IncomingDocument>, signal: AbortSignal,
): Promise<number | null> {
  const current = ids.indexOf(currentId);
  if (current < 0) return null;
  // Both the snapshot and loop are bounded; forbidden/deleted/processed records
  // are skipped, but an unknown server/network failure must not skip work.
  for (let index = current + direction; index >= 0 && index < Math.min(ids.length, 25); index += direction) {
    signal.throwIfAborted();
    try {
      const document = await read(ids[index]);
      signal.throwIfAborted();
      if (document.id === ids[index] && document.reviewState === 'REVIEW' && document.linkedExpenseId === null) return document.id;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof IncomingRequestError) || error.status !== 404) throw error;
    }
  }
  return null;
}

export type IncomingNavigationGuard = {
  blocked: boolean;
  request: (proceed: () => void, stay: () => void) => void;
};
export type IncomingReviewSequence = {
  position: number; count: number; busy: boolean; message: string | null;
  canPrevious: boolean; canNext: boolean; move: (direction: -1 | 1) => void;
};

export function sameReviewDraft(left: PurchaseReviewDraft | null | undefined, right: PurchaseReviewDraft): boolean {
  return !!left && (Object.keys(right) as Array<keyof PurchaseReviewDraft>).every(key => left[key] === right[key]);
}
