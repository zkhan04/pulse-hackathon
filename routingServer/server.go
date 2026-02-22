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
// DynamicState tracks the "live" metrics from heartbeats
type DynamicState struct {
	Status     string  `json:"status"`    // READY, BUSY, DRAINING [cite: 315]
	InFlight   int     `json:"in_flight"` // Current active jobs [cite: 132]
	EmaTps     float32 `json:"ema_tps"`   // Performance metric [cite: 134]
	LastSeenAt int64   `json:"last_seen"` // timestamp_ms for DOWN detection [cite: 41]
}

var (
	// registry stores the static capabilities of compute servers [cite: 36]
	registry      = make(map[string]RegisterRequest)
	registryMutex sync.RWMutex
)

var (
	// serverState maps ServerID -> DynamicState
	serverState = make(map[string]DynamicState)
	stateMutex  sync.RWMutex
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

func HeartbeatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HeartbeatRequest // Generated from oapi-codegen [cite: 349]
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	stateMutex.Lock()
	serverState[req.ServerId] = DynamicState{
		Status:     string(req.Status),
		InFlight:   req.InFlight,
		EmaTps:     *req.EmaTps, // Ensure you handle nil if optional [cite: 368]
		LastSeenAt: req.TimestampMs,
	}
	stateMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OkResponse{Ok: true})
}

// RouteHandler provides a temporary hardcoded routing decision for testing.
func RouteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RouteRequest // Generated from your OpenAPI spec
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// TODO: please replace this lol
	// Temporary hardcoded response for "v0" testing
	resp := RouteResponse{
		RequestId: req.RequestId,                 // Matches the client's UUID [cite: 408]
		ServerId:  "compute-1",                   // Hardcoded ID [cite: 410]
		Endpoint:  "http://localhost:8081",       // Hardcoded local compute agent [cite: 412]
		Reason:    "hardcoded_test_route_for_v0", // Debug reason [cite: 415]
	}

	fmt.Printf("Routing request %s to %s\n", req.RequestId, resp.ServerId)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

func main() {
	// Register the health check endpoint
	http.HandleFunc("/health", HealthHandler)
	http.HandleFunc("/register", RegisterHandler) // [cite: 62]
	http.HandleFunc("/heartbeat", HeartbeatHandler)
	http.HandleFunc("/route", RouteHandler)

	// The router typically runs on port 8080 as per the OpenAPI spec
	port := ":8080"
	fmt.Printf("Routing Server starting on %s...\n", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		fmt.Printf("Server failed to start: %v\n", err)
	}
}
