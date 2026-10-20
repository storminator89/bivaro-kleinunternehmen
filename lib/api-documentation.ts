/** OpenAPI contract for the supported public v1 operations (not web-only APIs). */
type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const number: Schema = { type: 'number' };
const integer: Schema = { type: 'integer' };
const boolean: Schema = { type: 'boolean' };
const id: Schema = { type: 'integer', minimum: 1 };
const date: Schema = { type: 'string', format: 'date' };
const dateTime: Schema = { type: 'string', format: 'date-time' };
const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: 'array', items });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const query = (name: string, schema: Schema = string, required = false) => ({ name, in: 'query', required, schema });
const idParam = query('id', id, true);
const pagination = [query('page', { ...id, default: 1 }), query('limit', { ...id, default: 50, maximum: 100 })];
const dates = [query('startDate', date), query('endDate', date)];
const financialFields = { description: string, amount: { ...number, minimum: 0 }, date, taxRelevant: boolean };
const customerFields = {
  name: string, contactPerson: nullable(string), email: nullable({ ...string, format: 'email' }),
  phone: nullable(string), address: nullable(string), zipCode: nullable(string), city: nullable(string), taxNumber: nullable(string),
};
const expenseFields = {
  ...financialFields, category: nullable(string), taxDeductiblePercentage: { ...number, minimum: 0, maximum: 100 },
  depreciationYears: nullable({ ...integer, minimum: 1 }),
};
const incomeFields = { ...financialFields, customerId: nullable(id) };
const recurringFields = {
  description: string, amount: { ...number, minimum: 0 }, category: nullable(string), taxRelevant: boolean,
  taxDeductiblePercentage: { ...number, minimum: 0, maximum: 100 }, interval: enumeration('MONTHLY', 'QUARTERLY', 'YEARLY'),
  dayOfMonth: { ...integer, minimum: 1, maximum: 31 }, startDate: dateTime, endDate: nullable(dateTime),
};
const cashTextFields = { description: string, category: nullable(string), receiptNumber: nullable(string), notes: nullable(string), taxRelevant: boolean };
const cashFields = {
  ...cashTextFields, cashBookId: id, type: enumeration('EINNAHME', 'AUSGABE'),
  amount: { ...number, minimum: 0, exclusiveMinimum: true }, date: dateTime, incomeId: nullable(id), expenseId: nullable(id),
};
const documentationFields = { version: string, title: string, content: { ...string, description: 'Dokumentinhalt als String, z. B. serialisiertes JSON.' } };
const invoiceFields = {
  id, fileName: string, invoiceNumber: nullable(string), invoiceDate: nullable(dateTime), dueDate: nullable(dateTime),
  totalAmount: nullable(number), status: enumeration('DRAFT', 'SENT', 'PAID', 'CANCELLED'),
  issuanceState: enumeration('UNISSUED', 'ISSUED', 'UNKNOWN'), paidAt: nullable(dateTime), uploadedAt: dateTime,
  customerId: nullable(id), customer: nullable(object({ id, name: string })),
};
const reminderFields = {
  id, invoiceId: id, reminderLevel: { ...integer, minimum: 1, maximum: 4 },
  fee: number, notes: nullable(string), sentAt: dateTime, dueDate: nullable(dateTime),
};

