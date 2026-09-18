type JsonRecord = Record<string, unknown>;

export type EInvoiceViewerSource = {
  fileName: string;
  invoiceNumber: string | null;
  invoiceDate: Date | string | null;
  dueDate: Date | string | null;
  totalAmount: number | null;
  currency?: string | null;
  parsedData: unknown;
};

type ViewerParty = {
  name: string | null;
  email: string | null;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  addressLines: string[];
};

type ViewerLineItem = {
  positionNumber: string | null;
  description: string;
  details: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  baseQuantity: number | null;
  baseUnit: string | null;
  amount: number | null;
  taxRate: number | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecord(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  return toArray(value).map(asString).filter((item): item is string => Boolean(item));
}

function toArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function parseParty(value: unknown, fallbackName: string | null = null): ViewerParty {
  const record = normalizeRecord(value);
  const name = asString(record.name) || fallbackName;

  return {
    name,
    email: asString(record.email),
    address: asString(record.address),
    zipCode: asString(record.zipCode),
    city: asString(record.city),
    country: asString(record.country),
    addressLines: asStringArray(record.addressLines),
  };
}

function parseLegacyCustomerAddress(addressBlock: string | null): Partial<ViewerParty> {
  if (!addressBlock) return {};
  const lines = addressBlock.split('\n').map(line => line.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';
  const cityMatch = lastLine.match(/^(\d{5})\s+(.+)$/);

  return {
    name: lines[0] || null,
    address: lines.length > 2 ? lines.slice(1, -1).join(', ') : lines[1] || null,
    addressLines: lines.length > 2 ? lines.slice(1, -1) : lines[1] ? [lines[1]] : [],
    zipCode: cityMatch?.[1] || null,
    city: cityMatch?.[2] || null,
  };
}

function parseLineItem(value: unknown, index: number): ViewerLineItem {
  const record = normalizeRecord(value);
  const quantity = firstNumber(record, ['quantity', 'qty', 'date']);
  const unitPrice = firstNumber(record, ['unitPrice', 'price']);
  const amount = firstNumber(record, ['amount', 'total'])
    ?? (quantity !== null && unitPrice !== null ? quantity * unitPrice : null);

  return {
    positionNumber: firstString(record, ['positionNumber', 'lineId', 'id']) || String(index + 1),
    description: firstString(record, ['description', 'name']) || `Position ${index + 1}`,
    details: asString(record.details),
    quantity,
    unit: firstString(record, ['unit', 'unitCode']),
    unitPrice,
    baseQuantity: firstNumber(record, ['baseQuantity', 'priceBaseQuantity']),
    baseUnit: firstString(record, ['baseUnit', 'priceBaseUnit']),
    amount,
    taxRate: firstNumber(record, ['taxRate', 'vatRate']),
  };
}

function getLineItems(parsedData: JsonRecord): ViewerLineItem[] {
  const rawItems = parsedData.lineItems ?? parsedData.items ?? [];
  return toArray(rawItems).map(parseLineItem);
}

function formatDate(value: Date | string | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('de-DE').format(date);
}

function formatNumber(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMeasure(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 12,
  }).format(value);
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) return '-';
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return formatNumber(value);
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return escapeHtml(String(value));
}

function partyHtml(title: string, party: ViewerParty): string {
  const cityLine = [party.zipCode, party.city].filter(Boolean).join(' ');
  const lines = [
    party.name,
    ...(party.addressLines.length > 0 ? party.addressLines : [party.address]),
    cityLine || null,
    party.country,
    party.email,
  ].filter(Boolean);

  return `
    <section class="party">
      <p class="section-label">${escapeHtml(title)}</p>
      <address>
        ${lines.length > 0 ? lines.map(line => `<span>${text(line)}</span>`).join('') : '<span>-</span>'}
      </address>
    </section>`;
}

function getFormatLabel(parsedData: JsonRecord): string {
  const format = asString(parsedData.eInvoiceFormat);
  if (format === 'UBL') {
    const profile = asString(parsedData.eInvoiceProfile);
    return profile?.toLowerCase().includes('xrechnung') ? 'XRechnung / UBL' : 'UBL-E-Rechnung';
  }
  if (format === 'CII') return 'ZUGFeRD / Factur-X CII';
  return 'E-Rechnung';
}

