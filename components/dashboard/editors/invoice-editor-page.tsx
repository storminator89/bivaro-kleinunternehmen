/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: Bivaro Ledger
 * tone: utilitarian · anchor hue: evergreen · enrichment: none
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass (40–41)
 * honest: pass (46) · chrome: pass (47) · tokens: pass (48) · mobile: pass (34, 49–57)
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ServiceBillingDraftSeed } from "@/lib/service-billing";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CreateInvoiceModal } from "@/components/dashboard/create-invoice-modal";

type Draft = { id: number; customerId: number | null; parsedData: ServiceBillingDraftSeed; draftToken: string };
export function InvoiceEditorPage({ draftId }: { draftId?: number }) {
  const { data: session } = useSession();
  return <InvoiceEditorState key={`${session?.user?.id ?? 'signed-out'}:${draftId ?? 'new'}`} draftId={draftId} />;
}
function InvoiceEditorState({ draftId }: { draftId?: number }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    fetch(`/api/service-billing/drafts/${draftId}`, { cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Entwurf konnte nicht geladen werden.'); return data;
    }).then(data => { if (active) setDraft(data); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [draftId]);
  const router = useRouter();

  const returnToInvoices = () => {
    router.push("/dashboard?tab=invoices");
  };

  if (draftId && !draft) return <section className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Serviceentwurf öffnen</h1><p className="my-4" role={error ? 'alert' : 'status'}>{error || 'Entwurf wird geladen …'}</p><Link href="/service-billing" className="underline">Zurück zu den Serviceplänen</Link></section>;
  return (
    <CreateInvoiceModal
      key={draft?.id ?? "new"}
      fromDraft={draft ?? undefined}
      isOpen
      presentation="page"
      onClose={returnToInvoices}
    />
  );
}
