'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import styles from './articles-workspace.module.css';
import { formatArticlePrice, type ServiceArticle } from '@/lib/service-articles';
export default function ArticlesPage() {
  const [rows, setRows] = useState<ServiceArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { let active = true; fetch('/api/service-articles', { cache: 'no-store' }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; }).then(value => { if (active) setRows(value); }).catch(() => { if (active) setError('Artikel und Leistungen konnten nicht geladen werden. Bitte laden Sie die Seite erneut.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return (
    <div className={styles.workspace}>
      <PageHeader title="Artikel und Leistungen" actions={<Button asChild><Link href="/customers/import?kind=articles">CSV importieren</Link></Button>} />
      <div className={styles.toolbar}>
        <Input className={styles.search} aria-label="Artikel und Leistungen suchen" placeholder="Artikel oder Leistung suchen …" value={query} onChange={event => setQuery(event.target.value)} />
        <p className={styles.priceNote}>Preise netto · EUR</p>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading && <p role="status" className={styles.loading}>Katalog wird geladen …</p>}
      <div className={styles.catalog}>
        {rows.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase())).map(row => (
          <article id={`article-${row.id}`} key={row.id} className={styles.record}>
            <div className={styles.identity}>
              <h2>{row.name}</h2>
              {row.description && <p className={styles.description}>{row.description}</p>}
            </div>
            <p className={styles.price}>
              {formatArticlePrice(row.unitPriceCents)} <span>netto / {row.unit}</span>
            </p>
            <p className={styles.source}>Quelle: {formatArticlePrice(row.sourcePriceCents)} {row.sourcePriceBasis === 'GROSS' ? 'brutto' : 'netto'} · {row.taxRate} % Steuer</p>
          </article>
        ))}
      </div>
      {!loading && !error && rows.length === 0 && (
        <div className={styles.empty}>
          <h2>Noch keine Artikel oder Leistungen</h2>
          <Button asChild><Link href="/customers/import?kind=articles">Artikel und Leistungen importieren</Link></Button>
        </div>
      )}
      <Link href="/customers" className={styles.backLink}>Zur Kundenverwaltung</Link>
    </div>
  );
}
