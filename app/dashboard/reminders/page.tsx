"use client";

import { PageHeader } from "@/components/page-header";
import { ReminderWorkbenchDialog } from "@/components/dashboard/reminder-workbench-dialog";
import { FullPaymentDialog } from "@/components/dashboard/full-payment-dialog";
import { notifyPaymentDashboardRefresh } from '@/lib/payment-dashboard-refresh';
import React, { useState, useEffect, useCallback } from 'react';
import styles from "@/components/dashboard/reminder-workspace.module.css";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/dashboard-utils";
import { AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, FileText, Mail, Check, History, Trash2, Info, HelpCircle } from "lucide-react";

type Invoice = {
  id: number;
  invoiceNumber: string | null;
  fileName: string;
  totalAmount: number | null;
  openAmount?: number | null;
  canCreateReminder?: boolean;
  canPrepareBalanceReminder?: boolean;
  paymentReviewRequired?: boolean;
  dueDate: string | null;
  invoiceDate: string | null;
  status: string;
  customer?: {
    id: number;
    name: string;
    contactPerson?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  reminders: Reminder[];
  currentReminderLevel: number;
  nextReminderLevel: number;
  nextReminderLevelLabel: string;
  daysOverdue: number;
  totalFees: number;
  isOverdue: boolean;
};

type Reminder = {
  id: number;
  invoiceId: number;
  reminderLevel: number;
  createdAt: string;
  dueDate: string;
  fee: number;
  notes: string | null;
  balanceSnapshot?: { openCents: string; paidCents: string } | null;
};

type Stats = {
  totalOverdue: number;
  totalAmount: number;
  totalFees: number;
  byLevel: {
    0: number;
    1: number;
    2: number;
    3: number;
    4: number;
  };
};

const REMINDER_LEVEL_LABELS: { [key: number]: string } = {
  0: 'Keine Mahnung',
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
  4: 'Letzte Mahnung',
};

const REMINDER_LEVEL_VARIANTS: { [key: number]: "secondary" | "default" | "destructive" | "outline" } = {
  0: 'secondary',
  1: 'outline',
  2: 'outline',
  3: 'default',
  4: 'destructive',
};

export default function RemindersPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceToPay, setInvoiceToPay] = useState<Invoice | null>(null);
  const [showCreateReminder, setShowCreateReminder] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<number | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [_filterStatus, _setFilterStatus] = useState<string>('overdue');
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [showInfoOpen, setShowInfoOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const remindersRes = await fetch('/api/reminders?includeAll=true', { cache: 'no-store' });

      if (remindersRes.ok) {
        const data = await remindersRes.json();
        setInvoices(data.invoices);
        setStats(data.stats);
      } else {
        setLoadError("Mahnwesen konnte nicht geladen werden. Bitte versuchen Sie es erneut.");
      }

    } catch (error) {
      console.error('Error loading reminders:', error);
      setLoadError('Mahnwesen konnte nicht geladen werden. Bitte versuchen Sie es erneut.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMarkAsPaid = (invoiceId: number) => {
    const invoice = invoices.find(item => item.id === invoiceId);
    if (invoice && invoice.status !== 'PAID') setInvoiceToPay(invoice);
  };

  const handlePaymentSuccess = async () => {
    notifyPaymentDashboardRefresh();
    const response = await fetch('/api/reminders?includeAll=true', { cache: 'no-store' });
    if (!response.ok) throw new Error('Mahnwesen konnte nicht aktualisiert werden.');
    const data = await response.json();
    setInvoices(data.invoices);
    setStats(data.stats);
  };

  const handleDeleteReminder = async (reminderId: number) => {
    try {
      const res = await fetch(`/api/reminders?id=${reminderId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error deleting reminder:', error);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('de-DE');
  };

  // Filter invoices
  let filteredInvoices = invoices;
  if (filterLevel !== 'all') {
    filteredInvoices = filteredInvoices.filter(i => i.currentReminderLevel === parseInt(filterLevel));
  }

  const overdueInvoices = filteredInvoices.filter(i => i.isOverdue);
  const upcomingInvoices = filteredInvoices.filter(i => !i.isOverdue && i.dueDate);

  const renderInvoiceTable = (invoiceList: Invoice[], showOverdue: boolean) => (
    <div>
      <div className={styles.reminderMobile}>
        {invoiceList.length === 0 ? <div className="ledger-empty"><CheckCircle aria-hidden="true" /><p>{showOverdue ? 'Keine überfälligen Rechnungen' : 'Keine bald fälligen Rechnungen'}</p></div> : invoiceList.map(invoice => <article key={invoice.id} className={styles.reminderRecord}>
          <div className={styles.reminderRecordHeader}><h3>{invoice.invoiceNumber || invoice.fileName}</h3><strong>{invoice.openAmount != null ? formatCurrency(invoice.openAmount) : '–'}</strong></div>
          <p>{invoice.customer?.name || 'Unbekannter Kunde'}</p>
          <div className={styles.recordMeta}><Badge variant={REMINDER_LEVEL_VARIANTS[invoice.currentReminderLevel]}>{REMINDER_LEVEL_LABELS[invoice.currentReminderLevel]}</Badge><span>{showOverdue ? `${invoice.daysOverdue} Tage überfällig` : `Fällig am ${formatDate(invoice.dueDate)}`}</span>{invoice.totalFees > 0 && <span>Gebühren: {formatCurrency(invoice.totalFees)}</span>}</div>
          <div className={styles.reminderActions}>{((invoice.canCreateReminder && invoice.currentReminderLevel < 4) || (invoice.canPrepareBalanceReminder && !invoice.canCreateReminder)) && <Button variant="outline" size="sm" onClick={() => { setSelectedInvoice(invoice); setShowCreateReminder(true); }}><Mail className="mr-1 h-4 w-4" aria-hidden="true" />{invoice.canCreateReminder ? invoice.nextReminderLevelLabel : 'Restbetrag prüfen'}</Button>}<Button variant="ghost" size="sm" onClick={() => handleMarkAsPaid(invoice.id)}><Check className="mr-1 h-4 w-4" aria-hidden="true" />Zahlung erfassen</Button></div>
          {invoice.reminders.length > 0 && <details className={styles.reminderHistory}><summary>Mahnungshistorie ({invoice.reminders.length})</summary>{invoice.reminders.map(reminder => <article key={reminder.id}><strong className="text-sm">{REMINDER_LEVEL_LABELS[reminder.reminderLevel]}</strong><p>Erfasst: {formatDate(reminder.createdAt)} · Fällig: {formatDate(reminder.dueDate)}</p>{reminder.notes && <p>{reminder.notes}</p>}{reminder.balanceSnapshot && <p>Bestätigter Restbetrag: {formatCurrency(Number(reminder.balanceSnapshot.openCents) / 100)} · nur intern erfasst</p>}<div className="flex items-center justify-between gap-2"><span className="text-sm tabular-nums">{formatCurrency(reminder.fee)}</span>{!reminder.balanceSnapshot && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteReminder(reminder.id)} aria-label="Mahnung löschen"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}</div></article>)}</details>}
        </article>)}
      </div>
      <div className={styles.reminderDesktop}>
    <Table className={styles.table}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">Rechnungsnr.</TableHead>
          <TableHead>Kunde</TableHead>
          <TableHead className="text-right">Betrag</TableHead>
          <TableHead className="text-center">Mahnstufe</TableHead>
          <TableHead className="text-center">{showOverdue ? 'Überfällig' : 'Fällig am'}</TableHead>
          <TableHead className="text-right">Gebühren</TableHead>
          <TableHead className="text-right w-[200px]">Aktionen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoiceList.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <CheckCircle className="h-8 w-8" />
                <p>{showOverdue ? 'Keine überfälligen Rechnungen' : 'Keine bald fälligen Rechnungen'}</p>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          invoiceList.map((invoice) => (
            <React.Fragment key={invoice.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
              >
                <TableCell className="font-medium">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate max-w-[140px]">
                      {invoice.invoiceNumber || invoice.fileName}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="truncate max-w-[150px]">
                    {invoice.customer?.name || <span className="text-muted-foreground italic">Unbekannt</span>}
                  </div>
                  {invoice.customer?.contactPerson && (
                    <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {invoice.customer.contactPerson}
                    </div>
                  )}
                  {invoice.customer?.email && (
                    <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {invoice.customer.email}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {invoice.openAmount != null ? formatCurrency(invoice.openAmount) : '-'}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={REMINDER_LEVEL_VARIANTS[invoice.currentReminderLevel]}>
                    {REMINDER_LEVEL_LABELS[invoice.currentReminderLevel]}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {showOverdue ? (
                    <span className="text-destructive font-medium">{invoice.daysOverdue} Tage</span>
                  ) : (
                    formatDate(invoice.dueDate)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {invoice.totalFees > 0 ? formatCurrency(invoice.totalFees) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {((invoice.canCreateReminder && invoice.currentReminderLevel < 4) || (invoice.canPrepareBalanceReminder && !invoice.canCreateReminder)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(invoice);
                          setShowCreateReminder(true);
                        }}
                      >
                        <Mail className="h-4 w-4 mr-1" />
                        {invoice.canCreateReminder ? invoice.nextReminderLevelLabel : 'Restbetrag prüfen'}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAsPaid(invoice.id);
                      }}
                      title="Zahlung und Restbetrag erfassen"
                      aria-label={`Zahlung für Rechnung ${invoice.invoiceNumber || invoice.fileName} erfassen`}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    {invoice.reminders.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id);
                        }}
                        title="Historie anzeigen"
                        aria-expanded={expandedInvoiceId === invoice.id}
                        aria-label="Historie anzeigen"
                      >
                        {expandedInvoiceId === invoice.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {/* Expanded row for reminder history */}
              {expandedInvoiceId === invoice.id && invoice.reminders.length > 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-muted/30 p-0">
                    <div className="p-4">
                      <div className={styles.historyTitle}>
                        <History className="h-4 w-4" />
                        Mahnungshistorie
                      </div>
                      <div className="space-y-2">
                        {invoice.reminders.map((reminder) => (
                          <div
                            key={reminder.id}
                            className={styles.historyRecord}
                          >
                            <div className={styles.historyRecordData}>
                              <Badge variant={REMINDER_LEVEL_VARIANTS[reminder.reminderLevel]}>
                                {REMINDER_LEVEL_LABELS[reminder.reminderLevel]}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                Erfasst: {formatDate(reminder.createdAt)}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                Fällig: {formatDate(reminder.dueDate)}
                              </span>
                              {reminder.balanceSnapshot && <span className="text-sm">Bestätigter Restbetrag: {formatCurrency(Number(reminder.balanceSnapshot.openCents) / 100)} · nur intern erfasst</span>}
                              {reminder.notes && (
                                <span className="text-sm text-muted-foreground italic">
                                  "{reminder.notes}"
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">
                                {reminder.fee > 0 ? formatCurrency(reminder.fee) : '-'}
                              </span>
                              {!reminder.balanceSnapshot && <Button
                                variant="ghost"
                                size="sm"
                                className="min-h-11 min-w-11 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteReminder(reminder.id);
                                }}
                                title="Mahnung löschen"
                                aria-label="Mahnung löschen"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))
        )}
      </TableBody>
    </Table>
      </div>
    </div>
  );

  return (
    <div className={styles.collections}>
      <div className={styles.workspace}>
        <PageHeader title="Mahnwesen" description="Nur interne Erfassung · Kein automatischer E-Mail-Versand." />

        {stats && <dl className={styles.collectionSummary} aria-label="Forderungsübersicht"><div><dt>Ausstehender Betrag</dt><dd>{formatCurrency(stats.totalAmount)}</dd></div><div><dt>Überfällige Rechnungen</dt><dd>{stats.totalOverdue}</dd></div><div><dt>Mahngebühren</dt><dd>{formatCurrency(stats.totalFees)}</dd></div><div><dt>Offene Rechnungen</dt><dd>{invoices.length}</dd></div></dl>}
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm text-destructive"><p>{loadError}</p><Button variant="outline" onClick={loadData}>Erneut laden</Button></div>}

        <section className={styles.collectionFilter} aria-label="Mahnstufen filtern">
          <div className={styles.filterControl}>
            <Label htmlFor="filter-level">Mahnstufe:</Label>
            <Select value={filterLevel} onValueChange={setFilterLevel}>
              <SelectTrigger id="filter-level" className="w-[180px]">
                <SelectValue placeholder="Alle Stufen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Stufen</SelectItem>
                <SelectItem value="0">Keine Mahnung</SelectItem>
                <SelectItem value="1">Zahlungserinnerung</SelectItem>
                <SelectItem value="2">1. Mahnung</SelectItem>
                <SelectItem value="3">2. Mahnung</SelectItem>
                <SelectItem value="4">Letzte Mahnung</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {stats && Object.values(stats.byLevel).some(count => count > 0) && <div className={styles.levelSummary}>
            <div className="flex flex-wrap gap-2">
              {Object.entries(REMINDER_LEVEL_LABELS).filter(([level]) => (stats.byLevel[parseInt(level) as keyof typeof stats.byLevel] ?? 0) > 0).map(([level, label]) => (
                <Badge
                  key={level}
                  variant={REMINDER_LEVEL_VARIANTS[parseInt(level)]}
                  className="cursor-default"
                >
                  {label}: {stats?.byLevel[parseInt(level) as keyof typeof stats.byLevel] ?? 0}
                </Badge>
              ))}
            </div>
          </div>}
        </section>

        {isLoading ? (
          <div role="status" className={styles.loading}>
            <span className="sr-only">Mahnwesen wird geladen …</span>
            <div className={styles.skeletonRows} aria-hidden="true"><span /><span /><span /></div>
          </div>
        ) : (
          <div className={styles.queue}>
            {/* Überfällige Rechnungen */}
            <Collapsible open={overdueOpen} onOpenChange={setOverdueOpen}>
              <Card className={styles.queuePanel}>
                <CollapsibleTrigger asChild>
                  <button type="button" className={styles.queueHeading}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                        <CardTitle>Überfällige Rechnungen ({overdueInvoices.length})</CardTitle>
                      </div>
                      {overdueOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className={styles.queueContent}>
                    {renderInvoiceTable(overdueInvoices, true)}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Bald fällige Rechnungen */}
            {upcomingInvoices.length > 0 && (
              <Collapsible open={upcomingOpen} onOpenChange={setUpcomingOpen}>
                <Card className={styles.queuePanel}>
                  <CollapsibleTrigger asChild>
                    <button type="button" className={styles.queueHeading}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Clock className="h-5 w-5 text-muted-foreground" />
                          <CardTitle>Bald fällige Rechnungen ({upcomingInvoices.length})</CardTitle>
                        </div>
                        {upcomingOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className={styles.queueContent}>
                      {renderInvoiceTable(upcomingInvoices, false)}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </div>
        )}

        {/* Info-Card: Mahnstufen Erklärung */}
        <Collapsible open={showInfoOpen} onOpenChange={setShowInfoOpen} className="mb-6">
          <Card className={styles.help}>
            <CollapsibleTrigger asChild>
              <button type="button" className={styles.queueHeading}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">Hilfe zum Mahnwesen</CardTitle>
                  </div>
                  {showInfoOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Mahnstufen Übersicht */}
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Die 4 Mahnstufen
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="outline" className="mt-0.5 shrink-0">Stufe 1</Badge>
                        <div>
                          <p className="font-medium text-sm">Zahlungserinnerung</p>
                          <p className="text-xs text-muted-foreground">
                            Freundlichen Text vorbereiten. Gebühren beginnen bei 0 EUR; die Zahlungsfrist wählen Sie selbst.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="outline" className="mt-0.5 shrink-0">Stufe 2</Badge>
                        <div>
                          <p className="font-medium text-sm">1. Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Optionaler weiterer Kontakt. Prüfen Sie den Restbetrag und wählen Sie Text, Frist und eine etwaige Gebühr bewusst selbst.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="default" className="mt-0.5 shrink-0">Stufe 3</Badge>
                        <div>
                          <p className="font-medium text-sm">2. Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Weiteren Zahlungsschritt dokumentieren. Frühere Gebühren werden nicht automatisch zum Entwurf addiert.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="destructive" className="mt-0.5 shrink-0">Stufe 4</Badge>
                        <div>
                          <p className="font-medium text-sm">Letzte Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Letzte im System vorgesehene Stufe. Weitere Schritte müssen Sie separat prüfen; die Anwendung eskaliert nicht automatisch.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-3 flex items-center gap-2 font-semibold"><Info className="h-4 w-4" />Vor dem manuellen Versand</h4>
                    <div className="space-y-3 text-sm">
                      <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Aktuellen Zahlungsstand prüfen</AlertTitle><AlertDescription>Neue Zahlungen erfordern eine erneute Prüfung. Ungeklärte Nachweise bleiben gesperrt.</AlertDescription></Alert>
                      <p className="text-xs text-muted-foreground">Gebühren und Mahnstufe selbst prüfen. Interne Erfassung; kein Versand und keine Zahlungsbuchung.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>


        {/* Mahnung erstellen Dialog */}
        {invoiceToPay && <FullPaymentDialog key={invoiceToPay.id} invoice={invoiceToPay} onClose={() => setInvoiceToPay(null)} onSuccess={handlePaymentSuccess} />}
        <p className="text-sm text-muted-foreground">Nach Teilzahlungen zuerst „Restbetrag prüfen“. Bei ungeklärten Zahlungsnachweisen bleiben Mahnaktionen gesperrt.</p>
        {showCreateReminder && selectedInvoice && <ReminderWorkbenchDialog key={selectedInvoice.id} invoice={selectedInvoice} onRecorded={loadData} onClose={() => { setShowCreateReminder(false); setSelectedInvoice(null); }} />}

      </div>
    </div>
  );
}
