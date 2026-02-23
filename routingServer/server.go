package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

// --- Structs & State Management ---

type DynamicState struct {
	Status     string  `json:"status"`    // READY, BUSY, DRAINING [cite: 315]
	InFlight   int     `json:"in_flight"` // [cite: 132]
	EmaTps     float32 `json:"ema_tps"`   // [cite: 134]
	LastSeenAt int64   `json:"last_seen"` // [cite: 41]
}

type ServerContext struct {
	Config RegisterRequest // [cite: 319]
	State  DynamicState    // [cite: 349]
}

type RouteCacheEntry struct {
	Response  *RouteResponse // nil means "in-progress" [cite: 73]
	ExpiresAt int64
	Mu        sync.Mutex // Entry-level lock for concurrent same-ID requests
}

var (
	// Registry: ServerID -> Context [cite: 36, 158]
	registry      = make(map[string]*ServerContext)
	registryMutex sync.RWMutex

	// Cache: RequestID -> Entry [cite: 73, 381]
	routeCache = make(map[string]*RouteCacheEntry)
	cacheMutex sync.Mutex
)

// --- Scheduling Helpers ---

func supportsModel(supportedModels []string, targetModel string) bool {
	for _, m := range supportedModels {
		if m == targetModel {
			return true
		}
	}
	return false
}

// Formula: (prompt_tokens + max_tokens) / tps [cite: 55-57]
func calculateRuntime(req RouteRequest, emaTps float32) float64 {
	const fallbackTps = 10.0 // [cite: 60]
	tps := float64(emaTps)
	if tps <= 0 {
		tps = fallbackTps
	}

	var promptTokens float64
	if req.EstimatedPromptTokens != nil {
		promptTokens = float64(*req.EstimatedPromptTokens)
	} else {
		promptTokens = float64(req.PromptChars) / 4.0 // [cite: 15, 59]
	}

	return (promptTokens + float64(req.MaxTokens)) / tps
}

// --- HTTP Handlers ---

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad request", 400)
		return
	}

	registryMutex.Lock()
	registry[req.ServerId] = &ServerContext{
		Config: req,
		State:  DynamicState{LastSeenAt: time.Now().UnixMilli(), Status: "READY"},
	}
	registryMutex.Unlock()

	log.Printf("Registered: %s at %s", req.ServerId, req.Endpoint)
	json.NewEncoder(w).Encode(OkResponse{Ok: true}) // [cite: 210]
}

func HeartbeatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Heartbeat decode error: %v", err)
		w.WriteHeader(400)
		return
	}

	registryMutex.Lock()
	if ctx, exists := registry[req.ServerId]; exists {
		var emaTps float32
		if req.EmaTps != nil {
			emaTps = *req.EmaTps
		}
		ctx.State = DynamicState{
			Status:     string(req.Status),
			InFlight:   req.InFlight,
			EmaTps:     emaTps,
			LastSeenAt: time.Now().UnixMilli(),
		}
	} else {
		registryMutex.Unlock()
		log.Printf("Heartbeat from unknown server: %s", req.ServerId)
		http.Error(w, "Unknown server_id (register first)", http.StatusBadRequest)
		return
	}
	registryMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OkResponse{Ok: true})
}

func RouteHandler(w http.ResponseWriter, r *http.Request) {
	var req RouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Route decode error: %v", err)
		w.WriteHeader(400)
		return
	}

	now := time.Now().UnixMilli()

	// 1. Get or Reserve Cache Entry
	cacheMutex.Lock()
	entry, exists := routeCache[req.RequestId]
	if !exists || now > entry.ExpiresAt {
		entry = &RouteCacheEntry{ExpiresAt: now + (5 * 60 * 1000)}
		routeCache[req.RequestId] = entry
	}
	cacheMutex.Unlock()

	// 2. Lock Entry to handle concurrent duplicates
	entry.Mu.Lock()
	defer entry.Mu.Unlock()

	// If already populated by another goroutine, return it
	if entry.Response != nil {
		log.Printf("Route cache hit for %s -> %s", req.RequestId, entry.Response.ServerId)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(entry.Response)
		return
	}

	// 3. Selection Algorithm [cite: 45-60]
	registryMutex.RLock()
	var bestID, bestURL string
	minInFlight := 999999
	minRuntime := 1e18
	found := false

	for id, ctx := range registry {
		// Filter: Status, Model support [cite: 46-50]
		if ctx.State.Status == "DRAINING" || !supportsModel(ctx.Config.Models, req.ModelId) {
			continue
		}

		// Score: Lowest in_flight, tie-break by runtime [cite: 52-54]
		runtime := calculateRuntime(req, ctx.State.EmaTps)
		if ctx.State.InFlight < minInFlight || (ctx.State.InFlight == minInFlight && runtime < minRuntime) {
			minInFlight = ctx.State.InFlight
			minRuntime = runtime
			bestID = id
			bestURL = ctx.Config.Endpoint
			found = true
		}
	}
	registryMutex.RUnlock()

	if !found {
		log.Printf("No capable servers for request %s (model: %s)", req.RequestId, req.ModelId)
		w.WriteHeader(503) // [cite: 246]
		json.NewEncoder(w).Encode(map[string]string{"error": "NO_CAPABLE_SERVERS"})
		return
	}

	// 4. Finalize Cache & Respond [cite: 419]
	entry.Response = &RouteResponse{
		RequestId: req.RequestId,
		ServerId:  bestID,
		Endpoint:  bestURL,
		Reason:    "least_in_flight_tie_break_runtime",
	}

	log.Printf("Routed %s to %s (InFlight: %d)", req.RequestId, bestID, minInFlight)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entry.Response)
}

func main() {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(OkResponse{Ok: true})
	})
	http.HandleFunc("/register", RegisterHandler)
	http.HandleFunc("/heartbeat", HeartbeatHandler)
	http.HandleFunc("/route", RouteHandler)

	// Background: Prune Dead Servers (>7s) [cite: 43, 90, 161]
	go func() {
		for range time.Tick(2 * time.Second) {
			now := time.Now().UnixMilli()
			registryMutex.Lock()
			for id, ctx := range registry {
				if now-ctx.State.LastSeenAt > 7000 {
					log.Printf("Pruning dead server: %s", id)
					delete(registry, id)
				}
			}
			registryMutex.Unlock()
		}
	}()

	// Background: Prune Cache [cite: 73]
	go func() {
		for range time.Tick(1 * time.Minute) {
			now := time.Now().UnixMilli()
			cacheMutex.Lock()
			for id, entry := range routeCache {
				if now > entry.ExpiresAt {
					delete(routeCache, id)
				}
			}
			cacheMutex.Unlock()
		}
	}()

	log.Println("Router starting on :8080...")
	http.ListenAndServe(":8080", nil)
}
