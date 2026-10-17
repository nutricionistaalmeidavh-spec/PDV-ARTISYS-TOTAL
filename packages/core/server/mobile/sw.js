'use strict';

const CACHE='artisys-mobile-v3';
const SHELL=['/mobile/','/mobile/index.html','/mobile/styles.css','/mobile/app.js','/mobile/pwa.js','/mobile/icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==location.origin)return;if(url.pathname.startsWith('/api/'))return;event.respondWith(fetch(request).then(response=>{if(response.ok&&url.pathname.startsWith('/mobile/')){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request).then(cached=>cached||caches.match('/mobile/'))));});
