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

type Customer = {
  id: number;
  name: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  createdAt: string;
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
    email: '',
    address: '',
    taxNumber: '',
  });

  useEffect(() => {
    if (customer) {
      setFormData(customer);
    } else {
      setFormData({
        name: '',
        email: '',
        address: '',
        taxNumber: '',
      });
    }
  }, [customer]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 dark:text-gray-200 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">
          {customer ? 'Kunden bearbeiten' : 'Neuen Kunden hinzufügen'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Adresse</Label>
            <Input
              id="address"
              value={formData.address || ''}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxNumber">Steuernummer</Label>
            <Input
              id="taxNumber"
              value={formData.taxNumber || ''}
              onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
              className="dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="dark:bg-gray-700 dark:border-gray-600">
              Abbrechen
            </Button>
            <Button type="submit" className="dark:bg-blue-600 dark:hover:bg-blue-700">
              Speichern
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl mx-auto px-4 py-10">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">
              Kundenverwaltung
            </h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Geschäftskunden
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <Button onClick={openAddModal}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Neuen Kunden hinzufügen
            </Button>
          </div>
        </header>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Ihre Kunden</CardTitle>
            <CardDescription>Eine Liste all Ihrer gespeicherten Kunden.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableCaption>Eine Liste Ihrer Kunden.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Adresse</TableHead>
                    <TableHead>Steuernummer</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length > 0 ? (
                    customers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>{customer.email || '-'}</TableCell>
                        <TableCell>{customer.address || '-'}</TableCell>
                        <TableCell>{customer.taxNumber || '-'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" size="sm" onClick={() => openEditModal(customer)}>
                              Bearbeiten
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-900/20"
                              onClick={() => handleDeleteCustomer(customer.id)}
                              disabled={isDeleting}
                            >
                              Löschen
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        <div className="flex flex-col items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-muted-foreground/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h-10a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2zM12 5v14" />
                          </svg>
                          <span>Keine Kunden vorhanden. Fügen Sie oben einen neuen Kunden hinzu.</span>
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
  );
}
