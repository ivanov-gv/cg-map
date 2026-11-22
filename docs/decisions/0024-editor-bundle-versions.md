# 0024: Versioned editor source bundles

## Status

Accepted.

## Context

The version-1 editor bundle manifest pinned eight source GeoJSON files. Feature #324 added a ninth,
`building-entrances.geojson`, to that same manifest. A bundle built from `main` has only eight files, so an editor that
requires nine would reject an existing reviewed bundle; later Features in the stack add further source files. The
producer, the browser consumer and the cross-component tests all need one rule that keeps older bundles usable.

## Decision

`editor-bundle.schema.json` declares two manifest versions. Version 1 keeps exactly the original eight filenames and is
frozen. Version 2 is the current nine-file set and stays open until the Feature stack merges: adding a source file to
version 2 is one line in its filename list, accompanied by the matching producer and consumer changes. The producer
writes version 2; the editor accepts versions 1 and 2 and selects the expected filenames from the manifest version.
Later Features add their files to version 2 rather than introducing a new version for each addition.

## Consequences

A version-1 bundle built from `main` remains inspectable, and a v2 bundle can grow through the stack without changing
the consumer's version check. Version 2 must not be treated as frozen until the stack merges; after that a new file set
needs a new version. Tests in `packages/contracts`, `data`, `apps/editor` and `tests/integration` keep the producer's
version, both filename lists and the consumer's check in step.
