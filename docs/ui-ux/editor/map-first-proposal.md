# Editor proposal: the map comes first on desktop and mobile

**Status:** proposed design, ready for review. This document describes the intended experience; it is not an
implementation specification or a claim that the complete behaviour is available.

**Scope:** `apps/editor` on desktop, tablet and phone. Both desktop and mobile are primary experiences: they share an
editing model, with layouts suited to the available space and input. Editing permissions remain defined by
[the shared layer rules](../../../packages/contracts/editor-layers.json). The current behaviour is described in
[the editor README](../../../apps/editor/README.md); [section 10](#10-what-changes-from-the-current-editor) lists where
this proposal departs from it.

## 1. The idea

The editor should open onto a map that fills the screen. Choosing a layer, editing an object and reviewing changes
should each open an optional panel over that map. A desktop can keep useful panels alongside the work; a phone can
collapse them into sheets. Closing a panel should immediately return the space to the map, without losing the current
selection or unfinished work.

The map should also show the editor's working result. Applying a change to a POI's position, name or visibility should
update its map appearance straight away. Switching layers or returning to Browse should preserve that result.

The visual direction is deliberately quiet: no logo, welcome text, permanent editing instructions or editing legend over
the map. Names and category icons belong to the map and remain useful context.

## 2. What stays visible, moves into menus or disappears

| Element                                             | Proposed treatment                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Map                                                 | Fill the usable viewport; never place it below a scrolling control panel.                             |
| Current layer                                       | A small selector in the top-right corner, showing Browse or the selected layer.                       |
| Layers, Tools, Changes                              | A compact toolbar on desktop and a bottom bar on mobile. Changes may include an applied-change count. |
| Zoom and scale                                      | Keep compact map controls clear of the bottom bar and open panels.                                    |
| Logo and branding block                             | Remove from the map interface.                                                                        |
| Routine prompts, such as the dock's editing hints   | Remove from the map. Put guidance inside the relevant panel when needed.                              |
| An editable / changed colour legend                 | Remove from the map. Explain marker styling in layer help inside the menu.                            |
| Source filenames, feature counts and identity       | Put in expandable source details. Use human layer names in normal controls.                           |
| Offline status, source integrity and update details | Put in the Layers menu. Surface a compact notice only when attention is needed.                       |
| Attribution and licensing                           | Move into the footer of the Layers menu, including the OSM contributor and licence links.             |
| Author, reason, import and export                   | Put in Changes; show export metadata when starting an export.                                         |
| Discard all changes                                 | Put behind an additional action in Changes, with confirmation.                                        |
| Preview all edits                                   | Remove the need for this separate action: applied edits should already be visible everywhere.         |
| Layer-specific editing controls                     | Show only for the chosen layer and selected object.                                                   |

At rest, the map should have no instructional or administrative text covering it. Temporary loading, validation and
save-failure messages are exceptions because they explain an action or a problem that needs attention.

## 3. One workspace, two layouts

The desktop experience should make use of width; the mobile experience should keep controls within reach. Neither should
open with a large fixed control dock, an empty inspector or a page that must be scrolled to reach the map.

| Situation         | Desktop / wide window                                                                                      | Mobile / narrow window                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Resting state     | Full map; compact Layers, Tools and Changes toolbar at the upper left; current layer at the upper right.   | Full map; current layer at the upper right; Layers, Tools and Changes in the bottom bar. |
| Layers and Tools  | Open a small left-side panel; the two use the same utility-panel space.                                    | Open a bottom sheet, one panel at a time.                                                |
| Selected object   | Open an inspector on the right, leaving the selected geometry visible in the remaining map area.           | Open a bottom sheet around half-height, keeping the selected geometry visible above it.  |
| Panel coexistence | Keep the inspector and one utility panel open together only when the map still has ample room.             | Opening a menu collapses the inspector while retaining its edit.                         |
| Geometry editing  | Keep the inspector open if useful, or collapse it; handles and the active tool stay tied to the selection. | Collapse the sheet for space, then reopen it to adjust details or Apply.                 |
| Change review     | Use a list and an adjacent comparison when there is room; otherwise stack them inside the panel.           | Use a short list with an individual change's details opened within the sheet.            |
| Long forms        | Scroll inside the inspector; use more than one field column only when labels and values remain readable.   | Scroll inside the sheet; keep primary fields first and Apply / Cancel reachable.         |

### Desktop layout

The default desktop screen should still be mostly map. Opening Layers, Tools or Changes is a deliberate action, rather
than a reason to reserve a permanent left column. Selecting an object opens its inspector; clearing the selection
removes that inspector instead of leaving an empty panel.

As a proposed sizing rule, keep at least about 60% of the viewport width unobscured by side panels. A utility panel
might start around 260 pixels wide and an inspector around 340 pixels, but the map-space rule takes priority over those
illustrative sizes. If both panels cannot fit comfortably, opening one collapses the other. Do not squeeze the map
between two mandatory sidebars on a small laptop.

An inspector may remain open through repeated geometry adjustments. Selecting another object with no pending edit
updates that same inspector. Hover may give a subtle object highlight or name, but must not select, change or save it.
All essential actions remain reachable without hover.

### Mobile layout

The bottom bar should stay small and reachable by thumb. A selected-object sheet initially uses roughly the lower half
of the screen, rather than turning into a second scrolling page below the map. Its handle or close button collapses it
to one compact selection control. The map itself stays fixed to the viewport.

Opening the keyboard should keep the active field and Apply / Cancel reachable. Keep the selected object visible where
space allows; let the person collapse the sheet to inspect the full geometry. Smaller screens must not force a permanent
toolbar label, form field or long source identity outside the viewport.

### Resizing and mixed input

Choose a layout from usable space, not from whether the device is called a phone or desktop. A narrow desktop window
should use the compact layout; a wide tablet may use a side inspector. Touch controls must remain usable in either
layout, and mouse and keyboard must work in the compact layout too.

Resizing, rotating a device or changing panel arrangement must preserve the layer, selection, entered values, geometry
preview and local draft. Reframe only as needed to keep the selected geometry clear of panels; do not reset zoom or
return to the initial map centre.

## 4. Panels and selection

### Layers

Layers opens a compact picker containing all eight layers and Browse. Choosing a layer closes the picker and returns to
the map. Exactly one layer is active for editing or inspection at a time; the other layers remain visible as context.
Opening another layer must not reset the map's position or zoom.

Source information and offline details stay collapsed inside this menu. Its footer contains the attribution that was
removed from the map.

### Tools

Tools contains actions relevant to the active layer: adding an allowed feature, undo and redo for that layer, and
optional edit guides. Satellite is a viewing option and can also live here. Browse should expose viewing options only.
Read-only layers should explain their status and offer inspection rather than disabled editing forms.

Edit guides identify source objects that can be selected. Turning guides off should reveal the normal map appearance,
including normal POI visibility thresholds. An object hidden from view must not become an invisible tap target. A
selected object's open edit can remain available through its selection control.

### Object inspector

The inspector is a side panel on a wide screen and a bottom sheet on a narrow one. It contains the same fields and
actions in both layouts. Keep Apply and Cancel at a consistent, easy-to-reach edge of the panel while its contents
scroll.

- Show the object's name or a useful fallback such as its house number or “Building”.
- Put the most common fields and geometry actions first; move source metadata into a collapsed section.
- The collapse or close control preserves the selection, typed values and geometry preview. Mobile also has a sheet
  handle.
- When collapsed, show one compact selected-object control for reopening the inspector. Hide it after selection is
  cleared.
- Cancel explicitly discards the current unapplied edit. Closing the inspector does not mean Cancel.
- Mobile keeps one panel open at a time. Desktop may retain the inspector alongside one utility panel when space allows.
  Opening, closing or replacing a panel must preserve its unfinished edit.
- If several objects share a click or tap location, offer a short choice list with their names instead of choosing
  arbitrarily.
- Offer a keyboard-accessible selection list for objects in the active layer and current view. Selecting a feature must
  not depend entirely on precise pointer placement or on tabbing through thousands of map objects.

### Changes

Changes lists applied edits by layer and object. Each entry should identify the operation and provide an expandable
before/after comparison. Use the same review content on both layouts: wide screens may show the list and comparison side
by side; narrow screens can open one comparison at a time. Show changed fields first, with full source details available
on demand. Added and deleted objects must be reviewable even when no marker remains at the original spot.

Export starts a short author-and-reason step. Import and whole-file downloads are secondary actions. Discarding the
entire draft requires confirmation; it should never sit beside Apply as an easy accidental tap.

## 5. Editing and immediate feedback

### Three distinct states

| State                | What the person should understand                                                    | Map behaviour                                                           |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Unapplied edit       | A change is being adjusted; Apply or Cancel is still required.                       | Show a temporary geometry preview and selection highlight.              |
| Applied local change | The change belongs to this browser's draft. It can be reviewed, undone and exported. | Update the normal map rendering and relevant edit guides immediately.   |
| Exported change      | A changeset has been downloaded for review and application to the sources.           | Keep showing the local draft; downloading does not publish or clear it. |

An applied change must remain visible in its own layer, while editing another layer, in Browse, and after reopening a
compatible saved draft. Map rendering may need a short refresh, but must not require a manual preview toggle, page
reload or reselection. A brief “Applied” confirmation can disappear once the result is visible.

The working map is still not a rebuild. Below street scale the published tiles simplify geometry and drop minor roads,
so the working map can show more detail there than a release would. Explain that once in Layers help, not over the map.

For a moved object, remove its former rendered position. For a renamed object, refresh its label. For a deleted object,
remove it from the working map and keep its deletion in Changes. Undo and redo must update both the map and the review
list, and affect only the active layer.

Applying a POI visibility change must use its new level and the current zoom. Public icons follow the visibility policy.
Optional source edit guides can still reveal below-threshold POIs so they remain discoverable for editing; those guides
must not imply that the public map would display the POI at that zoom.

Moving or changing one of several POIs at the same coordinate must also refresh the shared marker, membership and
visibility. Neither the old marker nor its old count should remain behind. This includes an edit that gives a spot a new
combination of place levels, which today's Preview all edits does not draw.

### Geometry interaction

Move and point-edit actions should be deliberate modes, available after selection. The inspector can stay open on
desktop or collapse to give the map more space. The compact selection control should indicate an active geometry tool
and provide a clear way to return to Apply or Cancel.

- Move a point or shape with relative drags; it should not jump to wherever the finger first touches the map.
- Click or tap a vertex to select it, then adjust it. Show handles only while editing points.
- When adding a POI or drawing a road, map clicks or taps place the point or append the next line point.
- With no geometry tool active, dragging pans the map normally.
- An interrupted gesture restores its starting position, without losing earlier deliberate adjustments.

### Mouse, keyboard and touch

The available actions and validation should be the same across input methods. Mouse precision is useful for geometry,
but must not unlock a type of edit that is unavailable on touch.

| Action                        | Mouse and keyboard                                                                                                                        | Touch                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Select an object or vertex    | Click, or use the accessible object chooser.                                                                                              | Tap; use the same chooser when several objects overlap.                                                     |
| Move geometry                 | Drag while the chosen geometry tool is active.                                                                                            | Relative one-finger drag while the chosen tool is active.                                                   |
| Navigate during geometry work | Temporarily pan with Space held, or leave the tool without discarding the edit. Wheel/trackpad zoom changes the view only.                | Leave the tool to pan, or use two-finger navigation after any active object drag has been cancelled safely. |
| Undo / redo                   | Tools buttons; conventional Ctrl/Cmd+Z and redo shortcuts when focus belongs to the map/editor workspace.                                 | Tools buttons for the active layer.                                                                         |
| Apply / cancel the edit       | Explicit inspector buttons, fully keyboard reachable.                                                                                     | The same buttons in the sheet.                                                                              |
| Escape / interrupted input    | Escape cancels a gesture in progress; otherwise dismisses the foremost menu or collapses the inspector. It preserves the unfinished edit. | An interrupted gesture restores its starting position. Closing the sheet preserves the unfinished edit.     |

Inside a text field, undo and redo retain their normal text-editing meaning. Keyboard shortcuts must not apply, delete
or discard an object merely because someone is typing. Show available shortcuts in Tools help, rather than adding
permanent instructions over the map. Focus should return to a sensible opener when a panel closes, with visible focus
and comfortably sized controls in both layouts.

If switching layers would replace an unapplied edit, offer Apply, Discard edit or Keep editing. Treat typed details and
geometry changes alike. Merely hiding a panel must never trigger that decision or silently discard work.

## 6. Layer functionality

The interface takes every permission from [the shared layer rules](../../../packages/contracts/editor-layers.json) at
run time, never from a fixed list per layer. Add belongs to the layer's Tools menu and Delete to a selected object, in
any layer whose rules allow them; property fields come from the rules in the same way. So when the rules widen, a layer
gains its actions without an interface redesign.

They will widen. **Entity IDs are the blocker:** today a changeset can name an object only by its position in one
snapshot, so adding and deleting buildings, labels, parks and water, and adding an address to an unnumbered footprint,
cannot be allowed until [entity IDs and data releases](../../plans/entity-ids-and-data-releases.md) gives every object a
stable ID. The interface proposed here does not wait for that, and needs no change when it lands. The table below is the
current contract, not a design limit. Every layer has the same permissions, fields, validation and immediate map
feedback on desktop and mobile. Its inspector changes position and size with the layout; its capabilities do not change
with the input device.

| Layer            | Allowed edits today                                     | Add / delete today | What unblocks add / delete                     |
| ---------------- | ------------------------------------------------------- | ------------------ | ---------------------------------------------- |
| POIs             | Details, visibility level and position                  | Both allowed       | Nothing needed                                 |
| Buildings        | Existing footprint corners and whole-footprint position | Neither allowed    | Blocked by entity IDs                          |
| Building labels  | Existing address values and label position              | Neither allowed    | Blocked by entity IDs                          |
| Roads & paths    | Name, type, vertices and whole-line position            | Both allowed       | Nothing needed                                 |
| Land             | Name and shape of existing parks                        | Neither allowed    | Blocked by entity IDs                          |
| Water            | Name and shape of existing water polygons and rivers    | Neither allowed    | Blocked by entity IDs; the ocean stays derived |
| Country outlines | Inspection only                                         | Neither allowed    | Not planned: Natural Earth refresh             |
| Bus stops        | Inspection only                                         | Neither allowed    | Not planned: transit import                    |

### POIs

Keep category icons and names. Replace the filled green editing dots with transparent rings around the existing map
symbols. Use a subtle green outline for an unchanged source object and an amber outline for an applied local change. Use
an additional outer highlight for selection, so selection remains distinct from change status. These treatments must
leave icons and labels readable. No permanent colour legend should appear on the map.

Normal label collision handling can prevent overlapping names, but the selected POI's name must always be available in
the inspector or collapsed selection control. Co-located POIs need the choice list described above.

The first fields should be Name and Visibility level, followed by other details such as English name, category, type,
address, phone, website and opening hours. Show only fields allowed by the contract; preserve other source properties.
Move point and Delete belong to the selected object. Add POI belongs to the layer's Tools menu.

Visibility choices should show both the level and its zoom threshold, using
[the shared visibility policy](../../../packages/contracts/place-visibility.json). The current policy is level 1 at zoom
12+, level 2 at 14+, level 3 at 15+, level 4 at 16+, and level 5 at 17+. Level 1 remains restricted to landmarks in the
sights category. A new POI requires an explicit level choice.

After Apply, update its name, category icon, level and coordinates together. A level change that makes the public icon
disappear at the current zoom is a valid visible outcome; the optional edit ring and selected-object details explain
where that POI can still be edited.

### Buildings

Keep the normal building fills, surrounding roads and existing house numbers visible. Use a restrained outline for
selectable footprints and a stronger outline for the selected one; avoid covering every building with an opaque tint.

Offer Move whole footprint and Edit corners. As today, the corner tool can move, insert and remove a corner. Show vertex
handles only for that tool. The inspector does not need an empty property form, because this layer permits geometry
changes only. Address edits belong to Building labels. Add and Delete are blocked by entity IDs and appear once the
rules allow them.

Applying a move or corner change updates the footprint immediately. Its address label remains a separate object and must
not move automatically. If a correction leaves that label outside its footprint, identify the issue in Changes and
require correction in Building labels before export.

### Building labels

Keep house numbers visible as text, with subtle position guides when editing this layer. Selecting a label exposes House
number, Street and Move label. Source properties remain in expandable details.

Apply updates the displayed address and position immediately. It must not reshape or move the building. Creating or
deleting labels, including adding an address to an unnumbered footprint, is blocked by entity IDs and appears once the
rules allow it; the label then still stays a separate object from its footprint. Invalid house numbers or a broken
footprint relationship need an actionable validation message.

### Roads & paths

Keep normal road and path styling, including names and the surrounding network. Highlight the selected line instead of
turning the entire network into uniform thick editing lines.

Offer Name, Type, Move whole line and Edit points. The point tool exposes insert and remove actions for a selected
vertex. Draw road/path belongs to Tools; Delete belongs to an existing selected line. Roads, footways, cycleways and
other allowed types share this one layer.

Apply should immediately update the line, label and styling associated with its type. Drawing needs at least two valid
points. Endpoint snapping, automatic network repair and routing recalculation are not part of this proposal.

### Land

Preserve the normal land colours and context. Editing guides should identify existing parks; other context geometry
remains inspectable with a concise explanation of its restriction.

For a park, offer Name, Move whole shape and Edit corners, with corner insert and remove. Apply updates its shape and
name immediately. Adding and deleting parks is blocked by entity IDs; offer it once the rules allow it. Country and
context shapes stay outside this layer.

### Water

Keep water fills and river lines recognisable. Offer selection and geometry guides appropriate to the selected shape,
without tinting the entire water layer as one editing surface.

For an existing water polygon or river, offer Name, Move whole shape and Edit points, with point insert and remove.
Apply updates its geometry and label immediately. The ocean remains inspection-only because it is derived by the data
workflow. Adding and deleting water features is blocked by entity IDs; offer it once the rules allow it.

### Country outlines

Provide inspection of the outline and available source properties. Keep its normal map appearance and identify this
layer as read-only inside Layers and the inspector.

Do not show movement tools, vertex handles, Apply, add or delete controls. Explain that corrections belong to the
Natural Earth/data refresh workflow. Selecting this layer should never suggest that the outline can be edited here.

### Bus stops

Keep the usual stop symbols and available names. Selection opens a compact inspector with available stop details, source
identity and a short read-only explanation.

Do not show POI editing controls, movement tools, Apply, add or delete actions. Explain that stop corrections belong to
the transit import workflow, which maintains related transit data together.

## 7. Loading, validation and draft recovery

Loading a layer should produce a short temporary indication and prevent selection against stale geometry. It should not
replace the map with a long status screen. A layer that cannot load must leave viewing available and explain how to
retry.

Field and geometry errors belong beside the relevant controls. Keep the unfinished edit available for correction. An
empty layer or a read-only selection should explain itself inside its panel, without permanently overlaying the map.

Applied edits should be saved locally. A failed draft save needs a persistent, compact notice: do not claim the work is
saved. The person should be able to inspect the issue or export their work. Draft incompatibility and update actions
also need a discoverable notice; routine “works offline” information stays inside Layers.

These local changes are not a publication workflow. Export still produces a changeset for the existing review and
source-application process. Accounts, server writes and collaboration are outside the proposal.

## 8. Review walkthrough

Review the same four states on both layouts: the clear map, an open utility panel, a selected object and the result
after Apply. Three review screenshots accompany the pull request that proposed this document; `docs/` holds Markdown
only, so they are not kept in the repository. They illustrate the mobile POI journey and an initial desktop direction,
not the desktop panel arrangements or any layer other than POIs. What they show that matters for review:

- **Mobile mockup, 412 × 840**: the four states for POIs. Its inspector puts Move point above Name and shows English
  name and Category side by side. The text above takes precedence: Name and Visibility level come first, and a second
  field column is used only where labels stay readable.
- **Mobile prototype, 360 × 740, after Apply**: the Changes label wraps onto two lines. That is the kind of defect the
  [narrow-layout rule](#mobile-layout) excludes: shorten or drop the label before letting it wrap.
- **Desktop prototype, 1280 × 800, POI guides at city zoom**: it keeps the mobile bottom bar, centred, where the
  proposal recommends a compact toolbar at the upper left. It also shows how dense the POI edit guides become at city
  zoom, where rings overlap and hide each other's icons; [section 9](#9-decisions-for-review) lists that as open.

### Shared editing journey

1. Open Layers, choose POIs and return to the same map position. Names and category icons remain readable.
2. Select Na Moraču. Name, visibility and movement are easy to reach, with the object clear of the inspector.
3. Change its level and move it. Collapse and reopen the inspector; both adjustments remain available.
4. Apply. The former position is empty, the marker follows the new level, and its edit ring shows the local change.
5. Hide edit guides or choose Browse. The map still shows the applied result at the appropriate zoom.
6. Switch layers, then reopen the draft. The applied result remains consistent in every view.
7. Check a footprint and its label, a road, a park and a river. Each selection exposes only that object's allowed tools.
8. Inspect a country outline and a bus stop. Neither presents editing actions.
9. Open Changes. Review the edits and start export without exposing administrative fields over the map.

### Desktop review

- Start with no compulsory sidebars, empty inspector, logo, routine prompt, legend or attribution bar over the map.
- Open the left utility panel, then select an object. Confirm that coexistence or panel replacement follows the
  map-space rule; a small laptop must still have a useful map.
- Adjust geometry with the inspector open, then collapse it. Neither action should lose the edit or change its meaning.
- Complete selection, form editing, Apply and undo with the keyboard. Confirm that typing uses native field shortcuts.
- Review a change with enough room for comparison, then narrow the window. The selection and draft should survive the
  transition into the compact layout.

### Mobile review

- Start with the full map, current-layer selector and thumb-accessible bottom bar, with the same requested UI removals.
- Select a feature, type with the keyboard open, and collapse the sheet to adjust geometry. Primary actions must stay
  reachable and the map must never move below a long control page.
- Open Layers or Changes during an unfinished edit, then return to it. Collapsing is different from discarding.
- Check a narrow phone, landscape orientation and device rotation. Labels, fields and controls should remain usable
  without losing the current work.

## 9. Decisions for review

| Topic                             | Recommended direction                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Default screen                    | Full map; compact top toolbar on desktop and bottom bar on mobile.                                        |
| Editing affordance                | Hollow guides; preserve normal cartography and readable names.                                            |
| Panels                            | Optional side panels on desktop; one bottom sheet on mobile. Preserve ample map space and allow collapse. |
| Less common property fields       | Keep below primary fields or in More details; use extra desktop width only where it improves readability. |
| Live result                       | Show all applied changes automatically; use edit guides as an optional aid.                               |
| Switching with an unfinished edit | Ask Apply / Discard edit / Keep editing for both typed and geometry changes.                              |
| Shared POI positions              | Offer a named choice list and refresh the shared marker after edits.                                      |
| Read-only layers                  | Clearly labelled inspection, with no editing form or handles.                                             |
| Attribution                       | Footer of the hidden Layers menu, as requested.                                                           |

The attribution choice needs one check before it is implemented. The OpenStreetMap attribution guidelines expect
attribution on or next to an interactive map, and accept it behind a small control on a small screen. The editor already
has such a compact attribution control from map-core, besides the credit line in its dock. Moving attribution only into
a menu footer would be a step away from the guidelines, even for an internal tool. If review agrees, keep the compact
map control, which leaves no text over the map until opened, and put the full credits in the Layers footer.

Edit guide density is also open. The desktop prototype shows overlapping rings at city zoom, because guides reveal every
POI regardless of its level. Options include showing guides only from a zoom where rings stay separable, or grouping
nearby rings into one; either way the keyboard selection list still reaches every POI.

Additional desktop decisions to confirm are the approximate map-space rule, whether optional panel pinning is useful,
and which shortcuts deserve visible hints inside Tools. Exact breakpoints and panel widths should follow a later visual
review on small laptops, large monitors, tablets and phones; the measurements above are starting points.

Review should settle the screen hierarchy, panel behaviour and layer-specific actions first. Exact icon shapes, colours,
spacing and transitions can be refined later. This proposal does not itself expand the shared editing permissions or
require changes to the publishing workflow; it is designed to follow them as entity IDs widen them.

## 10. What changes from the current editor

The [editor README](../../../apps/editor/README.md) describes what is implemented today. This proposal changes the
following behaviour; everything else, including permissions, validation, the draft store and export, stays as it is.

| Today                                                                                        | Proposed                                                                                        |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A dock with a layers table, one switch per source file, and status under the title.          | A full map with a layer selector, a Layers / Tools / Changes toolbar or bottom bar, and panels. |
| Outside a mode the map shows the reviewed release; a pending edit appears only in its mode.  | Applied edits appear in every layer and in Browse.                                              |
| Preview all edits shows the working map on request, from Browse.                             | No separate preview: the working map is always shown, with the same not-a-rebuild caveat.       |
| Escape, like Cancel, drops the open edit.                                                    | Escape cancels only a gesture in progress, or closes the foremost panel; Cancel drops the edit. |
| A mode switch silently drops a geometry preview, and is blocked by typed details.            | A mode switch asks Apply / Discard edit / Keep editing for both kinds of unapplied edit.        |
| A mode hides that file's published rendering and draws uniform fills, lines and filled dots. | Hollow guides around the normal map symbols, which can be turned off in Tools.                  |
| A permanent inspector column shows “Select an object” when nothing is selected.              | The inspector opens on selection and closes when the selection is cleared.                      |
| Below 720 pixels, the dock, map and inspector stack into one scrolling page.                 | The map stays fixed to the viewport, with a bottom bar and one bottom sheet.                    |
| A compact attribution control on the map, and a credit line in the dock.                     | Full credits in the Layers footer; see section 9 on keeping the compact control.                |
| Selection picks one feature under the pointer.                                               | A named choice list for overlapping objects and a keyboard selection list for the current view. |

Any unapplied edit still blocks undo, redo, adding a feature, export, import and discarding the draft, as it does today.
