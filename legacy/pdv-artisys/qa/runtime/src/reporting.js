import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writeJson } from './helpers.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function aggregateQaReport({ systemId, profile, runs = [], gate = null } = {}) {
  const normalized = runs.map(run => ({ ...run, status: run.status || run.summary?.status || 'unknown' }));
  const counts = normalized.reduce((acc, run) => {
    acc.total += 1;
    if (run.status === 'passed') acc.passed += 1;
    else if (run.status === 'failed') acc.failed += 1;
    else acc.other += 1;
    return acc;
  }, { total: 0, passed: 0, failed: 0, other: 0 });
  return { schemaVersion: 1, systemId, profile, generatedAt: new Date().toISOString(), counts, gate, runs: normalized };
}

export function renderQaReportHtml(report) {
  const rows = report.runs.map(run => `<tr><td>${esc(run.flow || run.check)}</td><td>${esc(run.status)}</td><td>${esc(run.durationMs ?? run.summary?.durationMs ?? '')}</td><td>${esc(run.error || run.summary?.failure?.message || '')}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtiSys QA Report</title><style>body{font-family:system-ui,sans-serif;margin:32px;max-width:1000px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}.ok{color:green}.bad{color:#b00020}</style></head><body><h1>ArtiSys QA Report</h1><p><strong>Sistema:</strong> ${esc(report.systemId)} · <strong>Perfil:</strong> ${esc(report.profile)}</p><p>Total ${report.counts.total} · <span class="ok">Passou ${report.counts.passed}</span> · <span class="bad">Falhou ${report.counts.failed}</span></p><table><thead><tr><th>Fluxo/check</th><th>Status</th><th>ms</th><th>Erro</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function readQaHistory(outputRoot) {
  try {
    const raw = await fs.readFile(path.join(outputRoot, 'history.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeQaReport({ report, outputRoot = 'qa-artifacts', historyLimit = 25 } = {}) {
  const dir = await ensureDir(path.resolve(outputRoot, 'reports', `${report.systemId || 'system'}-${report.profile || 'qa'}-${Date.now()}`));
  const jsonFile = path.join(dir, 'report.json');
  const htmlFile = path.join(dir, 'report.html');
  await writeJson(jsonFile, report);
  await fs.writeFile(htmlFile, renderQaReportHtml(report), 'utf8');
  const history = await readQaHistory(outputRoot);
  history.unshift({ systemId: report.systemId, profile: report.profile, generatedAt: report.generatedAt, counts: report.counts, gate: report.gate, reportDir: dir });
  await writeJson(path.resolve(outputRoot, 'history.json'), history.slice(0, Math.max(1, historyLimit)));
  return { outputDir: dir, jsonFile, htmlFile };
}
