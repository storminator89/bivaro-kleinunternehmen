import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/lib/audit-presentation';

function declaredValues(type: string): string[] {
  const source = readFileSync(new URL('../audit-log.ts', import.meta.url), 'utf8');
  const union = source.match(new RegExp(`export type ${type} =([\\s\\S]*?);`))?.[1] ?? '';
  return [...union.matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
}

describe('audit presentation regression #25', () => {
  it('provides a label for every supported entity and action, including security events', () => {
    expect(Object.keys(AUDIT_ENTITY_LABELS).sort()).toEqual(declaredValues('AuditEntityType'));
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual(declaredValues('AuditAction'));
    expect(AUDIT_ENTITY_LABELS).toMatchObject({ Quote: 'Angebot', CashBook: 'Kassenbuch', CashTransaction: 'Kassenbuchung', SecurityEvent: 'Sicherheitsereignis' });
    expect(AUDIT_ACTION_LABELS.SECURITY_EVENT).toBe('Sicherheitsereignis');
  });

  it('uses the same entity/action catalogue for filters, list and details', () => {
    const source = readFileSync(new URL('../../app/settings/audit-logs/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Object.entries(ENTITY_LABELS).map');
    expect(source).toContain('Object.entries(ACTION_NAMES).map');
    expect(source).toContain('ENTITY_LABELS[log.entityType]');
    expect(source).toContain('ENTITY_LABELS[selectedLog.entityType]');
    expect(source).toContain('ACTION_NAMES[log.action]');
    expect(source).toContain('ACTION_NAMES[selectedLog.action]');
    expect(source).not.toContain('Protokoll aller Änderungen');
  });
});
