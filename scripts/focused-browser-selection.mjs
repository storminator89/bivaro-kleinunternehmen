/** Explicit, reviewed browser scope. Unknown critical paths never imply coverage. */
export const FOCUSED_SPECS = {
  'e2e/public-help-fragments.spec.ts': [],
  'e2e/public-switching-checklist.spec.ts': [],
  'e2e/backup-file-inspection.spec.ts': ['ZIP inspection shows actual checks, blocks changed originals and never restores on discard or reload'],
  'e2e/incoming-invoice-date-filter.spec.ts': ['mobile source-date filters keep boundaries, unknown dates, detail/reload/history and palette continuation read-only'],
  'e2e/registration-status-retry.spec.ts': [],
  'e2e/invoice-number-check-freshness.spec.ts': [],
  'e2e/users-list-read-retry.spec.ts': [],
  'e2e/combobox-accessibility.spec.ts': ['category combobox exposes actual keyboard and pointer choices in entry/edit/recurring dialogs'],
};
const code = value => /^(?:app|components|hooks|lib|prisma|scripts|e2e|focused-e2e)\//u.test(value) || /^(?:proxy\.ts|next\.config\.ts|package(?:-lock)?\.json|playwright[^/]*\.ts|\.github\/workflows\/)/u.test(value);
const knownInfrastructure = value => /^(?:scripts\/|focused-e2e\/|\.github\/workflows\/|e2e\/helpers\/|lib\/__tests__\/|playwright[^/]*\.ts)/u.test(value) || ['package.json', 'package-lock.json', 'next.config.ts', 'proxy.ts'].includes(value);
const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\0-\x1f\x7f]/u.test(value) && !value.startsWith('/') && !value.split('/').includes('..');
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
// Exact reviewed backend contracts run in ordinary CI. They are not browser
// certification of resource races, tenant isolation or financial projections.
const serverUnitContracts = {
  'app/api/backup/full/route.ts': ['lib/__tests__/backup-snapshot-route.test.ts'],
  'app/api/backup/route.ts': ['lib/__tests__/backup-snapshot-route.test.ts'],
  'app/api/dashboard/filter-options/route.ts': ['lib/__tests__/dashboard-filter-options.test.ts'],
  'lib/backup-snapshot.ts': ['lib/__tests__/backup-snapshot-route.test.ts', 'lib/__tests__/bank-allocation-backup.test.ts'],
  'lib/bank-allocation-backup.ts': ['lib/__tests__/bank-allocation-backup.test.ts'],
  'lib/processing-limit.ts': ['lib/__tests__/processing-limits.test.ts'],
  'scripts/einvoice-validation/check-official.py': ['scripts/__tests__/einvoice-checker-exit.test.ts', 'scripts/__tests__/einvoice_checker_exit_cases.py'],
};
// The existing inspection journey really exports a ZIP and then previews it.
// Queue races and portable-reference equivalence remain unit-contract evidence.
const backupInspectionSources = new Set(['app/api/backup/full/route.ts', 'lib/backup-snapshot.ts', 'lib/bank-allocation-backup.ts', 'lib/processing-limit.ts']);

