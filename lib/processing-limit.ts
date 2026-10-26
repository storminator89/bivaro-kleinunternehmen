/** Reject overload immediately; never queue unbounded document buffers in memory. */
export class ProcessingCapacityError extends Error {
  readonly status = 429;
  constructor() { super('Die Dokumentverarbeitung ist ausgelastet. Bitte später erneut versuchen.'); }
}

let activeJobs = 0;
const activeUsers = new Map<string, { idempotencyKey?: string; finished: Promise<void> }>();
const MAX_PROCESSING_JOBS = 2;
const MAX_PENDING_RETRIES = 2;
const waitingUsers = new Set<string>();

/** Per-process safety limit. Multiple replicas each have their own capacity. */
export async function withProcessingSlot<T>(
  userId: string | undefined,
  work: () => Promise<T>,
  idempotencyKey?: string,
): Promise<T> {
  let waitingUser: string | undefined;
  try {
    while (userId && activeUsers.has(userId)) {
      const active = activeUsers.get(userId)!;
      if (!idempotencyKey || active.idempotencyKey !== idempotencyKey) throw new ProcessingCapacityError();
      if (!waitingUser) {
        // Retain one supported retry per owner, never an unbounded queue of
        // callbacks holding document buffers. The global cap also covers the
        // handoff between a finished job and its waiting retry.
        if (waitingUsers.has(userId) || waitingUsers.size >= MAX_PENDING_RETRIES) throw new ProcessingCapacityError();
        waitingUsers.add(userId);
        waitingUser = userId;
      }
      await active.finished;
    }
  } finally {
    if (waitingUser) waitingUsers.delete(waitingUser);
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
