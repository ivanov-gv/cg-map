import {formatBytes} from './core.js';
export class ArchiveSource {
 constructor(url,manifest){this.url=url;this.manifest=manifest;this.remote=new pmtiles.FetchSource(url);this.local=null;this.dir=null;this.onlineBlob=null;this.firstBlock=null;this.transportReady=null;this.filename='map-'+manifest.archive.sha256+'.pmtiles';}
 getKey(){return this.url;}
 async init(){
  if(!navigator.storage?.getDirectory)return false;
  this.dir=await navigator.storage.getDirectory();
  // Only a checksum-verified download writes this activation marker.
  if(localStorage.getItem('kompas-active-map')!==this.filename)return false;
  try{const h=await this.dir.getFileHandle(this.filename);const f=await h.getFile();if(f.size!==this.manifest.archive.bytes)throw new Error('Incomplete local map');this.local=f;return true;}catch{localStorage.removeItem('kompas-active-map');return false;}
 }
 async getBytes(offset,length,signal,etag){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(this.local)return {data:await this.local.slice(offset,offset+length).arrayBuffer()};
  // Detect hosts that ignore Range once, then reuse their complete response.
  if(!this.transportReady)this.transportReady=this.prepareTransport().catch(e=>{this.transportReady=null;throw e;});
  await this.transportReady;
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(this.onlineBlob)return {data:await this.onlineBlob.slice(offset,offset+length).arrayBuffer()};
  if(this.firstBlock&&offset+length<=this.firstBlock.byteLength)return {data:this.firstBlock.slice(offset,offset+length)};
  return this.remote.getBytes(offset,length,signal,etag);
 }
 async prepareTransport(){
  const response=await fetch(this.url,{headers:{Range:'bytes=0-16383'}});
  if(response.status===206){this.firstBlock=await response.arrayBuffer();return;}
  if(response.status!==200)throw new Error('Map request failed: HTTP '+response.status);
  const blob=await response.blob();
  if(blob.size!==this.manifest.archive.bytes)throw new Error('The map package is incomplete. Check your connection and retry.');
  this.onlineBlob=blob;
 }
 async download(signal,onProgress){
  if(!this.dir)throw new Error('Offline downloads require HTTPS or localhost, and a browser with local file storage.');
  const estimate=await navigator.storage.estimate();
  if(estimate.quota&&estimate.usage&&estimate.quota-estimate.usage<this.manifest.archive.bytes*2)throw new Error('Not enough storage. Free some space and try again.');
  const shell=await caches.open(this.manifest.shellCache);
  // Complete the shell first. A partial download never activates a new package.
  for(const asset of this.manifest.shell){if(signal.aborted)throw new DOMException('Aborted','AbortError');const url=new URL(asset,location.href);const response=await fetch(url,{cache:'reload',signal});if(!response.ok)throw new Error('Could not save '+asset);await shell.put(url,response);}
  const response=await fetch(this.url,{signal,cache:'no-store'});
  if(!response.ok)throw new Error('Map download failed: HTTP '+response.status);
  const staging=this.filename+'.partial';const handle=await this.dir.getFileHandle(staging,{create:true});const writable=await handle.createWritable();let loaded=0;
  try{
   const reader=response.body.getReader();
   while(true){const {done,value}=await reader.read();if(done)break;if(signal.aborted)throw new DOMException('Aborted','AbortError');await writable.write(value);loaded+=value.byteLength;onProgress(loaded,this.manifest.archive.bytes);}
   await writable.close();
   const staged=await handle.getFile();
   if(staged.size!==this.manifest.archive.bytes)throw new Error('Incomplete map download. Please try again.');
   // This PoC archive is bounded (~12 MB). Hashing once temporarily uses that much RAM.
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await staged.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
   if(hash!==this.manifest.archive.sha256)throw new Error('Map integrity check failed. Please try again.');
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const finalHandle=await this.dir.getFileHandle(this.filename,{create:true});const finalWriter=await finalHandle.createWritable();
   try{await staged.stream().pipeTo(finalWriter);}catch(e){try{await finalWriter.abort();}catch{}throw e;}
   // Commit last. An older active archive remains valid until this point.
   const old=localStorage.getItem('kompas-active-map');localStorage.setItem('kompas-active-map',this.filename);this.local=await finalHandle.getFile();this.onlineBlob=null;this.firstBlock=null;this.transportReady=null;
   if(old&&old!==this.filename)await this.dir.removeEntry(old).catch(()=>{});
   const persisted=await navigator.storage.persist?.().catch(()=>false);return {persisted,bytes:loaded};
  }catch(e){try{await writable.abort();}catch{}throw e;}finally{await this.dir.removeEntry(staging).catch(()=>{});}
 }
 async remove(){this.local=null;const active=localStorage.getItem('kompas-active-map');localStorage.removeItem('kompas-active-map');if(active&&this.dir)await this.dir.removeEntry(active).catch(()=>{});}
}
export function downloadLabel(manifest){return 'Download offline · '+formatBytes(manifest.totalBytes);}
