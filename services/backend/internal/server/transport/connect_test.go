package transport

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectinprocess"
	transportv1 "github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1"
	"github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1/transportv1connect"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

type fixedFeed struct {
	snapshot vehicles.Snapshot
	err      error
}

func (f fixedFeed) Current(context.Context) (vehicles.Snapshot, error) {
	return f.snapshot, f.err
}

func transportTestSnapshot(directionDegrees *float64, stale bool) vehicles.Snapshot {
	return vehicles.Snapshot{
		FetchedAt: time.Date(2026, 11, 5, 12, 0, 0, 123*int(time.Millisecond), time.UTC),
		Stale:     stale,
		Vehicles:  []vehicles.Vehicle{{Route: "6A", Longitude: 19.26, Latitude: 42.44, DirectionDegrees: directionDegrees}},
	}
}

func TestListVehiclesPresenceAndFreshness(t *testing.T) {
	north := 0.0
	for _, test := range []struct {
		name    string
		bearing *float64
		stale   bool
	}{{"unknown", nil, false}, {"north", &north, false}, {"stale keeps direction", &north, true}} {
		t.Run(test.name, func(t *testing.T) {
			server := connect.NewServer()
			transportv1connect.RegisterTransportServiceHandler(server, NewServer(fixedFeed{snapshot: transportTestSnapshot(test.bearing, test.stale)}))
			client := transportv1connect.NewTransportServiceClient(connect.NewClient(connectinprocess.New(server)))
			response, err := client.ListVehicles(context.Background(), &transportv1.ListVehiclesRequest{})
			if err != nil {
				t.Fatal(err)
			}
			fetchedAt := response.FetchedAt.AsTime().Format("2006-01-02T15:04:05.000Z")
			isExpectedSnapshot := len(response.Vehicles) == 1 &&
				fetchedAt == "2026-11-05T12:00:00.123Z" &&
				response.Stale == test.stale &&
				response.SourceUrl == sourceURL
			if !isExpectedSnapshot {
				t.Fatalf("snapshot metadata = %v", response)
			}
			vehicle := response.Vehicles[0]
			if vehicle.Route != "6A" || vehicle.Longitude != 19.26 || vehicle.Latitude != 42.44 {
				t.Fatalf("vehicle = %v", vehicle)
			}
			if test.bearing == nil {
				if vehicle.Direction != nil {
					t.Fatal("unknown direction must be absent")
				}
			} else if vehicle.Direction == nil || vehicle.Direction.BearingDegrees != 0 || vehicle.Direction.Source != transportv1.HeadingSource_HEADING_SOURCE_MOVEMENT {
				t.Fatalf("north must be present as movement: %v", vehicle.Direction)
			}
		})
	}
}

func TestListVehiclesErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		feed fixedFeed
		code connect.Code
	}{
		{"observing or expired", fixedFeed{err: vehicles.ErrUnavailable}, connect.CodeUnavailable},
		{"upstream timeout after expiry", fixedFeed{err: fmt.Errorf("%w: %w", vehicles.ErrUnavailable, context.DeadlineExceeded)}, connect.CodeUnavailable},
		{"canceled", fixedFeed{err: context.Canceled}, connect.CodeCanceled},
		{"deadline", fixedFeed{err: context.DeadlineExceeded}, connect.CodeDeadlineExceeded},
		{"unexpected error", fixedFeed{err: errors.New("private upstream diagnostic")}, connect.CodeInternal},
		{"invalid snapshot", fixedFeed{}, connect.CodeInternal},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := connect.NewServer()
			transportv1connect.RegisterTransportServiceHandler(server, NewServer(test.feed))
			client := transportv1connect.NewTransportServiceClient(connect.NewClient(connectinprocess.New(server)))
			_, err := client.ListVehicles(context.Background(), &transportv1.ListVehiclesRequest{})
			if connect.CodeOf(err) != test.code {
				t.Fatalf("error = %v, want %v", err, test.code)
			}
		})
	}
}

func TestConnectErrorWhenRequestEnded(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, cancelExpired := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancelExpired()
	for _, test := range []struct {
		name string
		ctx  context.Context
		err  error
		code connect.Code
	}{
		{"request cancelled while waiting", cancelled, fmt.Errorf("%w: %w", vehicles.ErrUnavailable, context.Canceled), connect.CodeCanceled},
		{"request deadline passed while waiting", expired, fmt.Errorf("%w: %w", vehicles.ErrUnavailable, context.DeadlineExceeded), connect.CodeDeadlineExceeded},
		{"request ended on an unrelated outage", cancelled, vehicles.ErrUnavailable, connect.CodeUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := connect.CodeOf(toConnectError(test.ctx, test.err))
			if got != test.code {
				t.Fatalf("code = %v, want %v", got, test.code)
			}
		})
	}
}

func TestTransportProtocols(t *testing.T) {
	north := 0.0
	connectServer := connect.NewServer()
	transportv1connect.RegisterTransportServiceHandler(connectServer, NewServer(fixedFeed{snapshot: transportTestSnapshot(&north, false)}))
	routes := http.NewServeMux()
	connecthttp.Mount(routes, connectServer)
	server := httptest.NewUnstartedServer(routes)
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	for _, test := range []struct {
		name    string
		options []connecthttp.Option
	}{
		{"Connect binary", nil},
		{"Connect JSON", []connecthttp.Option{connecthttp.WithProtoJSON()}},
		{"gRPC", []connecthttp.Option{connecthttp.WithGRPC()}},
		{"gRPC-Web", []connecthttp.Option{connecthttp.WithGRPCWeb()}},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := transportv1connect.NewTransportServiceClient(connect.NewClient(connecthttp.NewTransport(server.Client(), server.URL, test.options...)))
			ctx, callInfo := connect.NewClientContext(context.Background())
			response, err := client.ListVehicles(ctx, &transportv1.ListVehiclesRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if len(response.Vehicles) != 1 || response.Vehicles[0].Direction == nil || response.Vehicles[0].Direction.BearingDegrees != 0 {
				t.Fatalf("direction lost on the wire: %v", response)
			}
			if callInfo.ResponseHeader().Get("Cache-Control") != "no-store" {
				t.Fatal("live RPC responses must not be cached")
			}
		})
	}
}