export function selectFocusedBrowser(paths, exists = () => true) {
  if (!Array.isArray(paths) || paths.length > 5000 || !paths.every(safePath)) throw Error('Invalid changed-path inventory');
  const selected = new Set();
  const unknownCritical = new Set();
  let unmappedSourceCount = 0;
  const add = (file, critical, source) => {
    if (exists(file)) selected.add(file);
    else if (critical) unknownCritical.add(source);
    else unmappedSourceCount++;
  };
  // These reviewed feature packets have independent critical/non-mutation cases.
  // A path map is not semantic/security certification; source review remains required.
  const packets = [
    { spec: 'e2e/incoming-invoice-date-filter.spec.ts', marker: /(?:incoming-invoice-date-filter|invoice-date-filter)/u,
      paths: ['components/purchases/incoming-documents-workspace.tsx', 'components/purchases/incoming-invoice-date-filter.tsx', 'lib/purchase-documents/invoice-date-filter.ts', 'lib/purchase-documents/service.ts', 'lib/record-search/list-contract.ts'] },
    { spec: 'e2e/backup-file-inspection.spec.ts', marker: /(?:backup-file-inspection|backup-file-preview)/u,
      paths: ['app/api/backup/full/preview/route.ts', 'app/settings/page.tsx', 'components/settings/backup-file-inspection.tsx', 'lib/backup-file-preview.ts'] },
    { spec: 'e2e/public-switching-checklist.spec.ts', marker: /switching-checklist/u,
      paths: ['app/help/page.tsx', 'components/public-accounting/switching-checklist.tsx', 'components/public-accounting/switching-checklist.module.css', 'lib/switching-checklist.ts'] },
  ].filter(packet => exists(packet.spec) && paths.some(source => packet.marker.test(source)));
  // Existing isolated read-only journeys must follow their runtime source even
  // when a later fix does not edit the spec. A missing journey fails closed.
  const readJourneys = [
    { spec: 'e2e/registration-status-retry.spec.ts', source: 'app/register/page.tsx' },
    { spec: 'e2e/invoice-number-check-freshness.spec.ts', source: 'components/dashboard/create-invoice-modal.tsx' },
    { spec: 'e2e/users-list-read-retry.spec.ts', source: 'app/users/page.tsx' },
    ...['components/ui/combobox-options.ts', 'components/ui/combobox.tsx', 'components/ui/dialog.tsx'].map(source => ({ spec: 'e2e/combobox-accessibility.spec.ts', source })),
  ];
  for (const source of [...new Set(paths)]) {
    if (!code(source)) continue;
    if (Object.hasOwn(serverUnitContracts, source)) {
      if (!serverUnitContracts[source].every(file => exists(file))) unknownCritical.add(source);
      if (backupInspectionSources.has(source)) add('e2e/backup-file-inspection.spec.ts', true, source);
      continue;
    }
    const readJourney = readJourneys.find(value => value.source === source);
    if (readJourney) { add(readJourney.spec, true, source); continue; }
    const packet = packets.find(value => value.paths.includes(source) || value.spec === source);
    if (packet) { add(packet.spec, true, source); continue; }
    let mapped = knownInfrastructure(source);
    if (Object.hasOwn(FOCUSED_SPECS, source)) { add(source, true, source); mapped = true; }
    if (/^(?:app\/(?:help|page\.tsx)|components\/(?:public\/|public-accounting\/))/u.test(source)) {
      add('e2e/public-help-fragments.spec.ts', false, source);
      if (/switching|app\/help/u.test(source) && exists('e2e/public-switching-checklist.spec.ts')) add('e2e/public-switching-checklist.spec.ts', false, source);
      mapped = true;
    }
    if (['app/layout.tsx', 'components/app-shell.tsx'].includes(source)) { add('e2e/public-help-fragments.spec.ts', false, source); mapped = true; }
    if (/^(?:app\/(?:login|register)\/|components\/auth\/|lib\/(?:auth|password|session|login-callback))/u.test(source)) mapped = true; // Critical core + unchanged full security CI.
    if (!mapped) {
      if (/^(?:app\/api\/|lib\/|prisma\/|components\/(?:purchases|record-search|bank-csv)\/)/u.test(source)) unknownCritical.add(source);
      else unmappedSourceCount++;
    }
  }
  return { schema: 'bivaro-focused-browser-selection-v1', core: paths.some(code), specs: [...selected].sort().map(file => ({ file, titles: FOCUSED_SPECS[file] })),
    criticalMappingRequired: unknownCritical.size > 0, unknownCriticalCount: unknownCritical.size, unmappedSourceCount };
}
export function validFocusedSelection(value) {
  return shape(value, ['schema', 'core', 'specs', 'criticalMappingRequired', 'unknownCriticalCount', 'unmappedSourceCount']) &&
    value.schema === 'bivaro-focused-browser-selection-v1' && typeof value.core === 'boolean' && typeof value.criticalMappingRequired === 'boolean' &&
    [value.unknownCriticalCount, value.unmappedSourceCount].every(count => Number.isInteger(count) && count >= 0 && count <= 5000) &&
    value.criticalMappingRequired === (value.unknownCriticalCount > 0) && Array.isArray(value.specs) && value.specs.length <= Object.keys(FOCUSED_SPECS).length &&
    new Set(value.specs.map(spec => spec.file)).size === value.specs.length && value.specs.every(spec => shape(spec, ['file', 'titles']) &&
      Object.hasOwn(FOCUSED_SPECS, spec.file) && JSON.stringify(spec.titles) === JSON.stringify(FOCUSED_SPECS[spec.file]));
}
