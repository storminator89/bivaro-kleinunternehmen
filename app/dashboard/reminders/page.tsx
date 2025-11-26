"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, FileText, Mail, Check, History, Trash2, Copy, ExternalLink, Info, HelpCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Invoice = {
  id: number;
  invoiceNumber: string | null;
  fileName: string;
  totalAmount: number | null;
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
  sentAt: string;
  dueDate: string;
  fee: number;
  notes: string | null;
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

// Email Templates Generator
const generateEmailTemplate = (
  level: number, 
  invoice: Invoice, 
  fee: number, 
  dueDays: number,
  companyName: string = '[Ihr Firmenname]'
): { subject: string; body: string } => {
  // Nutze Ansprechpartner wenn vorhanden, sonst Firmenname, sonst Standard
  const customerName = invoice.customer?.contactPerson || invoice.customer?.name || 'Sehr geehrte Damen und Herren';
  const invoiceNumber = invoice.invoiceNumber || invoice.fileName;
  const amount = invoice.totalAmount ? (invoice.totalAmount + fee).toFixed(2).replace('.', ',') : '[Betrag]';
  const originalAmount = invoice.totalAmount ? invoice.totalAmount.toFixed(2).replace('.', ',') : '[Betrag]';
  const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('de-DE') : '[Rechnungsdatum]';
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + dueDays);
  const newDueDate = dueDate.toLocaleDateString('de-DE');
  const today = new Date().toLocaleDateString('de-DE');

  switch (level) {
    case 1: // Zahlungserinnerung
      return {
        subject: `Zahlungserinnerung - Rechnung ${invoiceNumber}`,
        body: `Sehr geehrte(r) ${customerName},

bei der Durchsicht unserer Buchhaltung ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde:

Rechnungsnummer: ${invoiceNumber}
Rechnungsdatum: ${invoiceDate}
Offener Betrag: ${originalAmount} €

Sollte sich die Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie diese Erinnerung bitte als gegenstandslos.

Andernfalls bitten wir Sie, den ausstehenden Betrag bis zum ${newDueDate} auf unser Konto zu überweisen.

Bei Fragen zur Rechnung stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
${companyName}`
      };

    case 2: // 1. Mahnung
      return {
        subject: `1. Mahnung - Rechnung ${invoiceNumber}`,
        body: `Sehr geehrte(r) ${customerName},

leider haben wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang für folgende Rechnung feststellen können:

Rechnungsnummer: ${invoiceNumber}
Rechnungsdatum: ${invoiceDate}
Ursprünglicher Betrag: ${originalAmount} €
${fee > 0 ? `Mahngebühr: ${fee.toFixed(2).replace('.', ',')} €` : ''}
Gesamtbetrag: ${amount} €

Wir bitten Sie, den Gesamtbetrag bis spätestens ${newDueDate} zu begleichen.

Falls Sie Fragen zur Rechnung haben oder eine Ratenzahlung vereinbaren möchten, kontaktieren Sie uns bitte umgehend.

Mit freundlichen Grüßen
${companyName}`
      };

    case 3: // 2. Mahnung
      return {
        subject: `2. Mahnung - Rechnung ${invoiceNumber} - Dringend`,
        body: `Sehr geehrte(r) ${customerName},

trotz unserer bisherigen Mahnungen haben wir leider noch immer keinen Zahlungseingang verzeichnen können.

Rechnungsnummer: ${invoiceNumber}
Rechnungsdatum: ${invoiceDate}
Ursprünglicher Betrag: ${originalAmount} €
${fee > 0 ? `Mahngebühr: ${fee.toFixed(2).replace('.', ',')} €` : ''}
Gesamtbetrag: ${amount} €

Wir fordern Sie hiermit nachdrücklich auf, den Gesamtbetrag bis zum ${newDueDate} zu überweisen.

Sollte die Zahlung nicht fristgerecht eingehen, sehen wir uns gezwungen, weitere Maßnahmen zu ergreifen.

Bei Zahlungsschwierigkeiten bitten wir Sie, sich umgehend mit uns in Verbindung zu setzen, um eine einvernehmliche Lösung zu finden.

Mit freundlichen Grüßen
${companyName}`
      };

    case 4: // Letzte Mahnung
      return {
        subject: `Letzte Mahnung vor gerichtlichem Mahnverfahren - Rechnung ${invoiceNumber}`,
        body: `Sehr geehrte(r) ${customerName},

trotz mehrfacher Mahnungen ist die folgende Forderung nach wie vor offen:

Rechnungsnummer: ${invoiceNumber}
Rechnungsdatum: ${invoiceDate}
Ursprünglicher Betrag: ${originalAmount} €
${fee > 0 ? `Mahngebühren gesamt: ${fee.toFixed(2).replace('.', ',')} €` : ''}
Gesamtbetrag: ${amount} €

Dies ist unsere letzte außergerichtliche Mahnung.

Wir fordern Sie hiermit letztmalig auf, den Gesamtbetrag bis zum ${newDueDate} zu begleichen.

Nach Ablauf dieser Frist werden wir ohne weitere Ankündigung ein gerichtliches Mahnverfahren einleiten. Die dadurch entstehenden zusätzlichen Kosten (Gerichtskosten, Inkassokosten, Verzugszinsen) werden Ihnen in Rechnung gestellt.

Eine außergerichtliche Einigung ist nur noch bis zum genannten Datum möglich.

Mit freundlichen Grüßen
${companyName}`
      };

    default:
      return { subject: '', body: '' };
  }
};

