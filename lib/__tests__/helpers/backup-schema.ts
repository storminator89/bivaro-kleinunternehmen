import { backupSchemaSupportsAiExtraction } from '@/lib/backup-manifest';
/** Construct a genuine pre-CSV fixture, rather than relabelling a future schema. */
export function stripCsvCatalogForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  stripEmptyAnnualContextForLegacy(backup);
  if (!backupSchemaSupportsAiExtraction(backup.manifest.schemaVersion)) backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'AiProviderSettings');
  delete backup.data.serviceArticles;
  backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => !['ServiceArticle', 'DataImportBatch'].includes(entry.model));
}

/** Empty later context is not part of genuine older feature fixtures. */
export function stripEmptyAnnualContextForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  const context = backup.data.annualBusinessContextRevisions;
  if (Array.isArray(context) && context.length === 0) {
    delete backup.data.annualBusinessContextRevisions;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'AnnualBusinessContextRevision');
  }
}
