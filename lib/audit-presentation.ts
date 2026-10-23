import type { AuditAction, AuditEntityType } from '@/lib/audit-log';

// Exhaustive labels keep the list, detail dialog and filters in sync with the
// audit writer. Type-only imports do not load server/database code in the UI.
export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  Customer: 'Kunde', Supplier: 'Lieferant', Invoice: 'Rechnung', PurchaseDocument: 'Eingangsbeleg', Expense: 'Ausgabe', Income: 'Einnahme',
  Settings: 'Einstellungen', User: 'Benutzer', ApiKey: 'API-Key',
  ServiceBillingPlan: 'Service-Abrechnungsplan', RecurringExpense: 'Wiederkehrende Ausgabe', Reminder: 'Mahnung',
  InvoiceTemplate: 'Rechnungsvorlage', Backup: 'Datensicherung', Session: 'Sitzung',
  CreditNote: 'Gutschrift', CashBook: 'Kassenbuch', CashTransaction: 'Kassenbuchung',
  EURExport: 'EÜR-Export', Quote: 'Angebot', Documentation: 'Verfahrensdokumentation',
  SecurityEvent: 'Sicherheitsereignis',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Erstellt', UPDATE: 'Geändert', DELETE: 'Gelöscht', LOGIN: 'Anmeldung',
  LOGOUT: 'Abmeldung', LOGIN_FAILED: 'Anmeldung fehlgeschlagen', EXPORT: 'Exportiert',
  IMPORT: 'Importiert', BACKUP: 'Datensicherung erstellt', RESTORE: 'Wiederhergestellt',
  API_KEY_CREATED: 'API-Key erstellt', API_KEY_REVOKED: 'API-Key widerrufen',
  PASSWORD_CHANGED: 'Passwort geändert', SETTINGS_CHANGED: 'Einstellungen geändert',
  STATUS_CHANGED: 'Status geändert', PAYMENT_RECEIVED: 'Zahlung erhalten', PAYMENT_CORRECTION: 'Nie eingegangene Zahlung berichtigt', CUSTOMER_REFUND: 'Tatsächliche Rückzahlung erfasst', PAYMENT_ALLOCATION_CHANGED: 'Rechnungszuordnung geändert', REVIEW: 'Prüfhinweis',
  REMINDER_SENT: 'Mahnung gesendet', EMAIL_SENT: 'E-Mail gesendet', VIEW: 'Angesehen',
  DOWNLOAD: 'Heruntergeladen', CANCELLED: 'Storniert', CONVERTED: 'Umgewandelt',
  AUTH_LOGIN: 'Anmeldung', AUTH_LOGIN_FAILED: 'Anmeldung fehlgeschlagen',
  AUTH_LOGIN_RATE_LIMITED: 'Anmeldung begrenzt', AUTH_PASSWORD_CHANGED: 'Passwort geändert',
  AUTH_ROLE_CHANGED: 'Rolle geändert', AUTH_USER_DELETED: 'Benutzer gelöscht',
  SECURITY_EVENT: 'Sicherheitsereignis',
};
