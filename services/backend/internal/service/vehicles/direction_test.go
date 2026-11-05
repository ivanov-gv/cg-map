package vehicles

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

func vehicleAt(route string, longitude, latitude float64) Vehicle {
	return Vehicle{Route: route, Longitude: longitude, Latitude: latitude}
}

// directions returns each vehicle's direction, or -1 without one.
func directions(vehicles []Vehicle) []float64 {
	result := make([]float64, len(vehicles))
	for index, vehicle := range vehicles {
		result[index] = -1
		if vehicle.DirectionDegrees != nil {
			result[index] = *vehicle.DirectionDegrees
		}
	}
	return result
}

// decodeFixtureVehicle reads a fixture vehicle, written as [route, longitude, latitude].
func decodeFixtureVehicle(t *testing.T, row [3]json.RawMessage) Vehicle {
	t.Helper()
	var route string
	var longitude, latitude float64
	if json.Unmarshal(row[0], &route) != nil || json.Unmarshal(row[1], &longitude) != nil || json.Unmarshal(row[2], &latitude) != nil {
		t.Fatalf("row %v", row)
	}
	return vehicleAt(route, longitude, latitude)
}

// directionCases is packages/contracts/fixtures/vehicle-direction-cases.json, shared with the browser tracker's tests.
type directionCases struct {
	Cases []struct {
		Name   string            `json:"name"`
		Checks []json.RawMessage `json:"checks"`
		Want   []*float64        `json:"want"`
	} `json:"cases"`
}

// runFixtureChecks feeds a fixture case's checks to a new tracker and returns the last output.
// Each check is [milliseconds since start, [vehicle, ...]].
func runFixtureChecks(t *testing.T, checks []json.RawMessage) []Vehicle {
	t.Helper()
	var tracker directionTracker
	var output []Vehicle
	for _, check := range checks {
		var elapsedMilliseconds int64
		var rows [][3]json.RawMessage
		err := json.Unmarshal(check, &[]any{&elapsedMilliseconds, &rows})
		if err != nil {
			t.Fatalf("check %s: %v", check, err)
		}
		vehicles := make([]Vehicle, len(rows))
		for index, row := range rows {
			vehicles[index] = decodeFixtureVehicle(t, row)
		}
		output = tracker.update(vehicles, startTime.Add(time.Duration(elapsedMilliseconds)*time.Millisecond))
	}
	return output
}

func TestDirectionTracker(t *testing.T) {
	raw, err := os.ReadFile("../../../../../packages/contracts/fixtures/vehicle-direction-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture directionCases
	err = json.Unmarshal(raw, &fixture)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range fixture.Cases {
		t.Run(test.Name, func(t *testing.T) {
			got := directions(runFixtureChecks(t, test.Checks))
			if len(got) != len(test.Want) {
				t.Fatalf("directions = %v, want %d vehicles", got, len(test.Want))
			}
			// fixture directions have one decimal place, so allow one rounding step
			const directionTolerance = 0.11
			for index, want := range test.Want {
				isUnknownAsExpected := want == nil && got[index] == -1
				isNearExpected := want != nil && math.Abs(got[index]-*want) <= directionTolerance
				if !isUnknownAsExpected && !isNearExpected {
					t.Fatalf("vehicle %d direction = %v, want %v", index, got[index], formatWant(want))
				}
			}
		})
	}
}

func formatWant(want *float64) any {
	if want == nil {
		return "none"
	}
	return *want
}

func TestDirectionStaysBelow360(t *testing.T) {
	var tracker directionTracker
	tracker.update([]Vehicle{vehicleAt("6", 19.26, 42.44)}, startTime)
	// almost due north, slightly west: rounds to 360.0 before wrapping
	output := tracker.update([]Vehicle{vehicleAt("6", 19.2599999, 42.441)}, startTime.Add(13*time.Second))
	if got := *output[0].DirectionDegrees; got < 0 || got >= 360 {
		t.Fatalf("direction = %v, want [0, 360)", got)
	}
}
