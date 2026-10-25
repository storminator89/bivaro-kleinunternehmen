'use client';

import { useRef } from 'react';
import { restoreRecordDetailFocus } from '@/lib/record-search/detail-focus';
import { captureServiceDialogOpener } from '@/components/service-billing/service-dialog-focus';

/** Programmatic row dialogs have no Radix DialogTrigger to restore by default. */
export function useRecordDetailFocus() {
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  return {
    // Keep the closing content reference until Radix's deferred autofocus runs.
    ref: (node: HTMLDivElement | null) => { if (node) content.current = node; },
    onOpenAutoFocus: () => { opener.current = captureServiceDialogOpener(document); },
    onCloseAutoFocus: (event: Event) => { event.preventDefault(); restoreRecordDetailFocus(opener.current, content.current); },
  };
}
