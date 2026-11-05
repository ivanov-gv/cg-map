// Package transport publishes live vehicles over two protocols: the protobuf-defined Connect API
// and the GeoJSON compatibility endpoint. Both read the same VehicleFeed.
package transport

import (
	"context"
	"errors"
	"log"

	"connectrpc.com/connect/v2"
	transportv1 "github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1"
	"github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1/transportv1connect"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

// VehicleFeed supplies the current snapshot, or an error wrapping vehicles.ErrUnavailable.
type VehicleFeed interface {
	Current(ctx context.Context) (vehicles.Snapshot, error)
}

// Server adapts the observed feed to generated protobuf messages.
type Server struct {
	feed VehicleFeed
}

var _ transportv1connect.TransportServiceHandler = (*Server)(nil)

// NewServer returns the transport API backed by feed.
func NewServer(feed VehicleFeed) *Server {
	return &Server{feed: feed}
}

// ListVehicles returns the feed's current snapshot. Responses are never cached.
func (s *Server) ListVehicles(ctx context.Context, _ *transportv1.ListVehiclesRequest) (*transportv1.ListVehiclesResponse, error) {
	callInfo, _ := connect.CallInfoForServerContext(ctx)
	callInfo.ResponseHeader().Set("Cache-Control", noStoreCacheControl)

	snapshot, err := s.feed.Current(ctx)
	if err != nil {
		return nil, toConnectError(ctx, err)
	}
	response, err := toListVehiclesResponse(snapshot)
	if err != nil {
		log.Printf("transport: toListVehiclesResponse: %v", err)
		return nil, connect.NewError(connect.CodeInternal, "invalid vehicle snapshot")
	}
	return response, nil
}

// toConnectError maps a feed error to a public RPC error, without exposing upstream details.
// A feed error can wrap a context error from the feed's own upstream timeout, so an unavailable
// feed only reports canceled or deadline exceeded once the caller's own request has ended.
func toConnectError(ctx context.Context, err error) error {
	isContextError := errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
	isRequestActive := ctx.Err() == nil
	switch {
	case errors.Is(err, vehicles.ErrUnavailable) && (isRequestActive || !isContextError):
		return connect.NewError(connect.CodeUnavailable, "live vehicle positions are temporarily unavailable")
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, "request canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, "request deadline exceeded")
	default:
		// clients get no details, so this log is the only trace of the cause
		log.Printf("transport: unexpected feed error: %v", err)
		return connect.NewError(connect.CodeInternal, "vehicle snapshot failed")
	}
}
