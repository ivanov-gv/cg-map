package transport

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
)

var bus = Vehicle{Route: "6A", Longitude: 19.26, Latitude: 42.44}

func TestNormalize(t *testing.T) {
	// non-ASCII characters built from code points to keep the source ASCII-only
	bom := string(rune(0xFEFF))
	nbsp := string(rune(0x00A0))
	lineSeparator := string(rune(0x2028))
	nextLine := string(rune(0x0085))
	emoji := string(rune(0x1F68C)) // two UTF-16 code units

	tests := []struct {
		name       string
		rows       []Vehicle
		wantRoutes []string
		wantErr    error
	}{
		{
			// port of relay.test.mjs: duplicates, invalid GPS, null route, string longitude
			name: "relay parity: duplicates removed, invalid GPS and missing routes excluded",
			rows: []Vehicle{
				bus, bus,
				{Route: "6A", Longitude: 19.26, Latitude: 400},
				{Route: "", Longitude: 19.26, Latitude: 42.44},
				{Route: "6A", Longitude: math.NaN(), Latitude: 42.44},
			},
			wantRoutes: []string{"6A"},
		},
		{
			name:       "empty feed is valid",
			rows:       nil,
			wantRoutes: []string{},
		},
		{
			name:    "more than 2000 rows rejected",
			rows:    repeatVehicle(bus, 2001),
			wantErr: ErrTooManyVehicles,
		},
		{
			name:    "non-empty feed without valid rows rejected",
			rows:    []Vehicle{{Route: "   ", Longitude: 19.26, Latitude: 42.44}, {Route: "1", Longitude: 0, Latitude: 0}},
			wantErr: ErrNoValidVehicles,
		},
		{
			name:       "routes trimmed with JS whitespace semantics",
			rows:       []Vehicle{atLongitude(" \t6A\n", 19.1), atLongitude(bom+nbsp+"7"+lineSeparator, 19.2), atLongitude(nextLine+"8", 19.3)},
			wantRoutes: []string{"6A", "7", nextLine + "8"},
		},
		{
			name:       "trimmed routes deduplicate with untrimmed ones",
			rows:       []Vehicle{{Route: " 6A ", Longitude: 19.26, Latitude: 42.44}, bus},
			wantRoutes: []string{"6A"},
		},
		{
			name:       "same position with different routes kept",
			rows:       []Vehicle{bus, {Route: "6B", Longitude: 19.26, Latitude: 42.44}},
			wantRoutes: []string{"6A", "6B"},
		},
		{
			name: "routes truncated to 32 UTF-16 code units",
			rows: []Vehicle{
				atLongitude(strings.Repeat("A", 40), 19.1),
				atLongitude(strings.Repeat("A", 30)+emoji+"B", 19.2),
				atLongitude(strings.Repeat("A", 31)+emoji, 19.3),
			},
			// a pair that would be split is dropped whole (JS would keep a lone surrogate)
			wantRoutes: []string{strings.Repeat("A", 32), strings.Repeat("A", 30) + emoji, strings.Repeat("A", 31)},
		},
		{
			name: "bounds are inclusive, outside and non-finite rejected",
			rows: []Vehicle{
				{Route: "min", Longitude: 17.8, Latitude: 41.3},
				{Route: "max", Longitude: 21, Latitude: 44.1},
				{Route: "west", Longitude: 17.79, Latitude: 42},
				{Route: "east", Longitude: 21.01, Latitude: 42},
				{Route: "south", Longitude: 19, Latitude: 41.29},
				{Route: "north", Longitude: 19, Latitude: 44.11},
				{Route: "inf", Longitude: math.Inf(1), Latitude: 42},
				{Route: "nan", Longitude: 19, Latitude: math.NaN()},
			},
			wantRoutes: []string{"min", "max"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			features, err := Normalize(tt.rows)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Normalize error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				return
			}
			if features == nil {
				t.Fatal("Normalize returned nil features; JSON must encode []")
			}
			routes := make([]string, 0, len(features))
			for _, feature := range features {
				routes = append(routes, feature.Properties.Route)
				if feature.Type != "Feature" || feature.Geometry.Type != "Point" {
					t.Errorf("feature types = %q/%q", feature.Type, feature.Geometry.Type)
				}
			}
			if !reflect.DeepEqual(routes, tt.wantRoutes) {
				t.Errorf("routes = %q, want %q", routes, tt.wantRoutes)
			}
		})
	}
}

func TestNormalizeCoordinatesOrder(t *testing.T) {
	features, err := Normalize([]Vehicle{bus})
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if features[0].Geometry.Coordinates != [2]float64{19.26, 42.44} {
		t.Errorf("coordinates = %v, want [19.26 42.44]", features[0].Geometry.Coordinates)
	}
}

func TestNormalizeAcceptsExactly2000Rows(t *testing.T) {
	rows := make([]Vehicle, maxVehicleRows)
	for index := range rows {
		rows[index] = Vehicle{Route: "1", Longitude: 19 + float64(index)/10000, Latitude: 42}
	}
	features, err := Normalize(rows)
	if err != nil || len(features) != maxVehicleRows {
		t.Fatalf("Normalize = %d features, %v; want %d, nil", len(features), err, maxVehicleRows)
	}
}

func repeatVehicle(vehicle Vehicle, count int) []Vehicle {
	rows := make([]Vehicle, count)
	for index := range rows {
		rows[index] = vehicle
	}
	return rows
}

func atLongitude(route string, longitude float64) Vehicle {
	return Vehicle{Route: route, Longitude: longitude, Latitude: 42.44}
}
