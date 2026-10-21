import type { Metadata } from 'next';
import { HandoffWorkspace } from '@/components/handoff/handoff-workspace';
import { initialHandoffSelection } from '@/components/handoff/handoff-model';

export const metadata: Metadata = { title: 'Unterlagen übergeben – Bivaro' };

export default async function HandoffPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['year', 'from', 'to']) {
    const value = values[key];
    if (typeof value === 'string') params.set(key, value);
  }
  const currentYear = String(new Date().getUTCFullYear());
  return <HandoffWorkspace key={params.toString()} initialSelection={initialHandoffSelection(params, currentYear)} currentYear={currentYear} />;
}
