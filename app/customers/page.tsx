"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ServiceWorkbench } from '@/components/customers/service-workbench';
import { CustomerTimeline } from '@/components/customers/customer-timeline';
import styles from "@/components/customers/customer-workspace.module.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClipboardList, History, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";

type Customer = {
  id: number;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  zipCode?: string;
  city?: string;
  taxNumber?: string;
  internalNote?: string | null;
  noteVisibility?: NoteVisibility;
  paymentTermDays?: number | null;
  createdAt: string;
};

type NoteVisibility = 'EDITOR' | 'SEND' | 'BOTH';

// Helper to generate initials
const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

type CustomerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (customer: Omit<Customer, 'id' | 'createdAt'> & { id?: number }) => void;
  customer?: Customer | null;
};

const CustomerModal = ({ isOpen, onClose, onSave, customer }: CustomerModalProps) => {
  const [formData, setFormData] = useState<Omit<Customer, 'id' | 'createdAt'> & { id?: number }>(customer || {
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',
    zipCode: '',
    city: '',
    taxNumber: '',
    internalNote: '',
    noteVisibility: 'EDITOR',
    paymentTermDays: null,
  });

  useEffect(() => {
    if (customer) {
      setFormData(customer);
    } else {
      setFormData({
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        address: '',
        zipCode: '',
        city: '',
        taxNumber: '',
        internalNote: '',
        noteVisibility: 'EDITOR',
        paymentTermDays: null,
      });
    }
  }, [customer]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={styles.customerDialog}>
        <DialogHeader className={styles.dialogHeader}>
          <DialogTitle className="text-xl font-semibold">{customer ? 'Kunden bearbeiten' : 'Neuer Kunde'}</DialogTitle>
          <DialogDescription className="sr-only">
            Kontakt- und Rechnungsanschrift
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className={styles.customerForm}>
          <div className={styles.fullField}>
            <Label htmlFor="name" className="text-sm font-medium">Firmenname / Name <span className="text-destructive">*</span></Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="z.B. Musterfirma GmbH"
              className="min-h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactPerson" className="text-sm font-medium">Ansprechpartner</Label>
            <Input
              id="contactPerson"
              value={formData.contactPerson || ''}
              onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
              placeholder="z.B. Max Mustermann"
              className="min-h-11"
            />
          </div>

          <div className={styles.fieldPair}>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">E-Mail Adresse</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="kontakt@musterfirma.de"
                className="min-h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-medium">Telefon</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone || ''}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+49 123 456789"
                className="min-h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address" className="text-sm font-medium">Straße & Hausnummer</Label>
            <Input
              id="address"
              value={formData.address || ''}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Musterstraße 123"
              className="min-h-11"
            />
          </div>

          <div className={styles.addressPair}>
            <div className="space-y-2">
              <Label htmlFor="zipCode" className="text-sm font-medium">PLZ</Label>
              <Input
                id="zipCode"
                value={formData.zipCode || ''}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="12345"
                className="min-h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city" className="text-sm font-medium">Stadt</Label>
              <Input
                id="city"
                value={formData.city || ''}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Musterstadt"
                className="min-h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxNumber" className="text-sm font-medium">Steuernummer / USt-IdNr.</Label>
            <Input
              id="taxNumber"
              value={formData.taxNumber || ''}
              onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
              placeholder="DE123456789"
              className="min-h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-payment-term">Abweichendes Zahlungsziel (Tage)</Label>
            <Input id="customer-payment-term" type="number" min={0} max={365} step={1} value={formData.paymentTermDays ?? ''} onChange={e => setFormData({ ...formData, paymentTermDays: e.target.value === '' ? null : Number(e.target.value) })} aria-describedby="customer-payment-term-help" placeholder="Firmenvorgabe verwenden" />
            <p id="customer-payment-term-help" className="text-xs text-muted-foreground">Leer: Firmenvorgabe, sonst 14 Tage. 0: fällig am Rechnungsdatum.</p>
          </div>

          <details open={Boolean(customer?.internalNote)} className={styles.noteDisclosure}>
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Interner Hinweis</summary>
            <div>
              <Label htmlFor="internalNote" className="text-sm font-medium">Interner Kundenhinweis</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Nicht für Kunden sichtbar.
              </p>
            </div>
            <Textarea
              id="internalNote"
              value={formData.internalNote || ''}
              onChange={(e) => setFormData({ ...formData, internalNote: e.target.value })}
              placeholder="z. B. bevorzugte Kontaktzeit oder interne Absprachen"
              rows={3}
            />
            <div className="space-y-2">
              <Label htmlFor="noteVisibility" className="text-sm font-medium">Hinweis anzeigen in</Label>
              <select
                id="noteVisibility"
                value={formData.noteVisibility || 'EDITOR'}
                onChange={(e) => setFormData({ ...formData, noteVisibility: e.target.value as NoteVisibility })}
                className={styles.select}
              >
                <option value="EDITOR">Rechnungserstellung</option>
                <option value="SEND">E-Mail-Versand</option>
                <option value="BOTH">Rechnungserstellung und E-Mail-Versand</option>
              </select>
            </div>
          </details>

          <DialogFooter className={styles.dialogFooter}>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit">
              {customer ? 'Änderungen speichern' : 'Kunden anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function CustomersPage() {
  return <Suspense fallback={<p role="status">Kunden werden geladen …</p>}><ScopedCustomersWorkspace /></Suspense>;
}

function ScopedCustomersWorkspace() {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  // A selected-ID destination always gets a fresh owned-list read, including
  // client-side navigation from the directory and Back/Forward.
  return <CustomersWorkspace key={`${status}:${session?.user?.id}:${session?.user?.sessionVersion}:${params.get('customer')}`} />;
}

function CustomersWorkspace() {
  const params = useSearchParams();
  const selectedId = params.get('customer');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notesCustomer, setNotesCustomer] = useState<Customer | null>(null);
  const [timelineCustomer, setTimelineCustomer] = useState<Customer | null>(null);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setIsLoadingCustomers(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/customers', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
      } else {
        setLoadError('Kunden konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setLoadError('Kunden konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleSaveCustomer = async (customerData: Omit<Customer, 'id' | 'createdAt'> & { id?: number }) => {
    try {
      const payload = {
        ...customerData,
        internalNote: customerData.internalNote?.trim() || null,
        noteVisibility: customerData.noteVisibility || 'EDITOR',
      };
      let response;
      if (customerData.id) {
        // Update existing customer
        response = await fetch('/api/customers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // Add new customer
        response = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (response.ok) {
        fetchCustomers(); // Refresh list
        setIsModalOpen(false);
        setSelectedCustomer(null);
      } else {
        const errorData = await response.json();
        console.error('Failed to save customer:', errorData);
        alert(`Fehler beim Speichern des Kunden: ${errorData.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      console.error('Error saving customer:', error);
      alert(`Ein unerwarteter Fehler ist aufgetreten: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteCustomer = async (id: number) => {
    if (!confirm('Sind Sie sicher, dass Sie diesen Kunden löschen möchten? Dies kann zu Inkonsistenzen bei verknüpften Einnahmen/Rechnungen führen.')) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/customers?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchCustomers();
      } else {
        const errorData = await response.json();
        console.error('Failed to delete customer:', errorData);
        alert(`Fehler beim Löschen des Kunden: ${errorData.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert(`Ein unerwarteter Fehler ist aufgetreten: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setSelectedCustomer(null);
    setIsModalOpen(true);
  };

  const filteredCustomers = customers.filter(customer => selectedId === null || (/^[1-9]\d*$/.test(selectedId) && Number.isSafeInteger(Number(selectedId)) && customer.id === Number(selectedId))).filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (customer.contactPerson && customer.contactPerson.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.phone && customer.phone.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.city && customer.city.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className={`customer-workspace ${styles.directory}`}>
      <PageHeader
        title="Kunden"
        actions={<Button type="button" onClick={openAddModal}><Plus aria-hidden="true" />Neuer Kunde</Button>}
      />

      <div className={styles.directoryNavigation}>
        <span className={styles.directoryCount}>
          {isLoadingCustomers || loadError ? '—' : customers.length} {customers.length === 1 ? 'Kunde' : 'Kunden'}
        </span>
        <div className={styles.directoryLinks}>
          <Button variant="ghost" asChild><Link href="/customers/import">CSV importieren</Link></Button>
          <Button variant="ghost" asChild><Link href="/customers/articles">Artikel und Leistungen</Link></Button>
        </div>
      </div>

      {selectedId !== null && <div className={styles.selectedCustomer}>
        <p>{!isLoadingCustomers && !loadError && !filteredCustomers.length ? 'Kunde nicht gefunden oder nicht verfügbar.' : 'Ausgewählter Kunde'}</p>
        <Button variant="outline" asChild><Link href="/customers">Alle Kunden anzeigen</Link></Button>
      </div>}

      <section className={`customer-directory ${styles.directorySurface}`} aria-label="Kundenverzeichnis">
        <div className={styles.directoryToolbar}>
          <div className={styles.searchField}>
            <Label htmlFor="customer-search">Kunden suchen</Label>
            <div className={styles.searchInput}>
              <Search aria-hidden="true" />
              <Input
                id="customer-search"
                aria-label="Kunden suchen"
                placeholder="Name, Kontakt oder Ort suchen…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <p className={styles.resultCount}>
            Zeige {isLoadingCustomers || loadError ? '—' : filteredCustomers.length} von {isLoadingCustomers || loadError ? '—' : customers.length} Einträgen
          </p>
        </div>

        {isLoadingCustomers && <div role="status" className={styles.loading}>
          <p><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Kunden werden geladen …</p>
          <div className={styles.loadingRows} aria-hidden="true"><span /><span /><span /></div>
        </div>}
        {loadError && <div role="alert" className={styles.loadError}><p>{loadError}</p><Button type="button" variant="outline" onClick={fetchCustomers}>Erneut laden</Button></div>}

        {!isLoadingCustomers && !loadError && <>
          {filteredCustomers.length ? <>
            <div className={`customer-mobile-list ${styles.mobileList}`} aria-label="Kundenliste">
              {filteredCustomers.map(customer => <article key={customer.id} className={styles.mobileRecord}>
                <div className={`customer-record-heading ${styles.recordHeading}`}>
                  <span className={`customer-monogram ${styles.avatar}`}>{getInitials(customer.name)}</span>
                  <div><h2>{customer.name}</h2><p>{customer.contactPerson || 'Geschäftskontakt'}</p></div>
                </div>
                <dl className={styles.mobileDetails}>
                  {customer.email && <div><dt>E-Mail</dt><dd><a href={`mailto:${customer.email}`}>{customer.email}</a></dd></div>}
                  {customer.phone && <div><dt>Telefon</dt><dd><a href={`tel:${customer.phone}`}>{customer.phone}</a></dd></div>}
                  {!customer.email && !customer.phone && <div><dt>Kontakt</dt><dd>- keine Kontaktdaten -</dd></div>}
                  {(customer.address || customer.zipCode || customer.city) && <div><dt>Anschrift</dt><dd>{customer.address && <span>{customer.address}</span>}{(customer.zipCode || customer.city) && <span>{customer.zipCode} {customer.city}</span>}</dd></div>}
                  {customer.taxNumber && <div><dt>Steuer-Nr.</dt><dd>{customer.taxNumber}</dd></div>}
                  <div><dt>Kunde seit</dt><dd>{new Date(customer.createdAt).getFullYear()}</dd></div>
                </dl>
                <div className={styles.mobileActions}>
                  <Button type="button" variant="outline" size="sm" onClick={() => openEditModal(customer)} aria-label={`${customer.name} bearbeiten`}>Bearbeiten</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNotesCustomer(customer)} data-service-workbench-return={customer.id} aria-label={`Leistungsnotizen für ${customer.name}`}>Leistungsnotizen</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setTimelineCustomer(customer)} data-customer-timeline-return={customer.id} aria-label={`Verlauf für ${customer.name}`}>Verlauf</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={isDeleting} onClick={() => handleDeleteCustomer(customer.id)} aria-label={`${customer.name} löschen`}>Löschen</Button>
                </div>
              </article>)}
            </div>

            <div className={styles.desktopList}>
              <Table className={styles.directoryTable}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name / Firma</TableHead>
                    <TableHead>Kontakt</TableHead>
                    <TableHead>Anschrift</TableHead>
                    <TableHead className={styles.taxColumn}>Steuer-Nr.</TableHead>
                    <TableHead className={styles.actionsColumn}>Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map(customer => <TableRow key={customer.id}>
                    <TableCell>
                      <div className={styles.recordHeading}>
                        <span className={styles.avatar}>{getInitials(customer.name)}</span>
                        <div><h2>{customer.name}</h2><p>Kunde seit {new Date(customer.createdAt).getFullYear()}</p></div>
                      </div>
                      {customer.contactPerson && <dl className={styles.contactPerson}><dt>Ansprechpartner</dt><dd>{customer.contactPerson}</dd></dl>}
                    </TableCell>
                    <TableCell>
                      <div className={styles.contactLinks}>
                        {customer.email && <a href={`mailto:${customer.email}`}>{customer.email}</a>}
                        {customer.phone && <a href={`tel:${customer.phone}`}>{customer.phone}</a>}
                        {!customer.email && !customer.phone && <span className={styles.missingValue}>- keine Kontaktdaten -</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {customer.address ? <div className={styles.address}><span>{customer.address}</span><span>{customer.zipCode} {customer.city}</span></div> : <span className={styles.missingValue}>- keine Adresse -</span>}
                    </TableCell>
                    <TableCell>{customer.taxNumber || <span className={styles.missingValue}>-</span>}</TableCell>
                    <TableCell>
                      <div className={styles.rowActions}>
                        <TooltipProvider delayDuration={800}>
                          <Tooltip><TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label={`${customer.name} bearbeiten`} onClick={() => openEditModal(customer)}><Pencil aria-hidden="true" /></Button>
                          </TooltipTrigger><TooltipContent>Bearbeiten</TooltipContent></Tooltip>
                          <Tooltip><TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setNotesCustomer(customer)} data-service-workbench-return={customer.id} aria-label={`Leistungsnotizen für ${customer.name}`}><ClipboardList aria-hidden="true" /></Button>
                          </TooltipTrigger><TooltipContent>Leistungsnotizen</TooltipContent></Tooltip>
                          <Tooltip><TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setTimelineCustomer(customer)} data-customer-timeline-return={customer.id} aria-label={`Verlauf für ${customer.name}`}><History aria-hidden="true" /></Button>
                          </TooltipTrigger><TooltipContent>Verlauf</TooltipContent></Tooltip>
                          <Tooltip><TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={`${customer.name} löschen`} onClick={() => handleDeleteCustomer(customer.id)} disabled={isDeleting}><Trash2 aria-hidden="true" /></Button>
                          </TooltipTrigger><TooltipContent>Löschen</TooltipContent></Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
          </> : <div className={styles.empty}>
            <h2>Keine Kunden gefunden</h2>
            {searchTerm && <p>Suche ändern.</p>}
            {!searchTerm && selectedId === null && <Button type="button" onClick={openAddModal} variant="outline">Ersten Kunden anlegen</Button>}
          </div>}
        </>}
      </section>

      {isModalOpen && <CustomerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveCustomer} customer={selectedCustomer} />}
      <ServiceWorkbench
        customer={notesCustomer}
        open={Boolean(notesCustomer)}
        onOpenChange={(open) => {
          if (!open) setNotesCustomer(null);
        }}
      />
      <CustomerTimeline
        customer={timelineCustomer}
        open={Boolean(timelineCustomer)}
        onOpenChange={(open) => {
          if (!open) setTimelineCustomer(null);
        }}
      />
    </div>
  );
}
