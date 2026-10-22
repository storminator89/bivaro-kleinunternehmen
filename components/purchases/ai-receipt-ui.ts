import type { AiExtractionJob } from '@/lib/purchase-documents/ai-types';

export function aiStatusLabel(status: AiExtractionJob['status'] | null): string {
  return status === 'queued' ? 'KI-Analyse vorgemerkt' : status === 'running' ? 'KI liest den Beleg aus' : status === 'completed' ? 'KI-Vorschläge ausgelesen · nicht gebucht' : status === 'failed' ? 'KI-Analyse fehlgeschlagen' : status === 'unknown' ? 'KI-Ergebnis unklar · Status prüfen' : 'Noch keine KI-Analyse';
}

/** Never render raw provider messages, response bodies, URLs or credentials. */
export function aiRequestError(status: number, body: unknown): string {
  const code = body && typeof body === 'object' && 'code' in body ? String(body.code) : '';
  const messages: Record<string, string> = {
    ENCRYPTION_UNAVAILABLE: 'Sichere Schlüsselspeicherung nicht verfügbar. Betreiber muss die Serverkonfiguration prüfen.',
    RECONNECT_REQUIRED: 'Anbieter-Verbindung neu einrichten und Schlüssel ersetzen.',
    INVALID_BASE_URL: 'Bitte eine gültige HTTPS-Base-URL ohne Zugangsdaten, Suchparameter oder Fragment eingeben.',
    UNSAFE_ENDPOINT: 'Dieses Ziel ist serverseitig nicht freigegeben. Öffentlichen HTTPS-Endpunkt verwenden oder Betreiber kontaktieren.',
    DNS_FAILED: 'Anbieter nicht erreichbar. Base URL prüfen und später bewusst erneut versuchen.',
    AI_INVALID_RESULT: 'Das Modell lieferte keine verlässlich lesbaren Belegdaten. Original prüfen oder ein geeignetes Bildmodell wählen.',
    AI_UNSUPPORTED_FILE: 'KI-Auslesen unterstützt hier nur geeignete JPG-, PNG- und PDF-Originale. XML wird getrennt ausgelesen.',
    AI_PDF_LIMIT: 'PDF überschreitet das KI-Limit. Original bleibt erhalten; Beleg manuell prüfen.',
    AI_RENDER_UNAVAILABLE: 'Sichere PDF-Aufbereitung ist derzeit nicht verfügbar. Keine KI-Anfrage gesendet. Später erneut versuchen oder Original manuell prüfen.',
    AI_RENDER_FAILED: 'PDF konnte nicht vollständig aufbereitet werden. Keine KI-Anfrage gesendet. Erneut versuchen oder Original manuell prüfen.',
    AI_ORIGINAL_INTEGRITY: 'Original nicht sicher verfügbar. Nicht anhand dieser Vorschläge buchen; Betreiber kontaktieren.',
    AI_REQUEST_INTERRUPTED: 'Analyse wurde unterbrochen. Gespeicherten Status prüfen; eine erneute Analyse kann erneut Kosten verursachen.',
    AI_CANCELLED: 'Analyse wurde beendet. Original bleibt erhalten; keine automatische Wiederholung.',
    PROCESSING_BUSY: 'Verarbeitung ausgelastet. Später bewusst erneut versuchen.',
    REVISION_CONFLICT: 'Der Beleg wurde geändert. Aktuellen Belegstatus laden; eigene Eingaben zuerst sichern.',
    CONFIG_VERSION_CONFLICT: 'KI-Einstellungen wurden geändert. Gespeicherte Konfiguration neu laden.',
    CONFIG_CONFLICT: 'KI-Einstellungen wurden geändert. Gespeicherten Stand neu laden.',
    CONFIG_INCOMPLETE: 'Base URL, Modell und Schlüssel zum Aktivieren vollständig einrichten.',
    KEY_REPLACEMENT_REQUIRED: 'Bei geändertem Ziel oder Modell den Schlüssel ausdrücklich ersetzen oder entfernen.',
    AUTO_REQUIRES_ENABLED: 'Zuerst KI-Auslesen aktivieren; automatische neue Uploads separat freigeben.',
    AI_DISABLED: 'KI-Auslesen ist deaktiviert. In den Einstellungen aktivieren oder manuell erfassen.',
    TIMEOUT: 'Anbieter antwortet zu langsam. Status prüfen; Kosten können bereits entstanden sein.',
    CANCELLED: 'KI-Anfrage unterbrochen. Status prüfen; Kosten können bereits entstanden sein.',
    PROVIDER_REJECTED: 'Anbieter hat die Anfrage abgelehnt. Schlüssel, Modellfähigkeit und Anbieter-Kontingent prüfen.',
    RESPONSE_INVALID: 'Anbieterantwort ist unvollständig oder ungültig. Geeignetes Modell wählen oder Original manuell prüfen.',
    RESPONSE_TOO_LARGE: 'Anbieterantwort überschreitet das Limit. Original manuell prüfen.',
    REQUEST_TOO_LARGE: 'KI-Anfrage überschreitet das Limit. Original manuell prüfen.',
    REQUEST_FAILED: 'Anbieterverbindung unterbrochen. Status prüfen; Kosten können bereits entstanden sein.',
    VERSION_CONFLICT: 'KI-Einstellungen wurden geändert. Gespeicherten Stand neu laden.',
    PROVIDER_UNAUTHORIZED: 'Anbieter lehnt den Zugang ab. API-Schlüssel und Zugriffsrechte in den Einstellungen prüfen.',
    PROVIDER_RATE_LIMITED: 'Anbieterlimit erreicht. Anbieter-Kontingent prüfen und später bewusst erneut versuchen.',
    PROVIDER_TIMEOUT: 'Anbieter antwortet zu langsam. Status prüfen, bevor eine neue kostenpflichtige Analyse gestartet wird.',
    NOT_CONFIGURED: 'KI-Anbieter zuerst vollständig einrichten und aktivieren.',
    DISABLED: 'KI-Auslesen ist deaktiviert. In den Einstellungen aktivieren oder manuell erfassen.',
  };
  return messages[code] ?? (status === 401 ? 'Sitzung abgelaufen oder Anbieterzugang abgelehnt. Neu anmelden beziehungsweise API-Schlüssel prüfen.' : status === 403 ? 'Anfrage nicht freigegeben. Seite neu laden und Berechtigung prüfen.' : status === 409 ? 'Gespeicherter Stand wurde geändert. Status neu laden, bevor du fortfährst.' : status === 429 ? 'Anfragelimit erreicht. Kontingent prüfen und später bewusst erneut versuchen.' : status === 408 || status === 504 ? 'Zeitüberschreitung. Status prüfen; keine automatische Wiederholung.' : 'KI-Anfrage konnte nicht abgeschlossen werden. Anbieter-Konfiguration und Modellfähigkeit prüfen oder manuell erfassen.');
}

export async function aiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' }); }
  catch { throw new Error('Verbindung unterbrochen. Gespeicherten Status prüfen; nicht automatisch erneut analysieren.'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(aiRequestError(response.status, body));
  if (!body || typeof body !== 'object') throw new Error('Antwort unklar. Gespeicherten Status prüfen; nicht erneut buchen oder automatisch analysieren.');
  return body as T;
}
