-- Additive defaults only. Existing invoices and due dates remain unchanged.
ALTER TABLE "Customer" ADD COLUMN "paymentTermDays" INTEGER;
ALTER TABLE "Settings" ADD COLUMN "paymentTermDays" INTEGER;
