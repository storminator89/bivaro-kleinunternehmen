import { restoreServiceDialogOpener } from '@/components/service-billing/service-dialog-focus';

/** Never restore a detached row or take focus from a newer control/chooser. */
export function restoreRecordDetailFocus(opener: HTMLElement | null, content: HTMLElement | null, owner: Pick<Document, 'activeElement' | 'body'> = document) {
  const active = owner.activeElement;
  if (!active || active === owner.body || content?.contains(active)) restoreServiceDialogOpener(opener);
}
