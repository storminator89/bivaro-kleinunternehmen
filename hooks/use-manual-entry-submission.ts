'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createManualEntryGate, type ManualEntrySubmitState } from '@/lib/manual-entry-submission';

export function useManualEntrySubmission() {
  const gate = useRef<ReturnType<typeof createManualEntryGate> | null>(null);
  if (!gate.current) gate.current = createManualEntryGate();
  const [state, setState] = useState<ManualEntrySubmitState>({ phase: 'idle', message: '' });
  const waiting = useRef<{ token: number; controller: AbortController } | null>(null);
  useEffect(() => {
    const current = gate.current!;
    current.mount();
    return () => {
      current.dispose();
      waiting.current?.controller.abort();
      waiting.current = null;
    };
  }, []);
  const reset = useCallback(() => {
    if (!gate.current!.reset()) return false;
    setState({ phase: 'idle', message: '' });
    return true;
  }, []);
  const releaseAfterCommit = useCallback(() => {
    if (!gate.current!.releaseAfterCommit()) return false;
    setState({ phase: 'idle', message: '' });
    return true;
  }, []);
  return {
    state,
    begin() {
      const token = gate.current!.begin();
      if (token !== null) {
        waiting.current = { token, controller: new AbortController() };
        setState({ phase: 'pending', message: '' });
      }
      return token;
    },
    signal: (token: number) => waiting.current?.token === token ? waiting.current.controller.signal : undefined,
    current: (token: number) => gate.current!.current(token),
    editable: () => gate.current!.editable(),
    settle(token: number, next: ManualEntrySubmitState) {
      if (next.phase === 'pending' || next.phase === 'discarding' || !gate.current!.settle(token, next.phase)) return false;
      waiting.current = null;
      setState(next);
      return true;
    },
    reset,
    releaseAfterCommit,
    stopWaiting() {
      const request = waiting.current;
      if (!request || !gate.current!.settle(request.token, 'unknown')) return false;
      waiting.current = null;
      setState({ phase: 'unknown', message: 'Nur das Warten im Browser wurde beendet. Der Serverauftrag kann weiterlaufen.' });
      // Cancel browser waiting only. Never interpret this as server rollback.
      request.controller.abort();
      return true;
    },
    discard() {
      if (!gate.current!.discard()) return false;
      setState({ phase: 'discarding', message: '' });
      return true;
    },
  };
}
