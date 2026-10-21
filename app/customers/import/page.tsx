import { PageHeader } from '@/components/page-header';
import { CsvImportWizard } from '@/components/dashboard/csv-import-wizard';
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <div className="mx-auto w-full max-w-4xl space-y-6"><PageHeader title="CSV-Import" /><CsvImportWizard initialKind={kind === 'articles' ? 'articles' : 'customers'} /></div>;
}
