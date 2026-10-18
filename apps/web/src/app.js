import {categories,colors,matches,selectNearest,safeWebsite,collection} from './core.js';
import {mapStyle} from './map-style.js';
import {installSatellite,setSatelliteVisible,satelliteBounds} from './satellite.js';
import {ArchiveSource,downloadLabel} from './offline.js';
import {installTransport,TransportFeed} from './transport.js';
import {describePoint,endpointFeatures,installRoutePoints} from './point-selection.js';
import {RoutePlanner} from './route-planner.js';
import {installMapTaps} from './map-taps.js';
const $=id=>document.getElementById(id);
let map,all=[],filtered=[],byId=new Map(),category='all',selected=null,archive,manifest,downloadAbort,returnFocus;
let satelliteVisible=false,transport,selectedPoint,routePlanner;
const endpoints={from:null,to:null};
let loaded=false,errorTimer,searchTimer,frame=0,serviceWorkerRegistration=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function renderTransportStatus({state,count,fetchedAt}){
 const checked=fetchedAt?new Date(fetchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
 const labels={off:'Transport off',loading:'Loading live buses…',live:count?`${count} bus position${count===1?'':'s'} · checked ${checked}`:`No buses reported · checked ${checked}`,stale:`Updates delayed · last checked ${checked}`,unavailable:'Live buses temporarily unavailable · retrying',offline:'Live buses need an internet connection',paused:'Bus updates paused while map is hidden'};
 $('transport-status').textContent=labels[state]??labels.unavailable;
 $('transport-status').dataset.state=state;
}
function notify(message){$('error-text').textContent=message;$('error').hidden=false;}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function closePlace(){selectedPoint=null;selected=null;$('place-card').hidden=true;map?.getSource('selected')?.setData(collection([]));for(const e of document.querySelectorAll('.result[aria-current]'))e.removeAttribute('aria-current');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
function showPlace(id,trigger){const f=byId.get(String(id));if(!f)return;selected=f;selectedPoint={name:f.properties.name,coordinates:[...f.geometry.coordinates]};returnFocus=trigger??null;const p=f.properties;$('place-name').textContent=p.name;$('place-category').textContent=categories[p.category]??p.category;
 const details=$('place-details');details.replaceChildren();
 const add=text=>{if(text)details.append(node('p',text,'detail'));};
 add(p['name:en']&&p['name:en']!==p.name?p['name:en']:'');add([p['addr:street'],p['addr:housenumber']].filter(Boolean).join(' '));add(p.kind?.replaceAll('_',' '));add(p.opening_hours?'OSM hours: '+p.opening_hours:'');add(p.phone);add(f.geometry.coordinates.slice().reverse().map(n=>n.toFixed(5)).join(', '));
 details.append(node('p','OpenStreetMap listing. Details may be incomplete or out of date.','source-note'));
 function link(text,url){const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
 const website=safeWebsite(p.website);if(website)link('Website ↗',website);
 if(/^(node|way)\/\d+$/.test(p.id))link('View source ↗','https://www.openstreetmap.org/'+p.id);
 $('place-card').hidden=false;document.querySelector('.sidebar').classList.remove('results-open');$('toggle-results').setAttribute('aria-expanded','false');
 map.getSource('selected').setData(collection([f]));map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom(),15),duration:reduced?0:450});$('close-place').focus({preventScroll:true});
}
function showPoint(point) {
 closePlace();selectedPoint=point;
 $('place-name').textContent=point.name;$('place-category').textContent=point.kind;
 const details=$('place-details');details.replaceChildren();
 for(const text of [...point.details,point.coordinates.slice().reverse().map(n=>n.toFixed(5)).join(', ')]) {
  if(text)details.append(node('p',text,'detail'));
 }
 $('place-card').hidden=false;
 document.querySelector('.sidebar').classList.remove('results-open');$('toggle-results').setAttribute('aria-expanded','false');
 map.getSource('selected').setData(collection([{type:'Feature',geometry:{type:'Point',coordinates:point.coordinates},properties:{}}]));
 $('close-place').focus({preventScroll:true});
}
function renderEndpoints() {
 for(const role of ['from','to']) {
  const point=endpoints[role];
  $('route-'+role).textContent=point?`${point.name} · ${point.coordinates.slice().reverse().map(n=>n.toFixed(5)).join(', ')}`:'Not selected';
 }
 $('route-endpoints').hidden=!endpoints.from&&!endpoints.to;
 map.getSource('route-points').setData(endpointFeatures(endpoints));
 routePlanner?.setEndpoints(endpoints);
}
function setEndpoint(role) {
 if(!selectedPoint)return;
 endpoints[role]={name:selectedPoint.name,coordinates:[...selectedPoint.coordinates]};
 renderEndpoints();closePlace();
}
function renderResults(){if(!map)return;const center=map.getCenter().toArray();const nearest=selectNearest(filtered,center);const list=$('results');list.replaceChildren();
 $('toggle-results').textContent=`${filtered.length.toLocaleString()} places · nearest first`;
 if(!nearest.length){list.append(node('p','No places found. Try another search or category.','empty'));return;}
 for(const {f,d} of nearest){const p=f.properties;const button=node('button',undefined,'result');button.type='button';button.dataset.id=p.id;if(selected?.properties.id===p.id)button.setAttribute('aria-current','true');
  const symbol=node('span',p.category==='essentials'?'+':(p.kind??p.category)[0].toUpperCase(),'symbol');symbol.style.setProperty('--color',colors[p.category]);symbol.setAttribute('aria-hidden','true');const copy=node('span',undefined,'copy');copy.append(node('strong',p.name),node('small',(p.kind??'').replaceAll('_',' ')));button.append(symbol,copy,node('span',d<1?Math.round(d*1000)+' m':d.toFixed(1)+' km','distance'));button.addEventListener('click',()=>showPlace(p.id,button));list.append(button);
 }
}
function filterPlaces(){filtered=all.filter(f=>matches(f,$('search').value,category));if(loaded)map.getSource('places').setData(collection(filtered));if(selected&&!filtered.some(f=>f.properties.id===selected.properties.id))closePlace();renderResults();}
function updateConnection(){const offline=!!archive?.local;$('connection').textContent=offline?'Exploring offline':navigator.onLine?'Exploring Montenegro':'Offline · download needed';}
function updateDownload(){if(!manifest)return;const ready=!!archive?.local;$('download-title').textContent=ready?'Map saved for offline use':downloadLabel(manifest);$('download-state').textContent=ready?'READY':'';$('download').disabled=ready||!archive?.dir||!serviceWorkerRegistration;$('remove-download').hidden=!ready;if(!archive?.dir)$('storage-note').textContent='Use HTTPS or localhost with Chrome to enable offline downloads.';updateConnection();}
async function startDownload(){if(downloadAbort)return;downloadAbort=new AbortController();$('download').disabled=true;$('cancel-download').hidden=false;$('download-progress').hidden=false;$('error').hidden=true;
 try{
  await navigator.serviceWorker.ready;
  const result=await archive.download(downloadAbort.signal,(done,total)=>{$('download-progress').value=done/total*100;$('download-title').textContent=`Saving map… ${Math.min(100,Math.round(done/total*100))}%`;});
  $('storage-note').textContent=result.persisted?'Saved on this device. Ready for offline use.':'Saved. Your browser may remove downloads when storage is low.';
 }catch(e){if(e.name!=='AbortError')notify(e.message);else $('storage-note').textContent='Download cancelled. Existing downloads remain available.';}
 finally{downloadAbort=null;$('cancel-download').hidden=true;$('download-progress').hidden=true;updateDownload();}
}
async function start(){
 if(location.protocol==='file:'||location.protocol==='content:'){notify('Open Kompas through the supplied local server or an HTTPS address. A downloaded HTML file cannot install the offline app.');$('loading').hidden=true;return;}
 if(!globalThis.maplibregl||!globalThis.pmtiles){notify('The bundled map libraries did not load. Check the application files.');return;}
 // This MapLibre bundle has no supported() helper. Map construction reports
 // graphics initialization errors through the existing startup catch handler.
 const responses=await Promise.all([fetch('data/manifest.json'),fetch('data/places.geojson')]);if(responses.some(r=>!r.ok))throw new Error('Could not load map metadata or places.');
 [manifest,{features:all}]=await Promise.all(responses.map(r=>r.json()));all=all.map((f,i)=>({...f,id:i+1}));byId=new Map(all.map(f=>[String(f.properties.id),f]));filtered=all;
 if('serviceWorker' in navigator&&isSecureContext){serviceWorkerRegistration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}).catch(e=>{notify('Offline setup failed: '+e.message);return null;});}
 archive=new ArchiveSource(new URL(manifest.archive.path,location.href).href,manifest);try{await archive.init();}catch(e){$('storage-note').textContent='Local storage unavailable. Online map is still usable.';}
 updateDownload();
 const protocol=new pmtiles.Protocol();protocol.add(new pmtiles.PMTiles(archive));maplibregl.addProtocol('pmtiles',protocol.tile);
 map=new maplibregl.Map({container:'map',style:mapStyle(archive.url),center:[19.26,42.437],zoom:14,minZoom:7,maxZoom:23,maxBounds:[[17.8,41.3],[21,44.1]],renderWorldCopies:false,attributionControl:{compact:true},fadeDuration:0,maxTileCacheSize:160,pixelRatio:Math.min(devicePixelRatio||1,2),refreshExpiredTiles:false});
 // Exposed for the supplied browser QA script and manual performance inspection.
 window.kompasDebug={get map(){return map;},get endpoints(){return structuredClone(endpoints);},get offline(){return !!archive.local;},get selected(){return selected?.properties.id??null;},get placeCount(){return all.length;},get satellite(){return satelliteVisible;},get transport(){return !!transport?.enabled;}};
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.addControl(new maplibregl.ScaleControl({maxWidth:100}),'bottom-left');
 const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.resize());});observer.observe($('map'));
 map.on('load',()=>{
  installSatellite(map,location.href);
  $('satellite-toggle').disabled=false;
  map.addSource('places',{type:'geojson',data:collection(filtered),cluster:true,clusterRadius:38,clusterMaxZoom:13});
  map.addLayer({id:'clusters',type:'circle',source:'places',filter:['has','point_count'],paint:{'circle-color':'#294d3c','circle-radius':['step',['get','point_count'],17,50,22,200,27],'circle-stroke-color':'#fffef8','circle-stroke-width':2}});
  map.addLayer({id:'cluster-count',type:'symbol',source:'places',filter:['has','point_count'],layout:{'text-field':['to-string',['get','point_count_abbreviated']],'text-font':['Open Sans Semibold'],'text-size':11},paint:{'text-color':'#ffffff'}});
  map.addLayer({id:'place-circles',type:'circle',source:'places',filter:['!', ['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,5,15,10,18,12],'circle-color':['match',['get','category'],...Object.entries(colors).flat(),'#75899b'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
  map.addLayer({id:'place-names',type:'symbol',source:'places',minzoom:15.5,filter:['!', ['has','point_count']],layout:{'text-field':['coalesce',['get','name:en'],['get','name']],'text-font':['Open Sans Semibold'],'text-size':11,'text-anchor':'top','text-offset':[0,1.3],'text-max-width':11},paint:{'text-color':'#304c3e','text-halo-color':'#fffff9','text-halo-width':2}});
  map.addSource('selected',{type:'geojson',data:collection([])});map.addLayer({id:'selected-halo',type:'circle',source:'selected',paint:{'circle-radius':17,'circle-color':'#193f36','circle-opacity':.18,'circle-stroke-color':'#193f36','circle-stroke-width':2}});
  const cities=[['Podgorica',19.26,42.437],['Nikšić',18.944,42.774],['Cetinje',18.922,42.39],['Budva',18.84,42.286],['Kotor',18.771,42.424],['Bar',19.098,42.092],['Ulcinj',19.206,41.929],['Herceg Novi',18.537,42.454],['Žabljak',19.121,43.154],['Pljevlja',19.359,43.357],['Kolašin',19.522,42.824],['Berane',19.87,42.843]];
  map.addSource('cities',{type:'geojson',data:collection(cities.map(([name,x,y])=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{name}})))});map.addLayer({id:'city-names',type:'symbol',source:'cities',maxzoom:13,layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':13},paint:{'text-color':'#3c5945','text-halo-color':'#fafaf0','text-halo-width':2}});
  installTransport(map);
  installRoutePoints(map);
  routePlanner=new RoutePlanner(map);
  transport=new TransportFeed(map,{onStatus:renderTransportStatus});
  $('transport-toggle').disabled=false;
  loaded=true;$('loading').hidden=true;renderResults();
 });
 map.on('moveend',renderResults);
 installMapTaps(map,async e=>{
  if(!loaded)return;
  const routePoints=map.queryRenderedFeatures(e.point,{layers:['route-point-circles']});
  if(routePoints.length){const f=routePoints[0];showPoint({name:f.properties.name,coordinates:[...f.geometry.coordinates],kind:f.properties.role==='from'?'From point':'To point',details:[]});return;}
  const stops=map.queryRenderedFeatures(e.point,{layers:['transport-stops']});
  if(stops.length){showPoint(describePoint(stops[0],e.lngLat.toArray()));return;}
  const hits=map.queryRenderedFeatures(e.point,{layers:['place-circles','place-names','clusters']});
  const hit=hits[0];
  if(hit){
   if(hit.properties.cluster){const zoom=await map.getSource('places').getClusterExpansionZoom(hit.properties.cluster_id);map.easeTo({center:hit.geometry.coordinates,zoom,duration:reduced?0:350});}
   else showPlace(hit.properties.id);
   return;
  }
  const features=map.queryRenderedFeatures(e.point,{layers:['building-numbers','buildings','road-labels','minor-roads','major-roads','land','water','rivers']});
  const feature=features.find(f=>f.layer.id==='building-numbers')??features.find(f=>f.layer.id==='buildings')??features.find(f=>f.layer.id==='road-labels'||f.layer.id==='minor-roads'||f.layer.id==='major-roads')??features.find(f=>f.layer.id==='land'&&f.properties.kind==='park')??features.find(f=>f.layer.id==='water'||f.layer.id==='rivers');
  showPoint(describePoint(feature,e.lngLat.toArray()));
 });
 map.on('mousemove',()=>{if(loaded)map.getCanvas().style.cursor='crosshair';});
 map.on('error',e=>{console.error('Map error',e.error);clearTimeout(errorTimer);errorTimer=setTimeout(()=>notify('Some map data could not load. Check your connection or download the map for offline use.'),1500);});
 map.on('webglcontextlost',()=>notify('The browser paused graphics rendering. Waiting for it to recover…'));map.on('webglcontextrestored',()=>{$('error').hidden=true;map.triggerRepaint();});
 setTimeout(()=>{if(!loaded){$('loading').hidden=true;notify('Map startup is taking longer than expected. Check your connection and try again.');}},20000);
}
for(const [key,label] of Object.entries(categories)){const b=node('button',label);b.type='button';b.setAttribute('aria-pressed',String(key===category));b.addEventListener('click',()=>{category=key;for(const other of $('categories').children)other.setAttribute('aria-pressed',String(other===b));filterPlaces();});$('categories').append(b);}
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filterPlaces,120);});
$('point-from').addEventListener('click',()=>setEndpoint('from'));
$('point-to').addEventListener('click',()=>setEndpoint('to'));
$('clear-route-points').addEventListener('click',()=>{endpoints.from=null;endpoints.to=null;renderEndpoints();});
$('close-place').addEventListener('click',closePlace);document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePlace();document.querySelector('.sidebar').classList.remove('results-open');$('toggle-results').setAttribute('aria-expanded','false');}if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'){e.preventDefault();$('search').focus();}});
$('toggle-results').addEventListener('click',()=>{const open=document.querySelector('.sidebar').classList.toggle('results-open');$('toggle-results').setAttribute('aria-expanded',String(open));});
$('reset').addEventListener('click',()=>{$('search').value='';$('categories').firstElementChild.click();closePlace();});
$('overview').addEventListener('click',()=>{closePlace();map?.fitBounds([[18.42,41.84],[20.36,43.57]],{padding:55,duration:reduced?0:700});});
$('podgorica').addEventListener('click',()=>{closePlace();map?.easeTo({center:[19.26,42.437],zoom:14,duration:reduced?0:600});});
$('satellite-toggle').addEventListener('click',()=>{
 if(!loaded)return;
 satelliteVisible=!satelliteVisible;setSatelliteVisible(map,satelliteVisible);
 $('satellite-toggle').setAttribute('aria-pressed',String(satelliteVisible));
 $('satellite-toggle').textContent=satelliteVisible?'Street map':'Satellite';
 $('satellite-note').hidden=!satelliteVisible;
 if(satelliteVisible){closePlace();const [w,s,e,n]=satelliteBounds;map.easeTo({center:[(w+e)/2,(s+n)/2],zoom:17.5,duration:reduced?0:600});}
});
$('transport-toggle').addEventListener('click',()=>{
 if(!transport)return;
 const enabled=!transport.enabled;
 if(!enabled&&selectedPoint?.kind==='Bus stop')closePlace();
 $('transport-toggle').setAttribute('aria-pressed',String(enabled));
 $('transport-info').hidden=!enabled;
 transport.setEnabled(enabled);
 if(enabled){closePlace();map.easeTo({center:[19.26,42.44],zoom:12,duration:reduced?0:450});if(!navigator.onLine)transport.pause('offline');}
});
document.addEventListener('visibilitychange',()=>{if(!transport?.enabled)return;if(document.hidden)transport.pause('paused');else if(navigator.onLine)transport.refresh();});
addEventListener('offline',()=>transport?.pause('offline'));
addEventListener('online',()=>{if(transport?.enabled&&!document.hidden)transport.refresh();});
$('download').addEventListener('click',startDownload);$('cancel-download').addEventListener('click',()=>downloadAbort?.abort());$('remove-download').addEventListener('click',async()=>{await archive.remove();updateDownload();});
$('retry').addEventListener('click',()=>location.reload());addEventListener('online',updateConnection);addEventListener('offline',updateConnection);
start().catch(e=>{console.error(e);$('loading').hidden=true;notify(e.message||'Map startup failed.');});
