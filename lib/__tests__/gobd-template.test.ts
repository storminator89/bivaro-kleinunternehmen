import packageJson from '@/package.json';
import { describe, expect, it } from 'vitest';
import {
  getAppVersion,
  getDefaultDocumentationTemplate,
  getSystemInfo,
} from '@/lib/gobd-template';

function generatedContent(): string {
  return getDefaultDocumentationTemplate().map((section) => section.content).join('\n');
}

describe('GoBD documentation template', () => {
  it('uses the shipped release version and a generated timestamp', () => {
    const systemInfo = getSystemInfo();
    const content = generatedContent();

    expect(getAppVersion()).toBe(packageJson.version);
    expect(systemInfo.softwareVersion).toBe(packageJson.version);
    expect(systemInfo.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain(`**Version:** ${packageJson.version}`);
    expect(content).toMatch(/\*\*Stand des technischen Entwurfs:\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
  });

  it('labels host encryption and release ownership as operator tasks', () => {
    const systemInfo = getSystemInfo();
    const content = generatedContent();

    expect(systemInfo.operatorTasks.join('\n')).toMatch(/Verschlüsselung des Hosts/u);
    expect(systemInfo.operatorTasks.join('\n')).toMatch(/Verantwortliche Person/u);
    expect(content).toMatch(/Host-\/Datenträgerverschlüsselung bleibt Betreiberaufgabe/u);
    expect(content).toMatch(/fachliche Freigabe offen/u);
    expect(content).toMatch(/verantwortliche Person eintragen/u);
  });

  it('does not repeat the audited technical guarantees as facts', () => {
    const content = generatedContent();

    expect(content).not.toMatch(/Die Verfahrensdokumentation erfüllt die Anforderungen/u);
    expect(content).not.toMatch(/Keine physische Löschung/u);
    expect(content).not.toMatch(/Keine nachträgliche Änderung möglich/u);
    expect(content).not.toMatch(/Passwörter werden verschlüsselt gespeichert/u);
    expect(content).not.toMatch(/verschlüsselter Ordner/u);
    expect(content).not.toMatch(/automatisch versioniert/u);
    expect(content).not.toMatch(/Belege werden im Originalformat gespeichert/u);
    expect(content).not.toMatch(/Export aller Daten als JSON-Datei/u);
    expect(content).not.toMatch(/Vollständiges Backup inkl\. Dateien/u);

    expect(content).toMatch(/Ein technischer Nachweis für Unveränderbarkeit/u);
    expect(content).toMatch(/Audit-Log[\s\S]*best effort/u);
    expect(content).toMatch(/physisch gelöscht werden/u);
    expect(content).toMatch(/Originalerhalt über alle Konvertierungspfade ist nicht nachgewiesen/u);
    expect(content).toMatch(/JSON-Backup v3:[\s\S]*Auditsegment[\s\S]*High-Water-Marks/u);
    expect(content).toMatch(/Legacy-Backup v2:[\s\S]*ohne v3-Manifest/u);
    expect(content).toMatch(/Fehlende Referenzen führen zu einem sichtbaren Fehler/u);
  });

  it('exposes actual controls and explicit open limitations', () => {
    const systemInfo = getSystemInfo();

    expect(systemInfo.features).toContain('Transaktionales Finanz-Audit für ausgewählte Rechnungs- und Zahlungspfade; übrige Mutationen und Security-Telemetrie best effort');
    expect(systemInfo.features).toContain('Backup v3 mit Manifest, Auditsegment und Rechnungsnummern-High-Water-Mark; v2 als Legacy-Format');
    expect(systemInfo.features).toContain('Belegverwaltung mit mandantenbezogenem, privatem Upload-Speicher');
    expect(systemInfo.knownLimitations.join('\n')).toMatch(/unveränderlicher Datenbestand/u);
    expect(systemInfo.knownLimitations.join('\n')).toMatch(/Hostverschlüsselung/u);
    expect(systemInfo.knownLimitations.join('\n')).toMatch(/Freigabehistorie/u);
    expect(systemInfo.knownLimitations.join('\n')).toMatch(/vollständige Ereignisabdeckung ist offen/u);
    expect(systemInfo.knownLimitations.join('\n')).toMatch(/keine vollständige Original- oder Dateiabdeckung/u);
  });
});
