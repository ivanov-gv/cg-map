// basemapURL: 'pmtiles://<archive>' for the archive read directly, or the server's TileJSON URL.
export function mapStyle(basemapURL){
 const source='basemap',road=['get','kind'];
 const major=['in',road,['literal',['motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link','secondary_link']]];
 const kinds=list=>['in',road,['literal',list]];
 // Ways that are not carriageways get their own pattern; one generic minor-road stroke hides the walking network.
 const nonStreet=kinds(['footway','pedestrian','path','track','cycleway','steps']);
 const street=['all',['!',major],['!',nonStreet]];
 const line=(id,color,width,filter,minzoom=0,dash)=>({id,type:'line',source,'source-layer':'roads',minzoom,...(filter?{filter}:{}),layout:{'line-cap':dash?'butt':'round','line-join':'round'},paint:{'line-color':color,'line-width':width,...(dash?{'line-dasharray':dash}:{})}});
 const scaled=(z14,z17,z20)=>['interpolate',['exponential',1.5],['zoom'],13,z14*.6,14,z14,17,z17,20,z20];
 // Addresses are supplied only after the browser has validated the reviewed label asset.
 const buildingAddresses={type:'geojson',data:{type:'FeatureCollection',features:[]}};
 const buildingNumberLabel=['coalesce',['get','display_number'],['get','addr:housenumber']];
 return {version:8,glyphs:new URL('fonts/',location.href).href+'{fontstack}/{range}.pbf',sources:{'building-addresses':buildingAddresses,basemap:{type:'vector',url:basemapURL,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL · Natural Earth'}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#f2f1e7'}},
  {id:'land',type:'fill',source,'source-layer':'land',paint:{'fill-color':['match',['get','kind'],'park','#dce6c9','#efeee2']}},
  {id:'water',type:'fill',source,'source-layer':'water',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#c3dce0'}},
  {id:'rivers',type:'line',source,'source-layer':'water',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#a9ced6','line-width':['interpolate',['linear'],['zoom'],7,0.6,13,3,18,12]}},
  // Building type is not in the published data yet: one neutral "unknown type" fill, never a residential colour.
  {id:'buildings',type:'fill',source,'source-layer':'buildings',minzoom:13,paint:{'fill-color':'#d6d5c6','fill-outline-color':'#aeac98'}},
  line('road-casing','#d6d1b9',['interpolate',['exponential',1.5],['zoom'],7,0.7,12,2,16,9,20,65],major),
  line('minor-casing','#cfcab3',['interpolate',['exponential',1.5],['zoom'],13,1.6,14,3.2,17,10,20,38],street,13),
  line('minor-roads','#fffef8',['interpolate',['exponential',1.5],['zoom'],11,0.8,14,['match',road,'service',1.2,2],17,['match',road,'service',5,8],20,['match',road,'service',22,35]],street,11),
  line('pedestrian-streets','#f4ead6',scaled(2.5,7,28),kinds(['pedestrian']),13),
  line('footways','#8c6f4e',scaled(1.1,1.8,3.5),kinds(['footway','pedestrian']),13,[2,1.4]),
  line('paths','#6f7f3c',scaled(1.1,1.8,3.5),kinds(['path','track']),13,[4,2]),
  line('cycleways','#2c6fb0',scaled(1.2,2,4),kinds(['cycleway']),13,[3,1.5]),
  line('steps','#6b4a32',scaled(2.4,4.5,10),kinds(['steps']),13,[0.4,0.35]),
  line('major-roads','#e4c98e',['interpolate',['exponential',1.5],['zoom'],7,0.5,12,1.3,16,6,20,48],major),
  {id:'road-labels',type:'symbol',source,'source-layer':'roads',minzoom:13,filter:['all',['has','name'],['!=',['get','name'],'']],layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],13,10,17,13]},paint:{'text-color':'#7b7b69','text-halo-color':'#f8f8ee','text-halo-width':1.5}},
  {id:'building-numbers',type:'symbol',source:'building-addresses',minzoom:13,layout:{'visibility':'none','text-field':buildingNumberLabel,'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],15,11,21,14],'text-anchor':'center','text-max-width':6,'text-padding':2},paint:{'text-color':'#514d44','text-halo-color':'#fffef8','text-halo-width':1}}
 ]};
}

// Match the 100px metric ScaleControl: it rounds distances below 200m to
// 100m or less. Unprojecting also follows latitude, viewport and pitch changes.
export function installBuildingNumberScale(map) {
 let visible;
 const update=()=>{
  const {clientWidth,clientHeight}=map.getContainer();
  const left=map.unproject([clientWidth/2-50,clientHeight/2]);
  const right=map.unproject([clientWidth/2+50,clientHeight/2]);
  const next=left.distanceTo(right)<200;
  if(next!==visible){map.setLayoutProperty('building-numbers','visibility',next?'visible':'none');visible=next;}
 };
 map.on('move',update);map.on('resize',update);update();
}
