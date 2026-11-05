package vehicles

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
)

var sampleRow = UpstreamVehicle{Route: "6A", Longitude: 19.26, Latitude: 42.44}

func TestNormalize(t *testing.T) { //nolint:funlen // mostly a table of cases
	// non-ASCII characters built from code points to keep the source ASCII-only
	bom := string(rune(0xFEFF))
	nbsp := string(rune(0x00A0))
	lineSeparator := string(rune(0x2028))
	nextLine := string(rune(0x0085))
	emoji := string(rune(0x1F68C)) // two UTF-16 code units

	tests := []struct {
		name       string
		rows       []UpstreamVehicle
		wantRoutes []string
		wantErr    error
	}{
		{
			// port of relay.test.mjs: duplicates, invalid GPS, null route, string longitude
			name: "relay parity: duplicates removed, invalid GPS and missing routes excluded",
			rows: []UpstreamVehicle{
				sampleRow, sampleRow,
				{Route: "6A", Longitude: 19.26, Latitude: 400},
				{Route: "", Longitude: 19.26, Latitude: 42.44},
				{Route: "6A", Longitude: math.NaN(), Latitude: 42.44},
			},
			wantRoutes: []string{"6A"},
		},
		{
			// what a source passes through unfiltered: a non-string route, non-number coordinates, non-object rows
			name: "rows a source passes through are discarded here",
			rows: []UpstreamVehicle{
				{Route: "6A", Longitude: 19.263, Latitude: 42.454},
				{Route: "", Longitude: 19.2, Latitude: 42.4},
				{Route: "7", Longitude: 19.2, Latitude: math.NaN()},
				{Route: "", Longitude: math.NaN(), Latitude: math.NaN()},
				{Route: "9", Longitude: math.NaN(), Latitude: 42.1},
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
			rows:    repeatVehicle(sampleRow, 2001),
			wantErr: ErrTooManyVehicles,
		},
		{
			name:    "non-empty feed without valid rows rejected",
			rows:    []UpstreamVehicle{{Route: "   ", Longitude: 19.26, Latitude: 42.44}, {Route: "1", Longitude: 0, Latitude: 0}},
			wantErr: ErrNoValidVehicles,
		},
		{
			name:       "routes trimmed with JS whitespace semantics",
			rows:       []UpstreamVehicle{atLongitude(" \t6A\n", 19.1), atLongitude(bom+nbsp+"7"+lineSeparator, 19.2), atLongitude(nextLine+"8", 19.3)},
			wantRoutes: []string{"6A", "7", nextLine + "8"},
		},
		{
			name:       "trimmed routes deduplicate with untrimmed ones",
			rows:       []UpstreamVehicle{{Route: " 6A ", Longitude: 19.26, Latitude: 42.44}, sampleRow},
			wantRoutes: []string{"6A"},
		},
		{
			name:       "same position with different routes kept",
			rows:       []UpstreamVehicle{sampleRow, {Route: "6B", Longitude: 19.26, Latitude: 42.44}},
			wantRoutes: []string{"6A", "6B"},
		},
		{
			name: "routes truncated to 32 UTF-16 code units",
			rows: []UpstreamVehicle{
				atLongitude(strings.Repeat("A", 40), 19.1),
				atLongitude(strings.Repeat("A", 30)+emoji+"B", 19.2),
				atLongitude(strings.Repeat("A", 31)+emoji, 19.3),
			},
			// a pair that would be split is dropped whole (JS would keep a lone surrogate)
			wantRoutes: []string{strings.Repeat("A", 32), strings.Repeat("A", 30) + emoji, strings.Repeat("A", 31)},
		},
		{
			name: "bounds are inclusive, outside and non-finite rejected",
			rows: []UpstreamVehicle{
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
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			vehicles, err := normalize(test.rows)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("normalize error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if vehicles == nil {
				t.Fatal("normalize returned nil vehicles; an empty feed is a valid empty list")
			}
			routes := make([]string, 0, len(vehicles))
			for _, vehicle := range vehicles {
				routes = append(routes, vehicle.Route)
			}
			if !reflect.DeepEqual(routes, test.wantRoutes) {
				t.Errorf("routes = %q, want %q", routes, test.wantRoutes)
			}
		})
	}
}

func TestNormalizeCoordinatesOrder(t *testing.T) {
	vehicles, err := normalize([]UpstreamVehicle{sampleRow})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if want := (coordinates{longitude: 19.26, latitude: 42.44}); vehicles[0].position() != want {
		t.Errorf("position = %v, want %v", vehicles[0].position(), want)
	}
}

func TestNormalizeAcceptsExactly2000Rows(t *testing.T) {
	rows := make([]UpstreamVehicle, MaxVehicleRows)
	for index := range rows {
		rows[index] = UpstreamVehicle{Route: "1", Longitude: 19 + float64(index)/10000, Latitude: 42}
	}
	vehicles, err := normalize(rows)
	if err != nil || len(vehicles) != MaxVehicleRows {
		t.Fatalf("normalize = %d vehicles, %v; want %d, nil", len(vehicles), err, MaxVehicleRows)
	}
}

func repeatVehicle(vehicle UpstreamVehicle, count int) []UpstreamVehicle {
	rows := make([]UpstreamVehicle, count)
	for index := range rows {
		rows[index] = vehicle
	}
	return rows
}

func atLongitude(route string, longitude float64) UpstreamVehicle {
	return UpstreamVehicle{Route: route, Longitude: longitude, Latitude: 42.44}
}
