import { Prisma, type Customer } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/get-user-id';
import { ownedRecordMatch } from '@/lib/record-search/match';
import { customerListSearchInput } from '@/lib/record-search/list-contract';
import { filteredListBody, filteredListError, filteredListReply, protectFilteredListSearch } from '@/lib/record-search/list-http';

async function search(request: Request) {
  try {
    const userId = await requireUserId();
    const { query } = customerListSearchInput(await filteredListBody(request));
    // The ordinary customer list is an unpaginated array of the same owned scalars.
    const customers = await prisma.$queryRaw<Customer[]>(Prisma.sql`
      SELECT * FROM "Customer" WHERE ${ownedRecordMatch('customer', userId, query)}
      ORDER BY "createdAt" DESC, "id" DESC
    `);
    return filteredListReply(customers);
  } catch (error) { return filteredListError(error); }
}
export const POST = protectFilteredListSearch(search);
