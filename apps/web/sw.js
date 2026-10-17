/* PDV Total PWA: only public, immutable app assets are cached.
   No authenticated API data, checkout state, sales, inventory or mutations.
   The offline shell is read-only; online server remains the sole authority. */
const SHELL='__SHELL_CACHE__';
const PUBLIC_ASSETS=__ASSET_PRECACHE__;
const API_PATH=/^\/api(?:\/|$)/;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(PUBLIC_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith('pdv-total-shell-')&&name!==SHELL).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||API_PATH.test(url.pathname)||request.method!=='GET')return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).catch(async()=>(
      (await caches.match('/index.html'))||Response.error()
    )));
    return;
  }
  if(!PUBLIC_ASSETS.includes(url.pathname))return;
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
