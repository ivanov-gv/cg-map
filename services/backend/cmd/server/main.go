// Kompas serves the static application from disk. Run from the repository root:
// go run ./cmd/server -dir ../../dist/web
package main

import (
	"flag"
	"log"
	"net/http"
	"strings"
)

func handler(directory string) http.Handler {
	files := http.FileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(r.URL.Path, ".pmtiles") {
			w.Header().Set("Content-Type", "application/vnd.pmtiles")
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript")
		}
		if strings.HasSuffix(r.URL.Path, ".geojson") {
			w.Header().Set("Content-Type", "application/geo+json")
		}
		files.ServeHTTP(w, r)
	})
}

func main() {
	address := flag.String("listen", "127.0.0.1:8080", "HTTP listening address")
	directory := flag.String("dir", "../../dist/web", "Application asset directory")
	flag.Parse()
	log.Printf("Kompas: http://%s/ (assets: %s)", *address, *directory)
	log.Fatal(http.ListenAndServe(*address, handler(*directory)))
}
