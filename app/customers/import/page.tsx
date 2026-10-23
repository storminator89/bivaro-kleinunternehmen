import { PageHeader } from '@/components/page-header';
import { CsvImportWizard } from '@/components/dashboard/csv-import-wizard';
import styles from '@/components/customers/customer-workspace.module.css';
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <div className={styles.importWorkspace}><PageHeader title="CSV-Import" /><CsvImportWizard initialKind={kind === 'articles' ? 'articles' : 'customers'} /></div>;
}
