import type { Metadata } from 'next';
import { BankCsvWorkspace } from '@/components/bank-csv/bank-csv-workspace';

export const metadata: Metadata = { title: 'Bank-CSV prüfen | Bivaro' };

export default function BankCsvPage() {
  return <BankCsvWorkspace />;
}