const schemas: Record<string, Schema> = {
  Error: object({ error: object({ message: string, code: string, timestamp: dateTime }, ['message', 'code', 'timestamp']) }, ['error']),
  PaginationMeta: object({ page: integer, pageSize: integer, total: integer, hasMore: boolean }),
  Deleted: object({ deleted: boolean, id }),
  Customer: object({ id, ...customerFields, createdAt: dateTime }),
  CustomerInput: object(customerFields, ['name']), CustomerUpdate: object(customerFields),
  Expense: object({ id, ...expenseFields, date: dateTime, receiptFileName: nullable(string) }),
  ExpenseInput: object(expenseFields, ['description', 'amount']), ExpenseUpdate: object(expenseFields),
  Income: object({ id, ...incomeFields, date: dateTime, invoiceId: nullable(id), customer: nullable(object({ id, name: string })) }),
  IncomeInput: object(incomeFields, ['description', 'amount', 'date']), IncomeUpdate: object(incomeFields),
  Invoice: object(invoiceFields),
  InvoiceUpdate: object({ status: enumeration('DRAFT', 'SENT', 'PAID'), paidAt: nullable(dateTime), customerId: nullable(id) }),
  InvoiceUpload: object({
    ...invoiceFields, customerName: nullable(string), eInvoiceFormat: string, documentType: nullable(string), currency: nullable(string),
    grossAmount: nullable(number), prepaidAmount: nullable(number), roundingAmount: nullable(number), dueAmount: nullable(number),
    hasEInvoiceXml: boolean, hasPdfFile: boolean,
  }),
  RecurringExpense: object({ id, ...recurringFields, isActive: boolean, lastExecuted: nullable(dateTime), nextExecution: dateTime, createdAt: dateTime, updatedAt: dateTime }),
  RecurringExpenseInput: object(recurringFields, ['description', 'amount', 'interval']),
  RecurringExpenseUpdate: object({ ...recurringFields, isActive: boolean }),
  Reminder: object({ ...reminderFields, reminderLevelLabel: string, invoice: object({ id, invoiceNumber: nullable(string), totalAmount: nullable(number), customer: nullable(object({ id, name: string })) }) }),
  ReminderInput: object({
    invoiceId: id, reminderLevel: { ...integer, minimum: 1, maximum: 4 },
    fee: { ...number, minimum: 0, default: 0 }, notes: string, dueDays: { ...integer, minimum: 1, default: 14 },
  }, ['invoiceId']),
  ReminderOverview: object({
    invoices: array(object({
      id, invoiceNumber: nullable(string), fileName: string, invoiceDate: nullable(dateTime), dueDate: nullable(dateTime),
      totalAmount: nullable(number), status: string, customer: nullable(object({ id, name: string, email: nullable(string) })),
      reminders: array(object(reminderFields)), currentReminderLevel: integer, currentReminderLevelLabel: string,
      nextReminderLevel: integer, nextReminderLevelLabel: string, daysOverdue: integer, totalFees: number, isOverdue: boolean,
    })),
    stats: object({ totalOverdue: integer, totalAmount: number, totalFees: number, byLevel: { type: 'object', additionalProperties: integer } }),
  }),
  CashBook: object({ id, name: string, description: nullable(string), initialBalance: number, currency: string, isActive: boolean }),
  CashTransaction: object({ id, ...cashFields, runningBalance: number }),
  CashTransactionInput: object(cashFields, ['cashBookId', 'type', 'description', 'amount']),
  CashTransactionUpdate: { ...object(cashTextFields), additionalProperties: false },
  CashBookOverview: object({ cashBooks: array(ref('CashBook')), transactions: array(ref('CashTransaction')) }),
  Documentation: object({ id, ...documentationFields, createdAt: dateTime, updatedAt: dateTime }),
  DocumentationInput: object(documentationFields, ['title', 'content']), DocumentationUpdate: object(documentationFields),
  Settings: object(Object.fromEntries([
    'companyName', 'companyAddress', 'email', 'telephone', 'taxNumber', 'bankName', 'bic', 'footerText', 'logoUrl',
  ].map(field => [field, nullable(string)]))),
};
// The v1 settings response never exposes an unmasked IBAN.
schemas.Settings = object({
  ...((schemas.Settings.properties ?? {}) as Record<string, Schema>),
  iban: nullable({ ...string, description: 'Maskiert: **** gefolgt von den letzten vier Zeichen.' }),
});

