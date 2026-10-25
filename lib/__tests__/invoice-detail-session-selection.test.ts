import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from '@/types/dashboard';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], queue: [] as (() => void)[], dirty: false }));
type Effect = { deps?: unknown[]; cleanup?: () => void };
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { const next = typeof value === 'function' ? value(hooks.slots[index]) : value; hooks.dirty = !Object.is(next, hooks.slots[index]); hooks.slots[index] = next; }];
  },
  useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useCallback(callback: unknown) { return callback; },
  useLayoutEffect(callback: () => (() => void) | void, deps?: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as Effect | undefined;
    if (!previous || !deps || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) {
      const effect: Effect = { deps }; hooks.slots[index] = effect;
      hooks.queue.push(() => { previous?.cleanup?.(); effect.cleanup = callback() || undefined; });
    }
  },
}));
const auth = vi.hoisted(() => ({ status: 'authenticated', session: { user: { id: 'owner', role: 'USER', sessionVersion: 1 }, expires: '2026-10-25T18:00:00Z' } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: auth.session, status: auth.status }) }));
import { useInvoiceDetailSelection } from '@/hooks/use-invoice-detail-selection';
let value: ReturnType<typeof useInvoiceDetailSelection>;
const invoice: Invoice = { id: 1, fileName: 'synthetic.pdf', uploadedAt: '2026-10-25', status: 'DRAFT', invoiceNumber: 'SYNTHETIC-OWNER' };
function RenderSelection(effects = true) {
  hooks.cursor = 0; hooks.dirty = false; value = useInvoiceDetailSelection();
  if (effects) { hooks.queue.splice(0).forEach(run => run()); if (hooks.dirty) RenderSelection(); }
}
function cleanup() { for (const slot of hooks.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot) (slot as Effect).cleanup?.(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.queue = []; hooks.dirty = false;
  auth.status = 'authenticated'; auth.session = { user: { id: 'owner', role: 'USER', sessionVersion: 1 }, expires: '2026-10-25T18:00:00Z' };
  RenderSelection();
});
afterEach(cleanup);
describe('selected invoice detail session boundary', () => {
  it('preserves the same owner selection across ordinary expiry refresh and supports explicit close', () => {
    value[1](invoice); RenderSelection(); expect(value[0]).toBe(invoice);
    auth.session = { ...auth.session, expires: '2026-10-25T19:00:00Z' }; RenderSelection(); expect(value[0]).toBe(invoice);
    value[1](previous => previous ? { ...previous, invoiceNumber: 'SYNTHETIC-UPDATED' } : null); RenderSelection(); expect(value[0]?.invoiceNumber).toBe('SYNTHETIC-UPDATED');
    value[1](null); RenderSelection(); expect(value[0]).toBe(null);
  });
  it.each(['id', 'role', 'sessionVersion', 'logout'])('hides synchronously, disposes and rejects an obsolete setter on %s change', field => {
    value[1](invoice); RenderSelection(); const previousSelect = value[1];
    if (field === 'id') auth.session = { ...auth.session, user: { ...auth.session.user, id: 'new-owner' } };
    if (field === 'role') auth.session = { ...auth.session, user: { ...auth.session.user, role: 'ADMIN' } };
    if (field === 'sessionVersion') auth.session = { ...auth.session, user: { ...auth.session.user, sessionVersion: 2 } };
    if (field === 'logout') auth.status = 'unauthenticated';
    RenderSelection(false); expect(value[0]).toBe(null); previousSelect(invoice); expect(hooks.dirty).toBe(false);
    hooks.queue.splice(0).forEach(run => run()); RenderSelection(); expect(value[0]).toBe(null);
    if (field !== 'logout') { const current = { ...invoice, id: 2, invoiceNumber: 'SYNTHETIC-NEW-OWNER' }; value[1](current); RenderSelection(); expect(value[0]).toBe(current); }
  });
  it('rejects a retained action after the detail owner unmounts', () => {
    const select = value[1]; cleanup(); select(invoice); expect(hooks.dirty).toBe(false);
  });
});
