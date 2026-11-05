package main

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1/transportv1connect"
	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/server/layers"
	"github.com/ivanov-gv/cg-map/services/backend/internal/server/transport"
	"github.com/ivanov-gv/cg-map/services/backend/internal/server/web"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

const (
	// maxRPCRequestBytes bounds RPC request bodies; the read-only API takes no real input.
	maxRPCRequestBytes = 1024
)

var (
	errNoArchive        = errors.New("no *.pmtiles archive found")
	errMultipleArchives = errors.New("several *.pmtiles archives found; pass -archive")
)

// app holds the server's routes and the resources they share
type app struct {
	handler        http.Handler
	archive        *pmtiles.Archive
	archiveName    string
	observer       *vehicles.Observer
	isShuttingDown atomic.Bool
}

// newApp opens the layers archive (archivePath, or the single *.pmtiles in <directory>/data)
// and routes the APIs, health checks, web config and static files. publicURL, if set, is the base of
// tile URLs in TileJSON. vehicleSource supplies the transport API.
func newApp(directory, archivePath, publicURL string, vehicleSource vehicles.Source) (*app, error) {
	// locate the archive the web artifact ships with, unless one is given explicitly
	if archivePath == "" {
		foundArchivePath, err := findArchive(filepath.Join(directory, "data"))
		if err != nil {
			return nil, fmt.Errorf("findArchive [directory='%s']: %w", directory, err)
		}
		archivePath = foundArchivePath
	}

	archive, err := pmtiles.Open(archivePath)
	if err != nil {
		return nil, fmt.Errorf("pmtiles.Open [path='%s']: %w", archivePath, err)
	}
	archiveName := filepath.Base(archivePath)
	layersHandler, err := layers.NewHandler(archive, archiveName, layers.WithPublicURL(publicURL))
	if err != nil {
		_ = archive.Close()
		return nil, fmt.Errorf("layers.NewHandler [archive='%s']: %w", archiveName, err)
	}

	// both transport APIs read through the observer, so they share one cache and direction history
	observer := vehicles.NewObserver(vehicles.NewFeed(vehicleSource, time.Now), vehicles.DefaultPollInterval)

	_app := &app{archive: archive, archiveName: archiveName, observer: observer}

	connectServer := connect.NewServer()
	transportv1connect.RegisterTransportServiceHandler(connectServer, transport.NewServer(observer))

	routes := http.NewServeMux()
	connecthttp.Mount(routes, connectServer, connecthttp.WithReadMaxBytes(maxRPCRequestBytes))
	routes.Handle(layers.Path, layersHandler)
	routes.Handle(layers.Path+"/", layersHandler)
	routes.Handle(transport.VehiclesPath, transport.NewVehiclesHandler(observer))
	routes.HandleFunc("/api", web.ServeAPINotFound)
	routes.HandleFunc("/api/", web.ServeAPINotFound)
	routes.HandleFunc(web.ConfigPath, web.ServeConfig)
	routes.HandleFunc("/healthz", web.ServeLiveness)
	routes.HandleFunc("/readyz", web.NewReadinessHandler(_app.isShuttingDown.Load, observer.Ready))
	routes.Handle("/", web.NewStaticHandler(directory))
	_app.handler = routes
	return _app, nil
}

// Close releases the archive
func (a *app) Close() error {
	return a.archive.Close()
}

// findArchive returns the only *.pmtiles file in directory
func findArchive(directory string) (string, error) {
	archivePaths, err := filepath.Glob(filepath.Join(directory, "*.pmtiles"))
	if err != nil {
		return "", fmt.Errorf("filepath.Glob [directory='%s']: %w", directory, err)
	}
	if len(archivePaths) == 0 {
		return "", errNoArchive
	}
	if len(archivePaths) > 1 {
		return "", fmt.Errorf("%w: %s", errMultipleArchives, strings.Join(archivePaths, ", "))
	}
	return archivePaths[0], nil
}
