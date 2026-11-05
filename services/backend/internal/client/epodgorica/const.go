package epodgorica

// upstreamURL is the fixed public ePodgorica vehicle endpoint, polled by the map at epodgorica.me/javniprevoz/mapa.
const upstreamURL = "https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public"

// maxUpstreamBytes bounds the upstream body, like relay.mjs (512000 characters). Counting bytes is
// at least as strict as counting UTF-16 units.
const maxUpstreamBytes = 512000
