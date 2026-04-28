"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/dashboard-utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmailPreviewDialog, type EmailPreviewReminderContext } from "@/components/dashboard/email-preview-dialog";
import { Mail } from "lucide-react";

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
    email?: string | null;
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

type RemindersModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceStatusChange?: (invoiceId: number, status: string) => void;
};

const REMINDER_LEVEL_COLORS = {
  0: 'bg-muted text-muted-foreground',
  1: 'bg-muted text-foreground border border-input',
  2: 'bg-muted text-foreground border border-input',
  3: 'bg-muted text-foreground border border-input font-medium',
  4: 'bg-muted text-foreground border border-input font-semibold',
};

const REMINDER_LEVEL_LABELS: { [key: number]: string } = {
  0: 'Keine Mahnung',
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
  4: 'Letzte Mahnung',
};

export function RemindersModal({ isOpen, onClose, onInvoiceStatusChange }: RemindersModalProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreateReminder, setShowCreateReminder] = useState(false);
  const [reminderFee, setReminderFee] = useState('0');
  const [reminderNotes, setReminderNotes] = useState('');
  const [reminderDueDays, setReminderDueDays] = useState('14');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<number | null>(null);
  const [emailReminder, setEmailReminder] = useState<{
    invoiceId: number;
    reminder: EmailPreviewReminderContext;
  } | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/reminders?includeAll=true');
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading reminders:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

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
        if (onInvoiceStatusChange) {
          onInvoiceStatusChange(invoiceId, 'PAID');
        }
      }
    } catch (error) {
      console.error('Error marking invoice as paid:', error);
    }
  };

  const openReminderEmailPreview = () => {
    if (!selectedInvoice) return;

    setEmailReminder({
      invoiceId: selectedInvoice.id,
      reminder: {
        reminderLevel: selectedInvoice.nextReminderLevel,
        fee: parseFloat(reminderFee) || 0,
        dueDays: parseInt(reminderDueDays) || 14,
        notes: reminderNotes || null,
      },
    });
    setShowCreateReminder(false);
  };

  const resetReminderForm = () => {
    setSelectedInvoice(null);
    setReminderFee('0');
    setReminderNotes('');
    setReminderDueDays('14');
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('de-DE');
  };

  const overdueInvoices = invoices.filter(i => i.isOverdue);
  const upcomingInvoices = invoices.filter(i => !i.isOverdue && i.dueDate);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[95vh] overflow-y-auto p-6 md:p-8">
        <DialogHeader className="pb-6 border-b">
          <DialogTitle className="flex items-center gap-3 text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Mahnwesen - Offene Rechnungen
          </DialogTitle>
          <DialogDescription className="text-base mt-2">
            Übersicht über überfällige Rechnungen und Mahnstatus. Erstellen Sie Zahlungserinnerungen und Mahnungen.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <svg className="animate-spin h-10 w-10 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : (
          <div className="space-y-8 mt-6">
            {/* Statistik-Karten */}
            {stats && (
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-xl p-4 border bg-card min-w-0">
                  <div className="text-2xl md:text-3xl font-bold truncate">
                    {stats.totalOverdue}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground mt-1 truncate">Überfällig</div>
                </div>
                <div className="rounded-xl p-4 border bg-card min-w-0">
                  <div className="text-2xl md:text-3xl font-bold truncate">
                    {formatCurrency(stats.totalAmount)}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground mt-1 truncate">Ausstehend</div>
                </div>
                <div className="rounded-xl p-4 border bg-card min-w-0">
                  <div className="text-2xl md:text-3xl font-bold truncate">
                    {formatCurrency(stats.totalFees)}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground mt-1 truncate">Gebühren</div>
                </div>
                <div className="rounded-xl p-4 border bg-card min-w-0">
                  <div className="text-2xl md:text-3xl font-bold truncate">
                    {invoices.length}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground mt-1 truncate">Offen</div>
                </div>
              </div>
            )}

            {/* Mahnstufen-Legende */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <span className="text-muted-foreground font-medium text-sm block mb-2">Mahnstufen:</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(REMINDER_LEVEL_LABELS).map(([level, label]) => (
                  <span
                    key={level}
                    className={`px-2 py-1 rounded-md text-xs md:text-sm whitespace-nowrap ${REMINDER_LEVEL_COLORS[parseInt(level) as keyof typeof REMINDER_LEVEL_COLORS]}`}
                  >
                    {label} ({stats?.byLevel[parseInt(level) as keyof typeof stats.byLevel] ?? 0})
                  </span>
                ))}
              </div>
            </div>

            {/* Überfällige Rechnungen */}
            <Collapsible defaultOpen={true}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-4 bg-card rounded-xl border hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-semibold text-lg">
                    Überfällige Rechnungen ({overdueInvoices.length})
                  </span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                {overdueInvoices.length > 0 ? (
                  <div className="space-y-3">
                    {overdueInvoices.map((invoice) => (
                      <div key={invoice.id} className="border rounded-lg bg-card">
                        <div 
                          className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => setExpandedInvoiceId(expandedInvoiceId === invoice.id ? null : invoice.id)}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold truncate">
                                  {invoice.invoiceNumber || invoice.fileName}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-xs ${REMINDER_LEVEL_COLORS[invoice.currentReminderLevel as keyof typeof REMINDER_LEVEL_COLORS]}`}>
                                  {REMINDER_LEVEL_LABELS[invoice.currentReminderLevel]}
                                </span>
                              </div>
                              <div className="text-sm text-muted-foreground mt-1">
                                {invoice.customer?.name || <span className="italic">Unbekannt</span>}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold">
                                {invoice.totalAmount ? formatCurrency(invoice.totalAmount) : '-'}
                              </div>
                              {invoice.totalFees > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  +{formatCurrency(invoice.totalFees)}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t">
                            <div className="text-sm">
                              <span className="text-muted-foreground">Überfällig: </span>
                              <span className="font-medium">{invoice.daysOverdue} Tage</span>
                              <span className="text-muted-foreground ml-1">({formatDate(invoice.dueDate)})</span>
                            </div>
                            <div className="flex gap-2">
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
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </Button>
                            </div>
                          </div>
                        </div>
                        {/* Mahnungshistorie */}
                        {expandedInvoiceId === invoice.id && invoice.reminders.length > 0 && (
                          <div className="px-4 pb-4">
                            <div className="p-3 bg-muted/30 rounded-lg">
                              <div className="text-xs font-semibold text-muted-foreground mb-2">Mahnungshistorie</div>
                              <div className="space-y-2">
                                {invoice.reminders.map((reminder) => (
                                  <div key={reminder.id} className="flex items-center justify-between text-sm p-2 bg-background rounded border">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`px-2 py-0.5 rounded text-xs ${REMINDER_LEVEL_COLORS[reminder.reminderLevel as keyof typeof REMINDER_LEVEL_COLORS]}`}>
                                        {REMINDER_LEVEL_LABELS[reminder.reminderLevel]}
                                      </span>
                                      <span className="text-muted-foreground text-xs">
                                        {formatDate(reminder.sentAt)}
                                      </span>
                                    </div>
                                    {reminder.fee > 0 && (
                                      <span className="text-xs font-medium">
                                        {formatCurrency(reminder.fee)}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground border rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>Keine überfälligen Rechnungen</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Bald fällige Rechnungen */}
            {upcomingInvoices.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-4 bg-card rounded-xl border hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold">
                      Bald fällige Rechnungen ({upcomingInvoices.length})
                    </span>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <div className="space-y-2">
                    {upcomingInvoices.map((invoice) => (
                      <div key={invoice.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{invoice.invoiceNumber || invoice.fileName}</div>
                          <div className="text-sm text-muted-foreground">
                            {invoice.customer?.name || <span className="italic">Unbekannt</span>}
                          </div>
                        </div>
                        <div className="text-right mx-4 shrink-0">
                          <div className="font-semibold">
                            {invoice.totalAmount ? formatCurrency(invoice.totalAmount) : '-'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Fällig: {formatDate(invoice.dueDate)}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMarkAsPaid(invoice.id)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {/* Mahnung erstellen Dialog */}
        <Dialog open={showCreateReminder && !!selectedInvoice} onOpenChange={(open) => {
          if (!open) {
            setShowCreateReminder(false);
            setSelectedInvoice(null);
          }
        }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-xl font-semibold">
                {selectedInvoice?.nextReminderLevelLabel} erstellen
              </DialogTitle>
              <DialogDescription className="mt-2">
                Für Rechnung: <span className="font-medium">{selectedInvoice?.invoiceNumber || selectedInvoice?.fileName}</span>
                <br />
                Betrag: <span className="font-medium">{selectedInvoice?.totalAmount ? formatCurrency(selectedInvoice.totalAmount) : '-'}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="reminder-fee" className="text-sm font-medium">Mahngebühr (€)</Label>
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
                  Empfehlung: 1. Mahnung 5€, 2. Mahnung 10€, Letzte Mahnung 15€
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reminder-due-days" className="text-sm font-medium">Zahlungsfrist (Tage)</Label>
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
                <Label htmlFor="reminder-notes" className="text-sm font-medium">Notizen (optional)</Label>
                <Textarea
                  id="reminder-notes"
                  value={reminderNotes}
                  onChange={(e) => setReminderNotes(e.target.value)}
                  placeholder="Interne Notizen zur Mahnung..."
                  rows={3}
                />
              </div>
            </div>

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
                variant="outline"
                onClick={openReminderEmailPreview}
                disabled={isCreating}
              >
                <Mail className="mr-2 h-4 w-4" />
                E-Mail prüfen & senden
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

        <EmailPreviewDialog
          open={!!emailReminder}
          onOpenChange={(open) => !open && setEmailReminder(null)}
          documentType="reminder"
          documentId={emailReminder?.invoiceId ?? null}
          reminder={emailReminder?.reminder}
          onSent={async () => {
            await loadData();
            resetReminderForm();
            setEmailReminder(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
