# Transit backend

Read README.md and docs/transport.md from the repository root. The upstream feed is public but CORS-restricted to ePodgorica; the public map needs a separately hosted relay.

Keep the upstream fixed, the API read-only, and refreshes bounded/cached. Never pass through caller-supplied URLs, credentials, or headers. Do not invent vehicle identity or GPS age. Preserve stale/expiry behavior and coordinate validation.

Run the Node relay tests and root make check. Hosted updates must sync canonical relay.mjs into the recorded Site source; preserve its identity and audience. Never embed private service credentials in the web client.
