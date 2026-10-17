import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFrameRecorder } from '../qa/runtime/src/video.js';
import fsSync from 'node:fs';

function deadline(promise, timeoutMs = 500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`deadline exceeded after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

test('frame recorder disables video instead of hanging when screenshot capture stalls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artisys-qa-video-timeout-'));
  let screenshotCalls = 0;
  const page = {
    screenshot() {
      screenshotCalls += 1;
      return new Promise(() => {});
    },
  };

  try {
    const recorder = createFrameRecorder(page, { dir, fps: 8, captureTimeoutMs: 25 });
    await deadline(recorder.start());
    const output = await deadline(recorder.stop(path.join(dir, 'video.mp4')));

    assert.equal(output, null);
    assert.equal(screenshotCalls, 1, 'a timed-out capture must disable further frame attempts');
    const diagnostic = await fs.readFile(path.join(dir, 'VIDEO_CAPTURE_DISABLED.txt'), 'utf8');
    assert.match(diagnostic, /timed out/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Electron QA starts frame recording only after authentication readiness', () => {
  const source = fsSync.readFileSync(new URL('../qa/runtime/src/runner.js', import.meta.url), 'utf8');
  const readinessGate = source.indexOf("['authenticated','app-ready'].includes(step.name)");
  const recorderStart = source.indexOf('frameRecorder.start()');
  assert.ok(readinessGate >= 0);
  assert.ok(recorderStart > readinessGate);
});
