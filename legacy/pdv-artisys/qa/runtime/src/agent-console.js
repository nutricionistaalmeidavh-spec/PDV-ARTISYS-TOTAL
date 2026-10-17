import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const MIME = new Map([
  ['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webm','video/webm'],['.mp4','video/mp4'],
  ['.json','application/json; charset=utf-8'],['.html','text/html; charset=utf-8'],['.zip','application/zip'],['.txt','text/plain; charset=utf-8'],['.log','text/plain; charset=utf-8']
]);

function headers(extra = {}) {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, headers({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }));
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, headers({ 'content-type': contentType, 'content-length': Buffer.byteLength(body) }));
  res.end(body);
}

function tokenMatches(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function safeJobId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9._-]{1,160}$/.test(id) ? id : null;
}

function dashboardHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtiSys QA Console</title><style>
  :root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark;background:#0d1117;color:#f0f6fc}*{box-sizing:border-box}body{margin:0}.wrap{max-width:980px;margin:auto;padding:18px}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.badge{padding:6px 10px;border:1px solid #30363d;border-radius:999px;color:#8b949e}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}.card{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:16px;margin:14px 0}.timeline{display:grid;gap:8px}.event{border-left:3px solid #30363d;padding:8px 12px}.ok{color:#3fb950}.bad{color:#f85149}.muted{color:#8b949e}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}input,button{min-height:44px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:#f0f6fc;padding:10px 12px;font:inherit}button{background:#238636;font-weight:700}.row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1;min-width:180px}.artifacts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.artifact{border:1px solid #30363d;border-radius:10px;padding:10px}.stage{font-size:28px;font-weight:800}@media(max-width:720px){.grid{grid-template-columns:1fr}.wrap{padding:12px}.stage{font-size:22px}}</style></head><body><main class="wrap">
  <div class="top"><div><h1 style="margin:0">ArtiSys QA Console</h1><div class="muted">Observabilidade local em tempo real</div></div><span id="conn" class="badge">desconectado</span></div>
  <section class="card"><div class="row"><input id="token" type="password" placeholder="Token do console"><button id="connect">Conectar</button></div><div id="agent" class="muted" style="margin-top:10px"></div></section>
  <div class="grid"><div><section class="card"><div class="muted">Job atual</div><div id="stage" class="stage">IDLE</div><div id="detail" class="muted">Nenhum job ativo</div><div id="progress" class="mono"></div></section><section class="card"><strong>Linha do tempo</strong><div id="events" class="timeline muted" style="margin-top:10px"></div></section></div><div><section class="card"><strong>Projetos</strong><div id="projects" class="mono muted" style="margin-top:10px"></div></section><section class="card"><strong>Artefatos</strong><div id="artifacts" class="artifacts muted" style="margin-top:10px"></div></section></div></div>
  <section class="card"><strong>Histórico</strong><div id="history" class="mono muted" style="margin-top:10px"></div></section>
