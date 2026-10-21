/** Messages are intentionally static: provider bodies, addresses and keys must not escape. */
export class AiProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly requestMayHaveBeenSent = false) {
    super(message);
    this.name = 'AiProviderError';
  }
}
