import {distance} from './core.js';
const walk = (from, to, name) => {
  const meters=distance(from,to)*1300;
  return {kind:'walk',coordinates:[from,to],distance:meters,duration:meters/1.3,name,approximate:true};
};
const total = legs => legs.reduce((sum,leg)=>sum+leg.duration,0);

// Two boarding rounds: direct buses or one transfer, with bounded access/transfer walks.
// Timetables/live positions are deliberately not treated as departure predictions.
export function planTransit(network, from, to) {
  const stops=Object.entries(network.stops);
  const access=stops.map(([id,s])=>({id,leg:walk(from,s.coordinates,`Walk to ${s.name}`)}))
    .filter(x=>x.leg.distance<=1000).sort((a,b)=>a.leg.distance-b.leg.distance).slice(0,12);
  let labels=new Map(access.map(({id,leg})=>[id,{cost:leg.duration,legs:[leg]}]));
  let best=null;
  for(let round=0;round<2;round++) {
    const ridden=new Map();
    for(const pattern of network.patterns) {
      for(let i=0;i<pattern.stops.length-1;i++) {
        const before=labels.get(pattern.stops[i]);if(!before)continue;
        for(let j=i+1;j<pattern.stops.length;j++) {
          const duration=pattern.offsets[j]-pattern.offsets[i];if(duration<=0)continue;
          const id=pattern.stops[j],cost=before.cost+300+duration;
          if(ridden.has(id)&&ridden.get(id).cost<=cost)continue;
          const coordinates=pattern.stops.slice(i,j+1).map(sid=>network.stops[sid].coordinates);
          const leg={kind:'bus',route:pattern.route,name:`Bus ${pattern.route} toward ${pattern.headsign||pattern.name}`,from:network.stops[pattern.stops[i]].name,to:network.stops[id].name,coordinates,duration,
            distance:coordinates.slice(1).reduce((m,p,k)=>m+distance(coordinates[k],p)*1000,0),approximate:true};
          ridden.set(id,{cost,legs:[...before.legs,leg]});
        }
      }
    }
    for(const [id,label] of ridden) {
      const exit=walk(network.stops[id].coordinates,to,'Walk to destination');
      if(exit.distance>1000)continue;
      const cost=label.cost+exit.duration;
      if(!best||cost<best.cost)best={cost,legs:[...label.legs,exit]};
    }
    labels=new Map(ridden);
    if(round===0)for(const [id,label] of ridden)for(const [other,stop] of stops) {
      if(other===id)continue;
      const leg=walk(network.stops[id].coordinates,stop.coordinates,`Transfer on foot to ${stop.name}`);
      if(leg.distance>250)continue;
      const cost=label.cost+leg.duration;
      if(!labels.has(other)||cost<labels.get(other).cost)labels.set(other,{cost,legs:[...label.legs,leg]});
    }
  }
  if(!best)throw new Error('No bus suggestion found within a 1 km walk of these points. Try stops nearer the bus network.');
  return {mode:'transit',legs:best.legs,duration:total(best.legs),distance:best.legs.reduce((n,l)=>n+l.distance,0),retrievedAt:network.retrievedAt};
}
