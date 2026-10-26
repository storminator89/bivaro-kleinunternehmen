import { readServiceArticle, type ServiceArticle } from '@/lib/service-articles';

/** Component-local read generations; never a cache of prices or a write retry. */
export function createArticlePickerScope() {
  let generation = 0, open = false, active = true;
  return {
    mount() { active = true; },
    begin() { open = true; return ++generation; },
    close() { open = false; generation += 1; },
    generation: () => generation,
    current: (request: number) => active && open && request === generation,
    dispose() { active = false; open = false; generation += 1; },
  };
}

export function readPickerArticles(value: unknown): ServiceArticle[] {
  if (!Array.isArray(value)) throw new Error('Ungültiger Artikelkatalog');
  const rows = value.map(readServiceArticle);
  if (rows.some(row => row === null)) throw new Error('Ungültiger Artikelkatalog');
  return rows as ServiceArticle[];
}