function getDocumentLabel(parsedData: JsonRecord): string {
  const type = asString(parsedData.documentType);
  if (type === 'CREDIT_NOTE') return 'Gutschrift';
  if (type === 'DEBIT_NOTE') return 'Belastungsanzeige';
  return 'Rechnung';
}

export function buildEInvoiceViewerHtml(source: EInvoiceViewerSource): string {
  const parsedData = normalizeRecord(source.parsedData);
  const legacyBuyer = parseLegacyCustomerAddress(asString(parsedData.customerAddress));
  const buyer = {
    ...parseParty(parsedData.buyerInfo, asString(parsedData.customerName) || legacyBuyer.name || null),
    ...Object.fromEntries(Object.entries(legacyBuyer).filter(([, value]) => value)),
  } as ViewerParty;
  const seller = parseParty(parsedData.sellerInfo);
  const lineItems = getLineItems(parsedData);
  const lineSubtotal = lineItems.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const taxTotal = lineItems.reduce((sum, item) => {
    if (item.amount === null || item.taxRate === null) return sum;
    return sum + item.amount * (item.taxRate / 100);
  }, 0);
  const rawCurrency = source.currency || asString(parsedData.currency);
  const currency = rawCurrency ? rawCurrency.toUpperCase() : null;
  const displayedNet = asNumber(parsedData.netAmount) ?? (lineItems.length > 0 ? lineSubtotal : null);
  const displayedTax = asNumber(parsedData.taxAmount) ?? taxTotal;
  const totalAmount = asNumber(parsedData.grossAmount) ?? source.totalAmount ?? asNumber(parsedData.totalAmount) ?? (lineItems.length > 0 ? lineSubtotal : null);
  const prepaidAmount = asNumber(parsedData.prepaidAmount);
  const dueAmount = asNumber(parsedData.dueAmount);
  const roundingAmount = asNumber(parsedData.roundingAmount);
  const invoiceNumber = source.invoiceNumber || asString(parsedData.invoiceNumber) || source.fileName;
  const invoiceDate = source.invoiceDate || asString(parsedData.invoiceDate);
  const dueDate = source.dueDate || asString(parsedData.dueDate);
  const formatLabel = getFormatLabel(parsedData);
  const documentLabel = getDocumentLabel(parsedData);
  const validationStatus = asString(parsedData.validationStatus);

  const rows = lineItems.length > 0
    ? lineItems.map(item => `
      <tr>
        <td>${text(item.positionNumber)}</td>
        <td>
          <strong>${text(item.description)}</strong>
          ${item.details ? `<small>${text(item.details)}</small>` : ''}
          ${item.baseQuantity !== null ? `<small>Preis je ${formatMeasure(item.baseQuantity)}${item.baseUnit ? ` ${text(item.baseUnit)}` : ''}</small>` : ''}
        </td>
        <td class="num">${formatMeasure(item.quantity)}</td>
        <td>${text(item.unit)}</td>
        <td class="num">${formatCurrency(item.unitPrice, currency)}</td>
        <td class="num">${item.taxRate === null ? '-' : `${formatNumber(item.taxRate)} %`}</td>
        <td class="num">${formatCurrency(item.amount, currency)}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="empty">Keine Positionsdaten in der E-Rechnung gefunden.</td></tr>`;

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>E-Rechnung ${escapeHtml(invoiceNumber)}</title>
  <style>
    :root {
      color-scheme: light;
      --text: #172033;
      --muted: #64748b;
      --line: #dbe3ef;
      --soft: #f8fafc;
      --accent: #2563eb;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background: #eef3f9;
    }

    .paper {
      max-width: 960px;
      margin: 0 auto;
      padding: 42px;
      background: white;
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
    }

    .top {
      display: flex;
      justify-content: space-between;
      gap: 32px;
      border-bottom: 2px solid var(--line);
      padding-bottom: 28px;
    }

    .eyebrow {
      margin: 0 0 10px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 40px;
      letter-spacing: -0.04em;
    }

    .meta {
      min-width: 260px;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
    }

    .meta-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }

    .meta-row:last-child { border-bottom: 0; }
    .meta-row span:first-child { color: var(--muted); }
    .meta-row span:last-child { text-align: right; font-weight: 700; }

    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin: 34px 0;
    }

    .party {
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px;
    }

    .section-label {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    address {
      display: grid;
      gap: 5px;
      font-style: normal;
      line-height: 1.45;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--soft);
    }

    th, td {
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    td small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
    }

    .num { text-align: right; white-space: nowrap; }
    .empty { color: var(--muted); text-align: center; padding: 28px; }

    .summary {
      display: flex;
      justify-content: flex-end;
      margin-top: 28px;
    }

    .summary-card {
      width: min(380px, 100%);
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--line);
    }

    .summary-row:last-child {
      color: white;
      background: var(--accent);
      border-bottom: 0;
      font-size: 18px;
      font-weight: 700;
    }

    .note {
      margin-top: 32px;
      padding: 14px 16px;
      border-left: 4px solid var(--accent);
      color: var(--muted);
      background: var(--soft);
      line-height: 1.5;
    }

    @media (max-width: 760px) {
      body { padding: 12px; }
      .paper { padding: 24px; border-radius: 12px; }
      .top, .parties { grid-template-columns: 1fr; display: grid; }
      h1 { font-size: 32px; }
      table { display: block; overflow-x: auto; }
    }

    @media print {
      body { padding: 0; background: white; }
      .paper { box-shadow: none; border: 0; border-radius: 0; }
    }
  </style>
