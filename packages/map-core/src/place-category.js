// POI symbols use the category a kind belongs to. The table is seeded from today's POIs so the version-5 data can drop
// the stored `category` without changing which symbol a kind gets.
import {otherCategory} from './poi-icons.js';

const categoriesByKind = new Map(
  Object.entries({
    food: ['bar', 'cafe', 'fast_food', 'ice_cream', 'pub', 'restaurant'],
    sights: [
      'archaeological_site', 'artwork', 'attraction', 'castle', 'city_gate', 'drinking_water', 'fort', 'fountain',
      'gallery', 'grave_yard', 'lighthouse', 'memorial', 'monastery', 'monument', 'museum', 'music_school',
      'place_of_worship', 'ruins', 'theatre', 'tower', 'viewpoint'
    ],
    shops: [
      'agrarian', 'alcohol', 'art', 'baby_goods', 'bag', 'bakery', 'bathroom_furnishing', 'beauty', 'bed', 'beverages',
      'bicycle', 'bookmaker', 'books', 'boutique', 'butcher', 'car', 'car_parts', 'car_repair', 'chemist', 'chocolate',
      'clothes', 'coffee', 'computer', 'confectionery', 'convenience', 'copyshop', 'cosmetics', 'craft', 'curtain',
      'deli', 'department_store', 'doityourself', 'electronics', 'estate_agent', 'farm', 'fishing', 'florist', 'food',
      'frozen_food', 'funeral_directors', 'furniture', 'garden_centre', 'gift', 'grocery', 'hairdresser', 'hardware',
      'health_food', 'hifi', 'houseware', 'interior_decoration', 'jewelry', 'kiosk', 'laundry', 'leather', 'mall',
      'massage', 'medical_supply', 'mobile_phone', 'motorcycle', 'music', 'musical_instrument', 'nutrition_supplements',
      'optician', 'outdoor', 'paint', 'pastry', 'perfumery', 'pet', 'pet_grooming', 'photo', 'radiotechnics', 'seafood',
      'second_hand', 'security', 'sewing', 'shoes', 'sports', 'stationery', 'supermarket', 'tailor', 'telecommunication',
      'ticket', 'tobacco', 'toys', 'trade', 'travel_agency', 'truck_repair', 'tyres', 'wholesale', 'wine', 'yes'
    ],
    stay: ['camp_site', 'guest_house', 'hostel', 'hotel'],
    essentials: ['atm', 'bank', 'clinic', 'fuel', 'hospital', 'pharmacy', 'post_office']
  }).flatMap(([category, kinds]) => kinds.map(kind => [kind, category]))
);

// These kinds occur in two categories in today's data. Until data picks one category for each, its stored category
// still decides their symbol; the table holds the more common category for version-5 features without one.
const kindsSpanningCategories = new Set(['fuel', 'hotel', 'yes']);

// Returns the category whose symbol a POI gets, or 'other' for a kind nobody has classified.
export function placeCategory(properties) {
  const {kind, category} = properties;
  if (kindsSpanningCategories.has(kind) && category !== undefined) return category;
  return categoriesByKind.get(kind) ?? otherCategory;
}
