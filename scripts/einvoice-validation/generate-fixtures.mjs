import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

const DEFAULT_EXEMPTION_REASON = 'Steuerbefreiung nach § 4 Nr. 8 UStG.';
const SMALL_BUSINESS_REASON = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.';

function assertCalculationResult(result, items) {
  if (!result || !Array.isArray(result.lines) || result.lines.length !== items.length) {
    throw new Error(
      'calculateInvoiceAmounts(items) must return { lines: [{ netAmount, taxAmount }, ...], netAmount, taxAmount, grossAmount }.',
    );
  }
  for (const [index, line] of result.lines.entries()) {
    if (!Number.isFinite(line?.netAmount) || !Number.isFinite(line?.taxAmount)) {
      throw new Error(`calculateInvoiceAmounts returned an invalid line at index ${index}.`);
    }
  }
  for (const field of ['netAmount', 'taxAmount', 'grossAmount']) {
    if (!Number.isFinite(result[field])) {
      throw new Error(`calculateInvoiceAmounts returned an invalid ${field}.`);
    }
  }
  return result;
}

function resolveModuleSpecifier(specifier, containingFile, bridgeDirectory, bridgeOverrides = {}) {
  if (!(specifier.startsWith('.') || specifier.startsWith('@/'))) return specifier;
  const unresolved = specifier.startsWith('@/')
    ? path.join(repositoryRoot, specifier.slice(2))
    : path.resolve(path.dirname(containingFile), specifier);
  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [`${unresolved}.ts`, `${unresolved}.tsx`, `${unresolved}.js`, `${unresolved}.mjs`, path.join(unresolved, 'index.ts')];
  const overriddenBridge = bridgeOverrides[path.resolve(candidates[0])];
  if (overriddenBridge) return pathToFileURL(overriddenBridge).href;
  return pathToFileURL(candidates[0]).href;
}

async function importTypeScriptModule(entryPath, bridgeDirectory, bridgeOverrides = {}) {
  let typescript;
  try {
    typescript = await import('typescript');
  } catch (typescriptError) {
    throw new Error(`TypeScript is required for the ESM bridge used to import ${entryPath}: ${String(typescriptError)}`);
  }
  const source = await readFile(entryPath, 'utf8');
  const transpiled = typescript.transpileModule(source, {
    compilerOptions: {
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      sourceMap: false,
      verbatimModuleSyntax: true,
    },
    fileName: entryPath,
  }).outputText.replace(
    /(\b(?:from|import\s*\(|export\s+\*\s+from|export\s+\{[^}]+\}\s+from)\s*["'])([^"']+)(["'])/g,
    (_, prefix, specifier, suffix) => `${prefix}${resolveModuleSpecifier(specifier, entryPath, bridgeDirectory, bridgeOverrides)}${suffix}`,
  );
  await mkdir(bridgeDirectory, { recursive: true });
  const bridgePath = path.join(bridgeDirectory, `${path.basename(entryPath, path.extname(entryPath))}-bridge.mjs`);
  await writeFile(bridgePath, transpiled, 'utf8');
  return import(pathToFileURL(bridgePath).href);
}

async function importGenerator(bridgeDirectory, bridgeOverrides) {
  const generatorPath = path.join(repositoryRoot, 'lib', 'zugferd-generator.ts');
  return importTypeScriptModule(generatorPath, bridgeDirectory, bridgeOverrides);
}

async function importCalculationHelper(bridgeDirectory) {
  const helperPath = path.join(repositoryRoot, 'lib', 'invoice-calculation.ts');
  try {
    const module = await importTypeScriptModule(helperPath, bridgeDirectory);
    if (typeof module.calculateInvoiceAmounts !== 'function') {
      throw new Error('module does not export calculateInvoiceAmounts');
    }
    Object.defineProperty(module.calculateInvoiceAmounts, '__moduleBridgePath', {
      value: path.join(bridgeDirectory, 'invoice-calculation-bridge.mjs'),
      enumerable: false,
    });
    return module.calculateInvoiceAmounts;
  } catch (error) {
    throw new Error(`Cannot import the application's calculation helper at ${helperPath}; refusing to substitute a harness calculation.\n${String(error)}`);
  }
}

