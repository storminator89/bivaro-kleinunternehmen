import { requireUserId } from '@/lib/get-user-id';
import { listPurchaseDocuments } from '@/lib/purchase-documents/service';
import { purchaseListSearchInput } from '@/lib/record-search/list-contract';
import { filteredListBody, filteredListError, filteredListReply, protectFilteredListSearch } from '@/lib/record-search/list-http';

async function search(request: Request) {
  try {
    const userId = await requireUserId();
    const { query, reviewStatus, ...options } = purchaseListSearchInput(await filteredListBody(request));
    // Only the ordinary non-private filters use URLSearchParams as an internal
    // parser adapter. The term never enters a URL or parameter collection.
    const params = new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)]));
    if (reviewStatus !== 'ALL') params.set('reviewStatus', reviewStatus);
    return filteredListReply(await listPurchaseDocuments(userId, params, query));
  } catch (error) { return filteredListError(error); }
}
export const POST = protectFilteredListSearch(search);
