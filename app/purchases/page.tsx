import { Suspense } from 'react';
import { IncomingDocumentsWorkspace } from '@/components/purchases/incoming-documents-workspace';

export default function PurchasesPage() {
  return <Suspense fallback={<p role="status">Belegeingang wird geladen…</p>}><IncomingDocumentsWorkspace /></Suspense>;
}
