export const QA_PROGRESS_PREFIX = 'ARTISYS_QA_EVENT=';

export function formatQaProgressEvent(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('progress event must be an object');
  return `${QA_PROGRESS_PREFIX}${JSON.stringify(event)}`;
}

export function createQaProgressParser(onEvent) {
  if (typeof onEvent !== 'function') throw new TypeError('onEvent callback required');
  let buffer = '';

  function consume(line) {
    if (!line.startsWith(QA_PROGRESS_PREFIX)) return;
    const raw = line.slice(QA_PROGRESS_PREFIX.length);
    try {
      const event = JSON.parse(raw);
      if (event && typeof event === 'object' && !Array.isArray(event)) onEvent(event);
    } catch {
      // Malformed instrumentation is ignored and must not affect QA execution.
    }
  }

  return {
    push(chunk) {
      buffer += String(chunk ?? '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    },
    flush() {
      if (buffer) consume(buffer);
      buffer = '';
    },
  };
}
