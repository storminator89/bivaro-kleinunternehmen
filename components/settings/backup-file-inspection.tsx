import type { BackupFileInspection } from '@/lib/backup-file-preview';

export function BackupFileInspectionSummary({ inspection }: { inspection: BackupFileInspection }) {
  const verified = inspection.status === 'MANIFEST_VERIFIED';
  return <section aria-label="Dateiprüfung des ZIP-Backups" className="w-full min-w-0 space-y-2 rounded-md border p-3 text-sm">
    <h3 className="font-semibold">{verified ? 'Dateiprüfung gegen Manifest bestanden' : 'Legacy-Backup: Dateiverfügbarkeit geprüft'}</h3>
    <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      <div><dt className="inline">Referenzierte Dateien: </dt><dd className="inline tabular-nums">{inspection.referencedFiles}</dd></div>
      <div><dt className="inline">Gelesene Dateien: </dt><dd className="inline tabular-nums">{inspection.checkedFiles}</dd></div>
      <div><dt className="inline">SHA-256-geprüft: </dt><dd className="inline tabular-nums">{inspection.verifiedFiles}</dd></div>
      <div><dt className="inline">Geprüfte Dateibytes: </dt><dd className="inline tabular-nums">{inspection.checkedBytes.toLocaleString('de-DE')}</dd></div>
    </dl>
    {!verified && <p>Dieses ältere Format enthält kein Dateimanifest. Vorhandensein und Lesbarkeit sind geprüft, ursprüngliche Prüfsummen bleiben unbekannt.</p>}
    {inspection.unlistedFiles > 0 && <p role="note" className="font-medium">{inspection.unlistedFiles} zusätzliche ZIP-Dateien sind keinem geprüften Dateinachweis oder Datenbezug zugeordnet. Diese Dateien werden nicht wiederhergestellt.</p>}
    <p className="text-xs">Nur Prüfung des ausgewählten Archivs: keine Wiederherstellung und kein Abgleich mit dem Zielbestand. Prüfsummen bestätigen keine Herkunft. Bei der Wiederherstellung folgen gesonderte Prüfungen von Zielkonflikten, Medienformaten und Ressourcenlimits.</p>
  </section>;
}
