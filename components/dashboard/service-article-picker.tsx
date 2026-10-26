'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatArticlePrice, type ServiceArticle } from '@/lib/service-articles';
import { createArticlePickerScope, readPickerArticles } from './service-article-picker-state';
export type SelectedServiceArticle = { description: string; unit: string; unitPrice: number; taxRate: number };
export function ServiceArticlePicker({ onSelect }: { onSelect: (article: SelectedServiceArticle) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const scope = useRef<ReturnType<typeof createArticlePickerScope> | null>(null);
  if (!scope.current) scope.current = createArticlePickerScope();
  const [result, setResult] = useState<{ generation: number; status: 'closed' | 'loading' | 'ready' | 'error'; rows: ServiceArticle[] }>({ generation: 0, status: 'closed', rows: [] });
  useEffect(() => {
    const current = scope.current!;
    current.mount();
    return () => current.dispose();
  }, []);
  const begin = () => {
    const generation = scope.current!.begin();
    // Synchronous generation invalidation also rejects a queued click on the
    // previous rendered row, before React has committed its removal.
    setResult({ generation, status: 'loading', rows: [] });
    setReload(current => current + 1);
    setOpen(true);
  };
  const close = () => {
    scope.current!.close();
    setOpen(false);
    setResult({ generation: scope.current!.generation(), status: 'closed', rows: [] });
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    const current = scope.current!;
    const generation = current.generation();
    const controller = new AbortController();
    fetch('/api/service-articles', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Artikelkatalog nicht verfügbar');
        return readPickerArticles(await response.json());
      })
      .then(rows => { if (active && current.current(generation)) setResult({ generation, status: 'ready', rows }); })
      .catch(() => { if (active && current.current(generation)) setResult({ generation, status: 'error', rows: [] }); });
    return () => { active = false; controller.abort(); };
  }, [open, reload]);
  const ready = open && result.status === 'ready' && scope.current.current(result.generation);
  const rows = ready ? result.rows : [];
  const select = (row: ServiceArticle) => {
    if (result.status !== 'ready' || !scope.current!.current(result.generation)) return;
    // Preserve the existing explicit net-price copy and document-owned tax mode.
    onSelect({ description: row.description || row.name, unit: row.unit, unitPrice: Number(row.unitPriceCents) / 100, taxRate: Number(row.taxRate) });
    close();
  };
  return <div className="my-4 rounded-lg border bg-muted/15 p-3"><Button type="button" variant="outline" aria-expanded={open} onClick={() => { if (open) close(); else begin(); }}>Aus Artikelkatalog übernehmen</Button>{open && <div className="mt-3 space-y-3" aria-busy={result.status === 'loading'}>
    <p className="text-xs text-muted-foreground">Es wird eine neue Position mit dem gespeicherten Netto-Einzelpreis ergänzt. Der Steuer-Modus dieses Dokuments bleibt unverändert. Der Quellen-Steuersatz wird angezeigt, aber nicht automatisch übernommen; bitte die neue Position prüfen.</p>
    <Input aria-label="Artikelkatalog durchsuchen" value={query} onChange={event => setQuery(event.target.value)} placeholder="Artikel oder Leistung suchen" />
    {result.status === 'error' && <div role="alert" className="space-y-2 text-sm text-destructive"><p>Der Katalog konnte nicht geladen werden. Frühere Preise können nicht übernommen werden.</p><Button type="button" variant="outline" onClick={begin}>Katalog erneut laden</Button></div>}
    {result.status === 'loading' && <p role="status" className="text-sm text-muted-foreground">Katalog wird geladen …</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto">{rows.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE'))).map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-3"><div className="min-w-0 text-sm"><p className="break-words font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{formatArticlePrice(row.unitPriceCents)} netto / {row.unit} · Quelle {row.taxRate} %</p></div><Button type="button" size="sm" variant="outline" aria-label={`${row.name} als Position übernehmen`} onClick={() => select(row)}>Übernehmen</Button></div>)}</div>
    {ready && rows.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Artikel oder Leistungen vorhanden.</p>}<Link href="/customers/articles" className="text-sm underline underline-offset-4">Artikelkatalog öffnen / CSV importieren</Link>
  </div>}</div>;
}