function response(data: Schema, paginated = false): Schema {
  return object({ success: { type: 'boolean', enum: [true] }, data, timestamp: dateTime, ...(paginated ? { meta: ref('PaginationMeta') } : {}) }, ['success', 'data', 'timestamp']);
}
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });
function operation(summary: string, tag: string, scope: string, data: Schema, options: {
  parameters?: ReturnType<typeof query>[]; input?: string; created?: boolean; paginated?: boolean; description?: string;
} = {}) {
  return {
    summary, tags: [tag], description: options.description ?? `Erforderlicher API-Key-Scope: ${scope}.`, 'x-required-scopes': [scope],
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.input ? { requestBody: { required: true, content: { 'application/json': { schema: ref(options.input) } } } } : {}),
    responses: {
      [options.created ? '201' : '200']: { description: 'Erfolgreich', content: { 'application/json': { schema: response(data, options.paginated) } } },
      '400': errorResponse('Ungültige Anfrage'), '401': errorResponse('API-Key fehlt oder ist ungültig'),
      '403': errorResponse('Scope oder Origin nicht erlaubt'), '404': errorResponse('Ressource nicht gefunden'),
      '409': errorResponse('Konflikt mit dem aktuellen Zustand'), '413': errorResponse('Anfrage zu groß'),
      '429': errorResponse('Anfragenlimit überschritten'), '500': errorResponse('Interner Serverfehler'),
    },
  };
}
function crud(tag: string, schema: string, parameters: ReturnType<typeof query>[]) {
  return {
    get: operation(`${tag} abrufen`, tag, 'read', array(ref(schema)), { parameters: [...pagination, ...parameters], paginated: true }),
    post: operation(`${tag} erstellen`, tag, 'write', ref(schema), { input: `${schema}Input`, created: true }),
    put: operation(`${tag} aktualisieren`, tag, 'write', ref(schema), { parameters: [idParam], input: `${schema}Update` }),
    delete: operation(`${tag} löschen`, tag, 'delete', ref('Deleted'), { parameters: [idParam] }),
  };
}

