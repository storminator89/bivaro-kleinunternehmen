/** Reject overload immediately; never queue unbounded document buffers in memory. */
export class ProcessingCapacityError extends Error {
  readonly status = 429;
  constructor() { super('Die Dokumentverarbeitung ist ausgelastet. Bitte später erneut versuchen.'); }
}

let activeJobs = 0;
const activeUsers = new Set<string>();
const MAX_PROCESSING_JOBS = 2;

/** Per-process safety limit. Multiple replicas each have their own capacity. */
export async function withProcessingSlot<T>(userId: string | undefined, work: () => Promise<T>): Promise<T> {
  if (activeJobs >= MAX_PROCESSING_JOBS || (userId && activeUsers.has(userId))) throw new ProcessingCapacityError();
  activeJobs++;
  if (userId) activeUsers.add(userId);
  try {
    return await work();
  } finally {
    activeJobs--;
    if (userId) activeUsers.delete(userId);
  }
}
