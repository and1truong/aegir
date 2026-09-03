package api

import (
	"bytes"
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
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/attention"
	contractdiff "github.com/and1truong/aegir/internal/contracts"
	"github.com/and1truong/aegir/internal/graph"
	"github.com/and1truong/aegir/internal/history"
	"github.com/and1truong/aegir/internal/review"
	"github.com/and1truong/aegir/internal/store"
)

type Server struct {
	store  *store.Store
	webDir string
	webFS  fs.FS
}

// New serves frontend files from webDir. It is retained for local development and tests.
func New(database *store.Store, webDir string) http.Handler {
	return NewWithFS(database, webDir, nil)
}

// NewWithFS serves frontend files from webDir when it is set, otherwise from webFS.
// The latter is used by the standalone release binary.
func NewWithFS(database *store.Store, webDir string, webFS fs.FS) http.Handler {
	s := &Server{store: database, webDir: webDir, webFS: webFS}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/repositories", s.repositories)
	mux.HandleFunc("POST /api/repositories", s.registerRepository)
	mux.HandleFunc("POST /api/repositories/{id}/index", s.indexRepository)
	mux.HandleFunc("GET /api/repositories/{id}/graph", s.snapshot)
	mux.HandleFunc("GET /api/repositories/{id}/timeline", s.timeline)
	mux.HandleFunc("GET /api/repositories/{id}/attention", s.attention)
	mux.HandleFunc("GET /api/repositories/{id}/attention/evidence", s.attentionEvidence)
	mux.HandleFunc("GET /api/repositories/{id}/attention/reviews/{reviewID}", s.reviewAttention)
	mux.HandleFunc("POST /api/repositories/{id}/timeline/compact", s.compactTimeline)
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
		base, err = s.store.PreviousComparableSnapshot(r.Context(), repositoryID, head)
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
	value, err := s.store.SaveReviewSnapshots(r.Context(), repository.ID, body.BaseRef, body.HeadRef, baseIndexed, headIndexed)
	if err != nil {
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
	repositoryID := r.PathValue("id")
	snapshot, err := s.store.Snapshot(r.Context(), repositoryID)
	if raw := r.URL.Query().Get("snapshot"); raw != "" {
		id, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			writeError(w, 400, errors.New("invalid snapshot"))
			return
		}
		snapshot, err = s.store.SnapshotByID(r.Context(), repositoryID, id)
	}
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

func (s *Server) timeline(w http.ResponseWriter, r *http.Request) {
	timeline, err := s.store.Timeline(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, timeline)
}

func (s *Server) attention(w http.ResponseWriter, r *http.Request) {
	repositoryID := r.PathValue("id")
	windowDays, err := attentionWindow(r)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	snapshot, err := s.store.Snapshot(r.Context(), repositoryID)
	if raw := r.URL.Query().Get("snapshot"); raw != "" {
		id, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil {
			writeError(w, 400, errors.New("invalid snapshot"))
			return
		}
		snapshot, err = s.store.SnapshotByID(r.Context(), repositoryID, id)
	}
	if err != nil {
		writeError(w, 404, err)
		return
	}
	profile, _, err := s.loadAttention(r.Context(), snapshot, windowDays)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, profile)
}

func attentionWindow(r *http.Request) (int, error) {
	windowDays := 90
	if raw := r.URL.Query().Get("window"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || (parsed != 30 && parsed != 90 && parsed != 180) {
			return 0, errors.New("window must be 30, 90, or 180 days")
		}
		windowDays = parsed
	}
	return windowDays, nil
}

func indexedSnapshot(snapshot store.Snapshot) analyzer.Snapshot {
	return analyzer.Snapshot{Repository: analyzer.Repository{Name: snapshot.Repository.Name, Path: snapshot.Repository.Path, Module: snapshot.Repository.Module, Head: snapshot.Ref.Commit}, Nodes: snapshot.Nodes, Edges: snapshot.Edges, Evidence: snapshot.Evidence, Analysis: snapshot.Analysis, Stats: snapshot.Stats}
}