</head>
<body>
  <main class="paper">
    <header class="top">
      <div>
        <p class="eyebrow">${escapeHtml(formatLabel)} Vorschau</p>
        <h1>${escapeHtml(documentLabel)}</h1>
      </div>
      <section class="meta" aria-label="Rechnungsdaten">
        <div class="meta-row"><span>Rechnungsnummer</span><span>${text(invoiceNumber)}</span></div>
        <div class="meta-row"><span>Rechnungsdatum</span><span>${escapeHtml(formatDate(invoiceDate))}</span></div>
        <div class="meta-row"><span>Fällig am</span><span>${escapeHtml(formatDate(dueDate))}</span></div>
        <div class="meta-row"><span>Währung</span><span>${text(currency || 'unbekannt')}</span></div>
      </section>
    </header>

    <div class="parties">
      ${partyHtml('Rechnungsaussteller', seller)}
      ${partyHtml('Rechnungsempfänger', buyer)}
    </div>

    <section>
      <p class="section-label">Positionen</p>
      <table>
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Beschreibung</th>
            <th class="num">Menge</th>
            <th>Einheit</th>
            <th class="num">Einzelpreis</th>
            <th class="num">USt.</th>
            <th class="num">Betrag</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="summary" aria-label="Summen">
      <div class="summary-card">
        <div class="summary-row"><span>Zwischensumme</span><strong>${formatCurrency(displayedNet, currency)}</strong></div>
        <div class="summary-row"><span>Umsatzsteuer</span><strong>${formatCurrency(displayedTax, currency)}</strong></div>
        ${prepaidAmount !== null ? `<div class="summary-row"><span>Vorausgezahlt</span><strong>${formatCurrency(prepaidAmount, currency)}</strong></div>` : ''}
        ${roundingAmount !== null ? `<div class="summary-row"><span>Rundung</span><strong>${formatCurrency(roundingAmount, currency)}</strong></div>` : ''}
        ${dueAmount !== null ? `<div class="summary-row"><span>Fällig</span><strong>${formatCurrency(dueAmount, currency)}</strong></div>` : ''}
        <div class="summary-row"><span>Gesamtbetrag</span><strong>${formatCurrency(totalAmount, currency)}</strong></div>
      </div>
    </section>

    <p class="note">
      Diese Ansicht ist eine vereinfachte Lesedarstellung der strukturierten E-Rechnung.
      Maßgeblich bleibt die importierte XML-Datei; XRechnung selbst enthält kein verbindliches Drucklayout.
      ${validationStatus === 'NOT_VALIDATED' ? 'Standardkonformität nicht geprüft.' : ''}
    </p>
  </main>
</body>
</html>`;
}
