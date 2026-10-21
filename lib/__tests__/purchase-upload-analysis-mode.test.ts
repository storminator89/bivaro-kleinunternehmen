import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
const state = vi.hoisted(() => ({ intake: vi.fn(), detect: vi.fn() }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => 'synthetic-queue-owner' }));
vi.mock('@/lib/request-security', () => ({ protectMutation: (handler: unknown) => handler }));
vi.mock('@/lib/processing-limit', () => ({ withProcessingSlot: (_id: string, action: () => unknown) => action() }));
vi.mock('@/lib/purchase-documents/original', () => ({ detectPurchaseContainer: state.detect }));
vi.mock('@/lib/purchase-documents/service', () => ({ intakePurchaseDocument: state.intake, parseUploadRequestId: (value: unknown) => value, listPurchaseDocuments: vi.fn() }));
vi.mock('@/lib/purchase-documents/http', () => ({ purchaseErrorResponse: (error: { status?: number }) => new Response(null, { status: error.status ?? 400 }) }));
import { POST } from '@/app/api/purchase-documents/route';
function request(modes: Array<string | File> = [], files = 1) {
  const form = new FormData();
  for (let i = 0; i < files; i++) form.append('file', new File(['<synthetic/>'], `synthetic-${i}.xml`, { type: 'application/xml' }));
  form.append('uploadRequestId', randomUUID()); for (const mode of modes) form.append('analysisMode', mode);
  return new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form });
}
beforeEach(() => { vi.clearAllMocks(); state.detect.mockResolvedValue('application/xml'); state.intake.mockResolvedValue({ document: { id: 1 }, replayed: false }); });
describe('upload analysis mode is opt-out only; no new consent surface', () => {
  it('keeps the single-file default unchanged when mode is absent', async () => {
    expect((await POST(request())).status).toBe(201);
    expect(state.intake.mock.calls[0][0]).not.toHaveProperty('analysisMode');
  });
  it('passes an explicit manual opt-out before intake', async () => {
    expect((await POST(request(['manual']))).status).toBe(201);
    expect(state.intake.mock.calls[0][0]).toMatchObject({ userId: 'synthetic-queue-owner', analysisMode: 'manual', originalFileName: 'synthetic-0.xml' });
  });
  it.each([['automatic'], [''], ['manual', 'manual'], ['manual', 'automatic']])('rejects unknown/duplicated mode %j before processing', async (...modes) => {
    expect((await POST(request(modes))).status).toBe(400); expect(state.detect).not.toHaveBeenCalled(); expect(state.intake).not.toHaveBeenCalled();
  });
  it('rejects a file masquerading as analysis mode before processing', async () => {
    expect((await POST(request([new File(['manual'], 'mode.txt')]))).status).toBe(400); expect(state.intake).not.toHaveBeenCalled();
  });
  it('never accepts a batch multipart request; the existing one-file server contract stays', async () => {
    expect((await POST(request(['manual'], 2))).status).toBe(400); expect(state.intake).not.toHaveBeenCalled();
  });
});
