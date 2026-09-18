/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: custom Bivaro
 * tone: utilitarian · anchor hue: cool blue · enrichment: none
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass (40–41)
 * honest: pass (46) · chrome: pass (47) · tokens: pass (48) · mobile: pass (34, 49–57)
 */
"use client";

import { useRouter } from "next/navigation";
import { CreateInvoiceModal } from "@/components/dashboard/create-invoice-modal";

export function InvoiceEditorPage() {
  const router = useRouter();

  const returnToInvoices = () => {
    router.push("/dashboard?tab=invoices");
  };

  return (
    <CreateInvoiceModal
      isOpen
      presentation="page"
      onClose={returnToInvoices}
    />
  );
}
