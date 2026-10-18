package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAssetDirectoryAndRange(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "map.pmtiles"), []byte("PMTiles-test"), 0600); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/map.pmtiles", nil)
	request.Header.Set("Range", "bytes=0-6")
	response := httptest.NewRecorder()
	handler(directory).ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "PMTiles" {
		t.Fatalf("range response: %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/vnd.pmtiles" {
		t.Fatal("incorrect archive MIME type")
	}
}
