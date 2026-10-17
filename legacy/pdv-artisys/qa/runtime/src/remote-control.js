import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY_BYTES = 16 * 1024;

function json(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function text(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

function tokenMatches(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBearerToken(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function choose(value, allowed, fallback, label) {
  const selected = value ?? fallback;
  if (selected == null || selected === '') return null;
  if (!allowed.includes(selected)) throw new Error(`Unknown ${label}: ${selected}`);
  return selected;
}

function normalizeRunRequest(body, meta) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid run request');
  const profile = choose(body.profile, meta.profiles || [], null, 'profile');
  const flow = profile ? null : choose(body.flow, meta.flows || [], meta.defaults?.flow, 'flow');
  return {
    profile,
    flow,
    environment: choose(body.environment, meta.environments || [], meta.defaults?.environment, 'environment'),
    viewport: choose(body.viewport, meta.viewports || [], meta.defaults?.viewport, 'viewport'),
  };
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ArtiSys QA Remote Control</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}body{margin:0;background:#0d1117;color:#f0f6fc}.wrap{max-width:760px;margin:auto;padding:24px 18px 48px}.card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:18px;margin:14px 0}h1{font-size:24px;margin:4px 0 6px}p{color:#8b949e;line-height:1.45}label{display:block;font-size:13px;color:#8b949e;margin:12px 0 6px}input,select,button{box-sizing:border-box;width:100%;min-height:46px;border-radius:10px;border:1px solid #30363d;background:#0d1117;color:#f0f6fc;padding:10px 12px;font:inherit}button{background:#238636;border-color:#2ea043;font-weight:700;margin-top:14px}button:disabled{opacity:.55}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.status{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#3fb950}.err{color:#f85149}.muted{color:#8b949e;font-size:12px}.history{display:grid;gap:8px}.history div{padding:10px;border:1px solid #30363d;border-radius:10px}@media(max-width:520px){.row{grid-template-columns:1fr}}
</style>
</head>
<body><main class="wrap">
<h1>ArtiSys QA Remote Control</h1><p>Controle opcional do runner local. O GitHub Actions continua independente.</p>
<section class="card"><label>Token</label><input id="token" type="password" autocomplete="off" placeholder="Token exibido no PC"><button id="connect">Conectar</button><div id="connection" class="muted"></div></section>
<section class="card" id="controls" hidden><div id="system" class="muted"></div><label>Perfil</label><select id="profile"><option value="">Fluxo individual</option></select><div class="row"><div><label>Fluxo</label><select id="flow"></select></div><div><label>Ambiente</label><select id="environment"></select></div></div><label>Viewport</label><select id="viewport"></select><button id="run">Executar testes</button></section>
<section class="card" id="result" hidden><strong>Status</strong><div id="status" class="status muted">idle</div></section>
<section class="card" id="historyCard" hidden><strong>Histórico</strong><div id="history" class="history muted"></div></section>
</main>
<script>
const $=id=>document.getElementById(id);let token='',timer=null;
async function call(path,options={}){const r=await fetch(path,{...options,headers:{authorization:'Bearer '+token,'content-type':'application/json',...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
function fill(id,items,selected,keepFirst=false){const el=$(id);const first=keepFirst?el.firstElementChild:null;el.innerHTML='';if(first)el.appendChild(first);for(const item of items||[]){const o=document.createElement('option');o.value=o.textContent=item;if(item===selected)o.selected=true;el.appendChild(o)}}
function renderHistory(items){$('history').innerHTML='';for(const item of (items||[]).slice(0,5)){const d=document.createElement('div');d.textContent=(item.profile||'run')+' · '+(item.counts?.passed||0)+' passou · '+(item.counts?.failed||0)+' falhou · '+(item.generatedAt||'');$('history').appendChild(d)}$('historyCard').hidden=false}
async function connect(){token=$('token').value.trim();try{const meta=await call('/api/meta');sessionStorage.setItem('artisysQaToken',token);$('connection').textContent='Conectado';$('controls').hidden=false;$('result').hidden=false;$('system').textContent=meta.systemId;fill('profile',meta.profiles,null,true);fill('flow',meta.flows,meta.defaults?.flow);fill('environment',meta.environments,meta.defaults?.environment);fill('viewport',meta.viewports,meta.defaults?.viewport);await loadHistory();poll()}catch(e){$('connection').textContent=e.message;$('controls').hidden=true}}
async function loadHistory(){try{renderHistory(await call('/api/history'))}catch{}}
async function poll(){try{const s=await call('/api/status');$('status').textContent=JSON.stringify(s,null,2);$('status').className='status '+(s.state==='failed'?'err':s.state==='passed'?'ok':'muted');$('run').disabled=s.state==='running';if(s.finishedAt)loadHistory()}catch(e){$('status').textContent=e.message}timer=setTimeout(poll,1200)}
$('connect').onclick=connect;$('run').onclick=async()=>{try{await call('/api/run',{method:'POST',body:JSON.stringify({profile:$('profile').value||null,flow:$('flow').value,environment:$('environment').value,viewport:$('viewport').value})});poll()}catch(e){$('status').textContent=e.message;$('status').className='status err'}};const saved=sessionStorage.getItem('artisysQaToken');if(saved){$('token').value=saved;connect()}
</script></body></html>`;
}

export function createQaRemoteControl({ host = '127.0.0.1', port = 4173, token, meta, runJob, getHistory } = {}) {
  if (!meta || typeof meta !== 'object') throw new TypeError('meta is required');
  if (typeof runJob !== 'function') throw new TypeError('runJob is required');
  if (getHistory != null && typeof getHistory !== 'function') throw new TypeError('getHistory must be a function');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be between 0 and 65535');
  if (!token && !LOOPBACK_HOSTS.has(host)) throw new Error('Remote token is required for non-loopback binding');

  const accessToken = token || randomBytes(24).toString('hex');
  let status = { state: 'idle', startedAt: null, finishedAt: null, request: null, result: null, error: null };
  let server;

  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return text(res, 200, dashboardHtml(), 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (!tokenMatches(accessToken, readBearerToken(req))) return json(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET' && url.pathname === '/api/meta') return json(res, 200, meta);
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, status);
    if (req.method === 'GET' && url.pathname === '/api/history') return json(res, 200, getHistory ? await getHistory() : []);
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (status.state === 'running') return json(res, 409, { error: 'QA is already running' });
      try {
        const request = normalizeRunRequest(await readJson(req), meta);
        status = { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, request, result: null, error: null };
        void Promise.resolve()
          .then(() => runJob(request))
          .then(result => { status = { ...status, state: 'passed', finishedAt: new Date().toISOString(), result }; })
          .catch(error => { status = { ...status, state: 'failed', finishedAt: new Date().toISOString(), error: error?.message || String(error) }; });
        return json(res, 202, { accepted: true });
      } catch (error) {
        return json(res, 400, { error: error?.message || String(error) });
      }
    }
    return json(res, 404, { error: 'Not found' });
  };

  return {
    token: accessToken,
    async start() {
      if (server) throw new Error('Remote control is already started');
      server = http.createServer((req, res) => { void handler(req, res).catch(error => json(res, 500, { error: error?.message || 'Internal error' })); });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      });
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
    getStatus() { return status; },
  };
}
