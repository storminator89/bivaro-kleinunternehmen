import { PageHeader } from '@/components/page-header';
import { CsvImportWizard } from '@/components/dashboard/csv-import-wizard';
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <div className="mx-auto w-full max-w-4xl space-y-6"><PageHeader section="Datenübernahme" title="CSV-Import" description="Kunden, Artikel und Leistungen übernehmen – erst prüfen, dann speichern." /><CsvImportWizard initialKind={kind === 'articles' ? 'articles' : 'customers'} /></div>;
}
