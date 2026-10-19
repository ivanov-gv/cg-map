// Service-worker update requests bypass its fetch cache. The worker reloads
// open tabs only after the complete replacement shell has installed.
export async function registerAppUpdates() {
 const registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
 let checking=false;
 const check=async()=>{
  if(checking||!navigator.onLine||document.visibilityState==='hidden')return;
  checking=true;
  try{await registration.update();}catch{/* Keep the installed map when offline or a release is unavailable. */}
  finally{checking=false;}
 };
 window.addEventListener('online',check);
 window.addEventListener('pageshow',check);
 document.addEventListener('visibilitychange',check);
 window.setInterval(check,60_000);
 void check();
 return registration;
}
