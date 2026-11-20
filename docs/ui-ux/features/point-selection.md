# Point selection and route endpoints

Serves [US-04](../user-stories/user-stories.md), [US-05](../user-stories/user-stories.md), and
[US-06](../user-stories/user-stories.md): a person can judge a listing, understand the actual map object they selected,
and deliberately use that location as a From or To endpoint. The selection, detail, highlight, and endpoint behaviors
below support those outcomes; they do not add reverse geocoding or invented place data.

Click or tap any map point to open the details card with From and To actions. Choosing an action copies its name and
WGS84 coordinates into session state, draws A (From) / B (To), updates the endpoint summary, and closes the card. Clear
points removes both endpoints. Closing the card or changing map layers does not remove chosen endpoints. With both
endpoints selected, the [route planner](routing.md) calculates the selected mode. Reloading clears the selection.

Visible endpoint markers, entrance markers, bus stops, and drawn directory place symbols take priority over basemap
geometry. Places are not clustered; a place below its [visibility level's](poi-visibility.md) zoom is reached through
the directory list instead. One click or tap opens a marker's card directly: the topmost rendered hit and its first
active identity win, with no chooser. Co-located listings remain reachable through search and a building card's Inside
this building section. Otherwise buildings, roads, parks and water expose available map attributes. Building polygons
take precedence over house-number label hit boxes; their revision-bound tile IDs retrieve address metadata independently
of zoom, collisions, or label visibility. See [building numbers](../../map-data/building-numbers.md). A recorded
building number supplies the building name; without a name or number the card says Unnamed building. Names, addresses,
bridge classifications and metadata are never invented. A named bridge may be represented as a directory attraction or
road; legacy roads do not consistently preserve bridge tags. Blank map points show coordinates alone. No reverse
geocoder is used.

The same card and actions work for directory results. Existing website/source links remain. Bus-stop details use the
dated ePodgorica snapshot. All point selection works with the downloaded offline map; From/To are independent of live
bus availability. Coordinates come from the selected point for places/stops and the actual click for basemap
polygons/lines.

The basemap archive is unchanged; entrance metadata extends the shared building-label contract. Browser coverage
exercises generic coordinates, real building interiors, stops, directory selection, endpoint replacement/clearing, and
offline interaction. Module responsibilities are documented in the [web component README](../../../apps/web/README.md).

## Card content

The first tap or click opens the card directly; there is no preview or second “More details” action. Its header shows
the category/type, the subject name and a short subtitle. From/To stay below the header. One source line names the
recorded source and published snapshot date, and adds “Hours are as recorded, not checked.” when hours are shown. OSM
cards use the release manifest's snapshot date; bus-stop cards use the dated ePodgorica snapshot.

Named sections carry only recorded facts. A POI gets **Location and contacts** (address, containing building,
coordinates, phone, website and source link), **Opening hours**, and **NEARBY** with up to three other already loaded
directory places within 500 m, each shown as name · category · rounded distance. Hours keep their weekday labels; an
unsupported expression is shown exactly as recorded. A building gets **Addresses**, **Entrances (marked on the map)**,
**Inside this building** and **Details**; entrance rows lead with the same labels shown on the map, and a place is
listed inside only when its recorded coordinates lie within the whole selected footprint, including polygon holes and
separate parts. Other objects get **Details** with whatever attributes they have. Missing facts omit their row or
section rather than claiming a value is absent in the world.

The topmost rendered marker selects its first active place; a bare building outline selects the building, not a tenant.
Picking another subject replaces both the card and its highlight. Close or Escape clears the inspection highlight while
leaving the query, category and any planned endpoints unchanged. Card composition is shared with
[the interface](interface.md#selected-object-card-content); browser acceptance is in
[the place-card coverage](../../../apps/web/tests/e2e/interface.spec.mjs).

## Tap and zoom gestures

Map point selection waits 500 ms, matching the bundled MapLibre tap-drag recognition window. A second touch/mouse press
cancels the pending point action. Double-click/double-tap, panning, two-finger pinch, touch cancellation and map removal
cancel it too, so those gestures never open a card or select a point. Native double-tap zoom and one-finger
tap-then-drag zoom retain their default handlers; no touch defaults are prevented. Directory result buttons still open
details immediately. Mouse and native touch browser tests cover the distinction.

## Object highlight

Selected map areas have a red contour and translucent red fill, including polygon holes and multiple parts. Line objects
use the contour stroke. object-selection.js filters the original vector feature ID in its source layer, so the full
footprint stays highlighted across tile boundaries, zoom changes and satellite mode. It does not copy the clicked tile
fragment into a separate geometry. Picking another subject replaces the highlight rather than adding to it. Closing the
card or choosing From/To clears the selection highlight.

Selecting a directory place inside a rendered building highlights that building footprint. The containing building
address comes from loaded building-label data or the first rendered match and stays with that selection; a late lookup
adds one row without rebuilding the card, and panning away cannot withdraw a recorded address. When a place has no
building footprint, its existing circle gets a red contour and translucent red fill. Bus stops use the same marker
highlight. The normal marker style returns when selection closes or changes. Bare coordinates use a small red selection
circle. No additional pin is added for existing places or stops; explicit A/B route endpoints keep their normal roles.
Buildings with reviewed entrance metadata show arrows at their entrance positions and individual entrance labels.
Selecting an entrance uses its exact recorded coordinates for From/To. See
[building and entrance addresses](../../map-data/building-numbers.md). Selection uses local data and works offline.
