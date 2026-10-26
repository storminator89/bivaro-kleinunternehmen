import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditBackup, auditSecurityEvent } from '@/lib/audit-log';
import { createBackupManifest, CURRENT_BACKUP_VERSION } from '@/lib/backup-manifest';
import { BackupFileSizeError, readBackupSnapshot } from '@/lib/backup-snapshot';

// GET: Export all user data as JSON
export async function GET() {
  try {
    const userId = await requireUserId();

    const snapshot = await readBackupSnapshot(userId);
    const { data } = snapshot;
    const count = (key: string) => Array.isArray(data[key]) ? data[key].length : 0;

    // Audit log
    await auditBackup(userId, 'BACKUP', {
      expensesCount: count('expenses'),
      incomesCount: count('incomes'),
      paymentJournalEventsCount: count('paymentJournalEvents'),
      invoicesCount: count('invoices'),
      purchaseDocumentsCount: count('purchaseDocuments'),
      customersCount: count('customers'),
      suppliersCount: count('suppliers'),
      serviceArticlesCount: count('serviceArticles'),
      serviceProjectsCount: count('serviceProjects'),
      billingNotesCount: count('billingNotes'),
      recurringExpensesCount: count('recurringExpenses'),
      remindersCount: count('reminders'),
      cashBooksCount: count('cashBooks'),
      cashTransactionsCount: count('cashTransactions'),
      documentationsCount: count('documentations'),
    });
    await auditSecurityEvent(userId, {
      event: 'BACKUP_EXPORT',
      outcome: 'success',
      severity: 'info',
      metadata: {
        backupType: 'json',
        expensesCount: count('expenses'),
        incomesCount: count('incomes'),
        paymentJournalEventsCount: count('paymentJournalEvents'),
        invoicesCount: count('invoices'),
        purchaseDocumentsCount: count('purchaseDocuments'),
        customersCount: count('customers'),
        suppliersCount: count('suppliers'),
        serviceArticlesCount: count('serviceArticles'),
        serviceProjectsCount: count('serviceProjects'),
        billingNotesCount: count('billingNotes'),
      },
    });

    const exportedAt = snapshot.info.endedAt;
    const backup = {
      version: CURRENT_BACKUP_VERSION,
      type: 'json',
      warnings: [
        ...(count('purchaseDocuments') > 0 ? ['Eingangsbeleg-Originale sind nicht eingebettet; zur Wiederherstellung ist ein vollständiges ZIP-Backup erforderlich.'] : []),
        ...(count('quoteReleases') > 0 ? ['Freigabenachweise enthalten keine Originalbytes. Neue Historien benötigen ZIP; JSON darf nur exakt passende, unabhängig geprüfte Zieloriginale wiederverwenden. Öffentliche Links bleiben geschlossen.'] : []),
      ],
      exportedAt,
      manifest: createBackupManifest({ sourceUserId: userId, generatedAt: exportedAt, data, snapshot: snapshot.info }),
      user: data.user,
      data,
      stats: {
        expenses: count('expenses'),
        incomes: count('incomes'),
        paymentJournalEvents: count('paymentJournalEvents'),
        invoices: count('invoices'),
        purchaseDocuments: count('purchaseDocuments'),
        customers: count('customers'),
        suppliers: count('suppliers'),
        serviceArticles: count('serviceArticles'),
        serviceProjects: count('serviceProjects'),
        billingNotes: count('billingNotes'),
        templates: count('templates'),
        recurringExpenses: count('recurringExpenses'),
        serviceBillingPlans: count('serviceBillingPlans'),
        serviceBillingPeriods: count('serviceBillingPeriods'),
        reminders: count('reminders'),
        cashBooks: count('cashBooks'),
        cashTransactions: count('cashTransactions'),
        documentations: count('documentations'),
        apiKeys: count('apiKeys'),
        auditLogs: count('auditLogs'),
        invoiceNumberCounters: count('invoiceNumberCounters'),
        bankMappingProfiles: count('bankMappingProfiles'),
        bankMappingProfileRevisions: count('bankMappingProfileRevisions'),
        documentNumberingPolicies: count('documentNumberingPolicies'),
        quoteCreateReceipts: count('quoteCreateReceipts'),
        quoteReleaseAuthorities: count('quoteReleaseAuthorities'),
        quoteReleases: count('quoteReleases'),
        quoteElectronicResponses: count('quoteElectronicResponses'),
      }
    };

    // Return as downloadable JSON
    const jsonString = JSON.stringify(backup, null, 2);
    const filename = `bivaro-backup-${new Date().toISOString().split('T')[0]}.json`;

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof BackupFileSizeError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Backup error:', error);
    return NextResponse.json({ error: 'Backup fehlgeschlagen' }, { status: 500 });
  }
}
