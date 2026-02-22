package main

import (
	"fmt"
	"net/http"
)

// HealthHandler returns a simple 200 OK status to indicate the server is running.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "OK")
}

func main() {
	// Register the health check endpoint
	http.HandleFunc("/health", HealthHandler)

	// The router typically runs on port 8080 as per the OpenAPI spec
	port := ":8080"
	fmt.Printf("Routing Server starting on %s...\n", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		fmt.Printf("Server failed to start: %v\n", err)
	}
}
