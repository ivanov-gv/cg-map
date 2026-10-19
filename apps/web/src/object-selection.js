const sources=['buildings','land','water','roads'];
const empty=['==',['id'],-1];

// Filter the original vector features instead of copying one clipped tile's
// geometry. This keeps all parts and holes selected across tile/zoom changes.
export class ObjectSelection {
 constructor(map) {
  this.map=map;this.anchor=null;this.pointTarget=null;
  map.addSource('point-selection',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'point-selection-indicator',type:'circle',source:'point-selection',paint:{'circle-radius':8,'circle-color':'#c43f3f','circle-opacity':.25,'circle-stroke-color':'#c43f3f','circle-stroke-width':2.5}});
  for(const layer of ['place-circles','transport-stops']) {
   for(const [property,value] of Object.entries({'circle-color':'#c43f3f','circle-opacity':.25,'circle-stroke-color':'#c43f3f','circle-stroke-width':3})) {
    const original=map.getPaintProperty(layer,property)??1;
    map.setPaintProperty(layer,property,['case',['boolean',['feature-state','selected'],false],value,original]);
   }
  }
  for(const sourceLayer of sources) {
   const base={source:'basemap','source-layer':sourceLayer,filter:empty};
   map.addLayer({...base,id:`selected-${sourceLayer}-fill`,type:'fill',filter:['all',empty,['==',['geometry-type'],'Polygon']],paint:{'fill-color':'#c43f3f','fill-opacity':.2}},'road-labels');
   map.addLayer({...base,id:`selected-${sourceLayer}-outline`,type:'line',paint:{'line-color':'#c43f3f','line-width':2.5},layout:{'line-join':'round','line-cap':'round'}},'road-labels');
  }
  map.on('idle',()=>this.resolveAnchor());
 }
 clearPoint() {
  if(this.pointTarget)this.map.setFeatureState(this.pointTarget,{selected:false});
  this.pointTarget=null;
  this.map.getSource('point-selection').setData({type:'FeatureCollection',features:[]});
 }
 clear() {this.anchor=null;this.clearPoint();this.setTarget(null);}
 selectPoint(source,id) {
  this.pointTarget={source,id};this.map.setFeatureState(this.pointTarget,{selected:true});
 }
 setTarget(target) {
  for(const sourceLayer of sources) {
   const filter=target?.sourceLayer===sourceLayer?['==',['id'],target.id]:empty;
   this.map.setFilter(`selected-${sourceLayer}-fill`,['all',filter,['==',['geometry-type'],'Polygon']]);
   this.map.setFilter(`selected-${sourceLayer}-outline`,filter);
  }
 }
 select(feature,coordinates) {
  this.clear();
  const label=feature?.layer?.id==='building-numbers';
  const sourceLayer=label?'buildings':feature?.sourceLayer??feature?.layer?.['source-layer'];
  const id=label?feature.properties.footprintIndex:feature?.id;
  if(sources.includes(sourceLayer)&&Number.isInteger(id)){this.setTarget({sourceLayer,id});return;}
  const source=feature?.source??feature?.layer?.source;
  if(['places','transport-stops'].includes(source)&&feature.id!==undefined){this.selectPoint(source,feature.id);return;}
  if(!feature&&coordinates)this.map.getSource('point-selection').setData({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[...coordinates]}}]});
 }
 selectPlace(feature) {
  this.clear();this.selectPoint('places',feature.id);this.anchor=[...feature.geometry.coordinates];this.resolveAnchor();
 }
 resolveAnchor() {
  if(!this.anchor||this.map.getZoom()<13)return;
  const point=this.map.project(this.anchor),canvas=this.map.getCanvas();
  if(point.x<0||point.y<0||point.x>canvas.clientWidth||point.y>canvas.clientHeight)return;
  const building=this.map.queryRenderedFeatures(point,{layers:['buildings']})[0];
  if(building)this.select(building);
 }
}
