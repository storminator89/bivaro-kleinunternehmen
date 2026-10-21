"use client";

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { publicAccessCopy, registrationAccessState, type PublicAccessState } from './pilot-guides';
import styles from './pilot-public.module.css';

export function PilotAccess() {
  const { status } = useSession();
  const [access, setAccess] = useState<PublicAccessState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    async function checkAccess() {
      try {
        const response = await fetch('/api/auth/registration-status', { cache: 'no-store', signal: controller.signal });
        const next = response.ok ? registrationAccessState(await response.json()) : 'unavailable';
        if (active) setAccess(next);
      } catch {
        if (active) setAccess('unavailable');
      } finally {
        clearTimeout(timeout);
      }
    }
    void checkAccess();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [status, attempt]);

  const copy = status === 'authenticated'
    ? { title: 'Ihr Arbeitsbereich ist erreichbar', description: 'Sie sind angemeldet. Die Aufgabenhilfe bleibt auch während Ihrer Arbeit verfügbar.', href: '/dashboard', label: 'Dashboard öffnen' }
    : publicAccessCopy[access];

  return <div className={styles.access}>
    <div aria-live="polite"><h3>{copy.title}</h3><p>{copy.description}</p></div>
    <div className={styles.actions}>
      <Button asChild><Link href={copy.href}>{copy.label}</Link></Button>
      {status === 'unauthenticated' && access === 'unavailable' && <Button variant="outline" onClick={() => { setAccess('checking'); setAttempt(value => value + 1); }}>Status erneut prüfen</Button>}
    </div>
  </div>;
}
