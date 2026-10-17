import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolveSecret, stepLabel } from './helpers.js';

function locator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.role) {
    const accessibleName = step.accessibleName ?? step.name;
    return page.getByRole(step.role, accessibleName ? { name: accessibleName, exact:step.exact ?? false } : undefined);
  }
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.selector) return page.locator(step.selector);
  throw new Error(`Step ${step.action} requires selector, testId, role, text or label`);
}

async function dismissPostSaleBeforeNavigation(page, step) {
  const selector = typeof step.selector === 'string' ? step.selector : '';
  if (!/\[data-(?:home-)?route=/.test(selector)) return;
  const close = page.locator('#post-sale-close');
  if (!(await close.isVisible().catch(() => false))) return;
  await close.click();
  await close.waitFor({ state:'detached', timeout:step.timeoutMs ?? 10000 });
}

async function ensureHomeRouteContext(page, step) {
  if (typeof step.selector !== 'string' || !step.selector.includes('[data-home-route=')) return;
  const homeNav = page.locator("#sidebar-nav [data-route='home']");
  if (!(await homeNav.isVisible().catch(() => false))) return;
  await homeNav.click();
  await page.locator(step.selector).waitFor({ state: 'visible', timeout: step.timeoutMs ?? 10000 });
}

function isModuleToggleStep(step) {
  return typeof step.selector === 'string' && step.selector.includes('[data-module-toggle=');
}

async function restoreModuleToggleContext(page, step, deadline) {
  if (!isModuleToggleStep(step)) return false;
  const areasTab = page.locator("#settings-hub [data-settings-category='modules']");
  if (!(await areasTab.isVisible().catch(() => false))) return false;
  await areasTab.click();
  const remainingMs = Math.max(1, deadline - Date.now());
  await locator(page, step).waitFor({ state:'visible', timeout:Math.min(remainingMs, 5000) }).catch(() => {});
  return true;
}

async function setCheckboxState(page, step, checked) {
  let target = locator(page, step);
  const current = await target.isChecked().catch(() => null);
  if (current === checked) return;
  await target.click();
  const timeoutMs = Number(step.timeoutMs ?? 10000);
  const deadline = Date.now() + timeoutMs;
  let restoredModuleContext = false;
  while (true) {
    target = locator(page, step);
    const next = await target.isChecked().catch(() => null);
    if (next === checked) return;
    if (next === null && !restoredModuleContext) {
      restoredModuleContext = await restoreModuleToggleContext(page, step, deadline);
      if (restoredModuleContext) continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${stepLabel(step, 0)}: checkbox did not reach ${checked ? 'checked' : 'unchecked'} state`);
    }
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

function waitState(step) {
  if (step.state) return step.state;
  const selector = typeof step.selector === 'string' ? step.selector : '';
  return /\boption(?=[:.\[#\s>+~]|$)/.test(selector) ? 'attached' : 'visible';
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
}

function assertQaFilePath(candidate, env, label, runtimeContext = null) {
  const base = path.resolve(runtimeContext?.rootDir || process.cwd());
  const target = path.resolve(base, candidate);
  const root = path.resolve(base, String(env.ARTISYS_QA_PDF_DIR || 'qa-artifacts'));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label}: file assertion must stay inside QA output root ${root}`);
  }
  return target;
}

async function newestMatchingFile(directory, suffix = '') {
  const names = await readdir(directory);
  const candidates = [];
  for (const name of names) {
    if (suffix && !name.toLowerCase().endsWith(String(suffix).toLowerCase())) continue;
    const filePath = path.join(directory, name);
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile()) candidates.push({ filePath, mtimeMs:info.mtimeMs });
  }
  candidates.sort((a,b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || null;
}

function runtimeVariable(runtimeContext, key, label) {
  const name = String(key || '').trim();
  if (!name) throw new Error(`${label}: runtime variable name is required`);
  if (!runtimeContext?.vars || !Object.prototype.hasOwnProperty.call(runtimeContext.vars, name)) {
    throw new Error(`${label}: runtime variable ${name} is not available`);
  }
  return runtimeContext.vars[name];
}

function resolveRuntimeTemplate(value, runtimeContext, label) {
  if (typeof value === 'string') {
    return value.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => String(runtimeVariable(runtimeContext, key.trim(), label)));
  }
  if (Array.isArray(value)) return value.map(item => resolveRuntimeTemplate(item, runtimeContext, label));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, resolveRuntimeTemplate(item, runtimeContext, label)]));
  }
  return value;
}

