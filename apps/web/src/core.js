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
