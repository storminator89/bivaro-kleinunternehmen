import { Suspense } from 'react';
import { InvoiceHistoryWorkspace } from '@/components/history/invoice-history-workspace';

export default function HistoryPage() {
  return <Suspense fallback={<p role="status">Rechnungshistorie wird geladen…</p>}><InvoiceHistoryWorkspace /></Suspense>;
}
