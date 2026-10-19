/* Shell only: PMTiles byte ranges are handled by the archive reader, never cached as full responses. */
importScripts('offline-manifest.js');
const config=self.KOMPAS_OFFLINE;
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
 // Bypass the browser HTTP cache when installing a new release.
 await cache.addAll(config.shell.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 const upgrading=keys.some(key=>key.startsWith('kompas-shell-')&&key!==config.shellCache);
 const windows=upgrading?await self.clients.matchAll({type:'window',includeUncontrolled:true}):[];
 for(const key of keys)if(key.startsWith('kompas-shell-')&&key!==config.shellCache)await caches.delete(key);
 await self.clients.claim();
 // Do not await navigation inside activation: its fetch waits for activation
 // to finish. Initiating it here also updates tabs running older app code.
 for(const client of windows)if(client.url.startsWith(self.registration.scope)) {
  void client.navigate(client.url).catch(()=>{});
 }
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
