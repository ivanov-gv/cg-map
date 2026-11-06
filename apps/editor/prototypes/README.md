# Internal editor interaction draft

Open [editor.html](editor.html) directly in a browser. It is self-contained and is excluded from the web build because
it is outside public/ and src/. The [implementation plan](../../../docs/plans/internal-layer-editor.md) contains the
real source inventory, shared map proposal and staged delivery.

This is a schematic using fictional sample objects, not the actual Podgorica map or a production editing engine.
Coordinates in its exported JSON are drawing-space pixels, not WGS84 or importable GeoJSON. It makes no network calls,
writes no sources and keeps its history only until reload. Export downloads a clearly marked draft interaction record.

1. Start in Browse: every object type is locked.
2. Choose a source filename in the dock: **one GeoJSON file, one editing mode**. The eight switches are generated from
   the same registry as the layer table. Click the active switch again to return to Browse. This invariant is recorded
   in [the component rules](../AGENTS.md).
3. Select individual objects on the map (or focus a map object and press Enter/Space). POIs belong to places.geojson;
   footprints belong to buildings.geojson; street/house-number fields and the address point belong only to
   building-labels.geojson. A footprint edit never moves or changes its label automatically, and a label edit never
   reshapes its footprint. In roads.geojson, Road/Path is a new-line tool option, not another editing mode. Add POI or
   Draw line creates an object in the active file; Finish line commits a drawing with two points.
4. Select Move point or Move vertex. Drag with the left mouse button, or swipe anywhere on the map to shift the point by
   the same distance without covering it with your finger. Release to inspect, then drag/swipe again to refine. Press
   Done in the map controls to record one change. Clicking/tapping does not move or finish it. Cancel move, Escape or a
   mode switch discards the entire preview; an interrupted gesture restores that gesture's start position. Other
   editing, review and export actions stay disabled until Done or Cancel.
5. For a road/path or building, select a numbered vertex, move it, insert after it or remove it. In Buildings mode, Move
   building translates the entire footprint using the same drag/swipe and Done controls. Building outlines stay closed
   and need at least three distinct corners with nonzero area; crossed or touching edges cannot be saved. Invalid
   movement stays a preview so you can adjust or cancel it. The sketch supports one outer ring per building; holes,
   multipolygons and real address-label containment remain production requirements. Delete removes a selected POI or
   line, with Undo available.
6. Escape cancels a tool and unapplied form changes. Switching modes cancels tools and resets unapplied form changes;
   the status explains this. Completed changes and history survive mode switches. Undo/Redo require the matching editing
   file mode.
7. Review changes lists before/after records with their owning filename. Draft JSON version 2 includes a `layer` on
   every record and object. Export does not save source datasets or publish a release. Export before reloading if you
   want to retain the sketch session.

The production editor will use the real shared map and source GeoJSON, offer durable local drafts, and validate an
explicit changeset contract before data import. Land, water, country outlines and bus stops each have their own working
mode switch, but their editing tools/sample features remain a later slice. Cross-file label containment is a production
validation requirement; this sketch demonstrates independent file transactions, not complete GIS consistency checks.
Satellite belongs to map viewing, not to the GeoJSON editing-mode registry.
