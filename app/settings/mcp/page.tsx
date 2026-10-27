import Link from 'next/link';
import { requireUserId } from '@/lib/get-user-id';
import { mcpConfig } from '@/lib/mcp/config';
import { PageHeader } from '@/components/page-header';
import { McpAccess } from '@/components/settings/mcp-access';

export const dynamic = 'force-dynamic';
export default async function McpPage() {
  await requireUserId();
  let config = null;
  let error = false;
  try { config = mcpConfig(); } catch { error = true; }
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
    <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground">← Einstellungen</Link>
    <PageHeader title="Agent-Zugang" />
    <section className="space-y-4 rounded-xl border bg-card p-5 md:p-6" aria-labelledby="mcp-endpoint-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="mcp-endpoint-title" className="text-lg font-semibold">MCP im Netzwerk</h2><span className={`rounded-full px-3 py-1 text-sm ${config ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{config ? 'Aktiv' : error ? 'Konfiguration prüfen' : 'Deaktiviert'}</span></div>
      {config ? <><p className="break-all rounded-lg bg-muted/40 p-3 font-mono text-sm">{config.url}</p><p className="text-sm text-muted-foreground">Streamable HTTP · API-Schlüssel{config.oauth ? ' oder OAuth' : ''}</p>{config.url.startsWith('http:') && <p className="text-sm text-caution-foreground">Unverschlüsselter LAN-Modus. HTTPS oder einen verschlüsselten Tunnel verwenden.</p>}</> : <p className="text-sm text-muted-foreground">Am Server BIVARO_MCP_ENABLED=1 und BIVARO_MCP_URL setzen.</p>}
      <details className="border-t pt-3"><summary className="cursor-pointer py-2 text-sm">Agent verbinden</summary><div className="space-y-3 py-3 text-sm"><p>Transport: Streamable HTTP. Endpunkt oben eintragen. Schlüssel als Bearer-Token hinterlegen.</p><p>Nur eigene Geschäftsdaten. Schreibzugriff gilt ausschließlich für die angebotenen Werkzeuge.</p><p>OAuth ist optional und benötigt einen konfigurierten Anbieter sowie HTTPS.</p><p>Server-Einrichtung und Client-Beispiele: docs/mcp.md im Repository.</p></div></details>
    </section>
    <McpAccess enabled={!!config} writes={!!config?.writes} />
  </div>;
}
