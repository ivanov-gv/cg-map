import http from 'node:http';
import fs from 'node:fs';

// A real two-release host: browser route mocks do not intercept worker fetches.
export async function startUpdateServer(scope) {
 let version=1,fail=false,failures=0;
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(scope.length);
  const types={'sw.js':'text/javascript','offline-manifest.js':'text/javascript','app-updates.js':'text/javascript','version.txt':'text/plain'};
  res.setHeader('Content-Type',types[name]??'text/html');
  res.setHeader('Cache-Control',['sw.js','offline-manifest.js'].includes(name)?'no-cache':'public, max-age=3600');
  if(name==='sw.js')return res.end(fs.readFileSync('dist/web/sw.js'));
  if(name==='app-updates.js')return res.end(fs.readFileSync('dist/web/app-updates.js'));
  if(name==='offline-manifest.js')return res.end('self.KOMPAS_OFFLINE='+JSON.stringify({shellCache:'kompas-shell-update-test-'+version,shell:['index.html','app-updates.js','version.txt']})+';');
  if(name==='version.txt'){
   if(fail){failures++;res.statusCode=503;return res.end('Incomplete release');}
   return res.end(String(version));
  }
  res.end(`<!doctype html><title>Update fixture</title><p id="version">${version}</p>
   <script>sessionStorage.loads=String(Number(sessionStorage.loads||0)+1);</script>
   <script type="module">import {registerAppUpdates} from './app-updates.js';window.registration=await registerAppUpdates();</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {
  url:`http://127.0.0.1:${server.address().port}${scope}`,
  release:(next,incomplete=false)=>{version=next;fail=incomplete;},
  get failures(){return failures;},
  close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})
 };
}
