import { Loader2, RefreshCw, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function QueryFeedback({ noun, isError, onRetry }: { noun: string; isError: boolean; onRetry: () => void }) {
  return isError ? <div role="alert" className="query-feedback query-feedback-error">
    <CircleAlert aria-hidden="true" /><p>{noun} konnten nicht geladen werden.</p>
    <Button variant="outline" onClick={onRetry}><RefreshCw aria-hidden="true" />Erneut laden</Button>
  </div> : <div role="status" className="query-feedback"><Loader2 className="animate-spin" aria-hidden="true" /><p>{noun} werden geladen…</p></div>;
}