type Settings = {
  companyName: string;
  companyAddress: string;
  email: string;
  telephone: string;
  bankName: string;
  iban: string;
  bic: string;
};

export default function RemindersPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreateReminder, setShowCreateReminder] = useState(false);
  const [reminderFee, setReminderFee] = useState('0');
  const [reminderNotes, setReminderNotes] = useState('');
  const [reminderDueDays, setReminderDueDays] = useState('14');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<number | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('overdue');
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [copiedField, setCopiedField] = useState<'subject' | 'body' | null>(null);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [showInfoOpen, setShowInfoOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [remindersRes, settingsRes] = await Promise.all([
        fetch('/api/reminders?includeAll=true'),
        fetch('/api/settings')
      ]);
      
      if (remindersRes.ok) {
        const data = await remindersRes.json();
        setInvoices(data.invoices);
        setStats(data.stats);
      }
      
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setSettings(settingsData);
      }
    } catch (error) {
      console.error('Error loading reminders:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateReminder = async () => {
    if (!selectedInvoice) return;
    
    setIsCreating(true);
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          fee: parseFloat(reminderFee) || 0,
          notes: reminderNotes || null,
          dueDays: parseInt(reminderDueDays) || 14
        })
      });

      if (res.ok) {
        await loadData();
        setShowCreateReminder(false);
        setSelectedInvoice(null);
        setReminderFee('0');
        setReminderNotes('');
        setReminderDueDays('14');
      }
    } catch (error) {
      console.error('Error creating reminder:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleMarkAsPaid = async (invoiceId: number) => {
    try {
      const res = await fetch('/api/invoices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoiceId, status: 'PAID' })
      });

      if (res.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error marking invoice as paid:', error);
    }
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
    <Table>
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
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate max-w-[140px]">
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
                  {invoice.totalAmount ? formatCurrency(invoice.totalAmount) : '-'}
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
                    {invoice.currentReminderLevel < 4 && (
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
                        {invoice.nextReminderLevelLabel}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAsPaid(invoice.id);
                      }}
                      title="Als bezahlt markieren"
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
                      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-muted-foreground">
                        <History className="h-4 w-4" />
                        Mahnungshistorie
                      </div>
                      <div className="space-y-2">
                        {invoice.reminders.map((reminder) => (
                          <div 
                            key={reminder.id} 
                            className="flex items-center justify-between p-3 bg-background rounded-lg border"
                          >
                            <div className="flex items-center gap-3">
                              <Badge variant={REMINDER_LEVEL_VARIANTS[reminder.reminderLevel]}>
                                {REMINDER_LEVEL_LABELS[reminder.reminderLevel]}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                Gesendet: {formatDate(reminder.sentAt)}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                Fällig: {formatDate(reminder.dueDate)}
                              </span>
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
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteReminder(reminder.id);
                                }}
                                title="Mahnung löschen"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Mahnwesen</h1>
          <p className="text-muted-foreground">
            Verwalten Sie überfällige Rechnungen und erstellen Sie Zahlungserinnerungen
          </p>
        </header>

        {/* Info-Card: Mahnstufen Erklärung */}
        <Collapsible open={showInfoOpen} onOpenChange={setShowInfoOpen} className="mb-6">
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">Wie funktioniert das Mahnwesen?</CardTitle>
                  </div>
                  {showInfoOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>
              </CardHeader>
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
                            Freundliche Erinnerung ohne Gebühren. Empfohlen: 7-14 Tage nach Fälligkeit.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="outline" className="mt-0.5 shrink-0">Stufe 2</Badge>
                        <div>
                          <p className="font-medium text-sm">1. Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Erste formelle Mahnung. Empfehlung: 5€ Mahngebühr, 14 Tage Zahlungsfrist.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="default" className="mt-0.5 shrink-0">Stufe 3</Badge>
                        <div>
                          <p className="font-medium text-sm">2. Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Nachdrückliche Aufforderung. Empfehlung: 10€ Mahngebühr, 14 Tage Zahlungsfrist.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <Badge variant="destructive" className="mt-0.5 shrink-0">Stufe 4</Badge>
                        <div>
                          <p className="font-medium text-sm">Letzte Mahnung</p>
                          <p className="text-xs text-muted-foreground">
                            Ankündigung rechtlicher Schritte. Empfehlung: 15€ Mahngebühr, 7-10 Tage Frist.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Rechtliche Hinweise */}
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Rechtliche Hinweise
                    </h4>
                    <div className="space-y-3 text-sm">
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Verzug tritt automatisch ein</AlertTitle>
                        <AlertDescription className="text-xs">
                          Bei Geschäftskunden (B2B) tritt Verzug automatisch 30 Tage nach Fälligkeit und Zugang der Rechnung ein (§ 286 Abs. 3 BGB).
                        </AlertDescription>
                      </Alert>
                      
                      <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                        <p className="font-medium">Mahngebühren</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• Mahngebühren müssen angemessen sein (ca. 2,50€ - 5€ pro Mahnung)</li>
                          <li>• Höhere Gebühren nur bei nachweisbarem Aufwand zulässig</li>
                          <li>• Verzugszinsen: 5% über Basiszinssatz (Privat), 9% über Basiszinssatz (B2B)</li>
                        </ul>
                      </div>

                      <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                        <p className="font-medium">Ablauf nach der letzten Mahnung</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• Gerichtliches Mahnverfahren (Mahnbescheid)</li>
                          <li>• Inkassounternehmen beauftragen</li>
                          <li>• Anwaltliche Hilfe in Anspruch nehmen</li>
                        </ul>
                      </div>

                      <div className="p-3 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-lg">
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                          <strong>Hinweis:</strong> Diese Informationen dienen nur als Orientierung und ersetzen keine Rechtsberatung.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Statistik-Karten */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Überfällige Rechnungen</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                  {stats.totalOverdue}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ausstehender Betrag</CardDescription>
                <CardTitle className="text-3xl">
                  {formatCurrency(stats.totalAmount)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mahngebühren</CardDescription>
                <CardTitle className="text-3xl">
                  {formatCurrency(stats.totalFees)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Offene Rechnungen</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <Clock className="h-6 w-6 text-muted-foreground" />
                  {invoices.length}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Filter */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-lg">Filter</CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="filter-level" className="text-sm whitespace-nowrap">Mahnstufe:</Label>
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {Object.entries(REMINDER_LEVEL_LABELS).map(([level, label]) => (
                <Badge
                  key={level}
                  variant={REMINDER_LEVEL_VARIANTS[parseInt(level)]}
                  className="cursor-default"
                >
                  {label}: {stats?.byLevel[parseInt(level) as keyof typeof stats.byLevel] ?? 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <svg className="animate-spin h-10 w-10 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Überfällige Rechnungen */}
            <Collapsible open={overdueOpen} onOpenChange={setOverdueOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                        <CardTitle>Überfällige Rechnungen ({overdueInvoices.length})</CardTitle>
                      </div>
                      {overdueOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    {renderInvoiceTable(overdueInvoices, true)}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Bald fällige Rechnungen */}
            {upcomingInvoices.length > 0 && (
              <Collapsible open={upcomingOpen} onOpenChange={setUpcomingOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Clock className="h-5 w-5 text-muted-foreground" />
                          <CardTitle>Bald fällige Rechnungen ({upcomingInvoices.length})</CardTitle>
                        </div>
                        {upcomingOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      {renderInvoiceTable(upcomingInvoices, false)}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </div>
        )}

        {/* Mahnung erstellen Dialog */}
        <Dialog open={showCreateReminder && !!selectedInvoice} onOpenChange={(open) => {
          if (!open) {
            setShowCreateReminder(false);
            setSelectedInvoice(null);
            setCopiedField(null);
          }
        }}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {selectedInvoice?.nextReminderLevelLabel} erstellen
              </DialogTitle>
              <DialogDescription className="mt-2">
                Für Rechnung: <span className="font-medium">{selectedInvoice?.invoiceNumber || selectedInvoice?.fileName}</span>
                {selectedInvoice?.customer?.name && (
                  <>
                    <br />
                    Kunde: <span className="font-medium">{selectedInvoice.customer.name}</span>
                  </>
                )}
                <br />
                Betrag: <span className="font-medium">{selectedInvoice?.totalAmount ? formatCurrency(selectedInvoice.totalAmount) : '-'}</span>
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="settings" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="settings">Einstellungen</TabsTrigger>
                <TabsTrigger value="email">E-Mail Vorlage</TabsTrigger>
              </TabsList>
              
              <TabsContent value="settings" className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label htmlFor="reminder-fee">Mahngebühr (€)</Label>
                  <Input
                    id="reminder-fee"
                    type="number"
                    step="0.01"
                    min="0"
                    value={reminderFee}
                    onChange={(e) => setReminderFee(e.target.value)}
                    placeholder="0.00"
                  />
                  <p className="text-sm text-muted-foreground">
                    Empfehlung: Zahlungserinnerung 0€, 1. Mahnung 5€, 2. Mahnung 10€, Letzte Mahnung 15€
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reminder-due-days">Zahlungsfrist (Tage)</Label>
                  <Input
                    id="reminder-due-days"
                    type="number"
                    min="1"
                    value={reminderDueDays}
                    onChange={(e) => setReminderDueDays(e.target.value)}
                    placeholder="14"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reminder-notes">Notizen (optional)</Label>
                  <Textarea
                    id="reminder-notes"
                    value={reminderNotes}
                    onChange={(e) => setReminderNotes(e.target.value)}
                    placeholder="Interne Notizen zur Mahnung..."
                    rows={3}
                  />
                </div>
              </TabsContent>

              <TabsContent value="email" className="py-4">
                {selectedInvoice && (() => {
                  const emailTemplate = generateEmailTemplate(
                    selectedInvoice.nextReminderLevel,
                    selectedInvoice,
                    parseFloat(reminderFee) || 0,
                    parseInt(reminderDueDays) || 14,
                    settings?.companyName || '[Ihr Firmenname]'
                  );

                  const handleCopy = async (text: string, field: 'subject' | 'body') => {
                    await navigator.clipboard.writeText(text);
                    setCopiedField(field);
                    setTimeout(() => setCopiedField(null), 2000);
                  };

                  const handleOpenMailClient = () => {
                    const email = selectedInvoice.customer?.email || '';
                    const subject = encodeURIComponent(emailTemplate.subject);
                    const body = encodeURIComponent(emailTemplate.body);
                    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
                  };

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          Vorgeschlagener E-Mail-Text für diese Mahnstufe. Sie können den Text kopieren oder direkt im E-Mail-Client öffnen.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleOpenMailClient}
                          className="flex items-center gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Im E-Mail-Client öffnen
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Betreff</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(emailTemplate.subject, 'subject')}
                            className="h-8 px-2"
                          >
                            {copiedField === 'subject' ? (
                              <><Check className="h-4 w-4 mr-1 text-green-500" /> Kopiert</>
                            ) : (
                              <><Copy className="h-4 w-4 mr-1" /> Kopieren</>
                            )}
                          </Button>
                        </div>
                        <div className="p-3 bg-muted rounded-md font-medium">
                          {emailTemplate.subject}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Nachricht</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(emailTemplate.body, 'body')}
                            className="h-8 px-2"
                          >
                            {copiedField === 'body' ? (
                              <><Check className="h-4 w-4 mr-1 text-green-500" /> Kopiert</>
                            ) : (
                              <><Copy className="h-4 w-4 mr-1" /> Kopieren</>
                            )}
                          </Button>
                        </div>
                        <div className="p-4 bg-muted rounded-md whitespace-pre-wrap text-sm max-h-[300px] overflow-y-auto">
                          {emailTemplate.body}
                        </div>
                      </div>

                      {selectedInvoice.customer?.email && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                          <Mail className="h-4 w-4" />
                          E-Mail wird gesendet an: <span className="font-medium">{selectedInvoice.customer.email}</span>
                        </div>
                      )}

                      {!selectedInvoice.customer?.email && (
                        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md">
                          <AlertCircle className="h-4 w-4" />
                          Keine E-Mail-Adresse für diesen Kunden hinterlegt.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateReminder(false);
                  setSelectedInvoice(null);
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={handleCreateReminder}
                disabled={isCreating}
              >
                {isCreating ? (
                  <>
                    <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Wird erstellt...
                  </>
                ) : (
                  <>Mahnung erstellen</>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