func (s *Server) loadHistory(ctx context.Context, snapshot store.Snapshot, windowDays int) (*history.Result, error) {
	ref := snapshot.Ref.Commit
	if ref == "" {
		ref = "HEAD"
	}
	if ref != "HEAD" {
		if cached, err := s.store.ChangeHistory(ctx, snapshot.Repository.ID, ref, windowDays); err == nil {
			if cached.Version == history.FormatVersion {
				return &cached, nil
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if previous, err := s.store.LatestChangeHistory(ctx, snapshot.Repository.ID, windowDays); err == nil {
			if previous.Version == history.FormatVersion {
				updated, _, updateErr := history.UpdateGit(snapshot.Repository.Path, previous, ref, windowDays, time.Now())
				if updateErr == nil {
					if saveErr := s.store.SaveChangeHistory(ctx, snapshot.Repository.ID, updated); saveErr != nil {
						return nil, saveErr
					}
					return &updated, nil
				}
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	read, err := history.ReadGit(snapshot.Repository.Path, ref, windowDays, time.Now())
	if err != nil {
		return nil, err
	}
	if ref != "HEAD" {
		if err := s.store.SaveChangeHistory(ctx, snapshot.Repository.ID, read); err != nil {
			return nil, err
		}
	}
	return &read, nil
}

func (s *Server) loadAttention(ctx context.Context, snapshot store.Snapshot, windowDays int) (attention.Landscape, *history.Result, error) {
	if cached, err := s.store.AttentionProfile(ctx, snapshot.ID, attention.ModelVersion, windowDays); err == nil {
		calculatedAt, parseErr := time.Parse(time.RFC3339, cached.CalculatedAt)
		if parseErr == nil && time.Since(calculatedAt) < 24*time.Hour {
			history, _ := s.loadHistory(ctx, snapshot, windowDays)
			return cached, history, nil
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return attention.Landscape{}, nil, err
	}
	changeHistory, historyErr := s.loadHistory(ctx, snapshot, windowDays)
	profile := attention.Calculate(snapshot.Repository.ID, snapshot.ID, indexedSnapshot(snapshot), changeHistory, windowDays, time.Now())
	if historyErr != nil {
		profile.Completeness.Warnings = append(profile.Completeness.Warnings, "Git history could not be read: "+historyErr.Error())
	}
	if historyErr == nil {
		if err := s.store.SaveAttentionProfile(ctx, profile); err != nil {
			return attention.Landscape{}, nil, err
		}
	}
	return profile, changeHistory, nil
}

func (s *Server) attentionEvidence(w http.ResponseWriter, r *http.Request) {
	unitID := r.URL.Query().Get("unitId")
	if unitID == "" {
		writeError(w, 400, errors.New("unitId is required"))
		return
	}
	windowDays, err := attentionWindow(r)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	snapshot, err := s.attentionSnapshot(r)
	if err != nil {
		writeError(w, 404, err)
		return
	}
	profile, changes, err := s.loadAttention(r.Context(), snapshot, windowDays)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	var unit *attention.Unit
	for index := range profile.Units {
		if profile.Units[index].Unit.ID == unitID {
			unit = &profile.Units[index]
			break
		}
	}
	if unit == nil {
		writeError(w, 404, errors.New("attention unit not found"))
		return
	}
	edgeIDs, changeIDs := map[string]bool{}, map[string]bool{}
	for _, dimension := range []attention.Dimension{unit.Impact, unit.ChangeComplexity, unit.ChangeVelocity} {
		for _, factor := range dimension.Factors {
			for _, ref := range factor.EvidenceRefs {
				if ref.Kind == "edge" {
					edgeIDs[ref.ID] = true
				} else if ref.Kind == "git-change" {
					changeIDs[ref.ID] = true
				}
			}
		}
	}
	edges := []analyzer.Edge{}
	evidenceIDs := map[string]bool{}
	for _, edge := range snapshot.Edges {
		if edgeIDs[edge.ID] {
			edges = append(edges, edge)
			for _, id := range edge.EvidenceRefs {
				evidenceIDs[id] = true
			}
		}
	}
	sourceEvidence := []analyzer.EvidenceRecord{}
	for _, item := range snapshot.Evidence {
		if evidenceIDs[item.ID] {
			sourceEvidence = append(sourceEvidence, item)
		}
	}
	gitChanges := []history.ChangeEvent{}
	if changes != nil {
		for _, change := range changes.Events {
			if changeIDs[change.ID] {
				gitChanges = append(gitChanges, change)
			}
		}
	}
	writeJSON(w, 200, struct {
		Unit           attention.Unit            `json:"unit"`
		GraphEdges     []analyzer.Edge           `json:"graphEdges"`
		SourceEvidence []analyzer.EvidenceRecord `json:"sourceEvidence"`
		GitChanges     []history.ChangeEvent     `json:"gitChanges"`
	}{*unit, edges, sourceEvidence, gitChanges})
}

func (s *Server) attentionSnapshot(r *http.Request) (store.Snapshot, error) {
	repositoryID := r.PathValue("id")
	if raw := r.URL.Query().Get("snapshot"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return store.Snapshot{}, errors.New("invalid snapshot")
		}
		return s.store.SnapshotByID(r.Context(), repositoryID, id)
	}
	return s.store.Snapshot(r.Context(), repositoryID)
}

func (s *Server) reviewAttention(w http.ResponseWriter, r *http.Request) {
	windowDays, err := attentionWindow(r)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	value, err := s.store.Review(r.Context(), r.PathValue("id"), r.PathValue("reviewID"))
	if err != nil {
		writeError(w, 404, err)
		return
	}
	base, err := s.store.SnapshotByID(r.Context(), r.PathValue("id"), value.BaseSnapshotID)
	if err != nil {
		writeError(w, 404, err)
		return
	}
	head, err := s.store.SnapshotByID(r.Context(), r.PathValue("id"), value.HeadSnapshotID)
	if err != nil {
		writeError(w, 404, err)
		return
	}
	baseProfile, _, err := s.loadAttention(r.Context(), base, windowDays)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	headProfile, _, err := s.loadAttention(r.Context(), head, windowDays)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, attention.ForReview(baseProfile, headProfile, indexedSnapshot(base), indexedSnapshot(head), value))
}

func (s *Server) compactTimeline(w http.ResponseWriter, r *http.Request) {
	var body struct {
		KeepReviews int `json:"keepReviews"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, errors.New("invalid JSON body"))
		return
	}
	result, err := s.store.CompactTimeline(r.Context(), r.PathValue("id"), body.KeepReviews)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 200, result)
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
	clean := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		writeError(w, http.StatusBadRequest, errors.New("invalid asset path"))
		return
	}
	if clean == "." {
		clean = "index.html"
	}
	if s.webDir != "" {
		s.serveDiskFrontend(w, r, clean)
		return
	}
	if s.webFS != nil {
		s.serveEmbeddedFrontend(w, r, clean)
		return
	}
	writeError(w, http.StatusNotFound, errors.New("frontend is not built; run npm --prefix web run build"))
}

func (s *Server) serveDiskFrontend(w http.ResponseWriter, r *http.Request, clean string) {
	candidate := filepath.Join(s.webDir, filepath.FromSlash(clean))
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		http.ServeFile(w, r, candidate)
		return
	}
	index := filepath.Join(s.webDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, http.StatusNotFound, errors.New("frontend build not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	http.ServeFile(w, r, index)
}

func (s *Server) serveEmbeddedFrontend(w http.ResponseWriter, r *http.Request, clean string) {
	body, err := fs.ReadFile(s.webFS, clean)
	if err != nil {
		body, err = fs.ReadFile(s.webFS, "index.html")
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				writeError(w, http.StatusNotFound, errors.New("embedded frontend is not available"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		clean = "index.html"
	}
	http.ServeContent(w, r, clean, time.Time{}, bytes.NewReader(body))
}
