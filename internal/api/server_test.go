package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/and1truong/aegir/internal/attention"
	contractdiff "github.com/and1truong/aegir/internal/contracts"
	"github.com/and1truong/aegir/internal/store"
)

func TestRepositoryIndexAndImpactFlow(t *testing.T) {
	repositoryPath := filepath.Join(t.TempDir(), "service")
	for path, body := range map[string]string{
		".git/HEAD":       "0123456789abcdef\n",
		"go.mod":          "module example.com/service\n\ngo 1.24\n",
		"service.go":      "package service\nfunc Public() { helper() }\nfunc helper() {}\n",
		"service_test.go": "package service\nimport \"testing\"\nfunc TestPublic(t *testing.T) { Public() }\n",
		"coverage.out":    "mode: set\nexample.com/service/service.go:2.1,2.27 1 1\nexample.com/service/service.go:3.1,3.17 1 0\n",
		"telemetry.json":  `[{"label":"Public","rpm":120,"p99":42,"window":"5m","source":"test-export"}]`,
		"openapi.yaml":    "openapi: 3.1.0\ncomponents:\n  schemas:\n    Order:\n      type: object\n",
	} {
		full := filepath.Join(repositoryPath, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	database, err := store.Open(filepath.Join(t.TempDir(), "aegir.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	handler := New(database, "")

	body, _ := json.Marshal(map[string]any{"path": repositoryPath, "index": true, "coveragePath": "coverage.out", "telemetryPath": "telemetry.json"})
	request := httptest.NewRequest(http.MethodPost, "/api/repositories", bytes.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("register: status=%d body=%s", response.Code, response.Body.String())
	}
	var snapshot store.Snapshot
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Repository.Status != "ready" || len(snapshot.Nodes) == 0 || len(snapshot.Edges) == 0 {
		t.Fatalf("unexpected snapshot: %#v", snapshot.Stats)
	}
	if len(snapshot.Evidence) == 0 || len(snapshot.Edges[0].EvidenceRefs) == 0 {
		t.Fatal("expected persisted edge evidence in indexed snapshot")
	}
	measured := false
	for _, coverage := range snapshot.Analysis.Coverage {
		measured = measured || coverage.Line == 100
	}
	if !measured {
		t.Fatal("expected imported coverprofile measurement")
	}
	if len(snapshot.Analysis.Telemetry) != 1 || snapshot.Analysis.Telemetry[0].P99 != 42 {
		t.Fatalf("expected imported runtime measurement, got %#v", snapshot.Analysis.Telemetry)
	}

	var publicID string
	for _, node := range snapshot.Nodes {
		if node.Label == "Public" {
			publicID = node.ID
			break
		}
	}
	request = httptest.NewRequest(http.MethodGet, "/api/repositories/"+snapshot.Repository.ID+"/impact?nodeId="+publicID+"&depth=3", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("impact: status=%d body=%s", response.Code, response.Body.String())
	}
	var impact struct {
		Root  string `json:"root"`
		Nodes []any  `json:"nodes"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &impact); err != nil {
		t.Fatal(err)
	}
	if impact.Root != publicID || len(impact.Nodes) == 0 {
		t.Fatalf("unexpected impact response: %#v", impact)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/repositories/"+snapshot.Repository.ID+"/attention?window=90", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("attention: status=%d body=%s", response.Code, response.Body.String())
	}
	var landscape attention.Landscape
	if err := json.Unmarshal(response.Body.Bytes(), &landscape); err != nil {
		t.Fatal(err)
	}
	if landscape.ModelVersion != attention.ModelVersion || landscape.UnitLevel != "package" || len(landscape.Units) == 0 {
		t.Fatalf("unexpected attention landscape: %#v", landscape)
	}
	if landscape.Units[0].ChangeVelocity.Score != nil {
		t.Fatal("invalid fake Git repository must produce unavailable velocity, not zero")
	}
	request = httptest.NewRequest(http.MethodGet, "/api/repositories/"+snapshot.Repository.ID+"/attention/evidence?window=90&unitId="+landscape.Units[0].Unit.ID, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("attention evidence: status=%d body=%s", response.Code, response.Body.String())
	}
	var evidence struct {
		Unit attention.Unit `json:"unit"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &evidence); err != nil {
		t.Fatal(err)
	}
	if evidence.Unit.Unit.ID != landscape.Units[0].Unit.ID {
		t.Fatalf("unexpected attention evidence unit: %#v", evidence.Unit)
	}

	headContract := "openapi: 3.1.0\ncomponents:\n  schemas:\n    Order:\n      type: object\n      required: [id]\n      properties:\n        id:\n          type: string\n"
	if err := os.WriteFile(filepath.Join(repositoryPath, "openapi.yaml"), []byte(headContract), 0o644); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/repositories/"+snapshot.Repository.ID+"/index", bytes.NewReader([]byte(`{}`)))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("reindex: status=%d body=%s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/repositories/"+snapshot.Repository.ID+"/contracts/diff", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("contract diff: status=%d body=%s", response.Code, response.Body.String())
	}
	var diff contractdiff.Diff
	if err := json.Unmarshal(response.Body.Bytes(), &diff); err != nil {
		t.Fatal(err)
	}
	if len(diff.Changes) != 1 || diff.Changes[0].Compatibility != "break" {
		t.Fatalf("unexpected contract diff: %#v", diff)
	}
}

func TestServesEmbeddedFrontend(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "aegir.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	handler := NewWithFS(database, "", fstest.MapFS{
		"index.html":    {Data: []byte("<html>embedded</html>")},
		"assets/app.js": {Data: []byte("console.log('embedded')")},
	})
	for _, requestPath := range []string{"/", "/assets/app.js", "/repositories/example"} {
		t.Run(requestPath, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestRejectsUntrustedBrowserOrigin(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "aegir.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	request := httptest.NewRequest(http.MethodGet, "/api/repositories", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	response := httptest.NewRecorder()
	New(database, "").ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAllowsLoopbackBrowserOrigins(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "aegir.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	for _, origin := range []string{"http://127.0.0.1:4123", "http://localhost:5173", "http://[::1]:4123"} {
		t.Run(origin, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/repositories", nil)
			request.Header.Set("Origin", origin)
			response := httptest.NewRecorder()
			New(database, "").ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if got := response.Header().Get("Access-Control-Allow-Origin"); got != origin {
				t.Fatalf("allow-origin=%q want %q", got, origin)
			}
		})
	}
}
