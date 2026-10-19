// Check once per page load. The worker reloads open tabs only after the
// complete replacement shell has installed; no background checks are scheduled.
export async function registerAppUpdates() {
 const registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
 void registration.update().catch(()=>{/* Keep the installed map if the update is unavailable. */});
 return registration;
}
