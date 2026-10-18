import {RoadRouter} from './routing.js';
import {planTransit} from './transit-routing.js';
import {distance} from './core.js';
const $=id=>document.getElementById(id);
const empty=()=>({type:'FeatureCollection',features:[]});
const minutes=s=>`${Math.max(1,Math.round(s/60))} min`;
const length=m=>m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1)} km`;
const item=text=>{const li=document.createElement('li');li.textContent=text;return li;};
export class RoutePlanner {
  constructor(map,{router=new RoadRouter(),fetchImpl=(...args)=>fetch(...args)}={}) {
    Object.assign(this,{map,router,fetchImpl});this.mode='car';this.generation=0;this.endpoints={};
    map.addSource('planned-route',{type:'geojson',data:empty()});
    map.addLayer({id:'planned-route-casing',type:'line',source:'planned-route',paint:{'line-color':'#ffffff','line-width':9,'line-opacity':.9}},'route-point-circles');
    map.addLayer({id:'planned-route-street',type:'line',source:'planned-route',filter:['==',['get','approximate'],false],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#195c9e','line-width':5}},'route-point-circles');
    map.addLayer({id:'planned-route-suggestion',type:'line',source:'planned-route',filter:['==',['get','approximate'],true],paint:{'line-color':['match',['get','kind'],'bus','#195c9e','#687850'],'line-width':4,'line-dasharray':[2,1]}},'route-point-circles');
    for(const button of $('route-modes').querySelectorAll('button'))button.addEventListener('click',()=>{
      this.mode=button.dataset.mode;
      for(const b of $('route-modes').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));
      this.calculate();
    });
    $('route-retry').addEventListener('click',()=>this.calculate());
    addEventListener('offline',()=>{if(this.mode!=='transit')this.invalidate('Car and walking routes need an internet connection.');});
  }
  invalidate(message='Choose From and To points on the map.') {
    this.generation++;this.controller?.abort();this.map.getSource('planned-route').setData(empty());
    $('route-status').textContent=message;$('route-status').dataset.state='idle';
    $('route-steps').replaceChildren();$('route-itinerary').hidden=true;$('route-retry').hidden=true;$('route-note').textContent='';
  }
  setEndpoints(endpoints) {
    this.endpoints=structuredClone(endpoints);this.invalidate();
    const ready=!!endpoints.from&&!!endpoints.to;
    for(const b of $('route-modes').querySelectorAll('button'))b.disabled=!ready;
    if(ready)this.calculate();
  }
  async calculate() {
    this.invalidate();
    const {from,to}=this.endpoints;if(!from||!to)return;
    if(distance(from.coordinates,to.coordinates)<.005){$('route-status').textContent='From and To are at the same point. Choose another destination.';return;}
    if(this.mode!=='transit'&&!navigator.onLine){$('route-status').textContent='Car and walking routes need an internet connection.';return;}
    const generation=this.generation;const mode=this.mode;
    this.controller=new AbortController();const signal=this.controller.signal;
    $('route-status').textContent=`Finding ${mode==='transit'?'public transport':mode==='car'?'car':'walking'} route…`;
    $('route-status').dataset.state='loading';
    try {
      let result;
      if(mode==='transit') {
        if(!this.network) {
          const response=await this.fetchImpl('data/transit-network.json',{signal});
          if(!response.ok)throw new Error('Bus route data could not load. Download the map before using bus suggestions offline.');
          const network=await response.json();
          if(generation!==this.generation)return;
          this.network=network;
        }
        result=planTransit(this.network,from.coordinates,to.coordinates);
        if(navigator.onLine)for(let i=0;i<result.legs.length;i++) {
          const leg=result.legs[i];if(leg.kind!=='walk'||leg.distance<10)continue;
          try {
            const routed=await this.router.route('walk',leg.coordinates[0],leg.coordinates.at(-1),signal);
            if(generation!==this.generation)return;
            result.legs[i]={...leg,...routed.legs[0],name:leg.name};
          } catch(error) {if(signal.aborted)throw error;}
        }
        result.duration=result.legs.reduce((n,l)=>n+l.duration,0);result.distance=result.legs.reduce((n,l)=>n+l.distance,0);
      } else result=await this.router.route(mode,from.coordinates,to.coordinates,signal);
      if(generation!==this.generation)return;
      this.render(result);
    } catch(error) {
      if(generation!==this.generation)return;
      $('route-status').textContent=error.name==='TimeoutError'?'Routing request timed out. Try again.':error.message;
      $('route-status').dataset.state='error';$('route-retry').hidden=false;
    }
  }
  render(result) {
    const transit=result.mode==='transit';
    $('route-status').textContent=`${transit?'~':''}${minutes(result.duration)}${transit?' + waiting':''} · ${length(result.distance)}`;
    $('route-status').dataset.state='ready';
    $('route-note').textContent=transit?`Bus suggestion from the ${new Date(result.retrievedAt).toLocaleDateString('en-GB')} route snapshot. Check departures. Dotted bus lines join stops. ${result.legs.some(l=>l.kind==='walk'&&l.approximate&&l.distance>10)?'Walking links are approximate.':'Walking legs follow mapped paths.'} Waiting time is extra.`:result.mode==='car'?'Driving estimate without live traffic. Route may start or end on a nearby accessible road.':'Walking route follows mapped footpaths and accessible streets. Route may start or end on a nearby path.';
    $('route-steps').replaceChildren();
    if(transit)for(const leg of result.legs) {
      if(leg.kind==='bus')$('route-steps').append(item(`${leg.name}: ${leg.from} → ${leg.to} · ~${minutes(leg.duration)}`));
      else if(leg.distance>10)$('route-steps').append(item(`${leg.name} · ~${length(leg.distance)} / ${minutes(leg.duration)}`));
    } else for(const step of result.steps)$('route-steps').append(item(`${step.name} · ${length(step.distance??0)}`));
    $('route-itinerary').hidden=false;
    const features=result.legs.filter(l=>l.coordinates.length>=2).map(l=>({type:'Feature',geometry:{type:'LineString',coordinates:l.coordinates},properties:{kind:l.kind,approximate:l.approximate}}));
    this.map.getSource('planned-route').setData({type:'FeatureCollection',features});
    const points=[...result.legs.flatMap(l=>l.coordinates),this.endpoints.from.coordinates,this.endpoints.to.coordinates];
    const bounds=points.reduce((b,p)=>[[Math.min(b[0][0],p[0]),Math.min(b[0][1],p[1])],[Math.max(b[1][0],p[0]),Math.max(b[1][1],p[1])]],[[180,90],[-180,-90]]);
    this.map.resize();
    this.map.fitBounds(bounds,{padding:{top:115,right:65,bottom:90,left:65},maxZoom:17,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:450});
  }
}