const paths: Record<string, Record<string, unknown>> = {
  '/customers': crud('Kunden', 'Customer', [query('search')]),
  '/expenses': crud('Ausgaben', 'Expense', [query('search'), query('category'), query('taxRelevant', boolean), ...dates]),
  '/incomes': crud('Einnahmen', 'Income', [query('search'), query('customerId', id), ...dates]),
  '/invoices': {
    get: operation('Rechnungen abrufen', 'Rechnungen', 'read', array(ref('Invoice')), { parameters: [...pagination, query('status', enumeration('DRAFT', 'SENT', 'PAID', 'CANCELLED')), query('customerId', id), query('invoiceNumber'), ...dates], paginated: true }),
    put: operation('Rechnungsstatus oder Kundenzuordnung ändern', 'Rechnungen', 'write', ref('Invoice'), { parameters: [idParam], input: 'InvoiceUpdate', description: 'Scope: write. Geschäftsregeln können Änderungen bereits ausgestellter/bezahlter Rechnungen ablehnen (409). Keine Rechnungserstellung über diesen Pfad; dafür /invoices/upload verwenden.' }),
    delete: operation('Löschbaren Rechnungsentwurf entfernen', 'Rechnungen', 'delete', ref('Deleted'), { parameters: [idParam], description: 'Scope: delete. Nur sicher nie ausgestellte Entwürfe sind löschbar; andere Rechnungen werden mit 409 abgewiesen.' }),
  },
  '/invoices/upload': {
    post: {
      ...operation('ZUGFeRD-/Factur-X-PDF oder XML-E-Rechnung importieren', 'Rechnungen', 'write', ref('InvoiceUpload'), { created: true }),
      requestBody: { required: true, content: { 'multipart/form-data': { schema: object({ file: { type: 'string', format: 'binary', description: 'PDF mit eingebetteter E-Rechnung oder XRechnung-/UBL-XML; kein beliebiger PDF-Beleg.' } }, ['file']) } } },
      responses: {
        ...operation('', '', 'write', ref('InvoiceUpload'), { created: true }).responses,
        '422': errorResponse('Nicht unterstützte E-Rechnung'), '503': errorResponse('Verarbeitung ausgelastet; später erneut versuchen'),
      },
    },
  },
  '/recurring-expenses': crud('Wiederkehrende Ausgaben', 'RecurringExpense', [query('isActive', boolean), query('interval', recurringFields.interval), query('category')]),
  '/reminders': {
    get: operation('Rechnungen mit Mahnstatus und Statistik abrufen', 'Mahnungen', 'read', ref('ReminderOverview'), { parameters: [query('includeAll', boolean), query('invoiceId', id)], description: 'Scope: read. Standardmäßig überfällige offene Rechnungen; includeAll=true bezieht auch noch nicht überfällige offene Rechnungen ein. Keine Pagination.' }),
    post: operation('Mahnung erfassen (kein E-Mail-Versand)', 'Mahnungen', 'write', ref('Reminder'), { input: 'ReminderInput', created: true }),
    delete: operation('Mahnung löschen', 'Mahnungen', 'delete', ref('Deleted'), { parameters: [idParam] }),
  },
  '/cashbook': {
    get: operation('Kassen und Kassenbuchungen abrufen', 'Kassenbuch', 'read', ref('CashBookOverview'), { parameters: [...pagination, query('cashBookId', id), query('type', cashFields.type), ...dates], paginated: true }),
    post: operation('Buchung in bestehender aktiver Kasse erstellen', 'Kassenbuch', 'write', ref('CashTransaction'), { input: 'CashTransactionInput', created: true }),
    put: operation('Nichtfinanzielle Buchungsfelder ändern', 'Kassenbuch', 'write', ref('CashTransaction'), { parameters: [idParam], input: 'CashTransactionUpdate', description: 'Scope: write. amount, date, type, cashBookId, incomeId und expenseId dürfen hier nicht geändert werden (400). Kein Anlegen/Ändern einer Kasse über diesen API-Pfad.' }),
    delete: operation('Kassenbuchung löschen', 'Kassenbuch', 'delete', object({ success: boolean }), { parameters: [idParam], description: 'Scope: delete. Kann bei negativem Zwischensaldo abgewiesen werden (409).' }),
  },
  '/documentation': crud('GoBD-Dokumentation', 'Documentation', []),
  '/settings': {
    get: operation('Firmeneinstellungen lesen', 'Einstellungen', 'read', ref('Settings'), { description: 'Scope: read. Nur lesbar; POST, PUT und DELETE liefern 405. Die IBAN wird maskiert. Ohne gespeicherte Einstellungen sind alle Werte null.' }),
  },
  '/docs': {
    get: { summary: 'OpenAPI-Spezifikation abrufen', tags: ['Dokumentation'], security: [], responses: { '200': { description: 'Diese OpenAPI-3.0.3-Spezifikation', content: { 'application/json': { schema: { type: 'object' } } } } } },
  },
};
// All resource routes implement unauthenticated CORS preflight explicitly.
for (const [path, item] of Object.entries(paths)) {
  if (path === '/docs') continue;
  item.options = { summary: 'CORS-Preflight', tags: ['Dokumentation'], security: [], responses: { '204': { description: 'CORS-Preflight-Antwort; API-Key-Berechtigungen werden beim eigentlichen Aufruf geprüft.' }, '400': { description: 'Ungültiger Origin-Header' }, '403': { description: 'Preflight-Methode oder Header nicht erlaubt' } } };
}

export const API_DOCUMENTATION = {
  openapi: '3.0.3',
  info: { title: 'Bivaro Buchhaltung API', version: '1.0.0', description: 'Unterstützte öffentliche API-v1-Operationen für Kunden, Ausgaben, Einnahmen, Rechnungen/Import, wiederkehrende Ausgaben, Mahnungen, Kassenbuch, Verfahrensdokumentation und lesbare Firmeneinstellungen. Mutationen unterliegen denselben fachlichen Integritätsregeln wie die Weboberfläche. API-Key-Limit: 100 Anfragen/Minute; Pagination nur an entsprechend ausgewiesenen GET-Endpunkten.' },
  servers: [{ url: '/api/v1', description: 'API v1' }],
  security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer biv_sk_...' },
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'X-API-Key: biv_sk_...' },
    },
    schemas,
  },
  paths,
  tags: ['Kunden', 'Ausgaben', 'Einnahmen', 'Rechnungen', 'Wiederkehrende Ausgaben', 'Mahnungen', 'Kassenbuch', 'GoBD-Dokumentation', 'Einstellungen', 'Dokumentation'].map(name => ({ name })),
};
