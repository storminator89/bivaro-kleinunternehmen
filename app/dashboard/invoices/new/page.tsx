import type { Metadata } from "next";
import { InvoiceEditorPage } from "@/components/dashboard/editors/invoice-editor-page";

export const metadata: Metadata = {
  title: "Neue Rechnung | Bivaro",
};

export default function NewInvoicePage() {
  return <InvoiceEditorPage />;
}