function payloadPathValue(payload, pathValue) {
  const path = String(pathValue || '').trim();
  if (!path) return payload;
  return path.split('.').reduce((value, segment) => value == null ? undefined : value[segment], payload);
}

async function qaRunStartMs(screenshotsDir, runtimeContext) {
  const explicit = Number(runtimeContext?.runStartedAtMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const info = await stat(screenshotsDir);
  const birth = Number(info.birthtimeMs);
  if (Number.isFinite(birth) && birth > 0) return birth;
  return Number(info.ctimeMs || 0);
}

export async function executeStep({ page, step, index, screenshotsDir, baseURL, env = process.env, adapter = null, electronApp = null, runtimeContext = null }) {
  const label = stepLabel(step, index);
  switch (step.action) {
    case 'goto': {
      let target;
      if (step.urlFrom) {
        const dynamicBase = String(runtimeVariable(runtimeContext, step.urlFrom, label));
        target = step.path ? new URL(step.path, dynamicBase).toString() : dynamicBase;
      } else {
        target = step.url || (step.path && baseURL ? new URL(step.path, baseURL).toString() : step.path);
      }
      if (!target) throw new Error('goto requires url, urlFrom or path');
      await page.goto(target, { waitUntil: step.waitUntil || 'domcontentloaded' });
      break;
    }
    case 'click': {
      await dismissPostSaleBeforeNavigation(page, step);
      await ensureHomeRouteContext(page, step);
      const target = locator(page, step);
      const isModalClose = typeof step.selector === 'string' && step.selector.includes('[data-close-modal]');
      if (isModalClose && !(await target.isVisible().catch(() => false))) break;
      if (step.selector === "#ops-inventory-form button[type='submit']") {
        const selectedProduct = await page.locator("#ops-inventory-form select[name='productId'] option:checked").textContent();
        const quantity = await page.locator("#ops-inventory-form input[name='quantity']").inputValue();
        const type = await page.locator("#ops-inventory-form select[name='type']").inputValue();
        await target.click();
        if (selectedProduct && type !== 'adjustment-out') {
          const expectedQuantity = Number(quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
          await page.locator("#ops-inventory-body tr", { hasText: selectedProduct.trim() }).filter({ hasText: expectedQuantity }).waitFor({ state: 'visible', timeout: step.timeoutMs ?? 15000 });
        } else {
          await page.locator("#ops-inventory-form").waitFor({ state: 'visible', timeout: step.timeoutMs ?? 15000 });
        }
      } else {
        await target.click();
      }
      break;
    }
    case 'fill': {
      const value = step.valueFrom != null
        ? runtimeVariable(runtimeContext, step.valueFrom, label)
        : resolveSecret(step, env);
      await locator(page, step).fill(String(value ?? ''));
      break;
    }
    case 'focus': {
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs});
      await target.focus();
      break;
    }
    case 'press': await locator(page, step).press(step.key || 'Enter'); break;
    case 'check': await setCheckboxState(page, step, true); break;
    case 'uncheck': await setCheckboxState(page, step, false); break;
    case 'hover': await locator(page, step).hover(); break;
    case 'selectOption': await locator(page, step).selectOption(resolveSecret(step, env)); break;
    case 'reload': await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded' }); break;
    case 'authenticateLocalQa': {
      const credentials = { username:String(step.username || 'qaadmin'), password:String(resolveSecret({ ...step, value:step.password || 'QaLocalOnly-12345!' }, env)) };
      await page.locator('#login-form').waitFor({ state:'visible', timeout:step.timeoutMs ?? 15000 });
      await page.evaluate(input => {
        const form = document.querySelector('#login-form');
        if (!form) throw new Error('QA login form unavailable');
        form.elements.namedItem('username').value = input.username;
        form.elements.namedItem('password').value = input.password;
        form.requestSubmit();
      }, credentials);
      await page.locator('#auth-overlay').waitFor({ state:'hidden', timeout:step.timeoutMs ?? 15000 });
      break;
    }
    case 'desktopConfig': {
      const config = await page.evaluate(async () => {
        if (typeof window.artisysDesktop?.getConfig !== 'function') throw new Error('Desktop config bridge unavailable');
        return window.artisysDesktop.getConfig();
      });
      if (!runtimeContext) throw new Error(`${label}: runtime context is unavailable`);
      runtimeContext.vars ||= {};
      if (step.saveAs != null) {
        if (!step.saveAs || typeof step.saveAs !== 'object' || Array.isArray(step.saveAs)) throw new TypeError(`${label}: saveAs must be an object`);
        for (const [name, configPath] of Object.entries(step.saveAs)) {
          const value = payloadPathValue(config, configPath);
          if (value == null) throw new Error(`${label}: config value ${configPath} is unavailable for ${name}`);
          runtimeContext.vars[name] = value;
        }
      }
      break;
    }
    case 'desktopApiRequest': {
      const requestPath=String(resolveRuntimeTemplate(step.path||'',runtimeContext,label)).trim();
      const requestBody=resolveRuntimeTemplate(step.body??null,runtimeContext,label);
      if(!requestPath.startsWith('/api/v1/'))throw new Error(`${label}: desktopApiRequest requires /api/v1/ path`);
      const result=await page.evaluate(async input=>{
        if(typeof window.artisysDesktop?.apiRequest!=='function')throw new Error('Desktop API bridge unavailable');
        const sessionToken=sessionStorage.getItem('artisys.sessionToken')||null;
        return window.artisysDesktop.apiRequest({path:input.path,method:input.method||'GET',body:input.body,sessionToken});
      },{path:requestPath,method:String(step.method||'GET').toUpperCase(),body:requestBody});
      if(step.expectedStatus!=null&&Number(result?.status)!==Number(step.expectedStatus))throw new Error(`${label}: expected HTTP ${step.expectedStatus}, got ${result?.status}`);
      if(step.expectOk!==false&&!result?.ok)throw new Error(`${label}: desktop API request failed: ${JSON.stringify(result?.payload||null)}`);
      if(step.expectedPayloadIncludes!=null){
        const payloadText=JSON.stringify(result?.payload??null);
        const expectations=Array.isArray(step.expectedPayloadIncludes)?step.expectedPayloadIncludes:[step.expectedPayloadIncludes];
        for(const expected of expectations){
          if(!payloadText.includes(String(expected)))throw new Error(`${label}: API payload does not include ${JSON.stringify(String(expected))}: ${payloadText}`);
        }
      }
      if (step.saveAs != null) {
        if (!step.saveAs || typeof step.saveAs !== 'object' || Array.isArray(step.saveAs)) throw new TypeError(`${label}: saveAs must be an object`);
        if (!runtimeContext) throw new Error(`${label}: runtime context is unavailable`);
        runtimeContext.vars ||= {};
        for (const [name, payloadPath] of Object.entries(step.saveAs)) {
          const value = payloadPathValue(result?.payload, payloadPath);
          if (value == null) throw new Error(`${label}: response value ${payloadPath} is unavailable for ${name}`);
          runtimeContext.vars[name] = value;
        }
      }
      break;
    }
    case 'setFeatureFlags': {
      const allowed = new Set(['productsDenseView', 'customersMasterDetailView']);
      const flags = step.flags;
      if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new TypeError('setFeatureFlags requires a flags object');
      for (const [key, value] of Object.entries(flags)) {
        if (!allowed.has(key)) throw new Error(`Unsupported QA feature flag: ${key}`);
        if (typeof value !== 'boolean') throw new TypeError(`QA feature flag ${key} must be boolean`);
      }
      await page.evaluate(nextFlags => {
        window.PdvFeatureFlags = {
          ...(window.PdvFeatureFlags || {}),
          ...nextFlags,
        };
      }, flags);
      break;
    }
    case 'setViewportSize': {
      const width = positiveInteger(step.width, `${label}: width`);
      const height = positiveInteger(step.height, `${label}: height`);
      await page.setViewportSize({ width, height });
      break;
    }
    case 'setZoomFactor': {
      const factor=Number(step.factor);
      if(!Number.isFinite(factor)||factor<0.5||factor>3)throw new TypeError(`${label}: factor must be between 0.5 and 3`);
      if(!electronApp?.evaluate)throw new Error(`${label}: native Electron zoom requires an Electron QA runtime`);
      await electronApp.evaluate(({BrowserWindow},value)=>{
        for(const window of BrowserWindow.getAllWindows()){
          if(!window.isDestroyed())window.webContents.setZoomFactor(value);
        }
      },factor);
      await page.waitForTimeout(Number(step.settleMs??150));
      break;
    }
    case 'waitFor': await locator(page, step).waitFor({ state: waitState(step), timeout: step.timeoutMs }); break;
    case 'waitForTimeout': await page.waitForTimeout(step.timeoutMs ?? 250); break;
    case 'expectVisible': {
      if (!(await locator(page, step).isVisible())) throw new Error(`${label}: expected locator to be visible`);
      break;
    }
    case 'expectInViewport': {
      const target = locator(page, step).first();
      await target.waitFor({ state:'visible', timeout:step.timeoutMs ?? 10000 });
      const box = await target.boundingBox();
      const viewport = page.viewportSize();
      const tolerancePx = Number(step.tolerancePx ?? 0);
      if (!box || !viewport) throw new Error(`${label}: could not measure viewport visibility`);
      const inside = box.x >= -tolerancePx
        && box.y >= -tolerancePx
        && box.x + box.width <= viewport.width + tolerancePx
        && box.y + box.height <= viewport.height + tolerancePx;
      if (!inside) throw new Error(`${label}: target is outside viewport (${JSON.stringify(box)} vs ${viewport.width}x${viewport.height})`);
      break;
    }
    case 'expectFocused': {
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs});
      const focused=await target.evaluate(element=>element===document.activeElement);
      if(!focused)throw new Error(`${label}: expected locator to own keyboard focus`);
      break;
    }
    case 'expectAccessibleName': {
      if(step.expected==null)throw new Error(`${label}: expectAccessibleName requires expected`);
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs});
      const actual=await target.evaluate(element=>{
        const labelledBy=String(element.getAttribute('aria-labelledby')||'').trim();
        if(labelledBy){
          const text=labelledBy.split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
          if(text)return text;
        }
        const aria=String(element.getAttribute('aria-label')||'').trim();
        if(aria)return aria;
        if(element.labels?.length)return Array.from(element.labels).map(label=>label.textContent||'').join(' ').trim();
        const alt=String(element.getAttribute('alt')||'').trim();
        if(alt)return alt;
        return String(element.innerText||element.textContent||element.getAttribute('title')||'').replace(/\\s+/g,' ').trim();
      });
      if(actual!==String(step.expected))throw new Error(`${label}: expected accessible name ${JSON.stringify(String(step.expected))}, got ${JSON.stringify(actual)}`);
      break;
    }
    case 'expectMinimumContrast': {
      const minimum=Number(step.minRatio??4.5);
      if(!Number.isFinite(minimum)||minimum<=1)throw new TypeError(`${label}: minRatio must be greater than 1`);
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs});
      const measurement=await target.evaluate((element,minRatio)=>{
        const rgba=value=>{
          const canvas=document.createElement('canvas');
          canvas.width=1;
          canvas.height=1;
          const context=canvas.getContext('2d',{willReadFrequently:true});
          if(!context)return null;
          context.clearRect(0,0,1,1);
          context.fillStyle=String(value||'transparent');
          context.fillRect(0,0,1,1);
          const pixel=context.getImageData(0,0,1,1).data;
          return {r:pixel[0],g:pixel[1],b:pixel[2],a:pixel[3]/255};
        };
        const composite=(front,back)=>({
          r:front.r*front.a+back.r*(1-front.a),
          g:front.g*front.a+back.g*(1-front.a),
          b:front.b*front.a+back.b*(1-front.a),
          a:1
        });
        const luminance=color=>{
          const channel=value=>{
            const normalized=value/255;
            return normalized<=0.03928?normalized/12.92:Math.pow((normalized+0.055)/1.055,2.4);
          };
          return 0.2126*channel(color.r)+0.7152*channel(color.g)+0.0722*channel(color.b);
        };
        const foreground=rgba(getComputedStyle(element).color);
        if(!foreground)return {ok:false,ratio:0,reason:'foreground-unavailable'};
        let background={r:255,g:255,b:255,a:1};
        let node=element;
        while(node){
          const candidate=rgba(getComputedStyle(node).backgroundColor);
          if(candidate&&candidate.a>0){
            background=candidate.a<1?composite(candidate,{r:255,g:255,b:255,a:1}):candidate;
            break;
          }
          node=node.parentElement;
        }
        const fg=foreground.a<1?composite(foreground,background):foreground;
        const lighter=Math.max(luminance(fg),luminance(background));
        const darker=Math.min(luminance(fg),luminance(background));
        const ratio=(lighter+0.05)/(darker+0.05);
        return {ok:ratio>=minRatio,ratio,foreground:fg,background};
      },minimum);
      if(!measurement.ok)throw new Error(`${label}: contrast ratio ${Number(measurement.ratio||0).toFixed(2)} is below ${minimum}`);
      break;
    }
    case 'expectValue': {
      if (step.expected == null) throw new Error(`${label}: expectValue requires expected`);
      const target = locator(page, step);
      await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
      const actual = await target.inputValue();
      if (actual !== String(step.expected)) throw new Error(`${label}: expected value ${JSON.stringify(String(step.expected))}, got ${JSON.stringify(actual)}`);
      break;
    }
    case 'expectSameRow': {
      if (!Array.isArray(step.selectors) || step.selectors.length < 2) throw new Error(`${label}: expectSameRow requires selectors`);
      const boxes = [];
      for (const selector of step.selectors) {
        const target = page.locator(selector).first();
        await target.waitFor({ state:'visible', timeout:step.timeoutMs ?? 10000 });
        const box = await target.boundingBox();
        if (!box) throw new Error(`${label}: could not measure ${selector}`);
        boxes.push(box);
      }
      const tolerancePx = Number(step.tolerancePx ?? 12);
      const centers = boxes.map(box => box.y + box.height / 2);
      if (Math.max(...centers) - Math.min(...centers) > tolerancePx) {
        throw new Error(`${label}: controls are not aligned on the same row`);
      }
      break;
    }
    case 'barcodeScan': {
      if (step.value == null) throw new Error(`${label}: barcodeScan requires value`);
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs ?? 10000});
      await target.fill('');
      await target.focus();
      const delayMs=Number(step.delayMs ?? 0);
      if(!Number.isFinite(delayMs)||delayMs<0)throw new TypeError(`${label}: delayMs must be non-negative`);
      await page.keyboard.type(String(step.value),{delay:delayMs});
      if(step.pressEnter!==false)await page.keyboard.press('Enter');
      if(step.settleMs!=null)await page.waitForTimeout(Number(step.settleMs));
      break;
    }
    case 'clickIfVisible': {
      const target=locator(page,step).first();
      const alternative=step.alternativeSelector?page.locator(String(step.alternativeSelector)).first():null;
      const timeoutMs=Number(step.timeoutMs ?? 10000);
      const started=Date.now();
      let matched=false;
      while(Date.now()-started<=timeoutMs){
        if(await target.isVisible().catch(()=>false)){
          matched=true;
          await target.click();
          if(alternative)await alternative.waitFor({state:'visible',timeout:Math.max(1,timeoutMs-(Date.now()-started))});
          break;
        }
        if(alternative&&await alternative.isVisible().catch(()=>false)){matched=true;break;}
        if(!alternative){matched=true;break;}
        await page.waitForTimeout(50);
      }
      if(!matched)throw new Error(`${label}: neither optional target nor alternative became visible`);
      break;
    }
    case 'doubleClick': {
      const target=locator(page,step).first();
      await target.waitFor({state:'visible',timeout:step.timeoutMs ?? 10000});
      const delayMs=Number(step.delayMs ?? 0);
      await target.evaluate(async(element,delay)=>{
        const fire=()=>element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
        fire();
        if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
        fire();
      },delayMs);
      break;
    }
    case 'expectCount': {
      const expected=Number(step.expected);
      if(!Number.isInteger(expected)||expected<0)throw new TypeError(`${label}: expectCount requires a non-negative integer expected`);
      const actual=await locator(page,step).count();
      if(actual!==expected)throw new Error(`${label}: expected count ${expected}, got ${actual}`);
      break;
    }
    case 'expectPdfText': {
      let filePath=null;
      if(step.directory){
        const directory=assertQaFilePath(step.directory,env,label,runtimeContext);
        filePath=await newestMatchingFile(directory,step.suffix||'.pdf');
      }else if(step.path)filePath=assertQaFilePath(step.path,env,label,runtimeContext);
      else throw new Error(`${label}: expectPdfText requires path or directory`);
      if(!filePath)throw new Error(`${label}: PDF file was not found`);
      const command=String(step.command||'pdftotext');
      const result=spawnSync(command,[filePath,'-'],{encoding:'utf8'});
      if(result.error)throw new Error(`${label}: ${command} unavailable: ${result.error.message}`);
      if(result.status!==0)throw new Error(`${label}: ${command} failed: ${String(result.stderr||'').trim()}`);
      const text=String(result.stdout||'').replace(/\s+/g,' ').trim();
      const expectedValues=Array.isArray(step.expected)?step.expected:[step.expected];
      for(const expected of expectedValues.filter(value=>value!=null)){
        if(!text.includes(String(expected)))throw new Error(`${label}: PDF text does not include ${JSON.stringify(String(expected))}: ${text.slice(0,500)}`);
      }
      break;
    }
    case 'expectFile': {
      let filePath = null;
      if (step.directory) {
        const directory = assertQaFilePath(step.directory, env, label, runtimeContext);
        filePath = await newestMatchingFile(directory, step.suffix || '');
      } else if (step.path) filePath = assertQaFilePath(step.path, env, label, runtimeContext);
      else throw new Error(`${label}: expectFile requires path or directory`);
      if (!filePath) throw new Error(`${label}: expected file was not found`);
      const info = await stat(filePath);
      if (step.createdAfterRunStart) {
        const startedAt = await qaRunStartMs(screenshotsDir, runtimeContext);
        if (info.mtimeMs < startedAt) throw new Error(`${label}: file is stale (${new Date(info.mtimeMs).toISOString()} < run start ${new Date(startedAt).toISOString()})`);
      }
      const bytes = await readFile(filePath);
      const minBytes = Number(step.minBytes ?? 1);
      if (!Number.isFinite(minBytes) || minBytes < 0) throw new TypeError(`${label}: minBytes must be non-negative`);
      if (bytes.length < minBytes) throw new Error(`${label}: expected at least ${minBytes} bytes, got ${bytes.length}`);
      if (step.startsWith != null) {
        const prefix = Buffer.from(String(step.startsWith), 'utf8');
        if (!bytes.subarray(0, prefix.length).equals(prefix)) throw new Error(`${label}: file does not start with ${JSON.stringify(String(step.startsWith))}`);
      }
      if (String(step.startsWith || '') === '%PDF-' && bytes.subarray(0,5).toString('utf8') !== '%PDF-') {
        throw new Error(`${label}: invalid PDF signature`);
      }
      break;
    }
    case 'expectNoHorizontalOverflow': {
      const tolerancePx = Number(step.tolerancePx ?? 2);
      if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new TypeError(`${label}: tolerancePx must be a non-negative number`);
      let measurement;
      if (step.selector || step.testId || step.role || step.text || step.label) {
        const target = locator(page, step).first();
        await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
        measurement = await target.evaluate((element, tolerance) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          ok: element.scrollWidth <= element.clientWidth + tolerance,
        }), tolerancePx);
      } else {
        measurement = await page.evaluate(tolerance => {
          const element = document.documentElement;
          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            ok: element.scrollWidth <= element.clientWidth + tolerance,
          };
        }, tolerancePx);
      }
      if (!measurement.ok) {
        throw new Error(`${label}: horizontal overflow detected (${measurement.scrollWidth}px > ${measurement.clientWidth}px + ${tolerancePx}px tolerance)`);
      }
      break;
    }
    case 'expectText': {
      const expected = step.expected ?? '';
      const target = locator(page, step);
      const timeoutMs = Number(step.timeoutMs ?? 10000);
      const deadline = Date.now() + timeoutMs;
      let texts = [];
      while (true) {
        texts = await target.allTextContents();
        if (texts.some(actual => actual.includes(expected))) break;
        if (Date.now() >= deadline) {
          throw new Error(`${label}: expected text ${JSON.stringify(expected)}, got ${JSON.stringify(texts.join(' | '))}`);
        }
        await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
      }
      break;
    }
    case 'expectURL': {
      const actual = page.url();
      if (step.equals && actual !== step.equals) throw new Error(`${label}: URL mismatch: ${actual}`);
      if (step.includes && !actual.includes(step.includes)) throw new Error(`${label}: URL does not include ${step.includes}: ${actual}`);
      break;
    }
    case 'screenshot': {
      await page.screenshot({ path: path.join(screenshotsDir, `${label}.png`), fullPage: step.fullPage ?? false });
      break;
    }
    case 'capability': {
      if (!step.name || typeof step.name !== 'string') throw new Error('capability requires name');
      const capability = adapter?.capabilities?.[step.name];
      if (typeof capability !== 'function') throw new Error(`Missing demo adapter capability: ${step.name}`);
      await capability({ page, step, runtimeContext });
      break;
    }
    default: throw new Error(`Unsupported QA action: ${step.action}`);
  }
  if (step.holdMs != null) {
    if (!Number.isFinite(step.holdMs) || step.holdMs < 0) throw new TypeError(`${label}: holdMs must be a non-negative number`);
    if (step.holdMs > 0) await page.waitForTimeout(step.holdMs);
  }
  return label;
}
