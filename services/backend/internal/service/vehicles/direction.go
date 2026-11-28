package vehicles

import (
	"math"
	"sort"
	"time"
)

// Direction tracking constants, identical to apps/web/src/vehicle-direction.js.
const (
	// minMovementMetres is how far a vehicle must move before its direction changes; smaller moves may be GPS noise.
	minMovementMetres = 20.0
	// maxSpeedMetresPerSecond limits how far one vehicle can plausibly travel between checks.
	maxSpeedMetresPerSecond = 30.0
	// matchToleranceMetres is added to the distance a vehicle can plausibly travel between checks.
	matchToleranceMetres = 50.0
	// maxTrackingGap is the longest pause between checks that still allows matching vehicles.
	maxTrackingGap = 60 * time.Second

	degreesPerCircle = 360
	// publishedStepsPerDegree rounds published directions to one decimal place.
	publishedStepsPerDegree = 10

	earthRadiusMetres = 6371008.8
	radiansPerDegree  = math.Pi / 180
)

// trackedVehicle is one vehicle remembered from the previous check.
type trackedVehicle struct {
	route string
	// movementAnchor is the position that movement is measured from.
	// It stays in place until the vehicle moves minMovementMetres away, so small steps add up.
	movementAnchor coordinates
	// direction is in degrees clockwise from north. It is nil while unknown, because 0 means north.
	direction *float64
}

// directionTracker sets DirectionDegrees on vehicles that moved between feed checks.
// It is not safe for concurrent use; the feed calls it from its single in-flight refresh.
type directionTracker struct {
	previouslyTracked []trackedVehicle
	previousFetchedAt time.Time
}

// update returns vehicles with DirectionDegrees set for vehicles whose movement is known, and
// remembers this check. Vehicles that have not moved since first seen get no direction.
func (t *directionTracker) update(vehicles []Vehicle, fetchedAt time.Time) []Vehicle {
	elapsed := fetchedAt.Sub(t.previousFetchedAt)
	// after a pause, positions are too far apart in time to match reliably; a repeated check has elapsed 0
	if t.previousFetchedAt.IsZero() || elapsed < 0 || elapsed > maxTrackingGap {
		t.previouslyTracked = nil
	}
	maxMatchDistanceMetres := maxSpeedMetresPerSecond*elapsed.Seconds() + matchToleranceMetres
	matches := t.matchToPreviouslyTracked(vehicles, maxMatchDistanceMetres)

	publishedVehicles := make([]Vehicle, len(vehicles))
	currentlyTracked := make([]trackedVehicle, len(vehicles))
	for vehicleIndex, vehicle := range vehicles {
		// a vehicle without a match is new: it starts here with an unknown direction
		position := vehicle.position()
		tracked := trackedVehicle{route: vehicle.Route, movementAnchor: position}
		match, isMatched := matches[vehicleIndex]
		if isMatched {
			previousVehicle := t.previouslyTracked[match.previousIndex]
			tracked = previousVehicle.movedTo(position, match.separationMetres)
		}
		currentlyTracked[vehicleIndex] = tracked
		publishedVehicles[vehicleIndex] = vehicle
		if tracked.direction == nil {
			continue
		}

		// publish one decimal place; a direction that rounds up to 360.0 wraps to 0.0
		roundedDirection := math.Mod(math.Round(*tracked.direction*publishedStepsPerDegree)/publishedStepsPerDegree, degreesPerCircle)
		publishedVehicles[vehicleIndex].DirectionDegrees = &roundedDirection
	}

	t.previouslyTracked, t.previousFetchedAt = currentlyTracked, fetchedAt
	return publishedVehicles
}

// vehicleMatch links a vehicle in the current check to a vehicle from the previous check.
type vehicleMatch struct {
	vehicleIndex, previousIndex int
	separationMetres            float64 // from the previous vehicle's movement anchor to the current vehicle's position
}

// matchToPreviouslyTracked returns the matches keyed by vehicle index. The upstream has no vehicle IDs, so
// a vehicle is assumed to be the nearest plausible previous vehicle on its route. Each side is used at most once, and the
// closest available pair wins.
func (t *directionTracker) matchToPreviouslyTracked(vehicles []Vehicle, maxDistanceMetres float64) map[int]vehicleMatch {
	// collect every plausible pair
	var candidates []vehicleMatch
	for vehicleIndex, vehicle := range vehicles {
		for previousIndex, previousVehicle := range t.previouslyTracked {
			if previousVehicle.route != vehicle.Route {
				continue
			}
			separationMetres := distanceMetres(previousVehicle.movementAnchor, vehicle.position())
			if separationMetres <= maxDistanceMetres {
				candidates = append(candidates, vehicleMatch{vehicleIndex: vehicleIndex, previousIndex: previousIndex, separationMetres: separationMetres})
			}
		}
	}

	// nearest pairs first; stable order keeps equal distances deterministic
	sort.SliceStable(candidates, func(left, right int) bool {
		return candidates[left].separationMetres < candidates[right].separationMetres
	})

	// accept each pair whose current and previous vehicles are both still free
	matches := make(map[int]vehicleMatch, len(candidates))
	usedPrevious := make(map[int]bool, len(candidates))
	for _, candidate := range candidates {
		_, isVehicleMatched := matches[candidate.vehicleIndex]
		if isVehicleMatched || usedPrevious[candidate.previousIndex] {
			continue
		}
		matches[candidate.vehicleIndex] = candidate
		usedPrevious[candidate.previousIndex] = true
	}
	return matches
}

// movedTo returns the vehicle after it was seen at position, separationMetres from its movement anchor.
// A vehicle that barely moved keeps its anchor and its last direction.
func (tracked trackedVehicle) movedTo(position coordinates, separationMetres float64) trackedVehicle {
	if separationMetres < minMovementMetres {
		return tracked
	}
	direction := compassDirection(tracked.movementAnchor, position)
	return trackedVehicle{route: tracked.route, movementAnchor: position, direction: &direction}
}

// offsetMetres returns how far point lies east and north of origin. It projects both onto a flat plane
// (equirectangular; fine at city scale).
func offsetMetres(origin, point coordinates) (east, north float64) {
	east = (point.longitude - origin.longitude) * radiansPerDegree * math.Cos(origin.latitude*radiansPerDegree) * earthRadiusMetres
	north = (point.latitude - origin.latitude) * radiansPerDegree * earthRadiusMetres
	return east, north
}

// distanceMetres returns the distance between two positions.
func distanceMetres(from, to coordinates) float64 {
	east, north := offsetMetres(from, to)
	return math.Hypot(east, north)
}

// compassDirection returns the direction from one position to another in degrees clockwise from north, in [0, 360).
func compassDirection(from, to coordinates) float64 {
	east, north := offsetMetres(from, to)
	return math.Mod(math.Atan2(east, north)/radiansPerDegree+degreesPerCircle, degreesPerCircle)
}
