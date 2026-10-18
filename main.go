// Optional Go host: go run main.go. No external dependencies.
package main

import (
 "embed"
 "flag"
 "io/fs"
 "log"
 "net/http"
 "strings"
)

//go:embed web
var assets embed.FS

func main() {
 address := flag.String("listen", "127.0.0.1:8080", "HTTP listening address")
 flag.Parse()
 root, err := fs.Sub(assets, "web")
 if err != nil { log.Fatal(err) }
 files := http.FileServer(http.FS(root)) // net/http handles Range and Content-Range.
 handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  w.Header().Set("X-Content-Type-Options", "nosniff")
  w.Header().Set("Cache-Control", "no-cache")
  if strings.HasSuffix(r.URL.Path,".pmtiles") { w.Header().Set("Content-Type","application/vnd.pmtiles");w.Header().Set("Cache-Control","public, max-age=31536000, immutable") }
  if strings.HasSuffix(r.URL.Path,".js") {w.Header().Set("Content-Type","text/javascript")}
  if strings.HasSuffix(r.URL.Path,".geojson") {w.Header().Set("Content-Type","application/geo+json")}
  files.ServeHTTP(w,r)
 })
 log.Printf("Kompas: http://%s/", *address)
 log.Fatal(http.ListenAndServe(*address, handler))
}
