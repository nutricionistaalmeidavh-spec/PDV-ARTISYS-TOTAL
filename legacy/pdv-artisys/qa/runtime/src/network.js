const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH']);

export async function retryTransient(fn, { attempts = 3, delayMs = 250, isRetryable } = {}) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts must be >= 1');
  const retryable = isRetryable || (error => TRANSIENT_CODES.has(error?.code));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function runConcurrent(terminals, worker) {
  if (!Array.isArray(terminals) || !terminals.length) throw new TypeError('terminals must be a non-empty array');
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  return Promise.all(terminals.map((terminal, index) => worker(terminal, index)));
}
