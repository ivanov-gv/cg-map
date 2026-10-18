/* Shell only: PMTiles byte ranges are handled by the archive reader, never cached as full responses. */
importScripts('offline-manifest.js');
const config=self.KOMPAS_OFFLINE;
// One-time recovery for the initial startup and cached-navigation failures.
const brokenCaches=new Set(['kompas-shell-4c2a2bbe7700c4fe-d4f4f7de','kompas-shell-2be1e80ac42b70e0-d4f4f7de','kompas-shell-d2645f8b2c0612c3-d4f4f7de']);
function navigationSafeResponse(response){
 if(!response?.redirected)return response;
 // A followed redirect cannot satisfy Chrome's redirect:manual navigation.
 // Rebuild from the decoded body; preserve content type but not wire encoding.
 const headers=new Headers(response.headers);
 headers.delete('Content-Encoding');headers.delete('Content-Length');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(config.shellCache);
 await cache.addAll(config.shell.map(p=>new URL(p,self.registration.scope).href));
 // Activate this critical startup repair even while the broken page is open.
 if((await caches.keys()).some(key=>brokenCaches.has(key)))await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 for(const key of keys)if(key.startsWith('kompas-shell-')&&key!==config.shellCache)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope)||event.request.headers.has('Range')||url.pathname.endsWith('.pmtiles'))return;
 event.respondWith((async()=>{
  const cache=await caches.open(config.shellCache);
  const cached=await cache.match(event.request);
  if(cached)return navigationSafeResponse(cached);
  if(event.request.mode==='navigate'){
   const index=await cache.match(new URL('index.html',self.registration.scope));
   return index?navigationSafeResponse(index):fetch(event.request);
  }
  // No catch-all cache: external links and unknown requests never become offline assets.
  return fetch(event.request);
 })());
});
