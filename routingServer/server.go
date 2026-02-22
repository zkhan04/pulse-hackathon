package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// HealthHandler returns a simple 200 OK status to indicate the server is running.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OkResponse{Ok: true}) // [cite: 210]
}

// --- In-Memory Storage ---

var (
	// registry stores the static capabilities of compute servers [cite: 36]
	registry      = make(map[string]RegisterRequest)
	registryMutex sync.RWMutex
)

// --- Handler Logic ---

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Store the server's static capabilities [cite: 36, 40]
	registryMutex.Lock()
	registry[req.ServerId] = req
	registryMutex.Unlock()

	fmt.Printf("Registered compute server: %s (%s)\n", req.ServerId, req.Endpoint)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OkResponse{Ok: true}) // [cite: 210]
}

func main() {
	// Register the health check endpoint
	http.HandleFunc("/health", HealthHandler)
	http.HandleFunc("/register", RegisterHandler) // [cite: 62]

	// The router typically runs on port 8080 as per the OpenAPI spec
	port := ":8080"
	fmt.Printf("Routing Server starting on %s...\n", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		fmt.Printf("Server failed to start: %v\n", err)
	}
}
