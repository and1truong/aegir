package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	contractdiff "github.com/and1truong/aegir/internal/contracts"
	"github.com/and1truong/aegir/internal/graph"
	"github.com/and1truong/aegir/internal/review"
	"github.com/and1truong/aegir/internal/store"
)

type Server struct {
	store  *store.Store
	webDir string
}

func New(database *store.Store, webDir string) http.Handler {
	s := &Server{store: database, webDir: webDir}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/repositories", s.repositories)
	mux.HandleFunc("POST /api/repositories", s.registerRepository)
	mux.HandleFunc("POST /api/repositories/{id}/index", s.indexRepository)
	mux.HandleFunc("GET /api/repositories/{id}/graph", s.snapshot)
	mux.HandleFunc("GET /api/repositories/{id}/impact", s.impact)
	mux.HandleFunc("GET /api/repositories/{id}/contracts/diff", s.contractDiff)
	mux.HandleFunc("POST /api/repositories/{id}/reviews", s.createReview)
	mux.HandleFunc("GET /api/repositories/{id}/reviews/latest", s.latestReview)
	mux.HandleFunc("GET /api/repositories/{id}/reviews/{reviewID}", s.getReview)
	mux.HandleFunc("OPTIONS /api/{path...}", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /", s.static)
	return cors(requestLog(mux))
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			origin := r.Header.Get("Origin")
			if origin != "" && !isLoopbackOrigin(origin) {
				writeError(w, http.StatusForbidden, errors.New("origin is not allowed"))
				return
			}
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopbackOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" {
		return false
	}
	hostname := parsed.Hostname()
	ip := net.ParseIP(hostname)
	return hostname == "localhost" || (ip != nil && ip.IsLoopback())
}

