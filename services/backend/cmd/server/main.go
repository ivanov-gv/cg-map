// Kompas serves the built web artifact, the map layers API and the transport API.
// Run from services/backend after building the web artifact at the repository root:
//
//	go run ./cmd/server -dir ../../dist/web
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/ivanov-gv/cg-map/services/backend/internal/transport"
)

const (
	readHeaderTimeout = 10 * time.Second
	idleTimeout       = 2 * time.Minute
	// No WriteTimeout: a global one would cut off large archive range downloads on slow connections.
)

func main() {
	os.Exit(serve())
}

// serve runs the server and returns the process exit code. It is separate from main so that
// deferred cleanup (closing the archive) runs before os.Exit.
func serve() int {
	const logfmt = "main: "
	address := flag.String("listen", "127.0.0.1:8080", "HTTP listening address")
	directory := flag.String("dir", "../../dist/web", "Application asset directory")
	archivePath := flag.String("archive", "", "PMTiles archive for the layers API (default: the single *.pmtiles in <dir>/data)")
	publicURL := flag.String("public-url", "", "Public base URL for tile URLs in TileJSON, e.g. https://maps.example.com (default: from the request's Host)")
	drainDelay := flag.Duration("shutdown-delay", 5*time.Second, "After SIGTERM, keep serving with /readyz=503 for this long before closing the listener")
	liveTransport := flag.Bool("live-transport", true, "Fetch live vehicles from ePodgorica for the transport API (false: always 503)")
	shutdownTimeout := flag.Duration("shutdown-timeout", 10*time.Second, "Maximum time to drain in-flight requests after the listener closes")
	flag.Parse()

	// open the archive and build all routes
	var vehicles transport.Source = transport.Unavailable{}
	if *liveTransport {
		vehicles = transport.NewEPodgorica(nil)
	}
	_app, err := newApp(*directory, *archivePath, *publicURL, vehicles)
	if err != nil {
		log.Printf(logfmt+"newApp [dir='%s', archive='%s']: %v", *directory, *archivePath, err)
		return 1
	}
	defer _app.Close()

	listener, err := net.Listen("tcp", *address)
	if err != nil {
		log.Printf(logfmt+"net.Listen [listen='%s']: %v", *address, err)
		return 1
	}
	server := &http.Server{
		Handler:           _app.handler,
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}

	// the first SIGINT/SIGTERM starts a graceful shutdown; a second one kills the process (default behaviour restored)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ctx.Done()
		stop()
	}()

	// keep live directions warm from startup until shutdown begins
	if *liveTransport {
		go _app.transport.Poll(ctx)
	}

	log.Printf("Kompas: http://%s/ (assets: %s, archive: %s)", listener.Addr(), *directory, _app.archiveName)
	err = run(ctx, server, listener, &_app.ready, *drainDelay, *shutdownTimeout)
	if err != nil {
		log.Printf(logfmt+"run: %v", err)
		return 1
	}
	log.Print("Kompas: stopped")
	return 0
}

// run serves until ctx is cancelled, then shuts down gracefully:
// mark not-ready, keep serving for drainDelay so probes and load balancers see 503,
// close the listener and wait up to shutdownTimeout for in-flight requests.
// It returns only after serving has fully stopped, so callers may release shared resources afterwards.
func run(ctx context.Context, server *http.Server, listener net.Listener, ready *atomic.Bool, drainDelay, shutdownTimeout time.Duration) error {
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()

	// serve until a shutdown is requested or the server fails
	select {
	case err := <-serveErr:
		return fmt.Errorf("server.Serve: %w", err)
	case <-ctx.Done():
	}

	// report not-ready while still accepting connections
	ready.Store(false)
	drain := time.NewTimer(drainDelay)
	defer drain.Stop()
	select {
	case err := <-serveErr:
		return fmt.Errorf("server.Serve during drain: %w", err)
	case <-drain.C:
	}

	// close the listener and wait for in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	err := server.Shutdown(shutdownCtx)
	if err != nil {
		closeErr := server.Close()
		return fmt.Errorf("server.Shutdown [timeout=%s]: %w", shutdownTimeout, errors.Join(err, closeErr))
	}
	err = <-serveErr
	if !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server.Serve: %w", err)
	}
	return nil
}
