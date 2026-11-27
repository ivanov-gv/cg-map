# Transit backend

Read README.md and [transport](../../docs/ui-ux/features/transport.md) from the repository root. The upstream feed is
public but CORS-restricted to ePodgorica; the public map needs a separately hosted relay.

Keep the upstream fixed, the API read-only, and refreshes bounded/cached. Never pass through caller-supplied URLs,
credentials, or headers. Do not invent vehicle identity or GPS age. Preserve stale/expiry behavior and coordinate
validation.

Node relay tests are optional for iterating; the pre-push hook runs the checks selected by the pushed diff (builds and
non-browser checks, no browser suites, `make check` on failure). GitHub's transit-relay pipeline and `CI gate` gate the
merge. Hosted updates must sync canonical relay.mjs into the recorded Site source; preserve its identity and audience.
Never embed private service credentials in the web client.
