import { requireUserId } from '@/lib/get-user-id';
import { readInvoiceList } from '@/lib/server/invoice-list';
import { invoiceListSearchInput } from '@/lib/record-search/list-contract';
import { filteredListBody, filteredListError, protectFilteredListSearch } from '@/lib/record-search/list-http';

async function search(request: Request) {
  try {
    const userId = await requireUserId();
    const { query, ...options } = invoiceListSearchInput(await filteredListBody(request));
    return await readInvoiceList(userId, request.headers, { ...options, recordQuery: query });
  } catch (error) { return filteredListError(error); }
}
export const POST = protectFilteredListSearch(search);
