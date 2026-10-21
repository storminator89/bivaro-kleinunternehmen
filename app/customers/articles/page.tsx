'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatArticlePrice, type ServiceArticle } from '@/lib/service-articles';
export default function ArticlesPage() {
  const [rows, setRows] = useState<ServiceArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { let active = true; fetch('/api/service-articles', { cache: 'no-store' }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; }).then(value => { if (active) setRows(value); }).catch(() => { if (active) setError('Artikel und Leistungen konnten nicht geladen werden. Bitte laden Sie die Seite erneut.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <div className="mx-auto w-full max-w-5xl space-y-6"><PageHeader title="Artikel und Leistungen" actions={<Button asChild><Link href="/customers/import?kind=articles">CSV importieren</Link></Button>} />
    <p className="text-xs text-muted-foreground">Preise netto · EUR</p>
    <Input aria-label="Artikel und Leistungen suchen" placeholder="Artikel oder Leistung suchen …" value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p role="alert" className="rounded-lg border p-4 text-sm text-destructive">{error}</p>}{loading && <p role="status">Katalog wird geladen …</p>}
    <div className="grid gap-3 sm:grid-cols-2">{rows.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase())).map(row => <article id={`article-${row.id}`} key={row.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5"><h2 className="break-words text-lg font-semibold">{row.name}</h2>{row.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{row.description}</p>}<p className="text-xl font-semibold tabular-nums">{formatArticlePrice(row.unitPriceCents)} <span className="text-sm font-normal text-muted-foreground">netto / {row.unit}</span></p><p className="text-xs text-muted-foreground">Quelle: {formatArticlePrice(row.sourcePriceCents)} {row.sourcePriceBasis === 'GROSS' ? 'brutto' : 'netto'} · {row.taxRate} % Steuer</p></article>)}</div>
    {!loading && !error && rows.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><h2 className="font-semibold">Noch keine Artikel oder Leistungen</h2><Button className="mt-4" asChild><Link href="/customers/import?kind=articles">Artikel und Leistungen importieren</Link></Button></div>}
    <Link href="/customers" className="inline-block text-sm underline underline-offset-4">Zur Kundenverwaltung</Link>
  </div>;
}