</main><script>
const $=id=>document.getElementById(id);let token='',timer=null,currentJob=null;
async function call(p){const r=await fetch(p,{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
async function blobUrl(p){const r=await fetch(p,{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('HTTP '+r.status);return URL.createObjectURL(await r.blob())}
async function refresh(){try{const [agent,current,projects,history]=await Promise.all([call('/api/agent'),call('/api/jobs/current'),call('/api/projects'),call('/api/history')]);$('conn').textContent='online';$('conn').className='badge ok';$('agent').textContent='Agente '+(agent.version||'')+' · '+(agent.machineId||'')+' · heartbeat '+(current.heartbeatAt||'—');const job=current.currentJob;currentJob=job?.jobId||null;$('stage').textContent=job?.stage||'IDLE';$('detail').textContent=job?.detail||'Nenhum job ativo';$('progress').textContent=job?.progress?job.progress.current+'/'+job.progress.total:'';$('projects').textContent=(projects||[]).map(p=>(p.running?'● ':'○ ')+p.id+' :'+p.port).join('\n')||'Nenhum projeto';$('history').textContent=(history||[]).slice(0,8).map(j=>j.jobId+' · '+j.stage+' · '+(j.updatedAt||'')).join('\n')||'Sem histórico';if(currentJob){const [events,arts]=await Promise.all([call('/api/jobs/'+encodeURIComponent(currentJob)+'/events'),call('/api/jobs/'+encodeURIComponent(currentJob)+'/artifacts')]);$('events').innerHTML='';for(const e of events.slice(-30)){const d=document.createElement('div');d.className='event';d.textContent=(e.at||'')+' · '+(e.stage||'')+(e.detail?' · '+e.detail:'');$('events').appendChild(d)}$('artifacts').innerHTML='';for(const a of arts){const d=document.createElement('div');d.className='artifact';const t=document.createElement('div');t.textContent=(a.type||'file')+' · '+(a.name||'');d.appendChild(t);const b=document.createElement('button');b.textContent='Abrir';b.style.marginTop='8px';b.addEventListener('click',async()=>{try{const u=await blobUrl(a.url);window.open(u,'_blank','noopener')}catch(e){alert(e.message)}});d.appendChild(b);$('artifacts').appendChild(d)}}else{$('events').textContent='';$('artifacts').textContent='';}}catch(e){$('conn').textContent=e.message;$('conn').className='badge bad'}finally{timer=setTimeout(refresh,1500)}}
$('connect').addEventListener('click',()=>{token=$('token').value.trim();if(timer)clearTimeout(timer);refresh()});
</script></body></html>`;
}

export function createAgentConsole({ host = '127.0.0.1', port = 4160, token, telemetry, agentState, artifactRoot, lanEnabled = false, agentInfo = async () => ({}) } = {}) {
  if (!telemetry) throw new TypeError('telemetry is required');
  if (typeof agentState !== 'function') throw new TypeError('agentState must be a function');
  if (!artifactRoot) throw new TypeError('artifactRoot is required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be between 0 and 65535');
  if (!LOOPBACK.has(host) && !lanEnabled) throw new Error('LAN console must be explicitly enabled');
  if (!LOOPBACK.has(host) && !token) throw new Error('LAN console token is required');
  const accessToken = token || randomBytes(24).toString('hex');
  const baseArtifactRoot = path.resolve(artifactRoot);
  let server = null;

  async function serveArtifact(req, res, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname.slice('/artifacts/'.length)); } catch { return sendJson(res, 400, { error: 'Invalid artifact path' }); }
    if (!decoded || decoded.split(/[\\/]/).includes('..')) return sendJson(res, 400, { error: 'Invalid artifact path' });
    const target = path.resolve(baseArtifactRoot, decoded);
    if (!(target === baseArtifactRoot || target.startsWith(`${baseArtifactRoot}${path.sep}`))) return sendJson(res, 400, { error: 'Invalid artifact path' });
    const type = MIME.get(path.extname(target).toLowerCase());
    if (!type) return sendJson(res, 404, { error: 'Artifact type not allowed' });
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
      const body = await fs.readFile(target);
      res.writeHead(200, headers({ 'content-type': type, 'content-length': body.length }));
      res.end(body);
    } catch (error) {
      if (error?.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found' });
      throw error;
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return sendText(res, 200, dashboardHtml(), 'text/html; charset=utf-8');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Read-only console' });
    if (!tokenMatches(accessToken, bearer(req))) return sendJson(res, 401, { error: 'Unauthorized' });
    if (url.pathname.startsWith('/artifacts/')) return serveArtifact(req, res, url.pathname);
    if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (url.pathname === '/api/agent') return sendJson(res, 200, await agentInfo());
    if (url.pathname === '/api/projects') {
      const state = await agentState();
      return sendJson(res, 200, (state.projects || []).map(project => ({ id: project.id, name: project.name, port: project.port, enabled: project.enabled !== false, running: project.running ?? null })));
    }
    if (url.pathname === '/api/jobs/current') return sendJson(res, 200, await telemetry.getSnapshot());
    if (url.pathname === '/api/history') return sendJson(res, 200, await telemetry.listHistory(50));
    const match = url.pathname.match(/^\/api\/jobs\/([A-Za-z0-9._-]{1,160})(?:\/(events|artifacts))?$/);
    if (!match) return sendJson(res, 404, { error: 'Not found' });
    const jobId = safeJobId(match[1]);
    if (!jobId) return sendJson(res, 400, { error: 'Invalid job id' });
    if (match[2] === 'events') return sendJson(res, 200, await telemetry.readEvents({ jobId, limit: 500 }));
    if (match[2] === 'artifacts') {
      const snapshot = await telemetry.getSnapshot();
      const artifacts = (snapshot.artifacts || []).filter(item => item.jobId === jobId).map(item => {
        const absolute = path.resolve(String(item.localPath || ''));
        if (!(absolute === baseArtifactRoot || absolute.startsWith(`${baseArtifactRoot}${path.sep}`))) return null;
        const relative = path.relative(baseArtifactRoot, absolute).split(path.sep).map(encodeURIComponent).join('/');
        return { ...item, localPath: undefined, url: `/artifacts/${relative}` };
      }).filter(Boolean);
      return sendJson(res, 200, artifacts);
    }
    return sendJson(res, 200, await telemetry.readJob(jobId));
  }

  return {
    token: accessToken,
    async start() {
      if (server) throw new Error('Agent console is already started');
      server = http.createServer((req, res) => { void handler(req, res).catch(error => sendJson(res, 500, { error: error?.message || 'Internal error' })); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host;
      return { host, port: actualPort, baseURL: `http://${displayHost}:${actualPort}`, token: accessToken };
    },
    async close() {
      if (!server) return;
      const current = server;
      server = null;
      await new Promise((resolve, reject) => current.close(error => error ? reject(error) : resolve()));
    },
  };
}
