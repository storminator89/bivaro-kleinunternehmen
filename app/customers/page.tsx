"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  createdAt: string;
};

// Helper to generate initials
const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

// Helper to generate a consistent color based on string
const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
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
      });
    }
  }, [customer]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-card border rounded-xl shadow-lg">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="text-xl font-semibold">{customer ? 'Kunden bearbeiten' : 'Neuen Kunden hinzufügen'}</DialogTitle>
          <DialogDescription>
            {customer ? 'Bearbeiten Sie die Details des Kunden.' : 'Fügen Sie einen neuen Kunden zu Ihrer Datenbank hinzu.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">Firmenname / Name <span className="text-red-500">*</span></Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="z.B. Musterfirma GmbH"
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactPerson" className="text-sm font-medium">Ansprechpartner</Label>
            <Input
              id="contactPerson"
              value={formData.contactPerson || ''}
              onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
              placeholder="z.B. Max Mustermann"
              className="h-10"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">E-Mail Adresse</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="kontakt@musterfirma.de"
                className="h-10"
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
                className="h-10"
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
              className="h-10"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2 col-span-1">
              <Label htmlFor="zipCode" className="text-sm font-medium">PLZ</Label>
              <Input
                id="zipCode"
                value={formData.zipCode || ''}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="12345"
                className="h-10"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="city" className="text-sm font-medium">Stadt</Label>
              <Input
                id="city"
                value={formData.city || ''}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Musterstadt"
                className="h-10"
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
              className="h-10"
            />
          </div>

          <DialogFooter className="border-t pt-4 mt-6">
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
      } else {
        console.error('Failed to fetch customers');
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleSaveCustomer = async (customerData: Omit<Customer, 'id' | 'createdAt'> & { id?: number }) => {
    try {
      let response;
      if (customerData.id) {
        // Update existing customer
        response = await fetch('/api/customers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customerData),
        });
      } else {
        // Add new customer
        response = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customerData),
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

  const filteredCustomers = customers.filter(customer => 
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (customer.contactPerson && customer.contactPerson.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.phone && customer.phone.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (customer.city && customer.city.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
              Kundenverwaltung
            </h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Geschäftskontakte und Kundenstammdaten
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-3">
             <div className="bg-card border rounded-lg px-4 py-2 shadow-sm hidden md:block">
               <span className="text-foreground font-medium">
                 {customers.length} {customers.length === 1 ? 'Kunde' : 'Kunden'}
               </span>
             </div>
            <Button onClick={openAddModal}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Neuen Kunden anlegen
            </Button>
          </div>
        </header>

        <div className="grid gap-6">
          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
            <div className="relative w-full sm:w-96">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <Input 
                placeholder="Suchen nach Name, Ansprechpartner, E-Mail, Telefon oder Stadt..." 
                className="pl-9 bg-background"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Zeige {filteredCustomers.length} von {customers.length} Einträgen
            </div>
          </div>

          <Card className="shadow-sm border-none bg-card/50 backdrop-blur-sm">
            <CardContent className="p-0">
              <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead className="font-semibold">Name / Firma</TableHead>
                      <TableHead className="font-semibold">Ansprechpartner</TableHead>
                      <TableHead className="font-semibold">Kontakt</TableHead>
                      <TableHead className="font-semibold">Anschrift</TableHead>
                      <TableHead className="font-semibold">Steuer-Nr.</TableHead>
                      <TableHead className="text-right font-semibold">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <TableRow key={customer.id} className="hover:bg-muted/50 transition-colors group">
                          <TableCell>
                            <div 
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
                              style={{ backgroundColor: stringToColor(customer.name) }}
                            >
                              {getInitials(customer.name)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-base text-foreground">{customer.name}</div>
                            <div className="text-xs text-muted-foreground">Kunde seit {new Date(customer.createdAt).getFullYear()}</div>
                          </TableCell>
                          <TableCell>
                            {customer.contactPerson ? (
                              <div className="flex items-center text-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span>{customer.contactPerson}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50 text-sm italic">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {customer.email ? (
                                <div className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  <a href={`mailto:${customer.email}`}>{customer.email}</a>
                                </div>
                              ) : null}
                              {customer.phone ? (
                                <div className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                  <a href={`tel:${customer.phone}`}>{customer.phone}</a>
                                </div>
                              ) : null}
                              {!customer.email && !customer.phone && (
                                <span className="text-muted-foreground/50 text-sm italic">- keine Kontaktdaten -</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {customer.address ? (
                                <div className="flex flex-col">
                                  <span>{customer.address}</span>
                                  <span className="text-muted-foreground">
                                    {customer.zipCode} {customer.city}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/50 italic">- keine Adresse -</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {customer.taxNumber ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border">
                                {customer.taxNumber}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50 text-sm italic">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end space-x-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => openEditModal(customer)} className="h-8 w-8">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                      </svg>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Bearbeiten</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => handleDeleteCustomer(customer.id)}
                                      disabled={isDeleting}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Löschen</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <div className="bg-muted/50 p-4 rounded-full mb-4">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h-10a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2zM12 5v14" />
                              </svg>
                            </div>
                            <h3 className="text-lg font-medium text-foreground mb-1">Keine Kunden gefunden</h3>
                            <p className="text-sm max-w-sm mx-auto mb-6">
                              {searchTerm ? 'Es wurden keine Kunden gefunden, die Ihrer Suche entsprechen.' : 'Sie haben noch keine Kunden angelegt. Starten Sie jetzt, indem Sie Ihren ersten Kunden hinzufügen.'}
                            </p>
                            {!searchTerm && (
                              <Button onClick={openAddModal} variant="outline">
                                Ersten Kunden anlegen
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {isModalOpen && (
            <CustomerModal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              onSave={handleSaveCustomer}
              customer={selectedCustomer}
            />
          )}
        </div>
      </div>
    </div>
  );
}
