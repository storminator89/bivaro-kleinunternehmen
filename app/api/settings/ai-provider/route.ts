import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { auditSecurityEvent } from '@/lib/audit-log';
import { getAiProviderSettings, saveAiProviderSettings, validateAiProviderSettingsInput } from '@/lib/ai-provider/settings';
import { aiProviderErrorResponse } from '@/lib/ai-provider/http';

export const runtime = 'nodejs';
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await getAiProviderSettings(userId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return aiProviderErrorResponse(error); }
}
async function putHandler(request: Request) {
  try {
    const userId = await requireUserId();
    const input = validateAiProviderSettingsInput(await request.json());
    const result = await saveAiProviderSettings(userId, input);
    await auditSecurityEvent(userId, { event: 'AI_PROVIDER_SETTINGS_CHANGED', outcome: 'success', severity: 'warning', metadata: { operation: 'update', enabled: result.enabled, autoAnalyzeNewUploads: result.autoAnalyzeNewUploads, version: result.version } });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return aiProviderErrorResponse(error); }
}
export const PUT = protectMutation(putHandler, { maxBodyBytes: 16 * 1024 });
