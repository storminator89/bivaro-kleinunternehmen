"use client";

import { copyAdminText } from "@/components/settings/copy-admin-text";

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from '@/components/settings/admin-workspace.module.css';

export function CodeExample({ code, id }: { code: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function copyCode() {
    setError('');
    try {
      await copyAdminText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kopieren nicht möglich. Markieren und kopieren Sie das Beispiel manuell.');
    }
  }

  return (
    <div className={styles.codeBlock}>
      <pre><code>{code}</code></pre>
      <Button
        variant="ghost"
        size="icon"
        className={styles.copyButton}
        aria-label={copied ? 'Beispiel kopiert' : `Codebeispiel ${id} kopieren`}
        onClick={copyCode}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <p role="status" className={error ? styles.copyFeedback : 'sr-only'}>{error || (copied ? 'Beispiel kopiert.' : '')}</p>
    </div>
  );
}
