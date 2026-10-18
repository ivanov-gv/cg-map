const validPoint = p => Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
export function roadURL(mode,from,to) {
  if(!['car','walk'].includes(mode)||!validPoint(from)||!validPoint(to))throw new Error('Invalid route request');
  const profile=mode==='car'?'car':'foot';
  return `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson&steps=true&radiuses=${mode==='car'?'1000;1000':'300;300'}`;
}
export function parseRoadRoute(value,mode) {
  const r=value?.routes?.[0];
  if(value?.code!=='Ok'||!r)throw new Error('No route found on this road or footpath network. Pick points closer to accessible streets.');
  if(!Number.isFinite(r.distance)||r.distance<0||!Number.isFinite(r.duration)||r.duration<0||r.geometry?.type!=='LineString'||!Array.isArray(r.geometry.coordinates)||r.geometry.coordinates.length<2||r.geometry.coordinates.length>100000||!r.geometry.coordinates.every(validPoint))throw new Error('Routing service returned an invalid route.');
  const steps=(r.legs??[]).flatMap(l=>l.steps??[]).slice(0,150).map(s=>({name:[s.maneuver?.type?.replaceAll('_',' '),s.maneuver?.modifier,s.name?`on ${s.name}`:''].filter(Boolean).join(' '),distance:s.distance}));
  return {mode,distance:r.distance,duration:r.duration,legs:[{kind:mode,coordinates:r.geometry.coordinates,distance:r.distance,duration:r.duration,approximate:false}],steps};
}
export class RoadRouter {
  constructor(fetchImpl=(...args)=>fetch(...args)) {this.fetchImpl=fetchImpl;this.queue=Promise.resolve();this.last=0;this.cache=new Map();}
  route(mode,from,to,signal) {
    const url=roadURL(mode,from,to);
    if(this.cache.has(url))return Promise.resolve(this.cache.get(url));
    const run=this.queue.catch(()=>{}).then(async()=>{
      signal?.throwIfAborted();
      const wait=Math.max(0,1100-(Date.now()-this.last));
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      signal?.throwIfAborted();this.last=Date.now();
      const timeout=AbortSignal.timeout(20000);
      const response=await this.fetchImpl(url,{signal:signal?AbortSignal.any([signal,timeout]):timeout,credentials:'omit'});
      if(!response.ok)throw new Error('Routing service unavailable. Try again shortly.');
      const route=parseRoadRoute(await response.json(),mode);
      signal?.throwIfAborted();
      this.cache.set(url,route);if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);
      return route;
    });
    this.queue=run;return run;
  }
}
