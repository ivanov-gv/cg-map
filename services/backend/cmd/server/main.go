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

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/epodgorica"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

const (
	readHeaderTimeout = 10 * time.Second
	idleTimeout       = 2 * time.Minute
	// defaultShutdownDelay gives probes and load balancers time to see the 503 from /readyz.
	defaultShutdownDelay   = 5 * time.Second
	defaultShutdownTimeout = 10 * time.Second
	// No WriteTimeout: a global one would cut off large archive range downloads on slow connections.
)

// serverFlags holds the parsed command line.
type serverFlags struct {
	listenAddress   string
	assetDirectory  string
	archivePath     string
	publicURL       string
	shutdownDelay   time.Duration
	shutdownTimeout time.Duration
	liveTransport   bool
}

func parseFlags() serverFlags {
	listenAddress := flag.String("listen", "127.0.0.1:8080", "HTTP listening address")
	assetDirectory := flag.String("dir", "../../dist/web", "Application asset directory")
	archivePath := flag.String("archive", "", "PMTiles archive for the layers API (default: the single *.pmtiles in <dir>/data)")
	publicURL := flag.String("public-url", "", "Public base URL for tile URLs in TileJSON, e.g. https://maps.example.com (default: from the request's Host)")
	shutdownDelay := flag.Duration("shutdown-delay", defaultShutdownDelay, "After SIGTERM, keep serving with /readyz=503 for this long before closing the listener")
	liveTransport := flag.Bool("live-transport", true, "Fetch live vehicles from ePodgorica for the transport API (false: always 503)")
	shutdownTimeout := flag.Duration("shutdown-timeout", defaultShutdownTimeout, "Maximum time to drain in-flight requests after the listener closes")
	flag.Parse()
	return serverFlags{
		listenAddress:   *listenAddress,
		assetDirectory:  *assetDirectory,
		archivePath:     *archivePath,
		publicURL:       *publicURL,
		shutdownDelay:   *shutdownDelay,
		shutdownTimeout: *shutdownTimeout,
		liveTransport:   *liveTransport,
	}
}

func main() {
	os.Exit(serve())
}

// serve runs the server and returns the process exit code. It is separate from main so that
// deferred cleanup (closing the archive) runs before os.Exit.
func serve() int {
	const logfmt = "main: "
	flags := parseFlags()

	// open the archive and build all routes
	var vehicleSource vehicles.Source = vehicles.Unavailable{}
	if flags.liveTransport {
		vehicleSource = epodgorica.NewClient(nil)
	}
	_app, err := newApp(flags.assetDirectory, flags.archivePath, flags.publicURL, vehicleSource)
	if err != nil {
		log.Printf(logfmt+"newApp [directory='%s', archive='%s']: %v", flags.assetDirectory, flags.archivePath, err)
		return 1
	}
	defer func() { _ = _app.Close() }()

	// Handle signals during the initial transport observation as well as while serving.
	// The first signal starts the shutdown; unregistering then lets a second signal exit immediately.
	ctx, stopHandlingSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopHandlingSignals()
	go func() {
		<-ctx.Done()
		stopHandlingSignals()
	}()

	listener, err := net.Listen("tcp", flags.listenAddress)
	if err != nil {
		log.Printf(logfmt+"net.Listen [listen='%s']: %v", flags.listenAddress, err)
		return 1
	}

	// Observe movement in the background; HTTP serves immediately, readiness gates a rollout.
	if flags.liveTransport {
		observationStopped := _app.observer.Start(ctx)
		defer func() {
			stopHandlingSignals()
			<-observationStopped
		}()
	}

	log.Printf("Kompas: http://%s/ (assets: %s, archive: %s)", listener.Addr(), flags.assetDirectory, _app.archiveName)
	err = serveUntilShutdown(ctx, newHTTPServer(_app.handler), listener, &_app.isShuttingDown, flags.shutdownDelay, flags.shutdownTimeout)
	if err != nil {
		log.Printf(logfmt+"serveUntilShutdown: %v", err)
		return 1
	}
	log.Print("Kompas: stopped")
	return 0
}

// newHTTPServer accepts HTTP/1.1 and cleartext HTTP/2, so Connect and gRPC share the listener.
func newHTTPServer(handler http.Handler) *http.Server {
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)
	return &http.Server{
		Handler:           handler,
		Protocols:         protocols,
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}
}

// serveUntilShutdown serves until ctx is cancelled, then shuts down gracefully:
// mark not-ready, keep serving for shutdownDelay so probes and load balancers see 503,
// close the listener and wait up to shutdownTimeout for in-flight requests.
// It returns only after serving has fully stopped, so callers may release shared resources afterwards.
func serveUntilShutdown(ctx context.Context, server *http.Server, listener net.Listener, isShuttingDown *atomic.Bool, shutdownDelay, shutdownTimeout time.Duration) error {
	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.Serve(listener)
	}()

	// serve until a shutdown is requested or the server fails
	select {
	case err := <-serveResult:
		return fmt.Errorf("server.Serve: %w", err)
	case <-ctx.Done():
	}

	// report not-ready while still accepting connections
	isShuttingDown.Store(true)
	delayTimer := time.NewTimer(shutdownDelay)
	defer delayTimer.Stop()
	select {
	case err := <-serveResult:
		return fmt.Errorf("server.Serve during drain: %w", err)
	case <-delayTimer.C:
	}

	// close the listener and wait for in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	err := server.Shutdown(shutdownCtx)
	if err != nil {
		closeErr := server.Close()
		return fmt.Errorf("server.Shutdown [timeout=%s]: %w", shutdownTimeout, errors.Join(err, closeErr))
	}
	err = <-serveResult
	if !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server.Serve: %w", err)
	}
	return nil
}
