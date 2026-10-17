export function attachPageTelemetry(page, sink = []) {
  const push = (type, payload = {}) => sink.push({
    at: new Date().toISOString(),
    type,
    ...payload,
  });

  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      push('console', { level: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', error => push('pageerror', { message: error.message, stack: error.stack }));
  page.on('requestfailed', request => push('requestfailed', {
    method: request.method(),
    url: request.url(),
    failure: request.failure()?.errorText ?? 'unknown',
  }));
  page.on('response', response => {
    if (response.status() >= 400) push('http-error', {
      status: response.status(),
      method: response.request().method(),
      url: response.url(),
    });
  });

  return sink;
}
