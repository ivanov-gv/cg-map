const sources=['buildings','land','water','roads'];
const empty=['==',['id'],-1];

// Filter the original vector features instead of copying one clipped tile's
// geometry. This keeps all parts and holes selected across tile/zoom changes.
export class ObjectSelection {
 constructor(map) {
  this.map=map;this.anchor=null;
  for(const sourceLayer of sources) {
   const base={source:'basemap','source-layer':sourceLayer,filter:empty};
   map.addLayer({...base,id:`selected-${sourceLayer}-fill`,type:'fill',filter:['all',empty,['==',['geometry-type'],'Polygon']],paint:{'fill-color':'#c43f3f','fill-opacity':.2}},'road-labels');
   map.addLayer({...base,id:`selected-${sourceLayer}-outline`,type:'line',paint:{'line-color':'#c43f3f','line-width':2.5},layout:{'line-join':'round','line-cap':'round'}},'road-labels');
  }
  map.on('idle',()=>this.resolveAnchor());
 }
 clear() {this.anchor=null;this.setTarget(null);}
 setTarget(target) {
  for(const sourceLayer of sources) {
   const filter=target?.sourceLayer===sourceLayer?['==',['id'],target.id]:empty;
   this.map.setFilter(`selected-${sourceLayer}-fill`,['all',filter,['==',['geometry-type'],'Polygon']]);
   this.map.setFilter(`selected-${sourceLayer}-outline`,filter);
  }
 }
 select(feature) {
  this.anchor=null;
  const label=feature?.layer?.id==='building-numbers';
  const sourceLayer=label?'buildings':feature?.sourceLayer??feature?.layer?.['source-layer'];
  const id=label?feature.properties.footprintIndex:feature?.id;
  this.setTarget(sources.includes(sourceLayer)&&Number.isInteger(id)?{sourceLayer,id}:null);
 }
 selectPlace(coordinates) {
  this.clear();this.anchor=[...coordinates];this.resolveAnchor();
 }
 resolveAnchor() {
  if(!this.anchor||this.map.getZoom()<13)return;
  const point=this.map.project(this.anchor),canvas=this.map.getCanvas();
  if(point.x<0||point.y<0||point.x>canvas.clientWidth||point.y>canvas.clientHeight)return;
  const building=this.map.queryRenderedFeatures(point,{layers:['buildings']})[0];
  if(building)this.select(building);
 }
}
