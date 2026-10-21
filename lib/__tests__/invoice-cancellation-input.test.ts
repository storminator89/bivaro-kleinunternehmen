import { describe, expect, it } from 'vitest';
import { cancellationReasonInput, MAX_CANCELLATION_REASON_LENGTH } from '@/lib/invoice-cancellation-input';

describe('explicit human cancellation reason', () => {
  it('preserves normal multiline text and normalizes line endings, not meaning', () => {
    expect(cancellationReasonInput('  Erste Begründung\r\nZweite Zeile\rDritte Zeile  ')).toEqual({ ok: true, value: 'Erste Begründung\nZweite Zeile\nDritte Zeile' });
  });
  it('shares the exact 1000-character UI/API bound', () => {
    expect(MAX_CANCELLATION_REASON_LENGTH).toBe(1000);
    expect(cancellationReasonInput('x'.repeat(1000)).ok).toBe(true);
    expect(cancellationReasonInput('x'.repeat(1001)).ok).toBe(false);
  });
  it.each([undefined, null, '', ' \n\t ', false, 12, [], {}, 'unsafe\u0000reason', 'unsafe\treason', 'unsafe\u007freason'])('rejects invalid reason %j', value => {
    expect(cancellationReasonInput(value).ok).toBe(false);
  });
});
