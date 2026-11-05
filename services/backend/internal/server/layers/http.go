package layers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// allowRead permits GET and HEAD and answers 405 otherwise
func allowRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	return false
}

// acceptsGzip reports whether Accept-Encoding allows gzip (explicitly or via *) with a non-zero q
func acceptsGzip(acceptEncoding string) bool {
	// -1 means the header does not mention the coding
	gzipQuality, wildcardQuality := -1.0, -1.0
	for _, listItem := range strings.Split(acceptEncoding, ",") {
		coding, parameters, _ := strings.Cut(strings.TrimSpace(listItem), ";")
		quality := parseQuality(parameters)
		switch strings.ToLower(strings.TrimSpace(coding)) {
		case "gzip", "x-gzip":
			gzipQuality = quality
		case "*":
			wildcardQuality = quality
		}
	}
	if gzipQuality >= 0 {
		return gzipQuality > 0
	}
	return wildcardQuality > 0
}

// parseQuality returns the q value in a coding's parameters: 1 when absent, 0 when malformed.
func parseQuality(parameters string) float64 {
	quality := 1.0
	for _, parameter := range strings.Split(parameters, ";") {
		name, value, _ := strings.Cut(strings.TrimSpace(parameter), "=")
		if !strings.EqualFold(name, "q") {
			continue
		}
		parsedQuality, err := strconv.ParseFloat(value, 64)
		if err != nil {
			parsedQuality = 0
		}
		quality = parsedQuality
	}
	return quality
}

// matchesETag implements the weak comparison used by If-None-Match
func matchesETag(ifNoneMatch, etag string) bool {
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

// writeError writes a JSON error that clients must not cache, dropping headers set for a tile response.
func writeError(w http.ResponseWriter, status int, message string) {
	body, _ := json.Marshal(struct {
		Error string `json:"error"`
	}{message})
	w.Header().Del("ETag")
	w.Header().Del("Content-Encoding")
	w.Header().Set("Content-Type", contentTypeJSON)
	w.Header().Set("Cache-Control", cacheControlError)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// withNoSniff stops browsers from guessing the type of any layers response.
func withNoSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
