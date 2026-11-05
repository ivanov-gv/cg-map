package transport

import (
	"errors"
	"fmt"

	transportv1 "github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// toListVehiclesResponse maps a snapshot to protobuf. A nil Direction means the direction is unknown.
func toListVehiclesResponse(snapshot vehicles.Snapshot) (*transportv1.ListVehiclesResponse, error) {
	if snapshot.FetchedAt.IsZero() {
		return nil, errors.New("missing check time")
	}
	fetchedAt := timestamppb.New(snapshot.FetchedAt)
	err := fetchedAt.CheckValid()
	if err != nil {
		return nil, fmt.Errorf("Timestamp.CheckValid: %w", err)
	}

	responseVehicles := make([]*transportv1.Vehicle, len(snapshot.Vehicles))
	for index, vehicle := range snapshot.Vehicles {
		responseVehicles[index] = toResponseVehicle(vehicle)
	}
	return &transportv1.ListVehiclesResponse{
		Vehicles:  responseVehicles,
		FetchedAt: fetchedAt,
		Stale:     snapshot.Stale,
		SourceUrl: sourceURL,
	}, nil
}

func toResponseVehicle(vehicle vehicles.Vehicle) *transportv1.Vehicle {
	responseVehicle := &transportv1.Vehicle{
		Route:     vehicle.Route,
		Longitude: vehicle.Longitude,
		Latitude:  vehicle.Latitude,
	}
	if vehicle.DirectionDegrees != nil {
		responseVehicle.Direction = &transportv1.Direction{
			BearingDegrees: *vehicle.DirectionDegrees,
			Source:         transportv1.HeadingSource_HEADING_SOURCE_MOVEMENT,
		}
	}
	return responseVehicle
}

// toFeatureCollection renders a snapshot as a feed body.
func toFeatureCollection(snapshot vehicles.Snapshot) FeatureCollection {
	features := make([]Feature, len(snapshot.Vehicles))
	for index, vehicle := range snapshot.Vehicles {
		features[index] = toFeature(vehicle)
	}
	// JS toISOString format: UTC with exactly three fractional digits
	fetchedAt := snapshot.FetchedAt.UTC().Format(fetchedAtLayout)
	return FeatureCollection{
		Type:      featureCollectionType,
		Features:  features,
		FetchedAt: &fetchedAt,
		Source:    sourceURL,
		Stale:     snapshot.Stale,
	}
}

func toFeature(vehicle vehicles.Vehicle) Feature {
	properties := FeatureProperties{Route: vehicle.Route}
	if vehicle.DirectionDegrees != nil {
		properties.Bearing = vehicle.DirectionDegrees
		properties.Heading = headingMovement
	}
	return Feature{
		Type:       featureType,
		Geometry:   Point{Type: pointType, Coordinates: [2]float64{vehicle.Longitude, vehicle.Latitude}},
		Properties: properties,
	}
}
