import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFirstAccessFlowSteps } from './first-access-flow.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_FLOW_ROOT = path.resolve(MODULE_DIR, '../flows');

function validateFlow(flow, label = 'flow') {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new TypeError(`${label} must be an object`);
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) throw new TypeError(`${label} must contain steps`);
  return flow;
}

export async function loadFlowFile(file) {
  const absolute = path.resolve(file);
  const parsed = JSON.parse(await fs.readFile(absolute, 'utf8'));
  return { flow: validateFlow(parsed, `Flow ${absolute}`), file: absolute };
}

async function resolveIncludedFlow(reference, options, sourceFile) {
  const custom = options.customLibrary;
  if (custom instanceof Map && custom.has(reference)) {
    const flow = validateFlow(structuredClone(custom.get(reference)), `Flow ${reference}`);
    return { flow, id: flow.id || reference, file: null };
  }

  const libraryRoot = options.libraryRoot ? path.resolve(options.libraryRoot) : BUILTIN_FLOW_ROOT;
  let file;
  if (reference.startsWith('common/') && !path.extname(reference)) {
    file = path.join(libraryRoot, `${reference}.json`);
  } else if (path.isAbsolute(reference)) {
    file = reference;
  } else {
    const base = sourceFile ? path.dirname(sourceFile) : options.rootDir ? path.resolve(options.rootDir) : process.cwd();
    file = path.resolve(base, reference);
  }
  const loaded = await loadFlowFile(file);
  return { flow: loaded.flow, id: loaded.flow.id || loaded.file, file: loaded.file };
}

async function expandFlow(flow, options, sourceFile, stack) {
  const steps = [];
  for (const step of flow.steps) {
    if (step && typeof step === 'object' && !Array.isArray(step) && step.uses) {
      if (typeof step.uses !== 'string' || !step.uses) throw new TypeError('Flow uses must be a non-empty string');
      const included = await resolveIncludedFlow(step.uses, options, sourceFile);
      if (stack.includes(included.id)) {
        throw new Error(`Flow composition cycle detected: ${[...stack, included.id].join(' -> ')}`);
      }
      const expanded = await expandFlow(included.flow, options, included.file, [...stack, included.id]);
      steps.push(...expanded.steps);
    } else {
      steps.push(structuredClone(step));
    }
  }
  return { ...structuredClone(flow), steps };
}

export async function resolveFlowComposition(flow, options = {}) {
  validateFlow(flow);
  const sourceFile = options.sourceFile ? path.resolve(options.sourceFile) : null;
  const rootId = flow.id || sourceFile || '<root>';
  const expanded = await expandFlow(flow, options, sourceFile, [rootId]);
  const steps = normalizeFirstAccessFlowSteps(expanded.steps);
  return steps === expanded.steps ? expanded : { ...expanded, steps };
}