func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s %s\n", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "product": "aegir"})
}
func (s *Server) repositories(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Repositories(r.Context())
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"repositories": items})
}
func (s *Server) registerRepository(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path          string `json:"path"`
		Index         *bool  `json:"index,omitempty"`
		CoveragePath  string `json:"coveragePath,omitempty"`
		TelemetryPath string `json:"telemetryPath,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, errors.New("invalid JSON body"))
		return
	}
	if strings.TrimSpace(body.Path) == "" {
		writeError(w, 400, errors.New("path is required"))
		return
	}
	repository, err := s.store.Register(r.Context(), body.Path)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	shouldIndex := body.Index == nil || *body.Index
	if !shouldIndex {
		writeJSON(w, 201, repository)
		return
	}
	snapshot, err := s.index(r.Context(), repository, analyzer.Options{CoverageProfile: body.CoveragePath, TelemetryFile: body.TelemetryPath})
	if err != nil {
		writeError(w, 422, err)
		return
	}
	writeJSON(w, 201, snapshot)
}
func (s *Server) indexRepository(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CoveragePath  string `json:"coveragePath"`
		TelemetryPath string `json:"telemetryPath"`
	}
	if err := decodeOptionalJSON(r, &body); err != nil {
		writeError(w, 400, errors.New("invalid JSON body"))
		return
	}
	options := analyzer.Options{CoverageProfile: body.CoveragePath, TelemetryFile: body.TelemetryPath}
	repository, err := s.store.Repository(r.Context(), r.PathValue("id"))
	if err != nil {
		status := 500
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		writeError(w, status, err)
		return
	}
	snapshot, err := s.index(r.Context(), repository, options)
	if err != nil {
		writeError(w, 422, err)
		return
	}
	writeJSON(w, 200, snapshot)
}
func decodeOptionalJSON(r *http.Request, value any) error {
	if r.Body == nil {
		return nil
	}
	err := json.NewDecoder(r.Body).Decode(value)
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

func (s *Server) index(ctx context.Context, repository store.Repository, options analyzer.Options) (store.Snapshot, error) {
	if err := s.store.SetIndexing(ctx, repository.ID); err != nil {
		return store.Snapshot{}, err
	}
	indexed, err := analyzer.RunWithOptions(repository.Path, options)
	if err != nil {
		s.store.SetIndexError(ctx, repository.ID, err)
		return store.Snapshot{}, err
	}
	snapshot, err := s.store.SaveSnapshot(ctx, repository.ID, indexed)
	if err != nil {
		s.store.SetIndexError(ctx, repository.ID, err)
	}
	return snapshot, err
}

func (s *Server) contractDiff(w http.ResponseWriter, r *http.Request) {
	repositoryID := r.PathValue("id")
	head, err := s.store.Snapshot(r.Context(), repositoryID)
	if err != nil {
		writeError(w, 404, err)
		return
	}
	if raw := r.URL.Query().Get("headSnapshot"); raw != "" {
		id, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			writeError(w, 400, errors.New("invalid headSnapshot"))
			return
		}
		head, err = s.store.SnapshotByID(r.Context(), repositoryID, id)
		if err != nil {
			writeError(w, 404, err)
			return
		}
	}
	var base store.Snapshot
	if raw := r.URL.Query().Get("baseSnapshot"); raw != "" {
		id, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			writeError(w, 400, errors.New("invalid baseSnapshot"))
			return
		}
		base, err = s.store.SnapshotByID(r.Context(), repositoryID, id)
	} else {
		base, err = s.store.PreviousSnapshot(r.Context(), repositoryID, head.ID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 200, contractdiff.Diff{BaseSnapshotID: 0, HeadSnapshotID: head.ID, Changes: []contractdiff.Change{}})
		return
	}
	if err != nil {
		writeError(w, 404, err)
		return
	}
	writeJSON(w, 200, contractdiff.Compare(base.ID, head.ID, base.Analysis.Contracts, head.Analysis.Contracts))
}

func (s *Server) createReview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseRef string `json:"baseRef"`
		HeadRef string `json:"headRef"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, errors.New("invalid JSON body"))
		return
	}
	if body.BaseRef == "" {
		writeError(w, 400, errors.New("baseRef is required"))
		return
	}
	if body.HeadRef == "" {
		body.HeadRef = "WORKTREE"
	}
	repository, err := s.store.Repository(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, 404, err)
		return
	}
	baseIndexed, err := review.AnalyzeRef(repository.Path, body.BaseRef)
	if err != nil {
		writeError(w, 422, err)
		return
	}
	headIndexed, err := review.AnalyzeRef(repository.Path, body.HeadRef)
	if err != nil {
		writeError(w, 422, err)
		return
	}
	base, err := s.store.SaveHistoricalSnapshot(r.Context(), repository.ID, baseIndexed)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	head, err := s.store.SaveHistoricalSnapshot(r.Context(), repository.ID, headIndexed)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	value := review.Compare(repository.ID, body.BaseRef, body.HeadRef, base.ID, head.ID, baseIndexed, headIndexed)
	if err := s.store.SaveReview(r.Context(), value); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (s *Server) latestReview(w http.ResponseWriter, r *http.Request) {
	value, err := s.store.LatestReview(r.Context(), r.PathValue("id"))
	if err != nil {
		status := 500
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, 200, value)
}

func (s *Server) getReview(w http.ResponseWriter, r *http.Request) {
	value, err := s.store.Review(r.Context(), r.PathValue("id"), r.PathValue("reviewID"))
	if err != nil {
		status := 500
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, 200, value)
}
func (s *Server) snapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.store.Snapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		status := 500
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, 200, snapshot)
}
func (s *Server) impact(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("nodeId")
	if nodeID == "" {
		writeError(w, 400, errors.New("nodeId is required"))
		return
	}
	depth := 3
	if raw := r.URL.Query().Get("depth"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			depth = n
		}
	}
	snapshot, err := s.store.Snapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, 404, err)
		return
	}
	found := false
	for _, node := range snapshot.Nodes {
		if node.ID == nodeID {
			found = true
			break
		}
	}
	if !found {
		writeError(w, 404, errors.New("node not found"))
		return
	}
	writeJSON(w, 200, graph.Analyze(nodeID, depth, snapshot.Nodes, snapshot.Edges))
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, errors.New("API route not found"))
		return
	}
	if s.webDir == "" {
		writeError(w, 404, errors.New("frontend is not built; run npm --prefix web run build"))
		return
	}
	clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
		writeError(w, http.StatusBadRequest, errors.New("invalid asset path"))
		return
	}
	if clean == "." {
		clean = "index.html"
	}
	candidate := filepath.Join(s.webDir, clean)
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		http.ServeFile(w, r, candidate)
		return
	}
	index := filepath.Join(s.webDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, 404, errors.New("frontend build not found"))
			return
		}
		writeError(w, 500, err)
		return
	}
	http.ServeFile(w, r, index)
}
