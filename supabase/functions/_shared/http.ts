export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Bound streamed bodies and HTTP promises, including transports that ignore abort.
export function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The caller may already have created a rejecting fetch/read promise.
    // Observe it even when cancellation wins before handlers can be attached.
    void promise.catch(() => {});
    return Promise.reject(new Error('Deadline exceeded'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function discard(response: Response) {
  void response.body?.cancel().catch(() => {});
}

export async function readJson(message: Request | Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const length = message.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void message.body?.cancel().catch(() => {});
    throw new Error('Body limit exceeded');
  }
  if (!message.body) throw new Error('Missing body');
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Body limit exceeded');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    void reader.cancel().catch(() => {});
    throw new Error('Invalid body');
  } finally {
    reader.releaseLock();
  }
}
