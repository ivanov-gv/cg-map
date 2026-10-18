# Point selection and route endpoints

Click or tap any map point to open the details card with From and To actions. Choosing an action copies its name and WGS84 coordinates into session state, draws A (From) / B (To), updates the endpoint summary, and closes the card. Clear points removes both endpoints. Closing the card or changing map layers does not remove chosen endpoints. With both endpoints selected, the [route planner](routing.md) calculates the selected mode. Reloading clears the selection.

Visible endpoint markers, bus stops, directory places, and clusters take priority over basemap geometry. Clusters retain zoom-to-expand behavior. Otherwise buildings, roads, parks and water expose available map attributes. Unnamed buildings show their feature type and coordinates; names, addresses, bridge classifications and metadata are never invented. A named bridge may be represented as a directory attraction or road; legacy roads do not consistently preserve bridge tags. Blank map points show coordinates alone. No reverse geocoder is used.

The same card and actions work for directory results. Existing website/source links remain. Bus-stop details use the dated ePodgorica snapshot. All point selection works with the downloaded offline map; From/To are independent of live bus availability. Coordinates come from the selected point for places/stops and the actual click for basemap polygons/lines.

point-selection.js owns pure point descriptions, endpoint GeoJSON, and endpoint layer installation. app.js owns session state, hit testing, and DOM updates. Existing basemap data and contracts are unchanged. Browser coverage exercises generic coordinates, real building interiors, stops, directory selection, endpoint replacement/clearing, and offline interaction.

## Tap and zoom gestures

Map point selection waits 500 ms, matching the bundled MapLibre tap-drag recognition window. A second touch/mouse press cancels the pending point action. Double-click/double-tap, map movement, touch cancellation and map removal cancel it too. Native double-tap zoom and one-finger tap-then-drag zoom retain their default handlers; no touch defaults are prevented. Directory result buttons still open details immediately. map-taps.js owns this arbitration; mouse and native touch browser tests cover the distinction.
