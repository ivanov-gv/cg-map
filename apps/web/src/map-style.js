export function mapStyle(archiveURL){
 const source='basemap',road=['get','kind'];
 const major=['in',road,['literal',['motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link','secondary_link']]];
 const line=(id,color,width,filter,minzoom=0)=>({id,type:'line',source,'source-layer':'roads',minzoom,...(filter?{filter}:{}),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width}});
 return {version:8,glyphs:new URL('fonts/',location.href).href+'{fontstack}/{range}.pbf',sources:{'building-addresses':{type:'geojson',data:new URL('data/building-labels.geojson',location.href).href},basemap:{type:'vector',url:'pmtiles://'+archiveURL,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL · Natural Earth'}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#f2f1e7'}},
  {id:'land',type:'fill',source,'source-layer':'land',paint:{'fill-color':['match',['get','kind'],'park','#dce6c9','#efeee2']}},
  {id:'water',type:'fill',source,'source-layer':'water',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#c3dce0'}},
  {id:'rivers',type:'line',source,'source-layer':'water',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#a9ced6','line-width':['interpolate',['linear'],['zoom'],7,0.6,13,3,18,12]}},
  {id:'buildings',type:'fill',source,'source-layer':'buildings',minzoom:13,paint:{'fill-color':'#d6d5c6','fill-outline-color':'#c8c8b8'}},
  line('road-casing','#d6d1b9',['interpolate',['exponential',1.5],['zoom'],7,0.7,12,2,16,9,20,65],major),
  line('minor-roads','#fffef8',['interpolate',['exponential',1.5],['zoom'],11,0.8,14,2,17,8,20,35],['!',major],11),
  line('major-roads','#e4c98e',['interpolate',['exponential',1.5],['zoom'],7,0.5,12,1.3,16,6,20,48],major),
  {id:'road-labels',type:'symbol',source,'source-layer':'roads',minzoom:13,filter:['all',['has','name'],['!=',['get','name'],'']],layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],13,10,17,13]},paint:{'text-color':'#7b7b69','text-halo-color':'#f8f8ee','text-halo-width':1.5}},
  {id:'building-numbers',type:'symbol',source:'building-addresses',minzoom:18,layout:{'text-field':['get','addr:housenumber'],'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],18,11,21,14],'text-anchor':'center','text-max-width':6,'text-padding':2},paint:{'text-color':'#514d44','text-halo-color':'#fffef8','text-halo-width':1}}
 ]};
}
