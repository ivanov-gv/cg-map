// What each property is called in a form, and its values in plain words. Attributes come from the layer rules; the
// catalog only names them.
const fieldLabels = {
  name: 'Name',
  'name:en': 'Name in English',
  'name:sr-Latn': 'Name in Latin script',
  'addr:street': 'Street',
  'addr:housenumber': 'House number',
  display_number: 'Display number',
  building_number: 'Building number',
  nohousenumber: 'Building has no number',
  building: 'Building type',
  'building:levels': 'Levels',
  'building:material': 'Material',
  start_date: 'Year built',
  'roof:levels': 'Roof levels',
  energy_class: 'Energy class',
  entrance: 'Type',
  opens_onto: 'Opens onto',
  wheelchair: 'Step-free',
  ref: 'Number',
  level: 'Level',
  door: 'Door',
  category: 'Category',
  kind: 'Kind',
  standalone: 'Stands on its own',
  visibilityLevel: 'Shown from',
  phone: 'Phone',
  website: 'Website',
  email: 'E-mail',
  opening_hours: 'Opening hours',
  cuisine: 'Cuisine',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  maxspeed: 'Speed limit',
  oneway: 'Direction',
  motor_vehicle: 'Cars',
  foot: 'Pedestrians',
  bicycle: 'Bicycles',
  access: 'Access',
  surface: 'Surface',
  lit: 'Street light',
  smoothness: 'Smoothness',
  sac_scale: 'Hiking difficulty',
  bridge: 'Bridge',
  tunnel: 'Tunnel',
  layer: 'Layer',
  junction: 'Junction',
  pathClass: 'Path class',
  startLevel: 'Start level',
  endLevel: 'End level',
  'parking:left': 'Parking on the left',
  'parking:right': 'Parking on the right',
  'parking:both': 'Parking on both sides',
  destination: 'A place to go to',
  intermittent: 'Dry part of the year',
  elevation: 'Height',
  ele: 'Elevation',
  natural: 'Type',
  place: 'Type',
  rank: 'Rank on the map',
  minzoom: 'Shown from zoom',
  side: 'Side of the road',
  stopId: 'Stop ID',
  number: 'Number',
  network: 'Network',
  colour: 'Colour'
};

const accessLabels = {yes: 'Allowed', no: 'Not allowed', designated: 'Meant for it', use_sidepath: 'Only beside the road'};

const valueLabels = {
  wheelchair: {yes: 'No steps or a ramp', limited: 'Partly', no: 'Steps'},
  side: {left: 'Left', right: 'Right'},
  network: {bus: 'Bus', intercity: 'Intercity'},
  natural: {peak: 'Peak', hill: 'Hill'},
  opens_onto: {street: 'Street', courtyard: 'Courtyard', passage: 'Passage', parking: 'Parking'},
  kind: {traffic_signals: 'Traffic light'},
  visibilityLevel: {
    1: 'Landmark · city view',
    2: 'District view',
    3: 'Neighbourhood view',
    4: 'Street level',
    5: 'Close up'
  },
  oneway: {yes: 'One way, as drawn', '-1': 'One way, against the drawing', no: 'Both ways', reversible: 'Changes by time'},
  crossing: {uncontrolled: 'Marked, without lights', traffic_signals: 'With lights'},
  maxspeed: {walk: 'Walking speed', none: 'No limit'},
  layer: {0: '0 · on the ground'},
  junction: {circular: 'Circular, without priority', roundabout: 'Roundabout'},
  access: accessLabels,
  motor_vehicle: accessLabels,
  foot: accessLabels,
  bicycle: accessLabels,
  bridge: {yes: 'Bridge', no: 'No bridge'},
  tunnel: {yes: 'Tunnel', no: 'No tunnel'}
};

const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1);
const inWords = text => capitalized(String(text).replaceAll('_', ' '));

export const fieldLabel = name => fieldLabels[name] ?? inWords(name);

export const valueLabel = (name, value) => valueLabels[name]?.[value] ?? inWords(value);

// Names of facts a form shows beside the editable ones, such as the stop ID from the transport import.
export const fieldUnits = {elevation: 'm', ele: 'm', maxspeed: 'km/h'};
