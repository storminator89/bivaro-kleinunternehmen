import type { Metadata } from "next";
import { InvoiceEditorPage } from "@/components/dashboard/editors/invoice-editor-page";

export const metadata: Metadata = {
  title: "Neue Rechnung | Bivaro",
};

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ draftId?: string }> }) {
  const { draftId } = await searchParams;
  const parsedId = Number(draftId);
  return <InvoiceEditorPage key={draftId ?? "new"} draftId={draftId && Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : undefined} />;
}
