'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { copyAdminText } from './copy-admin-text';

type Access = { id: number; name: string; scopes: string[]; isActive: boolean; keyPrefix: string; expiresAt: string | null };
export function McpAccess({ enabled, writes }: { enabled: boolean; writes: boolean }) {
  const [keys, setKeys] = useState<Access[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setKeys(null);
    try {
      const response = await fetch('/api/api-keys', { signal });
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.every(row => row && Number.isInteger(row.id) && typeof row.name === 'string' && typeof row.keyPrefix === 'string' && typeof row.isActive === 'boolean' && Array.isArray(row.scopes) && row.scopes.every((scope: unknown) => typeof scope === 'string'))) throw new Error();
      if (!signal?.aborted) setKeys((data as Access[]).filter(row => row.scopes.includes('mcp:read')));
    } catch { if (!signal?.aborted) setError('Zugänge konnten nicht geladen werden.'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSecret(''); setCopied(false);
    try {
      const response = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes: write ? ['mcp:read', 'mcp:write'] : ['mcp:read'], expiresInDays: 90 }) });
      const body = await response.json();
      if (!response.ok || typeof body.key !== 'string') throw new Error(body.error || 'Zugang konnte nicht erstellt werden. Liste vor erneutem Versuch prüfen.');
      setSecret(body.key); setName(''); setWrite(false); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Zugang konnte nicht erstellt werden.'); }
    finally { setBusy(false); }
  }
  async function toggle(access: Access) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/api-keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: access.id, isActive: !access.isActive }) });
      if (!response.ok) throw new Error();
      await load();
    } catch { setError('Zugang konnte nicht geändert werden.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5 rounded-xl border bg-card p-5 md:p-6" aria-labelledby="mcp-access-title">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mcp-access-title" className="text-lg font-semibold">Zugänge</h2><Link href="/settings/api-keys" className="text-sm underline underline-offset-4">Alle API-Schlüssel</Link></div>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{keys === null && <Button variant="outline" disabled={busy} onClick={() => { setError(''); void load(); }}>Erneut laden</Button>}</div>}
    {!error && keys === null && <p role="status" className="text-sm text-muted-foreground">Zugänge laden…</p>}
    {keys && <ul className="divide-y">{keys.length === 0 && <li className="py-3 text-sm text-muted-foreground">Noch kein Agent verbunden.</li>}{keys.map(access => <li key={access.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{access.name}</p><p className="text-xs text-muted-foreground">{access.keyPrefix} · {access.scopes.includes('mcp:write') ? writes ? 'Lesen + Schreiben' : 'Schreiben am Server gesperrt' : 'Nur lesen'} · {access.isActive ? 'Aktiv' : 'Deaktiviert'}</p></div><Button variant="outline" disabled={busy} onClick={() => void toggle(access)}>{access.isActive ? 'Deaktivieren' : 'Aktivieren'}</Button></li>)}</ul>}
    <form onSubmit={create} className="space-y-4 border-t pt-5">
      <div className="space-y-2"><Label htmlFor="mcp-name">Agent-Name</Label><Input id="mcp-name" placeholder="z. B. Arbeitsrechner" value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy || !enabled} /></div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={write} disabled={!writes || busy || !enabled} onChange={event => setWrite(event.target.checked)} />Schreiben erlauben</label>
      {!writes && <p className="text-xs text-muted-foreground">Schreibzugriff ist am Server gesperrt.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy || !enabled || !name.trim()}>{busy ? 'Bitte warten…' : 'Zugang erstellen'}</Button><span className="text-xs text-muted-foreground">90 Tage gültig</span></div>
    </form>
    {secret && <div role="status" className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4"><p className="text-sm font-medium">Schlüssel jetzt kopieren. Er wird nur einmal angezeigt.</p><code className="block break-all text-xs">{secret}</code><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={async () => { try { await copyAdminText(secret); setCopied(true); } catch { setError('Kopieren fehlgeschlagen. Schlüssel manuell markieren und kopieren.'); } }}>{copied ? 'Kopiert' : 'Schlüssel kopieren'}</Button><Button variant="ghost" onClick={() => setSecret('')}>Ausblenden</Button></div></div>}
  </section>;
}
