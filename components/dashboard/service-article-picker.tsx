'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatArticlePrice, type ServiceArticle } from '@/lib/service-articles';
export type SelectedServiceArticle = { description: string; unit: string; unitPrice: number; taxRate: number };
export function ServiceArticlePicker({ onSelect }: { onSelect: (article: SelectedServiceArticle) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ServiceArticle[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/service-articles', { cache: 'no-store' }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; }).then(value => { if (active) { setRows(value); setLoaded(true); } }).catch(() => { if (active) setError('Der Katalog konnte nicht geladen werden. Bitte schließen und erneut öffnen.'); });
    return () => { active = false; };
  }, [open]);
  return <div className="my-4 rounded-lg border bg-muted/15 p-3"><Button type="button" variant="outline" aria-expanded={open} onClick={() => { setOpen(value => !value); setError(''); }}>Aus Artikelkatalog übernehmen</Button>{open && <div className="mt-3 space-y-3">
    <p className="text-xs text-muted-foreground">Es wird eine neue Position mit dem gespeicherten Netto-Einzelpreis ergänzt. Der Steuer-Modus dieses Dokuments bleibt unverändert. Der Quellen-Steuersatz wird angezeigt, aber nicht automatisch übernommen; bitte die neue Position prüfen.</p>
    <Input aria-label="Artikelkatalog durchsuchen" value={query} onChange={event => setQuery(event.target.value)} placeholder="Artikel oder Leistung suchen" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loaded && !error && <p role="status" className="text-sm text-muted-foreground">Katalog wird geladen …</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto">{rows.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase('de-DE').includes(query.toLocaleLowerCase('de-DE'))).map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-3"><div className="min-w-0 text-sm"><p className="break-words font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{formatArticlePrice(row.unitPriceCents)} netto / {row.unit} · Quelle {row.taxRate} %</p></div><Button type="button" size="sm" variant="outline" aria-label={`${row.name} als Position übernehmen`} onClick={() => { onSelect({ description: row.description || row.name, unit: row.unit, unitPrice: Number(row.unitPriceCents) / 100, taxRate: Number(row.taxRate) }); setOpen(false); }}>Übernehmen</Button></div>)}</div>
    {loaded && rows.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Artikel oder Leistungen vorhanden.</p>}<Link href="/customers/articles" className="text-sm underline underline-offset-4">Artikelkatalog öffnen / CSV importieren</Link>
  </div>}</div>;
}