function baseParty() {
  return {
    name: 'Bivaro Test GmbH',
    address: 'Teststraße 10\n68159 Mannheim',
    countryCode: 'DE',
    email: 'seller@example.test',
    telephone: '+496211234567',
    taxNumber: '12345678901',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
  };
}

function baseBuyer() {
  return {
    name: 'Empfänger Test AG',
    address: 'Käuferweg 5\n10115 Berlin',
    countryCode: 'DE',
    email: 'buyer@example.test',
  };
}

function copyItems(items) {
  return items.map((item) => ({ ...item }));
}

function createData({ invoiceNumber, profile, taxMode, items, buyerReference = '04011000-12345-67', paymentMeansCode = '30', seller, buyer, deliveryDate = new Date('2026-09-18T12:00:00Z') }, calculate) {
  const inputItems = copyItems(items);
  const amounts = assertCalculationResult(calculate(inputItems), inputItems);
  const resolvedItems = inputItems.map((item, index) => ({
    ...item,
    total: amounts.lines[index].netAmount,
  }));

  return {
    invoiceNumber,
    date: new Date('2026-09-18T12:00:00Z'),
    dueDate: new Date('2026-10-18T12:00:00Z'),
    deliveryDate: deliveryDate === null ? undefined : deliveryDate,
    buyerReference,
    taxMode,
    paymentMeansCode,
    seller: { ...baseParty(), ...(seller || {}) },
    buyer: { ...baseBuyer(), ...(buyer || {}) },
    items: resolvedItems,
    netAmount: amounts.netAmount,
    taxAmount: amounts.taxAmount,
    currency: 'EUR',
    profile,
  };
}

function mutateMissingIban(xml) {
  return xml.replace(
    /\s*<ram:PayeePartyCreditorFinancialAccount>[\s\S]*?<\/ram:PayeePartyCreditorFinancialAccount>/,
    '',
  );
}

function mutateWrongHeaderNet(xml) {
  const marker = '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>';
  const start = xml.indexOf(marker);
  const end = xml.indexOf('</ram:SpecifiedTradeSettlementHeaderMonetarySummation>', start);
  if (start < 0 || end < 0) throw new Error('Cannot find settlement summation in generated XML.');
  const before = xml.slice(0, start);
  const header = xml.slice(start, end);
  const after = xml.slice(end);
  const changed = header.replace(/<ram:LineTotalAmount>([0-9]+(?:\.[0-9]+)?)<\/ram:LineTotalAmount>/, (_, value) => {
    return `<ram:LineTotalAmount>${(Number(value) + 1).toFixed(2)}</ram:LineTotalAmount>`;
  });
  if (changed === header) throw new Error('Cannot mutate header net amount in generated XML.');
  return before + changed + after;
}

function mutateMissingExemptionReason(xml) {
  const changed = xml.replace(/\s*<ram:ExemptionReason>[^<]*<\/ram:ExemptionReason>/g, '');
  if (changed === xml) throw new Error('Cannot mutate exemption reason in generated XML.');
  return changed;
}

function mutateWrongCurrency(xml) {
  const changed = xml.replaceAll('<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>', '<ram:InvoiceCurrencyCode>ZZZ</ram:InvoiceCurrencyCode>')
    .replaceAll('currencyID="EUR"', 'currencyID="ZZZ"');
  if (changed === xml) throw new Error('Cannot mutate currency in generated XML.');
  return changed;
}

function mutateMissingBuyerReference(xml) {
  const changed = xml.replace(/\s*<ram:BuyerReference>[^<]*<\/ram:BuyerReference>/, '');
  if (changed === xml) throw new Error('Cannot mutate buyer reference in generated XML.');
  return changed;
}

function cloneInvoice(invoice) {
  return structuredClone(invoice);
}

