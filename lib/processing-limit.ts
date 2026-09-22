/** Reject overload immediately; never queue unbounded document buffers in memory. */
export class ProcessingCapacityError extends Error {
  readonly status = 429;
  constructor() { super('Die Dokumentverarbeitung ist ausgelastet. Bitte später erneut versuchen.'); }
}

let activeJobs = 0;
const activeUsers = new Map<string, { idempotencyKey?: string; finished: Promise<void> }>();
const MAX_PROCESSING_JOBS = 2;

/** Per-process safety limit. Multiple replicas each have their own capacity. */
export async function withProcessingSlot<T>(
  userId: string | undefined,
  work: () => Promise<T>,
  idempotencyKey?: string,
): Promise<T> {
  while (userId && activeUsers.has(userId)) {
    const active = activeUsers.get(userId)!;
    if (!idempotencyKey || active.idempotencyKey !== idempotencyKey) throw new ProcessingCapacityError();
    await active.finished;
  }
  if (activeJobs >= MAX_PROCESSING_JOBS) throw new ProcessingCapacityError();

  activeJobs++;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  if (userId) activeUsers.set(userId, { idempotencyKey, finished });
  try {
    return await work();
  } finally {
    activeJobs--;
    if (userId && activeUsers.get(userId)?.finished === finished) activeUsers.delete(userId);
    finish();
  }
}
