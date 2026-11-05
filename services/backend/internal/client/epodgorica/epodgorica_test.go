package epodgorica

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	source := NewClient(server.Client())
	source.url = server.URL
	return source
}

func TestClientVehicles(t *testing.T) {
	var accept, cookie string
	source := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		accept, cookie = r.Header.Get("Accept"), r.Header.Get("Cookie")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"routeName":"6A","latitude":42.454,"longitude":19.263},` +
			`{"routeName":6,"latitude":42.4,"longitude":19.2},` +
			`{"routeName":"7","latitude":"42.4","longitude":19.2},` +
			`null,[1],{"routeName":"9","latitude":42.1}]`))
	})

	rows, err := source.Vehicles(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if accept != "application/json" || cookie != "" {
		t.Fatalf("request headers: Accept=%q Cookie=%q", accept, cookie)
	}
	if len(rows) != 6 {
		t.Fatalf("rows = %d, want 6 (sources do not filter)", len(rows))
	}
	if rows[0] != (vehicles.UpstreamVehicle{Route: "6A", Longitude: 19.263, Latitude: 42.454}) {
		t.Fatalf("first row = %+v", rows[0])
	}
	if rows[1].Route != "" {
		t.Fatalf("numeric routeName must become empty, got %q", rows[1].Route)
	}
	if !math.IsNaN(rows[2].Latitude) {
		t.Fatalf("string latitude must become NaN, got %v", rows[2].Latitude)
	}
	for _, row := range rows[3:5] {
		if row.Route != "" || !math.IsNaN(row.Longitude) || !math.IsNaN(row.Latitude) {
			t.Fatalf("non-object row = %+v", row)
		}
	}
	if !math.IsNaN(rows[5].Longitude) {
		t.Fatalf("missing longitude must become NaN, got %v", rows[5].Longitude)
	}
}

func TestClientErrors(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		wantErr error
	}{
		{name: "non-2xx status", status: http.StatusBadGateway, body: `[]`, wantErr: ErrUpstreamStatus},
		{name: "oversized body", status: http.StatusOK, body: "[" + strings.Repeat(" ", maxUpstreamBytes) + "]", wantErr: ErrUpstreamTooLarge},
		{name: "object instead of array", status: http.StatusOK, body: `{"vehicles":[]}`, wantErr: ErrUpstreamNotArray},
		{name: "null instead of array", status: http.StatusOK, body: `null`, wantErr: ErrUpstreamNotArray},
		{name: "too many rows", status: http.StatusOK, body: "[" + strings.Repeat("{},", vehicles.MaxVehicleRows) + "{}]", wantErr: vehicles.ErrTooManyVehicles},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			})
			_, err := source.Vehicles(context.Background())
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestClientInvalidJSON(t *testing.T) {
	source := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"routeName":`))
	})
	_, err := source.Vehicles(context.Background())
	if err == nil {
		t.Fatal("truncated JSON must fail")
	}
}

func TestClientHonorsContext(t *testing.T) {
	release := make(chan struct{})
	source := newTestClient(t, func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := source.Vehicles(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestClientRefusesRedirects(t *testing.T) {
	elsewhere := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("the redirect target must not be requested")
	}))
	defer elsewhere.Close()
	source := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL, http.StatusFound)
	})
	_, err := source.Vehicles(context.Background())
	if !errors.Is(err, ErrUpstreamRedirect) {
		t.Fatalf("err = %v, want ErrUpstreamRedirect", err)
	}
}