function assertApplicationRejects(generator, invoice, options, mutate, label) {
  if (typeof generator.validateZugferdData !== 'function') {
    throw new Error('lib/zugferd-generator.ts does not export validateZugferdData.');
  }
  const candidate = cloneInvoice(invoice);
  mutate(candidate);
  const validation = generator.validateZugferdData(candidate, options);
  if (validation.isValid) {
    throw new Error(`Application contract check ${label} unexpectedly accepted invalid data.`);
  }
  return { label, passed: true, errors: validation.errors.map((issue) => issue.field) };
}

const positiveDefinitions = [
  {
    name: 'baseline-standard-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [{ description: 'Beratung', quantity: 2, unitPrice: 125, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'rounding-lines-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [
      { description: 'Rundungsposition A', quantity: 1, unitPrice: 0.333, taxRate: 19, taxCategory: 'S' },
      { description: 'Rundungsposition B', quantity: 1, unitPrice: 0.667, taxRate: 19, taxCategory: 'S' },
    ],
  },
  {
    name: 'same-rate-tax-group-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    // The two rounded line nets add to 0.03 EUR. The VAT group must calculate
    // 0.03 * 19% = 0.01 EUR; summing per-line rounded tax would give 0.00 EUR.
    items: [
      { description: 'Kleine Position A', quantity: 1, unitPrice: 0.01, taxRate: 19, taxCategory: 'S' },
      { description: 'Kleine Position B', quantity: 1, unitPrice: 0.02, taxRate: 19, taxCategory: 'S' },
    ],
  },
  {
    name: 'same-category-decimal-sum-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    // 0.10 + 0.20 must stay exactly 0.30 before grouped 19% tax is rounded.
    items: [
      { description: 'Binärsumme A', quantity: 1, unitPrice: 0.1, taxRate: 19, taxCategory: 'S' },
      { description: 'Binärsumme B', quantity: 1, unitPrice: 0.2, taxRate: 19, taxCategory: 'S' },
    ],
  },
  {
    name: 'mixed-tax-rates-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [
      { description: 'Regelbesteuerte Leistung', quantity: 1, unitPrice: 100, taxRate: 19, taxCategory: 'S' },
      { description: 'Ermäßigte Leistung', quantity: 1, unitPrice: 100, taxRate: 7, taxCategory: 'S' },
    ],
  },
  {
    name: 'explicit-exempt-reason-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [
      { description: 'Steuerfreie Leistung', quantity: 1, unitPrice: 50, taxRate: 0, taxCategory: 'E', exemptionReason: DEFAULT_EXEMPTION_REASON },
      { description: 'Regelbesteuerte Leistung', quantity: 1, unitPrice: 10, taxRate: 19, taxCategory: 'S' },
    ],
  },
  {
    name: 'zero-rated-z-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [{ description: 'Nullsteuersatz', quantity: 1, unitPrice: 80, taxRate: 0, taxCategory: 'Z', exemptionReason: 'Nullsteuersatz nach § 12 Abs. 3 UStG.' }],
  },
  {
    name: 'small-business-19-xrechnung',
    profile: 'xrechnung',
    taxMode: 'small-business',
    items: [
      { description: 'Kleinunternehmerleistung', quantity: 1, unitPrice: 123.45, taxRate: 0, taxCategory: 'E', exemptionReason: SMALL_BUSINESS_REASON },
      { description: 'Kleinunternehmernebenleistung', quantity: 1, unitPrice: 0.55, taxRate: 0, taxCategory: 'E', exemptionReason: SMALL_BUSINESS_REASON },
    ],
  },
  {
    name: 'price-precision-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [{ description: 'Präziser Einzelpreis', quantity: 100, unitPrice: 0.3333, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'quantity-precision-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    items: [{ description: 'Präzise Menge', quantity: 0.333, unitPrice: 100, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'international-4digit-address-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    seller: {
      name: 'Alpen Test GmbH',
      addressLines: ['Hauptstraße 1'],
      zipCode: '1010',
      city: 'Wien',
      countryCode: 'AT',
      taxNumber: undefined,
      vatId: 'ATU12345678',
    },
    buyer: {
      name: 'Helvetia Test AG',
      addressLines: ['Bahnhofstrasse 1'],
      zipCode: '8001',
      city: 'Zürich',
      countryCode: 'CH',
    },
    items: [{ description: 'Internationale Leistung', quantity: 1, unitPrice: 100, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'three-street-lines-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    seller: { addressLines: ['Gebäude A', 'Hof 2', 'Raum 3'], zipCode: '68159', city: 'Mannheim' },
    items: [{ description: 'Dreizeilige Anschrift', quantity: 1, unitPrice: 25, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'sepa-credit-transfer-58-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    paymentMeansCode: '58',
    items: [{ description: 'SEPA Überweisung', quantity: 1, unitPrice: 20, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'cash-payment-10-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    paymentMeansCode: '10',
    items: [{ description: 'Barzahlung', quantity: 1, unitPrice: 20, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'no-delivery-date-xrechnung',
    profile: 'xrechnung',
    taxMode: 'standard',
    deliveryDate: null,
    items: [{ description: 'Ohne Leistungsdatum', quantity: 1, unitPrice: 30, taxRate: 19, taxCategory: 'S' }],
  },
  {
    name: 'facturx-shared-standard',
    profile: 'factur-x',
    taxMode: 'standard',
    items: [{ description: 'Factur-X gemeinsame EN16931-Prüfung', quantity: 1, unitPrice: 42, taxRate: 19, taxCategory: 'S' }],
  },
];

const negativeDefinitions = [
  {
    name: 'negative-missing-iban',
    source: 'baseline-standard-xrechnung',
    mutation: mutateMissingIban,
    requiredFailureIds: ['CII-SR-470', 'BR-DE-23-a'],
  },
  {
    name: 'negative-wrong-header-net',
    source: 'mixed-tax-rates-xrechnung',
    mutation: mutateWrongHeaderNet,
    requiredFailureIds: ['BR-CO-10'],
  },
  {
    name: 'negative-missing-exemption-reason',
    source: 'explicit-exempt-reason-xrechnung',
    mutation: mutateMissingExemptionReason,
    requiredFailureIds: ['BR-E-10'],
  },
  {
    name: 'negative-wrong-currency',
    source: 'baseline-standard-xrechnung',
    mutation: mutateWrongCurrency,
    requiredFailureIds: ['BR-CL-03', 'BR-CL-04'],
  },
  {
    name: 'negative-missing-buyer-reference',
    source: 'baseline-standard-xrechnung',
    mutation: mutateMissingBuyerReference,
    requiredFailureIds: [],
  },
];

export async function generateFixtures(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const bridgeDirectory = path.join(outputDirectory, '.loader');
  const calculate = await importCalculationHelper(bridgeDirectory);
  const calculationPath = path.join(repositoryRoot, 'lib', 'invoice-calculation.ts');
  const generator = await importGenerator(bridgeDirectory, { [calculationPath]: calculate.__moduleBridgePath });
  if (typeof generator.generateZugferdXml !== 'function') {
    throw new Error('lib/zugferd-generator.ts does not export generateZugferdXml.');
  }

  const manifest = {
    harnessVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'lib/zugferd-generator.ts',
    calculationSource: 'lib/invoice-calculation.ts',
    applicationContractChecks: [],
    fixtures: [],
  };
  const generatedByName = new Map();

  for (const [index, definition] of positiveDefinitions.entries()) {
    const invoice = createData({
      invoiceNumber: `HARNESS-${String(index + 1).padStart(3, '0')}`,
      ...definition,
    }, calculate);
    const xml = generator.generateZugferdXml(invoice, { profile: definition.profile });
    if (typeof xml !== 'string' || !xml.includes('<rsm:CrossIndustryInvoice')) {
      throw new Error(`${definition.name}: generator did not return CII XML.`);
    }
    const filename = `${definition.name}.xml`;
    await writeFile(path.join(outputDirectory, filename), xml, 'utf8');
    const entry = {
      name: definition.name,
      filename,
      profile: definition.profile,
      expectedValid: true,
      expectedFailureIds: [],
    };
    manifest.fixtures.push(entry);
    generatedByName.set(definition.name, { xml, entry });
  }

  const baseline = generatedByName.get('baseline-standard-xrechnung');
  if (!baseline) throw new Error('Baseline fixture was not generated.');
  const xrechnung = { profile: 'xrechnung' };
  manifest.applicationContractChecks.push(assertApplicationRejects(
    generator,
    createData({
      invoiceNumber: 'HARNESS-CONTRACT-COUNTRY',
      profile: 'xrechnung',
      taxMode: 'standard',
      items: [{ description: 'Country check', quantity: 1, unitPrice: 10, taxRate: 19, taxCategory: 'S' }],
    }, calculate),
    xrechnung,
    (candidate) => { candidate.seller.countryCode = 'ZZ'; },
    'ISO country code ZZ',
  ));
  manifest.applicationContractChecks.push(assertApplicationRejects(
    generator,
    createData({
      invoiceNumber: 'HARNESS-CONTRACT-CURRENCY',
      profile: 'xrechnung',
      taxMode: 'standard',
      items: [{ description: 'Currency check', quantity: 1, unitPrice: 10, taxRate: 19, taxCategory: 'S' }],
    }, calculate),
    xrechnung,
    (candidate) => { candidate.currency = 'ZZZ'; },
    'ISO currency code ZZZ',
  ));
  manifest.applicationContractChecks.push(assertApplicationRejects(
    generator,
    createData({
      invoiceNumber: 'HARNESS-CONTRACT-SEPA58',
      profile: 'xrechnung',
      taxMode: 'standard',
      paymentMeansCode: '58',
      items: [{ description: 'SEPA check', quantity: 1, unitPrice: 10, taxRate: 19, taxCategory: 'S' }],
    }, calculate),
    xrechnung,
    (candidate) => { candidate.seller.iban = undefined; },
    'SEPA payment without account',
  ));
  manifest.applicationContractChecks.push(assertApplicationRejects(
    generator,
    createData({
      invoiceNumber: 'HARNESS-CONTRACT-ZERO',
      profile: 'xrechnung',
      taxMode: 'standard',
      items: [{ description: 'Zero total check', quantity: 1, unitPrice: 0, taxRate: 0, taxCategory: 'Z', exemptionReason: 'Nullsteuersatz nach § 12 Abs. 3 UStG.' }],
    }, calculate),
    xrechnung,
    (candidate) => { candidate.seller.iban = undefined; candidate.paymentMeansCode = '30'; },
    'zero-total transfer without account',
  ));
  manifest.applicationContractChecks.push(assertApplicationRejects(
    generator,
    createData({
      invoiceNumber: 'HARNESS-CONTRACT-ENDPOINT',
      profile: 'xrechnung',
      taxMode: 'standard',
      items: [{ description: 'Endpoint check', quantity: 1, unitPrice: 10, taxRate: 19, taxCategory: 'S' }],
    }, calculate),
    xrechnung,
    (candidate) => { candidate.buyer.electronicAddress = { value: 'bad-endpoint', schemeId: 'INVALID' }; },
    'invalid EM endpoint scheme',
  ));

  for (const [index, definition] of negativeDefinitions.entries()) {
    const source = generatedByName.get(definition.source);
    if (!source) throw new Error(`Negative fixture source not found: ${definition.source}`);
    const xml = definition.mutation(source.xml);
    const filename = `${definition.name}.xml`;
    await writeFile(path.join(outputDirectory, filename), xml, 'utf8');
    manifest.fixtures.push({
      name: definition.name,
      filename,
      profile: source.entry.profile,
      expectedValid: false,
      expectedFailureIds: definition.requiredFailureIds,
      mutationOf: definition.source,
      mutationIndex: index,
    });
  }

  await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}
