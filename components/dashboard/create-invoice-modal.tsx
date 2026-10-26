"use client";
import { paymentToday, addPaymentCalendarDays, isPaymentBusinessDate, paymentTermSuggestion, type PaymentTermSelection } from "@/lib/payment-terms";
import type { ServiceBillingDraftSeed } from "@/lib/service-billing";
import { ServiceArticlePicker } from "@/components/dashboard/service-article-picker";
import { ProjectServiceSelection, type ProjectServiceNote } from "@/components/dashboard/project-service-selection";

import salesStyles from "@/components/dashboard/sales-workspace.module.css";
import { useState, useEffect, useCallback, useRef, type SyntheticEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { generateZugferdXml, validateZugferdData, SMALL_BUSINESS_EXEMPTION_REASON } from "@/lib/zugferd-generator";
import { calculateInvoiceAmounts } from "@/lib/invoice-calculation";
import { ownInvoiceToZugferdData, parseOwnInvoiceSource, type OwnInvoiceSource } from "@/lib/own-invoice-source";
import { DocumentTaxProfileFields } from "@/components/dashboard/document-tax-profile-fields";
import { type DocumentFiscalSettings, type DocumentTaxMode, type DocumentTaxSelection, type DocumentTaxCase, preservedDocumentTaxMode, resolveDocumentTaxState, isSupportedDocumentTaxCase, hasUnsupportedDocumentTaxCategory } from "@/lib/document-tax-profile";
import PriceHistory from "@/components/dashboard/price-history";
import { ArrowLeft, Copy, Eye, EyeOff, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: () => void;
  presentation?: "dialog" | "page";
  fromDraft?: { id: number; customerId: number | null; parsedData: ServiceBillingDraftSeed; draftToken: string };
  fromQuote?: {
    id: number;
    parsedData: {
      items?: InvoiceItem[];
      taxMode?: DocumentTaxMode;
      notes?: string;
      customerAddress?: string;
    };
    customerId?: number | null;
    invoiceNumber?: string | null; // quote number for reference
  };
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  taxRate: number;
  taxCategory?: 'S' | 'E' | 'Z';
  exemptionReason?: string;
  billingNoteId?: number;
  billingNoteSource?: ProjectServiceNote;
}

function stripBillingNoteAssociation(item: InvoiceItem): InvoiceItem {
  return {
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unit: item.unit,
    taxRate: item.taxRate,
    taxCategory: item.taxCategory,
    exemptionReason: item.exemptionReason,
  };
}

type NoteVisibility = 'EDITOR' | 'SEND' | 'BOTH';

interface Settings extends DocumentFiscalSettings {
  paymentTermDays?: number | null;
  companyName?: string;
  companyAddress?: string;
  taxNumber?: string;
  iban?: string;
  bic?: string;
  bankName?: string;
  footerText?: string;
  logoUrl?: string;
  email?: string;
  telephone?: string;
}

interface Customer {
  id: number | string;
  name: string;
  address?: string;
  zipCode?: string;
  city?: string;
  email?: string;
  internalNote?: string | null;
  noteVisibility?: NoteVisibility;
  paymentTermDays?: number | null;
}

interface Template {
  id: string | number;
  name: string;
  data: {
    items?: InvoiceItem[];
    notes?: string;
    includeQRCode?: boolean;
    taxMode?: 'small-business' | 'standard';
  };
}

type InvoiceOutputMode = 'zugferd-pdf' | 'xml-only';

export function CreateInvoiceModal({
  isOpen,
  onClose,
  onInvoiceCreated,
  fromQuote,
  fromDraft,
  presentation = "dialog",
}: CreateInvoiceModalProps) {
  const isServiceDraft = Boolean(fromDraft);
  const [draftToken, setDraftToken] = useState(fromDraft?.draftToken ?? "");
  const [draftSaveMessage, setDraftSaveMessage] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [customerAddress, setCustomerAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [numberingSelection, setNumberingSelection] = useState<import("@/lib/document-numbering-policy").DocumentNumberSelection | null>(null);
  const [numberRefreshing, setNumberRefreshing] = useState(false);
  const numberRequestRef = useRef(0);
  const [date, setDate] = useState(paymentToday());
  const [dueDate, setDueDate] = useState("");
  const [paymentTermManual, setPaymentTermManual] = useState(false);
  const [paymentTermMessage, setPaymentTermMessage] = useState("");
  const [paymentTermRefreshing, setPaymentTermRefreshing] = useState(false);
  const paymentTermRefreshRef = useRef(0);
  const paymentTermDataRef = useRef(0);
  const paymentTermDataRequestRef = useRef(0);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [billingNotes, setBillingNotes] = useState<ProjectServiceNote[]>([]);
  const [billingNotesReload, setBillingNotesReload] = useState(0);
  const [isBillingNotesLoading, setIsBillingNotesLoading] = useState(false);
  const [billingNotesError, setBillingNotesError] = useState<string | null>(null);
  const [customerChangeMessage, setCustomerChangeMessage] = useState<string | null>(null);
  const [includeQRCode, setIncludeQRCode] = useState(false);
  const [invoiceNumberError, setInvoiceNumberError] = useState<string | null>(null);
  const [isCheckingNumber, setIsCheckingNumber] = useState(false);
  const invoiceNumberCheckRequestRef = useRef(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [generatedRequestId, setGeneratedRequestId] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<InvoiceOutputMode>('zugferd-pdf');
  const [taxSelection, setTaxSelection] = useState<DocumentTaxSelection | null>(null);
  const [taxAcknowledged, setTaxAcknowledged] = useState(false);
  const [taxCase, setTaxCase] = useState<DocumentTaxCase>('domestic');
  const [domesticConfirmed, setDomesticConfirmed] = useState(false);
  const [buyerReference, setBuyerReference] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerCountry, setBuyerCountry] = useState('DE');
  const [sellerCountry, setSellerCountry] = useState('DE');
  const [buyerPostcode, setBuyerPostcode] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [sellerPostcode, setSellerPostcode] = useState('');
  const [sellerCity, setSellerCity] = useState('');
  const [paymentMeansCode, setPaymentMeansCode] = useState<'30' | '10'>('30');

  const taxState = resolveDocumentTaxState(settings, date, taxSelection, taxAcknowledged);
  const taxMode = taxState.mode;
  const foreignAddress = buyerCountry !== 'DE' || sellerCountry !== 'DE';
  const unsupportedTaxCategory = hasUnsupportedDocumentTaxCategory(items);
  const taxReady = taxState.ready && !unsupportedTaxCategory && isSupportedDocumentTaxCase(taxCase, foreignAddress, domesticConfirmed);

  const handleTaxModeChange = (mode: DocumentTaxMode | '') => {
    setTaxSelection({ mode, source: 'manual' });
    setTaxAcknowledged(false);
    if (mode === 'small-business') {
      setItems(current => current.map(item => ({ ...item, taxRate: 0, taxCategory: 'E', exemptionReason: undefined })));
    } else if (mode === 'standard') {
      // An explicit change away from §19 resets its exemption. Preserved
      // template/quote E/Z categories are otherwise not reinterpreted.
      setItems(current => current.map(item => taxMode === 'small-business'
        ? { ...item, taxRate: 19, taxCategory: undefined, exemptionReason: undefined }
        : !taxSelection && !item.taxCategory && item.taxRate === 0
          ? { ...item, taxRate: 19 }
          : item));
    }
  };

  // Only a fresh, profile-derived document gets company defaults. A template,
  // converted quote or explicit document decision always wins.
  useEffect(() => {
    if (taxState.source !== 'profile') return;
    setItems(current => current.map(item => taxMode === 'small-business'
      ? { ...item, taxRate: 0, taxCategory: 'E', exemptionReason: undefined }
      : (item.taxCategory === 'E' && !item.exemptionReason) || (!item.taxCategory && item.taxRate === 0)
        ? { ...item, taxRate: 19, taxCategory: undefined, exemptionReason: undefined }
        : item));
  }, [taxMode, taxState.source]);

  useEffect(() => { setDomesticConfirmed(false); }, [buyerCountry, sellerCountry]);

  // Preview states
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewGenerationRef = useRef(0);
  const renderRequestRef = useRef<Promise<void> | null>(null);
  const issuingRef = useRef(false);
  const editorActiveRef = useRef(isOpen);
  const editorGenerationRef = useRef(0);
  const billingNotesRequestRef = useRef(0);
  const wasOpenRef = useRef(false);
  const appliedQuoteRef = useRef<number | null>(null);
  const appliedDraftRef = useRef<number | null>(null);

  const resetEditorState = useCallback(() => {
    editorGenerationRef.current += 1;
    issuingRef.current = false;
    const today = paymentToday();

    appliedQuoteRef.current = null;
    appliedDraftRef.current = null;
    billingNotesRequestRef.current += 1;
    setDraftSaveMessage("");
    setCustomerAddress("");
    setInvoiceNumber("");
    setNumberingSelection(null);
    setNumberRefreshing(false);
    numberRequestRef.current += 1;
    setDate(today);
    setDueDate(addPaymentCalendarDays(today, 14));
    setPaymentTermManual(false);
    setPaymentTermMessage('');
    setPaymentTermRefreshing(false);
    paymentTermRefreshRef.current += 1;
    setDeliveryDate(today);
    setNotes("");
    setItems([{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: 0 }]);
    setSelectedCustomer(null);
    setSelectedCustomerId(null);
    setBillingNotes([]);
    setBillingNotesReload(0);
    setIsBillingNotesLoading(false);
    setBillingNotesError(null);
    setCustomerChangeMessage(null);
    setIncludeQRCode(false);
    setInvoiceNumberError(null);
    setIsCheckingNumber(false);
    setSelectedTemplateId("");
    setIsSaveTemplateOpen(false);
    setNewTemplateName("");
    setGeneratedRequestId(globalThis.crypto?.randomUUID?.() ?? null);
    setOutputMode('zugferd-pdf');
    setSettings(null);
    setTaxSelection(null);
    setTaxAcknowledged(false);
    setTaxCase('domestic');
    setDomesticConfirmed(false);
    setBuyerReference('');
    setBuyerEmail('');
    setBuyerCountry('DE');
    setSellerCountry('DE');
    setBuyerPostcode('');
    setBuyerCity('');
    setSellerPostcode('');
    setSellerCity('');
    setPaymentMeansCode('30');
    setIsGenerating(false);
    setShowPreview(false);
    setIsGeneratingPreview(false);
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    previewGenerationRef.current += 1;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      editorActiveRef.current = false;
      editorGenerationRef.current += 1;
      issuingRef.current = false;
      wasOpenRef.current = false;
      paymentTermRefreshRef.current += 1;
      return;
    }
    editorActiveRef.current = true;

    if (!wasOpenRef.current) resetEditorState();
    wasOpenRef.current = true;

    let active = true;
    const dataRequestId = ++paymentTermDataRequestRef.current;
    if (isOpen) {
      fetch("/api/settings", { cache: "no-store" })
        .then(res => { if (!res.ok) throw new Error("Firmenprofil konnte nicht geladen werden"); return res.json(); })
        .then(data => { if (active && !issuingRef.current && dataRequestId >= paymentTermDataRef.current) { paymentTermDataRef.current = dataRequestId; setSettings(data); } })
        .catch(err => console.error("Failed to load settings", err));

      fetch("/api/customers")
        .then(res => res.json())
        .then(data => {
          if (!active || issuingRef.current || dataRequestId < paymentTermDataRef.current) return;
          paymentTermDataRef.current = dataRequestId;
          const nextCustomers = Array.isArray(data) ? data : [];
          setCustomers(nextCustomers);
          if (!issuingRef.current && (fromQuote?.customerId || fromDraft?.customerId)) {
            const sourceCustomerId = fromDraft?.customerId ?? fromQuote?.customerId;
            const quoteCustomer = nextCustomers.find((customer: Customer) => customer.id.toString() === sourceCustomerId?.toString());
            if (quoteCustomer) {
              setSelectedCustomer(quoteCustomer);
              setSelectedCustomerId(Number(quoteCustomer.id));
            }
          }
        })
        .catch(err => console.error("Failed to load customers", err));

      const numberRequest = ++numberRequestRef.current;
      fetch("/api/invoices/next-number")
        .then(res => res.json())
        .then(data => {
          if (active && !issuingRef.current && numberRequest === numberRequestRef.current && data.nextInvoiceNumber) {
            setInvoiceNumber(data.nextInvoiceNumber);
            setNumberingSelection(data.numberingSelection ?? null);
          }
        })
        .catch(err => console.error("Failed to load next invoice number", err));

      fetchTemplates();
    }
    return () => { active = false; };
  }, [fromQuote?.customerId, fromDraft?.customerId, isOpen, resetEditorState]);

  useEffect(() => {
    if (!isOpen || !selectedCustomerId || isServiceDraft) {
      setBillingNotes([]);
      setBillingNotesError(null);
      setIsBillingNotesLoading(false);
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    const requestId = ++billingNotesRequestRef.current;
    setIsBillingNotesLoading(true);
    setBillingNotesError(null);
    fetch(`/api/billing-notes?customerId=${selectedCustomerId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Leistungsnotizen konnten nicht geladen werden.');
        return Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : [];
      })
      .then(data => {
        if (isActive && requestId === billingNotesRequestRef.current) setBillingNotes(data.filter((note: ProjectServiceNote) => note.customerId === selectedCustomerId));
      })
      .catch(error => {
        if (isActive && requestId === billingNotesRequestRef.current) {
          setBillingNotes([]);
          setBillingNotesError(error instanceof Error ? error.message : 'Leistungsnotizen konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (isActive && requestId === billingNotesRequestRef.current) setIsBillingNotesLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [selectedCustomerId, isServiceDraft, isOpen, billingNotesReload]);

  let suggestedPaymentTerm: PaymentTermSelection | null = null;
  if (isPaymentBusinessDate(date)) {
    try { suggestedPaymentTerm = paymentTermSuggestion(date, selectedCustomerId, selectedCustomer?.paymentTermDays, settings?.paymentTermDays); }
    catch { /* Unsupported end dates remain editable, never crash the editor. */ }
  }
  const suggestedPaymentDue = suggestedPaymentTerm?.dueDate ?? '';
  useEffect(() => {
    if (!isOpen || isServiceDraft || paymentTermManual || issuingRef.current) return;
    setDueDate(suggestedPaymentDue);
  }, [isOpen, isServiceDraft, paymentTermManual, suggestedPaymentDue]);

  const reapplyPaymentTerm = async () => {
    if (issuingRef.current || isSavingDraft || !editorActiveRef.current) return;
    const editorGeneration = editorGenerationRef.current;
    const requestId = ++paymentTermRefreshRef.current;
    const dataRequestId = ++paymentTermDataRequestRef.current;
    setPaymentTermRefreshing(true);
    setPaymentTermMessage('');
    try {
      const [settingsResponse, customersResponse] = await Promise.all([
        fetch('/api/settings', { cache: 'no-store' }),
        fetch('/api/customers', { cache: 'no-store' }),
      ]);
      if (!settingsResponse.ok || !customersResponse.ok) throw new Error('Die aktuelle Vorgabe konnte nicht geladen werden. Ihre Fälligkeit bleibt erhalten.');
      const nextSettings: Settings = await settingsResponse.json();
      const nextCustomers: Customer[] = await customersResponse.json();
      if (requestId !== paymentTermRefreshRef.current || issuingRef.current
        || !editorActiveRef.current || editorGeneration !== editorGenerationRef.current) return;
      if (!Array.isArray(nextCustomers)) throw new Error('Kunden konnten nicht geladen werden.');
      const nextCustomer = nextCustomers.find(customer => Number(customer.id) === selectedCustomerId) ?? null;
      if (selectedCustomerId !== null && !nextCustomer) throw new Error('Der ausgewählte Kunde ist nicht mehr verfügbar. Bitte erneut auswählen.');
      const nextSelection = paymentTermSuggestion(date, selectedCustomerId, nextCustomer?.paymentTermDays, nextSettings.paymentTermDays);
      paymentTermDataRef.current = dataRequestId;
      setSettings(nextSettings);
      setCustomers(nextCustomers);
      setSelectedCustomer(nextCustomer);
      setPaymentTermManual(false);
      setDueDate(nextSelection.dueDate ?? '');
    } catch (error) {
      if (requestId === paymentTermRefreshRef.current && !issuingRef.current
        && editorActiveRef.current && editorGeneration === editorGenerationRef.current) setPaymentTermMessage(error instanceof Error ? error.message : 'Vorgabe konnte nicht geladen werden.');
    } finally {
      if (requestId === paymentTermRefreshRef.current && editorActiveRef.current
        && editorGeneration === editorGenerationRef.current) setPaymentTermRefreshing(false);
    }
  };

  // Pre-fill from quote when converting
  useEffect(() => {
    if (isOpen && fromQuote && appliedQuoteRef.current !== fromQuote.id) {
      appliedQuoteRef.current = fromQuote.id;
      const pd = fromQuote.parsedData;
      if (pd.items && pd.items.length > 0) {
        // Quote/template data is not allowed to carry a billing-note claim
        // into a new invoice. Associations are created only by this editor.
        setItems(pd.items.map(item => stripBillingNoteAssociation({
          ...item,
          unit: item.unit || "Stück",
          taxRate: item.taxRate ?? 0,
        })));
        // A zero-tax legacy quote is ambiguous, never an implicit §19 decision.
        setTaxSelection({ mode: preservedDocumentTaxMode(pd), source: 'quote' });
        setTaxAcknowledged(false);
      }
      if (!pd.items?.length) setTaxSelection({ mode: preservedDocumentTaxMode(pd), source: 'quote' });
      if (pd.notes) setNotes(pd.notes);
      if (pd.customerAddress) setCustomerAddress(pd.customerAddress);
    }
  }, [isOpen, fromQuote]);

  useEffect(() => {
    if (!isOpen || !fromDraft || appliedDraftRef.current === fromDraft.id) return;
    appliedDraftRef.current = fromDraft.id;
    setItems(fromDraft.parsedData.items.map(item => ({ ...item })));
    setTaxSelection({ mode: fromDraft.parsedData.taxMode, source: 'template' });
    setTaxAcknowledged(false);
    setCustomerAddress(fromDraft.parsedData.customerAddress);
    setNotes(fromDraft.parsedData.notes);
    setDraftToken(fromDraft.draftToken);
  }, [isOpen, fromDraft]);

  useEffect(() => {
    if (outputMode === 'xml-only') {
      setIncludeQRCode(false);
    }
  }, [outputMode]);

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/invoice-templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error("Failed to load templates", error);
    }
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim() || !taxReady) return;

    const templateData = {
      items: items.map(stripBillingNoteAssociation),
      notes,
      includeQRCode,
      taxMode,
      // We don't save customer specific info or dates usually, but maybe notes and items are the most important
    };

    try {
      const res = await fetch("/api/invoice-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTemplateName,
          data: templateData,
        }),
      });

      if (res.ok) {
        setNewTemplateName("");
        setIsSaveTemplateOpen(false);
        fetchTemplates();
        alert("Vorlage erfolgreich gespeichert.");
      } else {
        alert("Fehler beim Speichern der Vorlage.");
      }
    } catch (error) {
      console.error("Error saving template:", error);
      alert("Fehler beim Speichern der Vorlage.");
    }
  };

  const handleLoadTemplate = (templateId: string) => {
    if (issuingRef.current || isSavingDraft) return;
    const template = templates.find(t => t.id.toString() === templateId);
    if (template && template.data) {
      const data = template.data;
      if (data.items) {
        setItems(data.items.map((item: InvoiceItem) => ({
          ...stripBillingNoteAssociation(item),
          unit: item.unit || "Stück",
          taxRate: item.taxRate ?? 0
        })));
      }
      setTaxSelection({ mode: preservedDocumentTaxMode(data), source: 'template' });
      setTaxAcknowledged(false);
      if (data.notes !== undefined) setNotes(data.notes);
      if (data.includeQRCode !== undefined) setIncludeQRCode(data.includeQRCode);
      // Add other fields if needed
    }
    setSelectedTemplateId(templateId);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Möchten Sie diese Vorlage wirklich löschen?")) return;

    try {
      const res = await fetch(`/api/invoice-templates/${templateId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchTemplates();
        if (selectedTemplateId === templateId) setSelectedTemplateId("");
      } else {
        alert("Fehler beim Löschen der Vorlage.");
      }
    } catch (error) {
      console.error("Error deleting template:", error);
      alert("Fehler beim Löschen der Vorlage.");
    }
  };

  // Keep creation disabled during the debounce as well as the request.
  // Otherwise a late duplicate check can disable retry after a successful save
  // whose response was lost.
  // Abort saves work; ownership guards also reject already-resolving reads.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requestId = ++invoiceNumberCheckRequestRef.current;
    const editorGeneration = editorGenerationRef.current;
    const isCurrentCheck = () => active && editorActiveRef.current
      && requestId === invoiceNumberCheckRequestRef.current
      && editorGeneration === editorGenerationRef.current;
    setIsCheckingNumber(isOpen && Boolean(invoiceNumber));
    if (!isOpen || !invoiceNumber) {
      setInvoiceNumberError(null);
      return;
    }

    const checkInvoiceNumber = async () => {
      if (!isCurrentCheck()) return;

      try {
        const res = await fetch(`/api/invoices/check-number?number=${encodeURIComponent(invoiceNumber)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (!isCurrentCheck()) return;
          if (data.exists) {
            setInvoiceNumberError("Diese Rechnungsnummer existiert bereits.");
          } else {
            setInvoiceNumberError(null);
          }
        }
      } catch (error) {
        if (isCurrentCheck()) console.error("Error checking invoice number:", error);
      } finally {
        if (isCurrentCheck()) setIsCheckingNumber(false);
      }
    };

    const timeoutId = setTimeout(checkInvoiceNumber, 500); // Debounce
    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [invoiceNumber, isOpen]);

  const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    billingNotesRequestRef.current += 1;
    paymentTermRefreshRef.current += 1;
    setPaymentTermRefreshing(false);
    const customerId = e.target.value;
    if (!isServiceDraft && paymentTermManual && window.confirm('Das Fälligkeitsdatum wurde manuell bearbeitet. Durch die Vorgabe des neuen Kunden ersetzen?')) setPaymentTermManual(false);
    const customer = customers.find(c => c.id.toString() === customerId);
    const hadSelectedBillingNotes = items.some(item => item.billingNoteId !== undefined);
    if (hadSelectedBillingNotes) {
      setItems(current => {
        const manualItems = current.filter(item => item.billingNoteId === undefined);
        return manualItems.length > 0
          ? manualItems
          : [{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: taxMode === 'standard' ? 19 : 0 }];
      });
      setCustomerChangeMessage('Der Kunde wurde geändert. Zugeordnete Leistungsnotizen wurden entfernt und müssen für den neuen Kunden erneut ausgewählt werden.');
    } else {
      setCustomerChangeMessage(null);
    }
    setBillingNotes([]);
    setBillingNotesError(null);

    if (!customer) {
      setSelectedCustomer(null);
      setSelectedCustomerId(null);
      setCustomerAddress('');
      setBuyerEmail('');
      setBuyerCountry('DE');
      setBuyerPostcode('');
      setBuyerCity('');
      return;
    }

    setSelectedCustomer(customer);
    setSelectedCustomerId(Number(customer.id));
    setBuyerEmail(customer.email || '');
    let addressBlock = customer.name;
    if (customer.address) addressBlock += `\n${customer.address} `;
    const cityLine = `${customer.zipCode || ''} ${customer.city || ''} `.trim();
    if (cityLine) addressBlock += `\n${cityLine} `;
    setCustomerAddress(addressBlock);
  };

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: taxMode === 'standard' ? 19 : 0 }]);
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate') {
      newItems[index] = { ...newItems[index], [field]: Number(value) };
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const duplicateItem = (index: number) => {
    const itemToDuplicate = items[index];
    const newItems = [...items];
    // A billing note belongs to exactly one imported row. Duplicating a row
    // creates a manual row so the note cannot be reserved twice.
    newItems.splice(index + 1, 0, stripBillingNoteAssociation(itemToDuplicate));
    setItems(newItems);
  };

  const toggleBillingNote = (note: ProjectServiceNote, checked: boolean) => {
    if (fromDraft) { setBillingNotesError('Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Bitte dafür eine separate neue Rechnung verwenden.'); return; }
    if (note.customerId !== selectedCustomerId) return;
    if (checked) {
      const importedItem: InvoiceItem = {
        description: note.description,
        quantity: note.quantity,
        unitPrice: 0,
        unit: note.unit,
        taxRate: taxMode === 'standard' ? 19 : 0,
        billingNoteId: note.id,
        billingNoteSource: note,
      };
      setItems(current => {
        // Repeated clicks cannot create two claims before the next render.
        if (current.some(item => item.billingNoteId === note.id)) return current;
        const onlyBlankRow = current.length === 1
          && current[0].billingNoteId === undefined
          && !current[0].description.trim()
          && current[0].unitPrice === 0;
        return onlyBlankRow ? [importedItem] : [...current, importedItem];
      });
      return;
    }

    setItems(current => {
      const remaining = current.filter(item => item.billingNoteId !== note.id);
      return remaining.length > 0
        ? remaining
        : [{ description: "", quantity: 1, unitPrice: 0, unit: "Stück", taxRate: taxMode === 'standard' ? 19 : 0 }];
    });
  };

  const formatCurrency = useCallback((amount: number) => {
    return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }, []);

  // One bounded invoice source drives the read-only server preview, visible
  // issued PDF and server-generated XML. Editor-only claims never leave here.
  const buildOwnInvoiceSource = useCallback((): OwnInvoiceSource => {
    if (!taxReady || !taxMode) throw new Error("Bitte zuerst Steuerbehandlung und unterstützten Steuerfall bestätigen.");
    return parseOwnInvoiceSource({
      version: 1,
      invoiceNumber, date, dueDate, deliveryDate, customerAddress,
      ...(selectedCustomer?.id ? { customerId: String(selectedCustomer.id) } : {}),
      buyerReference, buyerCountry, buyerPostcode, buyerCity, buyerEmail,
      sellerCountry, sellerPostcode, sellerCity, taxMode,
      items: items.map(item => ({
        description: item.description, quantity: item.quantity, unitPrice: item.unitPrice,
        unit: item.unit, taxRate: item.taxRate,
        ...(item.taxCategory ? { taxCategory: item.taxCategory } : {}),
        ...(item.exemptionReason ? { exemptionReason: item.exemptionReason } : {}),
      })),
      settings: {
        companyName: settings?.companyName ?? '', companyAddress: settings?.companyAddress ?? '',
        taxNumber: settings?.taxNumber ?? '', iban: settings?.iban ?? '', bic: settings?.bic ?? '',
        bankName: settings?.bankName ?? '', footerText: settings?.footerText ?? '',
        email: settings?.email ?? '', telephone: settings?.telephone ?? '',
      },
      notes, includeQRCode, paymentMeansCode,
    });
  }, [taxReady, taxMode, invoiceNumber, date, dueDate, deliveryDate, customerAddress, selectedCustomer,
    buyerReference, buyerCountry, buyerPostcode, buyerCity, buyerEmail, sellerCountry, sellerPostcode,
    sellerCity, items, settings, notes, includeQRCode, paymentMeansCode]);

  const generatePDFBytes = useCallback(async (forPreview = false, previewGeneration?: number, editorGeneration?: number): Promise<Uint8Array> => {
    const source = buildOwnInvoiceSource();
    const previous = renderRequestRef.current;
    let release!: () => void;
    const active = new Promise<void>(resolve => { release = resolve; });
    renderRequestRef.current = active;
    try {
      // A final click waits for this tab's in-flight preview rather than
      // colliding with the server's per-user processing limit. Superseded
      // previews never start another native render once their turn arrives.
      if (previous) await previous;
      if (forPreview && previewGeneration !== previewGenerationRef.current) throw new Error('Vorschau wurde ersetzt.');
      if (!forPreview && editorGeneration !== undefined
        && (!editorActiveRef.current || editorGeneration !== editorGenerationRef.current)) throw new Error('Erstellung wurde verworfen.');
      const response = await fetch('/api/invoices/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, preview: forPreview }),
      });
      if (!response.ok) {
        const message = await response.json().then((data: { error?: string }) => data.error).catch(() => null);
        throw new Error(message ?? 'Die Rechnung konnte nicht sicher erstellt werden.');
      }
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      release();
      if (renderRequestRef.current === active) renderRequestRef.current = null;
    }
  }, [buildOwnInvoiceSource]);

  // Generate preview with debouncing
  const generatePreview = useCallback(async () => {
    if (!showPreview || !taxReady || issuingRef.current) return;

    const generationId = previewGenerationRef.current + 1;
    previewGenerationRef.current = generationId;
    setIsGeneratingPreview(true);
    setPreviewError(null);
    try {
      const pdfBytes = await generatePDFBytes(true, generationId);
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);

      if (previewGenerationRef.current !== generationId) {
        URL.revokeObjectURL(nextUrl);
        return;
      }

      const previousUrl = previewUrlRef.current;
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);

      if (previousUrl) {
        window.setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
      }
    } catch (error) {
      if (previewGenerationRef.current === generationId) {
        setPreviewError(error instanceof Error ? error.message : 'Die Vorschau konnte nicht erstellt werden.');
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
      }
    } finally {
      if (previewGenerationRef.current === generationId) {
        setIsGeneratingPreview(false);
      }
    }
  }, [showPreview, generatePDFBytes, taxReady]);

  // Debounced preview update
  useEffect(() => {
    if (!showPreview) return;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    previewTimeoutRef.current = setTimeout(() => {
      generatePreview();
    }, 500); // 500ms debounce

    return () => {
      previewGenerationRef.current += 1;
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [showPreview, generatePreview]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      editorActiveRef.current = false;
      editorGenerationRef.current += 1;
      issuingRef.current = false;
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (showPreview && taxReady) return;

    previewGenerationRef.current += 1;
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setIsGeneratingPreview(false);
  }, [showPreview, taxReady]);

  const refreshNumbering = async () => {
    if (issuingRef.current || numberRefreshing) return;
    const generation = editorGenerationRef.current;
    const numberRequest = ++numberRequestRef.current;
    setNumberRefreshing(true);
    try {
      const response = await fetch(`/api/invoices/next-number?year=${encodeURIComponent(date.slice(0, 4))}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.numberingSelection) throw new Error(result.error || 'Nummer konnte nicht geladen werden.');
      if (generation !== editorGenerationRef.current || numberRequest !== numberRequestRef.current || issuingRef.current) return;
      setInvoiceNumber(result.nextInvoiceNumber); setNumberingSelection(result.numberingSelection); setInvoiceNumberError(null);
    } catch (error) { if (generation === editorGenerationRef.current && numberRequest === numberRequestRef.current) setInvoiceNumberError(error instanceof Error ? error.message : 'Nummer konnte nicht geladen werden.'); }
    finally { if (generation === editorGenerationRef.current && numberRequest === numberRequestRef.current) setNumberRefreshing(false); }
  };

  const buildZugferdData = () => ownInvoiceToZugferdData(buildOwnInvoiceSource());

  const buildInvoiceFileName = (extension: 'pdf' | 'xml') => {
    const safeNumber = invoiceNumber.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
    return `Rechnung_${safeNumber}.${extension}`;
  };

  const uploadGeneratedInvoice = async (file: File): Promise<{ invoiceId: number | null; replayed: boolean } | null> => {
    const formData = new FormData();
    formData.append('file', file);
    if (numberingSelection) formData.append('numberingSelection', JSON.stringify({ ...numberingSelection, automatic: invoiceNumber === numberingSelection.number }));
    formData.append('selectedCustomerId', selectedCustomerId ? String(selectedCustomerId) : '');
    const billingNoteIds = Array.from(new Set(
      items
        .map(item => item.billingNoteId)
        .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0),
    ));
    formData.append('billingNoteIds', JSON.stringify(billingNoteIds));
    if (generatedRequestId) formData.append('generatedRequestId', generatedRequestId);
    if (!isServiceDraft) {
      const selection: PaymentTermSelection = paymentTermManual
        ? { version: 1, source: 'MANUAL', days: null, invoiceDate: date, dueDate: dueDate || null, customerId: selectedCustomerId }
        : paymentTermSuggestion(date, selectedCustomerId, selectedCustomer?.paymentTermDays, settings?.paymentTermDays);
      formData.append('paymentTermSelection', JSON.stringify(selection));
    }
    if (fromQuote) formData.append('fromQuoteId', String(fromQuote.id));
    if (fromDraft) { formData.append('serviceDraftId', String(fromDraft.id)); formData.append('serviceDraftToken', draftToken); }

    let uploadRes: Response;
    try {
      uploadRes = await fetch('/api/invoices/upload', {
        method: 'POST',
        body: formData
      });
    } catch (e) {
      console.error("Auto-upload network error:", e);
      alert("Fehler beim automatischen Speichern der Rechnung.");
      return null;
    }

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => null);
      console.error("Auto-upload failed:", err);
      alert("Speichern fehlgeschlagen: " + (err?.error || "Unbekannter Fehler"));
      return null;
    }

    const savedInvoice = await uploadRes.json().catch(() => null) as { id?: unknown; idempotent?: unknown } | null;

    if (onInvoiceCreated) {
      onInvoiceCreated();
    }

    return {
      invoiceId: typeof savedInvoice?.id === 'number' && Number.isSafeInteger(savedInvoice.id) ? savedInvoice.id : null,
      replayed: savedInvoice?.idempotent === true,
    };
  };

  const downloadGeneratedFile = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadStoredInvoice = async (invoiceId: number, fileName: string) => {
    const response = await fetch(`/api/invoices/download?id=${invoiceId}&download=true`);
    if (!response.ok) {
      throw new Error('Die gespeicherte Rechnung konnte nicht heruntergeladen werden.');
    }
    downloadGeneratedFile(await response.blob(), fileName);
  };


  const saveServiceDraft = async () => {
    if (!fromDraft || !taxMode) return;
    if (items.some(item => item.billingNoteId !== undefined)) { setDraftSaveMessage('Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Bitte dafür eine separate neue Rechnung verwenden.'); return; }
    setIsSavingDraft(true); setDraftSaveMessage("");
    try {
      const response = await fetch(`/api/service-billing/drafts/${fromDraft.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftToken, customerId: selectedCustomerId, customerAddress, notes, taxMode, items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Entwurf konnte nicht gespeichert werden.');
      setDraftToken(data.draftToken); setDraftSaveMessage('Entwurf gespeichert. Keine Rechnungsdatei erstellt oder versendet.');
    } catch (error) { setDraftSaveMessage(error instanceof Error ? error.message : 'Entwurf konnte nicht gespeichert werden.'); }
    finally { setIsSavingDraft(false); }
  };

  const createInvoiceFile = async () => {
    if (fromDraft && items.some(item => item.billingNoteId !== undefined)) { setDraftSaveMessage('Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Bitte dafür eine separate neue Rechnung verwenden.'); return; }
    if (!taxReady || issuingRef.current || numberRefreshing) return;
    issuingRef.current = true;
    // A term refresh started before this click must not replace the frozen
    // due date/company/customer while the same source is rendered and saved.
    paymentTermRefreshRef.current += 1;
    setPaymentTermRefreshing(false);
    const editorGeneration = editorGenerationRef.current;
    const isCurrentAttempt = () => editorActiveRef.current && editorGenerationRef.current === editorGeneration;
    previewGenerationRef.current += 1;
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    setIsGeneratingPreview(false);
    setIsGenerating(true);
    try {
      const zugferdData = buildZugferdData();
      const xmlProfile = outputMode === 'xml-only' ? 'xrechnung' : 'factur-x';
      const validation = validateZugferdData(zugferdData, { profile: xmlProfile });
      if (!validation.isValid) {
        alert([
          'Die E-Rechnung kann noch nicht erstellt werden. Bitte ergänzen Sie:',
          '',
          ...validation.errors.map(issue => `- ${issue.message}`),
        ].join('\n'));
        return;
      }
      if (validation.warnings.length > 0) {
        console.warn('E-Rechnungshinweise:', validation.warnings);
      }

      const xmlContent = generateZugferdXml(zugferdData, { profile: xmlProfile });

      if (outputMode === 'xml-only') {
        const fileName = buildInvoiceFileName('xml');
        const blob = new Blob([xmlContent], { type: 'application/xml' });
        const file = new File([blob], fileName, { type: 'application/xml' });
        if (!isCurrentAttempt()) return;
        const uploadResult = await uploadGeneratedInvoice(file);

        if (uploadResult && isCurrentAttempt()) {
          if (uploadResult.replayed) {
            if (!uploadResult.invoiceId) throw new Error('Die gespeicherte Rechnung konnte nicht zugeordnet werden.');
            await downloadStoredInvoice(uploadResult.invoiceId, fileName);
          } else {
            downloadGeneratedFile(blob, fileName);
          }
          onClose();
        }
        return;
      }

      // The controlled server renderer attaches XML from this same source and
      // validates its exact final PDF/A-3b bytes before returning anything.
      const finalPdfBytes = await generatePDFBytes(false, undefined, editorGeneration);
      if (!isCurrentAttempt()) return;
      const blob = new Blob([finalPdfBytes as BlobPart], { type: 'application/pdf' });
      const fileName = buildInvoiceFileName('pdf');
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const uploadResult = await uploadGeneratedInvoice(file);

      if (uploadResult && isCurrentAttempt()) {
        if (uploadResult.replayed) {
          if (!uploadResult.invoiceId) throw new Error('Die gespeicherte Rechnung konnte nicht zugeordnet werden.');
          await downloadStoredInvoice(uploadResult.invoiceId, fileName);
        } else {
          downloadGeneratedFile(blob, fileName);
        }
        onClose();
      }
    } catch (error) {
      if (!isCurrentAttempt()) return;
      console.error("Error generating invoice file:", error);
      const message = error instanceof Error ? error.message : null;
      alert(message ?? (outputMode === 'xml-only' ? "Fehler beim Erstellen der XML-Datei." : "Fehler beim Erstellen der PDF."));
    } finally {
      if (editorGenerationRef.current === editorGeneration) {
        issuingRef.current = false;
        setIsGenerating(false);
      }
    }
  };

  let displayedNetAmount = '–';
  let displayedTaxAmount = '–';
  let displayedGrossAmount = '–';
  let displayedLines: string[] = [];
  try {
    const amounts = calculateInvoiceAmounts(items);
    displayedNetAmount = formatCurrency(amounts.netAmount);
    displayedTaxAmount = formatCurrency(amounts.taxAmount);
    displayedGrossAmount = formatCurrency(amounts.grossAmount);
    displayedLines = amounts.lines.map(line => formatCurrency(line.netAmount));
  } catch {
    // Export validation explains incomplete numerical input.
  }
  const isPage = presentation === "page";
  const requestClose = () => {
    if (issuingRef.current || isSavingDraft) return;
    onClose();
  };
  // Native disabled controls and inert cover the actual DOM subtree. Capture
  // guards also cover custom controls/React portals and the synchronous window
  // before the isGenerating state update commits, without changing the snapshot.
  const blockBusyEditorInteraction = (event: SyntheticEvent) => {
    if (!issuingRef.current && !isSavingDraft) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const editorContent = (
    <>
        <DialogHeader className="invoice-editor-header pb-2 text-left">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              {isPage && <Button type="button" variant="ghost" size="icon" onClick={requestClose} disabled={isSavingDraft || isGenerating} aria-label="Zu den Rechnungen" className="shrink-0 text-muted-foreground"><ArrowLeft className="size-4" aria-hidden="true" /></Button>}
              {isPage ? (
                <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight sm:text-3xl">
                  Neue Rechnung
                </h1>
              ) : (
                <DialogTitle>Rechnung erstellen</DialogTitle>
              )}
              {!isPage && <DialogDescription className="sr-only">ZUGFeRD-PDF oder XRechnung-XML erstellen.</DialogDescription>}
            </div>
            <Button
              type="button"
              variant={showPreview ? "default" : "outline"}
              size="sm"
              onClick={() => { if (!issuingRef.current && !isSavingDraft) setShowPreview(!showPreview); }}
              disabled={isGenerating || isSavingDraft}
              className="w-fit gap-2 whitespace-nowrap"
              aria-pressed={showPreview}
            >
              {showPreview ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Vorschau ausblenden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Live-Vorschau
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
          {isGenerating ? 'Rechnung wird erstellt. Angaben bleiben bis zum Abschluss gesperrt.'
            : isSavingDraft ? 'Entwurf wird gespeichert. Angaben bleiben bis zum Abschluss gesperrt.' : ''}
        </p>

        {fromDraft && <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-medium">Serviceentwurf · {fromDraft.parsedData.periodStart} bis {fromDraft.parsedData.periodEnd}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Zum Entwurf</summary><p className="pt-2">„Entwurf speichern“ erzeugt weder Datei noch Nummer. Die Dateierstellung aktualisiert denselben Datensatz; kein Versand und keine Einnahme.</p></details></div>}
        <fieldset
          aria-label="Rechnungsangaben"
          aria-busy={isGenerating || isSavingDraft}
          disabled={isGenerating || isSavingDraft}
          inert={isGenerating || isSavingDraft}
          onPointerDownCapture={blockBusyEditorInteraction}
          onKeyDownCapture={blockBusyEditorInteraction}
          onClickCapture={blockBusyEditorInteraction}
          onChangeCapture={blockBusyEditorInteraction}
          onInputCapture={blockBusyEditorInteraction}
          onBeforeInputCapture={blockBusyEditorInteraction}
          className="m-0 min-w-0 border-0 p-0"
        >
        <div className="invoice-editor-grid">
          <div className="invoice-editor-main">
            <DocumentTaxProfileFields id="invoice" settings={settings} issueDate={date} selection={taxSelection} acknowledged={taxAcknowledged} onAcknowledged={setTaxAcknowledged} onModeChange={handleTaxModeChange} taxCase={taxCase} onTaxCaseChange={setTaxCase} foreignAddress={foreignAddress} domesticConfirmed={domesticConfirmed} onDomesticConfirmed={setDomesticConfirmed} />
            {unsupportedTaxCategory && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">Das übernommene Dokument enthält eine nicht unterstützte Steuerkategorie, etwa Reverse Charge. Eine Erstellung als einfacher Inlandsfall ist gesperrt. Bitte fachlich klären; die ursprünglichen Angaben bleiben erhalten.</p>}
            <details className="invoice-template-drawer"><summary>Rechnungsvorlagen</summary>            {/* Template Section */}
            <section className={isPage ? "invoice-template space-y-3" : "mb-2 rounded-md border bg-muted/30 p-3"} aria-labelledby="invoice-template-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label id="invoice-template-title" className="text-sm font-medium">Vorlage laden oder speichern</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit text-xs whitespace-nowrap"
                  onClick={() => setIsSaveTemplateOpen(!isSaveTemplateOpen)}
                  aria-expanded={isSaveTemplateOpen}
                >
                  {isSaveTemplateOpen ? "Eingabe schließen" : "Als Vorlage speichern"}
                </Button>
              </div>

              {isSaveTemplateOpen ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    aria-label="Name der neuen Rechnungsvorlage"
                    placeholder="Name der Vorlage"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className="text-sm"
                  />
                  <Button type="button" size="sm" onClick={handleSaveTemplate} disabled={!taxReady}>Vorlage speichern</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Rechnungsvorlage auswählen"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedTemplateId}
                    onChange={(e) => handleLoadTemplate(e.target.value)}
                  >
                    <option value="">Vorlage wählen</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {selectedTemplateId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteTemplate(selectedTemplateId)}
                      title="Vorlage löschen"
                      aria-label="Ausgewählte Vorlage löschen"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </section>

            </details>
            <section className="invoice-section" aria-labelledby="invoice-recipient-title"><header className="invoice-section-heading"><div><p>Rechnung an</p><h2 id="invoice-recipient-title">Empfänger</h2></div></header>
            <div className="invoice-recipient-fields grid grid-cols-1 gap-6">
              {/* Left: Customer */}
              <div className="space-y-2">
                <Label htmlFor="customer">Empfänger (Name & Anschrift)</Label>

                {/* Customer Selection Dropdown */}
                <select
                  aria-label="Gespeicherten Kunden auswählen"
                  className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={handleCustomerSelect}
                  value={selectedCustomerId?.toString() || ""}
                >
                  <option value="">Kunden auswählen …</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                {selectedCustomer?.internalNote && selectedCustomer.noteVisibility !== 'SEND' && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/20" role="note">
                    <p className="font-medium text-amber-950 dark:text-amber-100">Interner Kundenhinweis</p>
                    <p className="mt-1 whitespace-pre-wrap text-amber-900/80 dark:text-amber-200/80">{selectedCustomer.internalNote}</p>
                  </div>
                )}

                <Textarea
                  id="customer"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Musterfirma GmbH&#10;Musterstraße 1&#10;12345 Musterstadt"
                  className="min-h-[100px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-buyer-email">E-Mail des Empfängers{outputMode === 'xml-only' ? ' (Pflichtfeld)' : ''}</Label>
                <Input id="invoice-buyer-email" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="rechnung@kunde.de" />
                <Label htmlFor="invoice-buyer-country">Land des Empfängers (ISO-Code)</Label>
                <Input id="invoice-buyer-country" value={buyerCountry} maxLength={2} onChange={e => { setBuyerCountry(e.target.value.toUpperCase()); setDomesticConfirmed(false); }} placeholder="DE" />
                {buyerCountry !== 'DE' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="invoice-buyer-postcode">PLZ des Empfängers</Label><Input id="invoice-buyer-postcode" value={buyerPostcode} onChange={e => setBuyerPostcode(e.target.value)} /></div>
                    <div><Label htmlFor="invoice-buyer-city">Ort des Empfängers</Label><Input id="invoice-buyer-city" value={buyerCity} onChange={e => setBuyerCity(e.target.value)} /></div>
                  </div>
                )}
              </div>

            </div>
            </section>
            <section className="invoice-section" aria-labelledby="invoice-dates-title"><header className="invoice-section-heading"><div><p>Belegdaten</p><h2 id="invoice-dates-title">Nummer und Termine</h2></div></header>
            {/* Top Row: Invoice Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invoice-number">Rechnungsnummer</Label>
                <Input
                  id="invoice-number"
                  value={invoiceNumber}
                  onChange={(e) => {
                    numberRequestRef.current += 1;
                    // Invalidate before the next passive-effect cleanup.
                    invoiceNumberCheckRequestRef.current += 1;
                    setNumberRefreshing(false);
                    setInvoiceNumberError(null);
                    setIsCheckingNumber(Boolean(e.target.value));
                    setInvoiceNumber(e.target.value);
                  }}
                  placeholder="RE-2024-001"
                  aria-invalid={Boolean(invoiceNumberError)}
                  aria-describedby={invoiceNumberError ? "invoice-number-error" : undefined}
                  className={invoiceNumberError ? "border-destructive outline-destructive" : ""}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => void refreshNumbering()} disabled={numberRefreshing || isGenerating}>{numberRefreshing ? "Lädt…" : "Nummer aktualisieren"}</Button>
                {invoiceNumberError && (
                  <p id="invoice-number-error" className="min-h-[1lh] text-xs font-medium text-destructive">{invoiceNumberError}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Rechnungsdatum</Label>
                <Input id="date" type="date" value={date} onChange={(e) => { paymentTermRefreshRef.current += 1; setPaymentTermRefreshing(false); numberRequestRef.current += 1; setNumberRefreshing(false); setDate(e.target.value); }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery-date">Leistungsdatum</Label>
                <Input id="delivery-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>

            </section>
            {customerChangeMessage && (
              <p className="text-sm text-amber-700 dark:text-amber-300" role="status">{customerChangeMessage}</p>
            )}

            {/* Unreserved service notes */}
            {fromDraft && <p className="text-xs text-muted-foreground" role="note">Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Dafür eine neue Rechnung erstellen.</p>}
            {selectedCustomerId && !fromDraft && (
              <ProjectServiceSelection
                key={selectedCustomerId}
                customerName={selectedCustomer?.name || `Kunde #${selectedCustomerId}`}
                notes={billingNotes}
                selected={items.flatMap(item => item.billingNoteId === undefined ? [] : [{
                  id: item.billingNoteId,
                  source: item.billingNoteSource ?? null,
                  description: item.description,
                  quantity: item.quantity,
                  unit: item.unit,
                  unitPrice: item.unitPrice,
                  taxRate: item.taxRate,
                  taxCategory: item.taxCategory,
                }])}
                loading={isBillingNotesLoading}
                error={billingNotesError}
                taxMode={taxMode}
                taxReady={taxReady}
                onToggle={toggleBillingNote}
                onRetry={() => setBillingNotesReload(value => value + 1)}
              />
            )}

            {/* Items Table */}
            <section className="invoice-section invoice-positions" aria-labelledby="invoice-positions-title">
              <header className="invoice-section-heading"><div><p>Leistungen</p><h2 id="invoice-positions-title">Positionen</h2></div><span>{items.length} {items.length === 1 ? "Position" : "Positionen"}</span></header>
              <ServiceArticlePicker onSelect={article => setItems(current => {
                const next = { description: article.description, quantity: 1, unitPrice: article.unitPrice, unit: article.unit, taxRate: taxMode === 'standard' ? 19 : 0 };
                return current.length === 1 && !current[0].description.trim() && current[0].unitPrice === 0 ? [next] : [...current, next];
              })} />
              <div className="invoice-line-list">
                <div className="divide-y">
                  {items.map((item, index) => (
                    <div key={index} className="invoice-line grid min-w-0 grid-cols-2 items-start gap-3 sm:grid-cols-4">
                      <div className="col-span-2 min-w-0 sm:col-span-4">
                        <Label htmlFor={`invoice-item-description-${index}`} className="mb-1 block text-xs text-muted-foreground">Beschreibung</Label>
                        <Textarea
                          id={`invoice-item-description-${index}`}
                          className="min-h-20 resize-y"
                          value={item.description}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          placeholder="Leistung / Produkt"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-quantity-${index}`} className="mb-1 block text-xs text-muted-foreground">Menge</Label>
                        <Input
                          id={`invoice-item-quantity-${index}`}
                          type="number"
                          step="any"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          placeholder="1"
                          className="text-right tabular-nums"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-unit-${index}`} className="mb-1 block text-xs text-muted-foreground">Einheit</Label>
                        <select
                          id={`invoice-item-unit-${index}`}
                          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring"
                          value={item.unit}
                          onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        >
                          {!['Stück', 'Stunde', 'Tag', 'Pauschal'].includes(item.unit) && <option value={item.unit}>{item.unit}</option>}
                          <option value="Stück">Stück</option>
                          <option value="Stunde">Stunde</option>
                          <option value="Tag">Tag</option>
                          <option value="Pauschal">Pauschal</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor={`invoice-item-price-${index}`} className="mb-1 block text-xs text-muted-foreground">Einzelpreis</Label>
                        <Input
                          id={`invoice-item-price-${index}`}
                          type="number"
                          step="any"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                          placeholder="0,00"
                          className="text-right tabular-nums"
                        />
                      </div>
                      <div className="relative">
                        <Label htmlFor={`invoice-item-tax-${index}`} className="mb-1 block text-xs text-muted-foreground">Steuer</Label>
                        <Input
                          id={`invoice-item-tax-${index}`}
                          type="number"
                          step="any"
                          disabled={!taxMode || taxMode === 'small-business' || item.taxCategory === 'E' || item.taxCategory === 'Z'}
                          value={item.taxRate}
                          onChange={(e) => updateItem(index, 'taxRate', e.target.value)}
                          placeholder="0"
                          className="pr-7 text-right tabular-nums"
                        />
                        <span className="pointer-events-none absolute right-2 bottom-3 text-sm text-muted-foreground">%</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-4">
                        <span className="mr-auto text-xs text-muted-foreground">Position {index + 1} · Netto <strong className="text-foreground tabular-nums">{displayedLines[index] ?? "–"}</strong></span>
                        <Button type="button" variant="ghost" size="icon" onClick={() => duplicateItem(index)} title="Zeile duplizieren" aria-label={`Position ${index + 1} duplizieren`} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label={`Position ${index + 1} entfernen`} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      {taxMode === 'standard' && (
                        <div className="col-span-2 grid gap-2 sm:col-span-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor={`invoice-item-tax-category-${index}`}>Steuerart für Position {index + 1}</Label>
                            <select
                              id={`invoice-item-tax-category-${index}`}
                              className="mt-1 flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={item.taxCategory || 'S'}
                              onChange={e => {
                                const category = e.target.value as InvoiceItem['taxCategory'];
                                setItems(current => current.map((entry, itemIndex) => itemIndex === index
                                  ? { ...entry, taxCategory: category, taxRate: category === 'S' ? entry.taxRate : 0 }
                                  : entry));
                              }}
                            >
                              <option value="S">Umsatzsteuerpflichtig</option>
                              <option value="Z">Nullsteuersatz (0 %)</option>
                              <option value="E">Steuerbefreit (mit Begründung)</option>
                            </select>
                          </div>
                          {item.taxCategory === 'E' && (
                            <div>
                              <Label htmlFor={`invoice-item-exemption-${index}`}>Grund der Steuerbefreiung</Label>
                              <Input id={`invoice-item-exemption-${index}`} className="mt-1" value={item.exemptionReason || ''} onChange={e => updateItem(index, 'exemptionReason', e.target.value)} />
                            </div>
                          )}
                        </div>
                      )}
                      {selectedCustomerId && (
                        <div className="col-span-2 min-w-0 sm:col-span-4">
                          <PriceHistory
                            customerId={selectedCustomerId}
                            description={item.description}
                            unit={item.unit}
                            taxRate={item.taxRate}
                            taxCategory={taxMode === 'small-business' ? 'E' : item.taxCategory}
                            exemptionReason={taxMode === 'small-business' ? SMALL_BUSINESS_EXEMPTION_REASON : item.exemptionReason}
                            currentPrice={item.unitPrice}
                            onApply={price => updateItem(index, 'unitPrice', price)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Position hinzufügen
                </Button>
                <div className="text-left font-bold tabular-nums sm:text-right">
                  Netto: {displayedNetAmount}
                </div>
              </div>
            </section>

            <section className="invoice-section" aria-labelledby="invoice-payment-title"><header className="invoice-section-heading"><div><p>Abschluss</p><h2 id="invoice-payment-title">Zahlung und Hinweise</h2></div></header>
            <div className="grid grid-cols-1 gap-6">
              {/* Right: Payment Terms */}
              <div className="space-y-2">
                <Label htmlFor="due-date">Fälligkeitsdatum</Label>
                <Input id="due-date" type="date" value={dueDate} onChange={(e) => { paymentTermRefreshRef.current += 1; setPaymentTermRefreshing(false); setPaymentTermManual(true); setPaymentTermMessage(''); setDueDate(e.target.value); }} aria-describedby={!isServiceDraft ? 'payment-term-source' : undefined} />
                {!isServiceDraft && <div className="space-y-2">
                  <p id="payment-term-source" className="text-xs text-muted-foreground" aria-live="polite">{paymentTermManual ? 'Manuell festgelegt · bleibt bei Änderungen erhalten' : `${suggestedPaymentTerm?.source === 'CUSTOMER' ? 'Kundenvorgabe' : suggestedPaymentTerm?.source === 'COMPANY' ? 'Firmenvorgabe' : 'Standard'}: ${suggestedPaymentTerm?.days ?? 14} Kalendertage`}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={paymentTermRefreshing || !isPaymentBusinessDate(date)} onClick={() => void reapplyPaymentTerm()}>{paymentTermRefreshing ? 'Vorgabe wird geladen …' : 'Vorgabe erneut anwenden'}</Button>
                    {!paymentTermManual && <Button type="button" variant="ghost" size="sm" onClick={() => { paymentTermRefreshRef.current += 1; setPaymentTermRefreshing(false); setPaymentTermManual(true); }}>Fälligkeit beibehalten</Button>}
                  </div>
                  {!suggestedPaymentTerm && !paymentTermManual && <p role="alert" className="text-sm text-destructive">Bitte ein unterstütztes Rechnungsdatum wählen.</p>}
                  {paymentTermMessage && <p role="alert" className="text-sm text-destructive">{paymentTermMessage}</p>}
                </div>}
                <Label htmlFor="invoice-payment-means">Zahlungsart</Label>
                <select
                  id="invoice-payment-means"
                  className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={paymentMeansCode}
                  onChange={e => {
                    const code = e.target.value as typeof paymentMeansCode;
                    setPaymentMeansCode(code);
                    if (code === '10') setIncludeQRCode(false);
                  }}
                >
                  <option value="30">Überweisung (IBAN in den Einstellungen erforderlich)</option>
                  <option value="10">Barzahlung</option>
                </select>
                <Label htmlFor="notes" className="mt-2 block">Anmerkungen (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Vielen Dank für Ihren Auftrag!"
                  className="min-h-[60px]"
                />

                <Label htmlFor="includeQRCode" className="mt-4 flex min-h-11 cursor-pointer items-center gap-1 text-sm font-medium leading-tight has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70">
                  <span className="grid size-11 shrink-0 place-items-center">
                    <input
                      type="checkbox"
                      id="includeQRCode"
                      checked={includeQRCode}
                      onChange={(e) => setIncludeQRCode(e.target.checked)}
                      disabled={outputMode === 'xml-only' || paymentMeansCode === '10'}
                      className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
                    />
                  </span>
                  <span>
                    GiroCode (QR-Code) für Banking-Apps hinzufügen{outputMode === 'xml-only' ? ' (nur PDF)' : ''}
                  </span>
                </Label>
              </div>
            </div>

            </section>
            <section className="invoice-section" aria-labelledby="invoice-format-details"><header className="invoice-section-heading"><div><p>Elektronische Rechnung</p><h2 id="invoice-format-details">Steuer und Referenzen</h2></div></header>            <div className="invoice-export-fields grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoice-buyer-reference">Käuferreferenz / Leitweg-ID{outputMode === 'xml-only' ? ' (Pflichtfeld)' : ''}</Label>
                <Input id="invoice-buyer-reference" value={buyerReference} onChange={e => setBuyerReference(e.target.value)} placeholder="Vom Rechnungsempfänger vorgegebene Referenz" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-seller-country">Land des Rechnungsausstellers (ISO-Code)</Label>
                <Input id="invoice-seller-country" value={sellerCountry} maxLength={2} onChange={e => { setSellerCountry(e.target.value.toUpperCase()); setDomesticConfirmed(false); }} placeholder="DE" />
                {sellerCountry !== 'DE' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="invoice-seller-postcode">PLZ des Ausstellers</Label><Input id="invoice-seller-postcode" value={sellerPostcode} onChange={e => setSellerPostcode(e.target.value)} /></div>
                    <div><Label htmlFor="invoice-seller-city">Ort des Ausstellers</Label><Input id="invoice-seller-city" value={sellerCity} onChange={e => setSellerCity(e.target.value)} /></div>
                  </div>
                )}
              </div>
            </div>

            </section>
          </div>
          <aside className="invoice-summary-rail" aria-label="Rechnungsübersicht">
            <section className="invoice-create-summary" aria-labelledby="invoice-total-title">
              <div className="invoice-total-hero"><p>Rechnungsübersicht · EUR</p><h2 id="invoice-total-title">Gesamtbetrag</h2><div aria-live="polite">{displayedGrossAmount}</div><span>{items.length} {items.length === 1 ? 'Position' : 'Positionen'} · {taxMode === 'small-business' ? 'Kleinunternehmer' : taxMode === 'standard' ? 'Umsatzsteuer je Position' : 'Steuerbehandlung noch offen'}</span></div>
              <div className="invoice-summary-body"><dl><div><dt>Nettobetrag</dt><dd>{displayedNetAmount}</dd></div><div><dt>Umsatzsteuer</dt><dd>{displayedTaxAmount}</dd></div></dl>
                {taxMode === 'small-business' && <p className="text-xs text-muted-foreground">Keine Umsatzsteuer gemäß § 19 UStG.</p>}
            <section className={isPage ? "invoice-output space-y-2" : "rounded-md border border-primary/20 bg-primary/5 p-3"} aria-labelledby="invoice-output-title">
              <Label id="invoice-output-title" htmlFor="invoice-output-mode" className="text-sm font-medium">Ausgabeformat</Label>
              <select
                id="invoice-output-mode"
                className="mt-2 flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={outputMode}
                onChange={(e) => setOutputMode(e.target.value as InvoiceOutputMode)}
              >
                <option value="zugferd-pdf">ZUGFeRD-PDF + XML</option>
                <option value="xml-only">XRechnung-XML</option>
              </select>
            </section>

        {!taxReady && <p id="invoice-tax-blocker" className="text-xs"><a href="#invoice-tax-heading" className="underline underline-offset-4">Steuerbehandlung bestätigen</a>.</p>}
        <DialogFooter className={isPage ? "invoice-create-actions" : undefined}>
          <Button type="button" variant="outline" onClick={requestClose} disabled={isSavingDraft || isGenerating}>Abbrechen</Button>
          {fromDraft && <Button type="button" variant="outline" onClick={saveServiceDraft} disabled={isSavingDraft || isGenerating || !taxMode}>{isSavingDraft ? 'Speichere Entwurf …' : 'Entwurf speichern'}</Button>}
          <Button type="button" onClick={createInvoiceFile} aria-describedby={!taxReady ? "invoice-tax-blocker" : undefined} disabled={!taxReady || isSavingDraft || isGenerating || !customerAddress || !invoiceNumber || !!invoiceNumberError || isCheckingNumber}>
            {isGenerating
              ? (outputMode === 'xml-only' ? "Erstelle XML …" : "Erstelle PDF …")
              : (outputMode === 'xml-only' ? "XML erstellen" : "PDF erstellen")}
          </Button>
        </DialogFooter>
        {draftSaveMessage && <p role="status" className="text-sm">{draftSaveMessage}</p>}
              </div>
            </section>
          {/* Preview Section */}
          {showPreview && (
            <aside className={isPage ? "invoice-preview flex min-h-[28rem] min-w-0 flex-col" : "flex min-h-[28rem] min-w-0 flex-col border-t border-border pt-4 lg:h-[calc(90vh-180px)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"} aria-label="Rechnungsvorschau">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">PDF-Vorschau</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={generatePreview}
                  disabled={isGeneratingPreview || !taxReady}
                  className="gap-1 whitespace-nowrap text-xs"
                >
                  {isGeneratingPreview ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Aktualisieren
                </Button>
              </div>

              <div className="flex-1 rounded-lg border bg-muted/30 overflow-hidden relative">
                {isGeneratingPreview && !previewUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Vorschau wird generiert …</span>
                    </div>
                  </div>
                )}

                {previewUrl ? (
                  <iframe
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Rechnungsvorschau"
                  />
                ) : !isGeneratingPreview && (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm" role={previewError ? 'alert' : undefined}>{previewError ?? (taxReady ? "Füllen Sie das Formular aus, um die Vorschau zu sehen." : "Bitte zuerst Steuerbehandlung und Steuerfall bestätigen.")}</p>
                    </div>
                  </div>
                )}

                {isGeneratingPreview && previewUrl && (
                  <div className="absolute top-2 right-2 bg-background/90 rounded-md px-2 py-1 text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Aktualisiere …
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Die Vorschau aktualisiert sich automatisch bei Änderungen. {outputMode === 'xml-only' ? 'Bei XML-only dient sie nur als Layoutkontrolle; gespeichert wird ausschließlich die XML-Datei.' : 'Vorschau und finale PDF verwenden dasselbe Layout einschließlich GiroCode. Die abschließende PDF/A-3b-Prüfung erfolgt beim Erstellen.'}
              </p>
            </aside>
          )}
          </aside>
        </div>
        </fieldset>
    </>
  );

  if (isPage) {
    return (
      <section className={`invoice-studio min-w-0 ${salesStyles.invoiceEditor}`} aria-label="Neue Rechnung">
        {editorContent}
      </section>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent showCloseButton={!isGenerating && !isSavingDraft} className={`max-h-[90vh] overflow-y-auto ${showPreview ? 'sm:max-w-[1400px]' : 'sm:max-w-[800px]'}`}>
        {editorContent}
      </DialogContent>
    </Dialog>
  );
}
