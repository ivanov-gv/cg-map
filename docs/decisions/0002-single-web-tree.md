> Superseded by [ADR 0003](0003-concern-monorepo-and-actions-pages.md).

# ADR 0002: One web tree and conventional host locations

Date: 2026-10-18. Status: accepted. Supersedes ADR 0001's generated root-output decision.

## Problem

Copying the app into the root mixed JavaScript, images, map archives, fonts, and server commands with project configuration. It also created a second tree requiring synchronization.

## Decision

Keep all browser application files in web/. Publish branch-based Pages from the root with a small index.html forwarding to web/. Reserve docs/ for documentation, cmd/kompas/ for the optional Go host, and tools/ for utilities including the Python development server.

The Go command serves assets from disk with an explicit -dir option; it no longer embeds an application copy. Standalone static exports go to ignored dist/. Remove the root publisher and its asset inventory. Enforce the root layout in repository checks.

## Compatibility

The public entry URL stays the same; the browser app URL gains /web/. Query/hash survive the transition. A root service-worker retirement shim prevents the old worker from continuing to serve a stale root app. It does not clear origin-wide caches or verified downloads.

## Consequences

No duplicate tracked application tree. No full build is needed to publish UI changes; regenerate offline manifests and commit the source. A distributed Go binary needs its chosen asset directory alongside it.
