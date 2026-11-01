package transport

import (
	"math"
	"sort"
	"time"
)

// Direction tracking constants, identical to apps/web/src/vehicle-direction.js.
const (
	directionMinMove  = 20.0 // metres a bus must move before its direction changes (GPS noise)
	directionMaxSpeed = 30.0 // metres per second; farther jumps are a different bus
	directionSlack    = 50.0 // metres added to the reachable distance
	directionMaxGap   = 60 * time.Second
	earthRadius       = 6371008.8
	degree            = math.Pi / 180
	// HeadingMovement marks a bearing derived from the bus's movement between feed checks.
	HeadingMovement = "movement"
)

// track is one bus followed across checks. The upstream has no vehicle IDs, so buses are matched
// by route and nearest plausible position.
type track struct {
	route string
	// reference is the last position the bus moved from; a stationary bus keeps it, so small steps add up.
	reference [2]float64
	bearing   *float64
}

// directionTracker adds a movement bearing to buses that moved between feed checks.
// It is not safe for concurrent use; the feed calls it from its single in-flight refresh.
type directionTracker struct {
	tracks []track
	at     time.Time
}

// update returns features with Bearing/Heading set for buses whose movement is known, and
// remembers this check. Buses that have not moved since first seen get no bearing.
func (t *directionTracker) update(features []Feature, at time.Time) []Feature {
	elapsed := at.Sub(t.at)
	// after a pause, positions are too far apart in time to match reliably; a repeated check has elapsed 0
	if t.at.IsZero() || elapsed < 0 || elapsed > directionMaxGap {
		t.tracks = nil
	}
	reach := directionMaxSpeed*elapsed.Seconds() + directionSlack

	type pair struct {
		feature, track int
		distance       float64
	}
	var pairs []pair
	for featureIndex, feature := range features {
		for trackIndex, previous := range t.tracks {
			if previous.route != feature.Properties.Route {
				continue
			}
			distance := metres(previous.reference, feature.Geometry.Coordinates)
			if distance <= reach {
				pairs = append(pairs, pair{feature: featureIndex, track: trackIndex, distance: distance})
			}
		}
	}
	// nearest pairs first; stable order keeps equal distances deterministic
	sort.SliceStable(pairs, func(a, b int) bool { return pairs[a].distance < pairs[b].distance })
	matched := make(map[int]pair, len(pairs))
	usedTracks := make(map[int]bool, len(pairs))
	for _, candidate := range pairs {
		if _, done := matched[candidate.feature]; done || usedTracks[candidate.track] {
			continue
		}
		matched[candidate.feature] = candidate
		usedTracks[candidate.track] = true
	}

	output := make([]Feature, len(features))
	tracks := make([]track, len(features))
	for index, feature := range features {
		current := track{route: feature.Properties.Route, reference: feature.Geometry.Coordinates}
		if candidate, ok := matched[index]; ok {
			previous := t.tracks[candidate.track]
			if candidate.distance >= directionMinMove {
				direction := bearing(previous.reference, current.reference)
				current.bearing = &direction
			} else {
				current.reference, current.bearing = previous.reference, previous.bearing
			}
		}
		tracks[index] = current
		output[index] = feature
		if current.bearing != nil {
			direction := math.Mod(math.Round(*current.bearing*10)/10, 360)
			output[index].Properties.Bearing = &direction
			output[index].Properties.Heading = HeadingMovement
		}
	}
	t.tracks, t.at = tracks, at
	return output
}

// local projects point onto a plane around origin, in metres (equirectangular; fine at city scale).
func local(origin, point [2]float64) (float64, float64) {
	x := (point[0] - origin[0]) * degree * math.Cos(origin[1]*degree) * earthRadius
	y := (point[1] - origin[1]) * degree * earthRadius
	return x, y
}

func metres(a, b [2]float64) float64 {
	return math.Hypot(local(a, b))
}

// bearing is the compass direction from a to b in degrees clockwise from north, in [0, 360).
func bearing(a, b [2]float64) float64 {
	x, y := local(a, b)
	return math.Mod(math.Atan2(x, y)/degree+360, 360)
}
