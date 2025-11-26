"use client";

import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AfaTableDialog } from "@/components/afa-table-dialog";
import { Customer } from "@/types/dashboard";

type EditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  data: any;
  type: 'expense' | 'income';
  customers: Customer[];
};

export function EditModal({ isOpen, onClose, onSave, data, type, customers = [] }: EditModalProps) {
  const [formData, setFormData] = useState(data);

  useEffect(() => {
    setFormData(data);
  }, [data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-card border rounded-xl shadow-lg">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="text-xl font-semibold">
            {type === 'expense' ? 'Ausgabe bearbeiten' : 'Einnahme bearbeiten'}
          </DialogTitle>
          <DialogDescription>
            Nehmen Sie Änderungen an Ihrer {type === 'expense' ? 'Ausgabe' : 'Einnahme'} vor. Klicken Sie auf Speichern, wenn Sie fertig sind.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-description" className="text-sm font-medium">Beschreibung</Label>
            <Input
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              required
              className="dark:bg-background dark:border-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-amount" className="text-sm font-medium">Betrag (€)</Label>
            <Input
              id="edit-amount"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
              className="dark:bg-background dark:border-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-date" className="text-sm font-medium">Datum</Label>
            <Input
              id="edit-date"
              type="date"
              value={formData.date ? new Date(formData.date).toISOString().split('T')[0] : ''}
              onChange={(e) => setFormData({ ...formData, date: new Date(e.target.value).toISOString() })}
              required
              className="dark:bg-background dark:border-input"
            />
          </div>

          {type === 'expense' && (
            <div className="space-y-2">
              <Label htmlFor="edit-category" className="text-sm font-medium">Kategorie</Label>
              <Input
                id="edit-category"
                value={formData.category || ''}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="dark:bg-background dark:border-input"
              />
            </div>
          )}

          {type === 'income' && (
            <div className="space-y-2">
              <Label htmlFor="edit-customer" className="text-sm font-medium">Kunde</Label>
              <select
                id="edit-customer"
                value={formData.customerId || ''}
                onChange={(e) => setFormData({ ...formData, customerId: e.target.value ? parseInt(e.target.value) : undefined })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Kunde auswählen (optional)</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="edit-taxRelevant"
              className="h-4 w-4 rounded border-input bg-background"
              checked={formData.taxRelevant}
              onChange={(e) => setFormData({ ...formData, taxRelevant: e.target.checked })}
            />
            <Label htmlFor="edit-taxRelevant" className="font-normal">Steuerlich relevant</Label>
          </div>

          {type === 'expense' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-taxDeductiblePercentage" className="text-sm font-medium">Steuerlich ansetzbar (%)</Label>
                <Input
                  id="edit-taxDeductiblePercentage"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={formData.taxDeductiblePercentage || 100}
                  onChange={(e) => setFormData({ ...formData, taxDeductiblePercentage: parseInt(e.target.value) || 100 })}
                  placeholder="100"
                  className="dark:bg-background dark:border-input"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-depreciationYears" className="text-sm font-medium">Abschreibung (Jahre)</Label>
                  <AfaTableDialog onSelect={(years) => setFormData({ ...formData, depreciationYears: years })} />
                </div>
                <Input
                  id="edit-depreciationYears"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.depreciationYears || ''}
                  onChange={(e) => setFormData({ ...formData, depreciationYears: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="Optional (z.B. 3)"
                  className="dark:bg-background dark:border-input"
                />
                <p className="text-xs text-muted-foreground">
                  &gt; 800€ Netto: AfA Pflicht. &lt; 800€: Leer lassen.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit">Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
