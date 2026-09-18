import type { Metadata } from "next";
import { QuotePageEditor } from "@/components/dashboard/editors/quote-page-editor";

export const metadata: Metadata = {
  title: "Neues Angebot | Bivaro",
};

export default function NewQuotePage() {
  return <QuotePageEditor />;
}
