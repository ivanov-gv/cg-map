import {categories,colors,matches,selectNearest,safeWebsite,collection,DEFAULT_CENTER,DISCOVER_ZOOM,PLACE_SCALE_FILTER,POSITION_APPROXIMATE_M,formatAge} from './core.js';
import {mapStyle,installBuildingNumberScale} from './map-style.js';
import {installSatellite,setSatelliteVisible,satelliteBounds} from './satellite.js';
import {ArchiveSource,downloadLabel} from './offline.js';
import {installTransport,TransportFeed} from './transport.js';
import {describePoint,buildingAddressIndex,endpointFeatures,installRoutePoints} from './point-selection.js';
import {RoutePlanner} from './route-planner.js';
import {ObjectSelection} from './object-selection.js';
import {registerAppUpdates} from './app-updates.js';
import {resolveDataMode,dataEndpoints,basemapURL} from './data-mode.js';
import {installMapTaps} from './map-taps.js';
import {installPlaceIcons,placeIconId} from './poi-icons.js';
import {PositionTracker,positionFeatures,installPositionLayers} from './position.js';
const $=id=>document.getElementById(id);
let map,all=[],filtered=[],byId=new Map(),category='all',selected=null,archive,manifest,downloadAbort,returnFocus;
let satelliteVisible=false,transport,selectedPoint,routePlanner,objectSelection,dataMode,api;
const endpoints={from:null,to:null};
let loaded=false,errorTimer,searchTimer,frame=0,serviceWorkerRegistration=null,buildingAddresses=new Map();
let placesError=null,position={state:'idle',fix:null,age:null},explored=false,ownMove=false,centeredOnFix=false;
const MAP_BOUNDS=[[17.8,41.3],[21,44.1]];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
// config.json comes from the host: the Go server answers {"api":"server"}, static hosts serve the
// artifact's {"api":"mock"}. A missing file, an offline start or a server error falls back to the
// bundled data (a server error visibly). Other HTTP errors and invalid content stop startup.
async function loadDataMode(){
 let response=null,config=null;
 try{response=await fetch('config.json',{cache:'no-store'});}catch(e){console.warn('config.json unreachable (offline start); using bundled data',e);}
 if(response?.ok){try{config=await response.json();}catch(e){throw new Error('Invalid config.json: '+e.message,{cause:e});}}
 else if(response&&response.status>=500){notify(`Server settings unavailable (HTTP ${response.status}). Showing preview data; live buses use the public relay.`);}
 else if(response&&response.status!==404)throw new Error('Could not load config.json: HTTP '+response.status);
 return resolveDataMode(location.search,config);
}
function renderTransportStatus({state,count,fetchedAt}){
 const checked=fetchedAt?new Date(fetchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
 const labels={off:'Transport off',loading:'Loading live buses…',live:count?`${count} bus position${count===1?'':'s'} · checked ${checked}`:`No buses reported · checked ${checked}`,stale:`Updates delayed · last checked ${checked}`,unavailable:'Live buses temporarily unavailable · retrying',offline:'Live buses need an internet connection',paused:'Bus updates paused while map is hidden'};
 $('transport-status').textContent=labels[state]??labels.unavailable;
 $('transport-status').dataset.state=state;
}
function notify(message){$('error-text').textContent=message;$('error').hidden=false;}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function closePlace(){selectedPoint=null;selected=null;$('place-card').hidden=true;objectSelection?.clear();for(const e of document.querySelectorAll('.result[aria-current]'))e.removeAttribute('aria-current');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
function showPlace(id,trigger){const f=byId.get(String(id));if(!f)return;selected=f;selectedPoint={name:f.properties.name,coordinates:[...f.geometry.coordinates]};returnFocus=trigger??null;const p=f.properties;$('place-name').textContent=p.name;$('place-category').textContent=categories[p.category]??p.category;
 const details=$('place-details');details.replaceChildren();
 const add=text=>{if(text)details.append(node('p',text,'detail'));};
 add(p['name:en']&&p['name:en']!==p.name?p['name:en']:'');add([p['addr:street'],p['addr:housenumber']].filter(Boolean).join(' '));add(p.kind?.replaceAll('_',' '));add(p.opening_hours?'OSM hours: '+p.opening_hours:'');add(p.phone);add(f.geometry.coordinates.slice().reverse().map(n=>n.toFixed(5)).join(', '));
 details.append(node('p','OpenStreetMap listing. Details may be incomplete or out of date.','source-note'));
 function link(text,url){const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
 const website=safeWebsite(p.website);if(website)link('Website ↗',website);
 if(/^(node|way)\/\d+$/.test(p.id))link('View source ↗','https://www.openstreetmap.org/'+p.id);
 $('place-card').hidden=false;document.querySelector('.sidebar').classList.remove('results-open');$('toggle-results').setAttribute('aria-expanded','false');
 explored=true;objectSelection.selectPlace(f);map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom(),15),duration:reduced?0:450});$('close-place').focus({preventScroll:true});
}
function showPoint(point,feature=null) {
 closePlace();selectedPoint=point;
 $('place-name').textContent=point.name;$('place-category').textContent=point.kind;
 const details=$('place-details');details.replaceChildren();
 for(const text of [...point.details,point.coordinates.slice().reverse().map(n=>n.toFixed(5)).join(', ')]) {
  if(text)details.append(node('p',text,'detail'));
 }
 $('place-card').hidden=false;
 document.querySelector('.sidebar').classList.remove('results-open');$('toggle-results').setAttribute('aria-expanded','false');
 objectSelection.select(feature,point.coordinates);
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
function renderResults(){if(!map)return;
 // A failed load is an error state, never an empty search result.
 if(placesError){$('toggle-results').textContent='Places unavailable';$('results').replaceChildren(node('p',`Places could not load (${placesError}). Reload to try again.`,'empty'));return;}
 const center=map.getCenter().toArray();const nearest=selectNearest(filtered,center);const list=$('results');list.replaceChildren();
 $('toggle-results').textContent=`${filtered.length.toLocaleString()} places · nearest first`;
 if(!nearest.length){list.append(node('p','No places found. Try another search or category.','empty'));return;}
 for(const {f,d} of nearest){const p=f.properties;const button=node('button',undefined,'result');button.type='button';button.dataset.id=p.id;if(selected?.properties.id===p.id)button.setAttribute('aria-current','true');
  const symbol=node('span',p.category==='essentials'?'+':(p.kind??p.category)[0].toUpperCase(),'symbol');symbol.style.setProperty('--color',colors[p.category]);symbol.setAttribute('aria-hidden','true');const copy=node('span',undefined,'copy');copy.append(node('strong',p.name),node('small',(p.kind??'').replaceAll('_',' ')));button.append(symbol,copy,node('span',d<1?Math.round(d*1000)+' m':d.toFixed(1)+' km','distance'));button.addEventListener('click',()=>showPlace(p.id,button));list.append(button);
 }
}
// An explicit search or category choice may surface places at any scale; the default scene keeps scale eligibility.
function filterPlaces(){filtered=all.filter(f=>matches(f,$('search').value,category));if(loaded){map.getSource('places').setData(collection(filtered));map.setFilter('place-symbols',$('search').value.trim()||category!=='all'?null:PLACE_SCALE_FILTER);}if(selected&&!filtered.some(f=>f.properties.id===selected.properties.id))closePlace();renderResults();}
// Connection state only; it carries no location meaning. Online with no saved map needs no badge.
function updateConnection(){const saved=!!archive?.local;const text=!navigator.onLine?(saved?'Offline · saved map':'Offline · download needed'):saved?'Saved map in use':'';$('connection').textContent=text;$('connection').hidden=!text;}
// In server mode a download or removal during the session switches the basemap between the API and
// the verified local archive, so offline use never depends on uncached API tiles.
function refreshBasemap(){const source=map?.getSource('basemap');const url=basemapURL(api,archive.url,!!archive.local);if(source&&source.url!==url)source.setUrl(url);}
function updateDownload(){if(!manifest)return;refreshBasemap();const ready=!!archive?.local;$('download-title').textContent=ready?'Map saved for offline use':downloadLabel(manifest);$('download-state').textContent=ready?'READY':'';$('download').disabled=ready||!archive?.dir||!serviceWorkerRegistration;$('remove-download').hidden=!ready;if(!archive?.dir)$('storage-note').textContent='Use HTTPS or localhost with Chrome to enable offline downloads.';updateConnection();}
async function startDownload(){if(downloadAbort)return;downloadAbort=new AbortController();$('download').disabled=true;$('cancel-download').hidden=false;$('download-progress').hidden=false;$('error').hidden=true;
 try{
  await navigator.serviceWorker.ready;
  const result=await archive.download(downloadAbort.signal,(done,total)=>{$('download-progress').value=done/total*100;$('download-title').textContent=`Saving map… ${Math.min(100,Math.round(done/total*100))}%`;});
  $('storage-note').textContent=result.persisted?'Saved on this device. Ready for offline use.':'Saved. Your browser may remove downloads when storage is low.';
 }catch(e){if(e.name!=='AbortError')notify(e.message);else $('storage-note').textContent='Download cancelled. Existing downloads remain available.';}
 finally{downloadAbort=null;$('cancel-download').hidden=true;$('download-progress').hidden=true;updateDownload();}
}
async function loadJSON(path,what){
 const response=await fetch(path);if(!response.ok)throw new Error(`${what}: HTTP ${response.status}`);
 try{return await response.json();}catch(e){throw new Error(`${what}: invalid JSON`,{cause:e});}
}
// D-06: the status always names the location condition; without a fix the default camera is a fallback view.
let tracker;
function renderPosition(snapshot){
 position=snapshot;const {state,fix,age}=snapshot;
 const fallback=explored||(fix&&state!=='outside')?'':' · default view: Podgorica';
 const accuracy=fix?`±${Math.round(fix.accuracy)} m`:'';
 const texts={idle:'Checking location…',insecure:'Location needs a secure (HTTPS) page',unsupported:'This browser cannot share location',prompt:'Allow location to see where you are',acquiring:'Finding your location…',live:`You are here · ${accuracy}`,approximate:`Approximate location · ${accuracy} (over ${POSITION_APPROXIMATE_M} m)`,stale:`Location not updating · last fix ${formatAge(age??0)} ago`,denied:'Location blocked in browser settings',unavailable:'Location unavailable · check device settings',timeout:'No location fix within 15 s',outside:'You are outside the map (Montenegro)'};
 $('position-status').textContent=(texts[state]??texts.unavailable)+(['live','approximate','stale'].includes(state)?'':fallback);
 $('position-badge').dataset.state=state;
 // A browser-level block cannot be lifted from the page, so it gets no retry loop; the status says where to change it.
 const action={prompt:'Show my location',unavailable:'Try again',timeout:'Try again',live:'Recenter',approximate:'Recenter',stale:'Recenter'}[state];
 $('position-action').textContent=action??'';$('position-action').hidden=!action;
 if(!map?.getSource('position'))return;
 map.getSource('position').setData(positionFeatures(snapshot));
 // Center once on the first usable fix, never after the person has started exploring.
 if(['live','approximate'].includes(state)&&!centeredOnFix&&!explored){centeredOnFix=true;ownMove=true;map.easeTo({center:fix.coordinates,zoom:Math.max(map.getZoom(),DISCOVER_ZOOM),duration:reduced?0:600});}
}
// The key shows the same runtime-drawn icons the map uses.
function renderPlaceKey(icons){
 const item=$('map-key-places');item.replaceChildren();
 for(const [key,label] of Object.entries(categories)){if(!icons[key])continue;const img=document.createElement('img');img.src=icons[key];img.alt='';img.width=img.height=14;const span=node('span',undefined,'key-place');span.append(img,label);item.append(span);}
 item.hidden=false;
}
function positionAction(){
 if(position.fix&&['live','approximate','stale'].includes(position.state)){explored=true;map?.easeTo({center:position.fix.coordinates,zoom:Math.max(map.getZoom(),DISCOVER_ZOOM),duration:reduced?0:500});}
 else tracker?.retry();
}
async function start(){
 if(location.protocol==='file:'||location.protocol==='content:'){notify('Open Kompas through the supplied local server or an HTTPS address. A downloaded HTML file cannot install the offline app.');$('loading').hidden=true;return;}
 if(!globalThis.maplibregl||!globalThis.pmtiles){notify('The bundled map libraries did not load. Check the application files.');return;}
 // Location, places and house numbers start immediately and never block the base map.
 tracker=new PositionTracker({bounds:MAP_BOUNDS,onChange:renderPosition});
 tracker.start().catch(e=>{console.error('Location setup failed',e);renderPosition({state:'unavailable',fix:null,age:null});});
 const placesReady=loadJSON('data/places.geojson','Places').then(data=>{
  if(!Array.isArray(data?.features))throw new Error('Places: missing features');
  all=data.features.map((f,i)=>({...f,id:i+1}));byId=new Map(all.map(f=>[String(f.properties.id),f]));filtered=all;
 }).catch(e=>{console.error(e);placesError=e.message;notify(`Places could not load (${e.message}). Streets and buildings are still shown.`);renderResults();});
 const labelsReady=loadJSON('data/building-labels.geojson','House numbers').then(labels=>{buildingAddresses=buildingAddressIndex(labels);})
  .catch(e=>{console.error(e);notify(`House numbers could not load (${e.message}). Building details may lack addresses.`);});
 // This MapLibre bundle has no supported() helper. Map construction reports
 // graphics initialization errors through the existing startup catch handler.
 if('serviceWorker' in navigator&&isSecureContext){serviceWorkerRegistration=await registerAppUpdates().catch(e=>{notify('Offline setup failed: '+e.message);return null;});}
 dataMode=await loadDataMode();api=dataEndpoints(dataMode,location.href);document.documentElement.dataset.api=dataMode;
 manifest=await loadJSON('data/manifest.json','Map metadata');
 archive=new ArchiveSource(new URL(manifest.archive.path,location.href).href,manifest);try{await archive.init();}catch(e){$('storage-note').textContent='Local storage unavailable. Online map is still usable.';}
 updateDownload();
 const protocol=new pmtiles.Protocol();protocol.add(new pmtiles.PMTiles(archive));maplibregl.addProtocol('pmtiles',protocol.tile);
 map=new maplibregl.Map({container:'map',style:mapStyle(basemapURL(api,archive.url,!!archive.local)),center:DEFAULT_CENTER,zoom:DISCOVER_ZOOM,minZoom:7,maxZoom:23,maxBounds:MAP_BOUNDS,renderWorldCopies:false,attributionControl:{compact:true},fadeDuration:0,maxTileCacheSize:160,pixelRatio:Math.min(devicePixelRatio||1,2),refreshExpiredTiles:false});
 // Exposed for the supplied browser QA script and manual performance inspection.
 window.kompasDebug={get map(){return map;},get endpoints(){return structuredClone(endpoints);},get offline(){return !!archive.local;},get selected(){return selected?.properties.id??null;},get placeCount(){return all.length;},get satellite(){return satelliteVisible;},get transport(){return !!transport?.enabled;},get dataMode(){return dataMode;},get position(){return position.state;},get explored(){return explored;}};
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.addControl(new maplibregl.ScaleControl({maxWidth:100}),'bottom-left');
 const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.resize());});observer.observe($('map'));
 // The desktop details card sits below the location status and layer buttons, whatever their wrapped height.
 const controls=document.querySelector('.map-left');new ResizeObserver(()=>document.documentElement.style.setProperty('--map-left-bottom',controls.offsetTop+controls.offsetHeight+'px')).observe(controls);
 map.on('load',()=>{
  installBuildingNumberScale(map);
  installSatellite(map,location.href);
  $('satellite-toggle').disabled=false;
  // D-05: scale eligibility before placement, no count clusters, and collision with every other label. Placed below
  // road names and house numbers so those win collisions; sights and essentials win over ordinary businesses.
  renderPlaceKey(installPlaceIcons(map,colors));
  map.addSource('places',{type:'geojson',data:collection([])});
  map.addLayer({id:'place-highlight',type:'circle',source:'places',paint:{'circle-radius':14,'circle-color':'#c43f3f','circle-opacity':0,'circle-stroke-color':'#c43f3f','circle-stroke-width':0}},'road-labels');
  map.addLayer({id:'place-symbols',type:'symbol',source:'places',filter:PLACE_SCALE_FILTER,layout:{'icon-image':['match',['get','category'],...Object.keys(colors).flatMap(c=>[c,placeIconId(c)]),placeIconId('other')],'icon-padding':2,'symbol-sort-key':['match',['get','category'],'sights',0,'essentials',1,'stay',2,3],'text-field':['coalesce',['get','name:en'],['get','name']],'text-font':['Open Sans Semibold'],'text-size':11,'text-anchor':'top','text-offset':[0,1.1],'text-max-width':10,'text-optional':true},paint:{'text-color':'#304c3e','text-halo-color':'#fffff9','text-halo-width':2}},'road-labels');
  const cities=[['Podgorica',19.26,42.437],['Nikšić',18.944,42.774],['Cetinje',18.922,42.39],['Budva',18.84,42.286],['Kotor',18.771,42.424],['Bar',19.098,42.092],['Ulcinj',19.206,41.929],['Herceg Novi',18.537,42.454],['Žabljak',19.121,43.154],['Pljevlja',19.359,43.357],['Kolašin',19.522,42.824],['Berane',19.87,42.843]];
  map.addSource('cities',{type:'geojson',data:collection(cities.map(([name,x,y])=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{name}})))});map.addLayer({id:'city-names',type:'symbol',source:'cities',maxzoom:13,layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':13},paint:{'text-color':'#3c5945','text-halo-color':'#fafaf0','text-halo-width':2}});
  installTransport(map);
  installRoutePoints(map);
  objectSelection=new ObjectSelection(map);
  routePlanner=new RoutePlanner(map);
  transport=new TransportFeed(map,{url:api.vehicles,onStatus:renderTransportStatus});
  $('transport-toggle').disabled=false;
  installPositionLayers(map);renderPosition(position);
  Promise.all([placesReady,labelsReady]).then(()=>{loaded=true;$('loading').hidden=true;filterPlaces();});
 });
 map.on('movestart',e=>{if(ownMove){ownMove=false;return;}if(e.originalEvent&&!explored){explored=true;renderPosition(position);}});
 map.on('moveend',renderResults);
 installMapTaps(map,e=>{
  if(!loaded)return;
  const routePoints=map.queryRenderedFeatures(e.point,{layers:['route-point-circles']});
  if(routePoints.length){const f=routePoints[0];showPoint({name:f.properties.name,coordinates:[...f.geometry.coordinates],kind:f.properties.role==='from'?'From point':'To point',details:[]},f);return;}
  const stops=map.queryRenderedFeatures(e.point,{layers:['transport-stops']});
  if(stops.length){showPoint(describePoint(stops[0],e.lngLat.toArray()),stops[0]);return;}
  const hit=map.queryRenderedFeatures(e.point,{layers:['place-symbols']})[0];
  if(hit){showPlace(hit.properties.id);return;}
  const roadLayers=['road-labels','steps','cycleways','paths','footways','pedestrian-streets','minor-roads','major-roads'];
  const features=map.queryRenderedFeatures(e.point,{layers:['building-numbers','buildings',...roadLayers,'land','water','rivers']});
  const feature=features.find(f=>f.layer.id==='buildings')??features.find(f=>f.layer.id==='building-numbers')??features.find(f=>roadLayers.includes(f.layer.id))??features.find(f=>f.layer.id==='land'&&f.properties.kind==='park')??features.find(f=>f.layer.id==='water'||f.layer.id==='rivers');
  showPoint(describePoint(feature,e.lngLat.toArray(),buildingAddresses),feature);
 });
 map.on('mousemove',()=>{if(loaded)map.getCanvas().style.cursor='crosshair';});
 // Name the layer that failed; a partly drawn map is not a ready map.
 const failures={basemap:'Streets, buildings and water could not load. Check your connection or save the map for offline use.','building-addresses':'House numbers could not load.','satellite-preview':'Satellite imagery could not load.','satellite-tiles':'Satellite imagery could not load.',places:'Places could not be drawn.','transport-stops':'Bus stops could not load.'};
 map.on('error',e=>{console.error('Map error',e.error);const message=failures[e.sourceId]??'Some map data could not load. Check your connection or download the map for offline use.';clearTimeout(errorTimer);errorTimer=setTimeout(()=>notify(message),1500);});
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
$('overview').addEventListener('click',()=>{closePlace();explored=true;map?.fitBounds([[18.42,41.84],[20.36,43.57]],{padding:55,duration:reduced?0:700});});
$('podgorica').addEventListener('click',()=>{closePlace();explored=true;map?.easeTo({center:DEFAULT_CENTER,zoom:DISCOVER_ZOOM,duration:reduced?0:600});});
$('satellite-toggle').addEventListener('click',()=>{
 if(!loaded)return;
 satelliteVisible=!satelliteVisible;setSatelliteVisible(map,satelliteVisible);
 $('satellite-toggle').setAttribute('aria-pressed',String(satelliteVisible));
 $('satellite-toggle').textContent=satelliteVisible?'Street map':'Satellite';
 $('satellite-note').hidden=!satelliteVisible;
 if(satelliteVisible){closePlace();explored=true;const [w,s,e,n]=satelliteBounds;map.easeTo({center:[(w+e)/2,(s+n)/2],zoom:17.5,duration:reduced?0:600});}
});
$('transport-toggle').addEventListener('click',()=>{
 if(!transport)return;
 const enabled=!transport.enabled;
 if(!enabled&&selectedPoint?.kind==='Bus stop')closePlace();
 $('transport-toggle').setAttribute('aria-pressed',String(enabled));
 $('transport-info').hidden=!enabled;
 transport.setEnabled(enabled);
 if(enabled){closePlace();explored=true;map.easeTo({center:[19.26,42.44],zoom:12,duration:reduced?0:450});if(!navigator.onLine)transport.pause('offline');}
});
document.addEventListener('visibilitychange',()=>{if(!transport?.enabled)return;if(document.hidden)transport.pause('paused');else if(navigator.onLine)transport.refresh();});
addEventListener('offline',()=>transport?.pause('offline'));
addEventListener('online',()=>{if(transport?.enabled&&!document.hidden)transport.refresh();});
$('download').addEventListener('click',startDownload);$('cancel-download').addEventListener('click',()=>downloadAbort?.abort());$('remove-download').addEventListener('click',async()=>{await archive.remove();updateDownload();});
$('retry').addEventListener('click',()=>location.reload());
$('position-action').addEventListener('click',positionAction);
$('map-key-toggle').addEventListener('click',()=>{const open=$('map-key-toggle').getAttribute('aria-expanded')!=='true';$('map-key-toggle').setAttribute('aria-expanded',String(open));$('map-key-items').hidden=!open;});addEventListener('online',updateConnection);addEventListener('offline',updateConnection);
start().catch(e=>{console.error(e);$('loading').hidden=true;notify(e.message||'Map startup failed.');});
