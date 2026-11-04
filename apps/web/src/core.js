export const categories={all:'Explore all',food:'Eat & drink',sights:'See & do',shops:'Shops',stay:'Stay',essentials:'Essentials'};
export const colors={food:'#aa8559',sights:'#688451',shops:'#75899b',stay:'#947c9b',essentials:'#4b9389'};
const cyr={а:'a',б:'b',в:'v',г:'g',д:'d',ђ:'dj',е:'e',ж:'z',з:'z',и:'i',ј:'j',к:'k',л:'l',љ:'lj',м:'m',н:'n',њ:'nj',о:'o',п:'p',р:'r',с:'s',т:'t',ћ:'c',у:'u',ф:'f',х:'h',ц:'c',ч:'c',џ:'dz',ш:'s',й:'i',ы:'y',ь:'',ъ:'',я:'ya',ю:'yu',щ:'sh',э:'e'};
export const fold=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ђ|đ/g,'dj').replace(/[а-яјљњћџ]/g,c=>cyr[c]??c).trim();
export function matches(f,q,category){const p=f.properties;return(category==='all'||p.category===category)&&fold([p.name,p['name:en'],p.kind,p['addr:street']].join(' ')).includes(fold(q));}
export function distance(a,b){const r=Math.PI/180,lat=(a[1]+b[1])/2*r;return Math.hypot((a[0]-b[0])*Math.cos(lat),a[1]-b[1])*111.2;}
export function safeWebsite(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export function selectNearest(features,center,limit=40){return features.map(f=>({f,d:distance(center,f.geometry.coordinates)})).sort((a,b)=>a.d-b.d).slice(0,limit);}
export const collection=features=>({type:'FeatureCollection',features});
export const formatBytes=n=>`${(n/1048576).toFixed(1)} MB`;
// Discover scale policy (docs/ui-ux/discover.md). Scale is ground metres per CSS pixel; MapLibre uses 512px tiles.
const EARTH_CIRCUMFERENCE=40075016.686;
export const metersPerPixel=(latitude,zoom)=>EARTH_CIRCUMFERENCE*Math.cos(latitude*Math.PI/180)/(512*2**zoom);
export const zoomForMetersPerPixel=(latitude,mpp)=>Math.log2(EARTH_CIRCUMFERENCE*Math.cos(latitude*Math.PI/180)/(512*mpp));
export const DEFAULT_CENTER=[19.26,42.437];
// About 1 ground metre per CSS pixel over central Podgorica.
export const DISCOVER_ZOOM=Math.round(zoomForMetersPerPixel(DEFAULT_CENTER[1],1)*10)/10;
// Location display states (D-06). Thresholds are the proposed initial tuning, not validated release values.
export const POSITION_FRESH_MS=30000,POSITION_TIMEOUT_MS=15000,POSITION_APPROXIMATE_M=50;
export function inBounds([x,y],[[west,south],[east,north]]){return x>=west&&x<=east&&y>=south&&y<=north;}
export function classifyFix(fix,now,bounds){
 if(!inBounds(fix.coordinates,bounds))return 'outside';
 if(now-fix.timestamp>POSITION_FRESH_MS)return 'stale';
 return fix.accuracy>POSITION_APPROXIMATE_M?'approximate':'live';
}
// Ground-scaled accuracy ring as a polygon; an equirectangular offset is accurate enough at these radii.
export function accuracyCircle([x,y],radius,steps=48){
 const dy=radius/111320,dx=dy/Math.cos(y*Math.PI/180),ring=[];
 for(let i=0;i<=steps;i++){const a=i/steps*2*Math.PI;ring.push([x+dx*Math.cos(a),y+dy*Math.sin(a)]);}
 return {type:'Polygon',coordinates:[ring]};
}
export function formatAge(ms){const s=Math.max(0,Math.round(ms/1000));return s<90?`${s} s`:`${Math.round(s/60)} min`;}
