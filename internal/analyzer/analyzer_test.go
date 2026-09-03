package analyzer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunIndexesFunctionsCallsTestsAndContracts(t *testing.T) {
	root := t.TempDir()
	for path, body := range map[string]string{
		".git/HEAD":           "0123456789abcdef\n",
		".github/CODEOWNERS":  "**/*.go @go-team @platform\n/api/openapi.yaml @api-team\n/models/types.go @models-team\n",
		"go.mod":              "module example.com/shop\n\ngo 1.24\n",
		"order/order.go":      "package order\nimport (\"database/sql\"; \"net/http\")\ntype Publisher interface { Publish(string) }\nfunc Create(db *sql.DB, publisher Publisher) { Validate(); db.Exec(`INSERT INTO orders (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id=excluded.id`); publisher.Publish(\"order.created\"); http.Get(\"https://fraud.example/check\"); headers.Set(\"origin\", \"https://not-a-call.example\") }\nfunc Validate() {}\n",
		"order/order_test.go": "package order\nimport \"testing\"\nfunc TestCreate(t *testing.T) { Create() }\n",
		"order/repeat.go":     "package order\nfunc Repeat() {\nValidate()\nValidate()\n}\n",
		"cmd/main.go":         "package main\nimport \"example.com/shop/order\"\nfunc main() { order.Create() }\n",
		"cyclea/a.go":         "package cyclea\nimport \"example.com/shop/cycleb\"\nfunc A() { cycleb.B() }\n",
		"cycleb/b.go":         "package cycleb\nimport \"example.com/shop/cyclea\"\nfunc B() { cyclea.A() }\n",
		"api/openapi.yaml":    "openapi: 3.1.0\n",
		"models/types.go":     "package models\ntype Order struct{}\n",
		"types.go":            "package shop\ntype Root struct{}\n",
		"coverage.out":        "mode: set\nexample.com/shop/order/order.go:4.1,4.180 1 1\nexample.com/shop/order/order.go:5.1,5.19 1 0\n",
		"telemetry.json":      `[{"label":"Create","file":"order/order.go","rpm":8200,"p99":184,"errorRate":0.18,"window":"5m","source":"local-prometheus-export"}]`,
	} {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := RunWithOptions(root, Options{CoverageProfile: "coverage.out", TelemetryFile: "telemetry.json"})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Stats["nodes"] < 6 {
		t.Fatalf("expected indexed nodes, got %#v", snapshot.Stats)
	}
	if snapshot.Stats["contracts"] != 1 {
		t.Fatalf("expected contract discovery, got %#v", snapshot.Stats)
	}
	covered, measuredUncovered := false, false
	for _, item := range snapshot.Analysis.Coverage {
		if item.Status == "covered" && item.Line == 100 {
			covered = true
		}
		if item.Status == "uncovered" && item.Line == 0 && strings.Contains(item.Note, "coverprofile") {
			measuredUncovered = true
		}
	}
	if !covered || !measuredUncovered {
		t.Fatal("expected measured covered and uncovered functions")
	}
	if len(snapshot.Analysis.Contracts) != 1 || snapshot.Analysis.Contracts[0].Fingerprint == "" || snapshot.Analysis.Contracts[0].Shape["/openapi"] == "" {
		t.Fatal("expected normalized contract shape")
	}
	contractNode, packages := Node{}, map[string]Node{}
	for _, node := range snapshot.Nodes {
		if node.ID == snapshot.Analysis.Contracts[0].Node {
			contractNode = node
		}
		if node.Kind == "package" {
			packages[node.File] = node
		}
	}
	if contractNode.Package == "" || packages["api"].ID == "" {
		t.Fatalf("expected contract to belong to its package: %#v", contractNode)
	}
	if packages["models"].ID == "" || packages["."].ID == "" {
		t.Fatalf("expected package directories for packages without functions and at repository root: %#v", packages)
	}
	for path, expected := range map[string]string{"api": "@api-team", "models": "@models-team", ".": "@go-team"} {
		if actual := packages[path].Owner; actual != expected {
			t.Fatalf("package %q owner=%q want %q", path, actual, expected)
		}
	}
	if actual := packages["."].Owners; len(actual) != 2 || actual[0] != "@go-team" || actual[1] != "@platform" {
		t.Fatalf("root package owners=%q want both CODEOWNERS", actual)
	}
	if len(snapshot.Analysis.Complexity) == 0 {
		t.Fatal("expected function complexity profiles")
	}
	if len(snapshot.Analysis.Telemetry) != 1 || snapshot.Analysis.Telemetry[0].RPM != 8200 || snapshot.Analysis.Telemetry[0].Source != "local-prometheus-export" {
		t.Fatalf("expected imported telemetry, got %#v", snapshot.Analysis.Telemetry)
	}
	hasCall, hasTest, hasDependency, hasCrossPackageCall := false, false, false, false
	hasTableWrite, hasPublish, hasNetworkCall, hasFalseNetworkCall, hasFalseTable := false, false, false, false, false
	for _, edge := range snapshot.Edges {
		hasCall = hasCall || edge.Kind == "calls"
		hasTest = hasTest || edge.Kind == "tests"
		hasDependency = hasDependency || edge.Kind == "depends_on"
		if edge.Kind == "calls" {
			source, target := "", ""
			for _, node := range snapshot.Nodes {
				if node.ID == edge.Source {
					source = node.Label
				}
				if node.ID == edge.Target {
					target = node.Label
				}
			}
			hasCrossPackageCall = hasCrossPackageCall || source == "main" && target == "Create"
		}
		for _, node := range snapshot.Nodes {
			if node.ID != edge.Target {
				continue
			}
			hasTableWrite = hasTableWrite || edge.Kind == "writes" && node.Kind == "table" && node.Label == "orders" && edge.Boundary == "persistence"
			hasPublish = hasPublish || edge.Kind == "publishes" && node.Kind == "topic" && node.Label == "order.created" && edge.Boundary == "async"
			hasNetworkCall = hasNetworkCall || edge.Kind == "calls" && node.Kind == "external" && node.Label == "fraud.example" && edge.Boundary == "network"
			hasFalseNetworkCall = hasFalseNetworkCall || node.Kind == "external" && node.Label == "not-a-call.example"
			hasFalseTable = hasFalseTable || node.Kind == "table" && node.Label == "SET"
		}
	}
	if !hasCall || !hasTest || !hasDependency || !hasCrossPackageCall {
		t.Fatalf("expected calls, tests and internal package resolution; calls=%v tests=%v dependency=%v cross-package=%v", hasCall, hasTest, hasDependency, hasCrossPackageCall)
	}
	if !hasTableWrite || !hasPublish || !hasNetworkCall {
		t.Fatalf("expected discovered data flow; table=%v publish=%v network=%v", hasTableWrite, hasPublish, hasNetworkCall)
	}
	if hasFalseNetworkCall {
		t.Fatal("ordinary URL data must not be classified as an external call")
	}
	if hasFalseTable {
		t.Fatal("SQL UPDATE SET clause must not create a table named SET")
	}
	evidenceByID := map[string]EvidenceRecord{}
	for _, record := range snapshot.Evidence {
		evidenceByID[record.ID] = record
	}
	multipleCallSites := false
	for _, edge := range snapshot.Edges {
		if len(edge.EvidenceRefs) == 0 {
			t.Fatalf("edge %s has no evidence", edge.ID)
		}
		for _, evidenceID := range edge.EvidenceRefs {
			if evidenceByID[evidenceID].Subject.ID != edge.ID {
				t.Fatalf("edge %s references missing or mismatched evidence %s", edge.ID, evidenceID)
			}
		}
		if edge.Kind == "calls" && len(edge.EvidenceRefs) == 2 {
			multipleCallSites = true
		}
	}
	if !multipleCallSites {
		t.Fatal("expected collapsed call relationship to preserve both call-site observations")
	}
	hasCycle := false
	for _, violation := range snapshot.Analysis.Violations {
		hasCycle = hasCycle || violation.RuleID == "AEGIR-ARCH-001"
	}
	if !hasCycle {
		t.Fatal("expected package cycle violation")
	}
}

func TestApplyTelemetryTracksTrafficFieldPresence(t *testing.T) {
	root := t.TempDir()
	contents := `[
		{"nodeId":"zero","rpm":0,"window":"5m","source":"test"},
		{"nodeId":"latency","p99":120,"window":"5m","source":"test"}
	]`
	if err := os.WriteFile(filepath.Join(root, "telemetry.json"), []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	nodes := map[string]Node{
		"zero":    {ID: "zero"},
		"latency": {ID: "latency"},
	}
	analysis := Analysis{}
	if err := applyTelemetryFile(root, "telemetry.json", nodes, &analysis); err != nil {
		t.Fatal(err)
	}
	observed := map[string]bool{}
	for _, telemetry := range analysis.Telemetry {
		observed[telemetry.NodeID] = telemetry.TrafficObserved
	}
	if !observed["zero"] || observed["latency"] {
		t.Fatalf("traffic presence not preserved: %#v", analysis.Telemetry)
	}
}

func TestRunConnectsEndpointToRegisteredCallback(t *testing.T) {
	root := t.TempDir()
	for path, body := range map[string]string{
		".git/HEAD":          "0123456789abcdef\n",
		"go.mod":             "module example.com/routes\n\ngo 1.24\n",
		"orders/handler.go":  "package orders\nfunc Handle() {}\n",
		"routes/register.go": "package routes\nimport (\"net/http\"; \"example.com/routes/orders\")\nfunc Register() { http.HandleFunc(\"/orders\", orders.Handle) }\n",
	} {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := Run(root)
	if err != nil {
		t.Fatal(err)
	}
	endpointID, handlerID := "", ""
	for _, node := range snapshot.Nodes {
		if node.Kind == "endpoint" && node.Label == "HTTP /orders" {
			endpointID = node.ID
		}
		if node.Kind == "function" && node.Label == "Handle" {
			handlerID = node.ID
		}
	}
	for _, edge := range snapshot.Edges {
		if edge.Source == endpointID && edge.Label == "handler" && edge.Target == handlerID {
			return
		}
	}
	t.Fatalf("endpoint %q was not connected to callback %q: %#v", endpointID, handlerID, snapshot.Edges)
}

func TestRunConnectsEndpointToInjectedMethodCallback(t *testing.T) {
	root := t.TempDir()
	for path, body := range map[string]string{
		".git/HEAD":          "0123456789abcdef\n",
		"go.mod":             "module example.com/routes\n\ngo 1.24\n",
		"orders/handler.go":  "package orders\ntype AdminHandler struct{}\ntype PublicHandler struct{}\nfunc (h *AdminHandler) Handle() {}\nfunc (h *PublicHandler) Handle() {}\nfunc NewHandler() *PublicHandler { return &PublicHandler{} }\n",
		"routes/register.go": "package routes\nimport (\"example.com/routes/orders\"; \"github.com/labstack/echo/v4\")\ntype Router struct{}\ntype Cache struct{}\nfunc (Router) GET(string, any) {}\nfunc (Cache) GET(string, any) {}\nfunc onMiss() {}\nfunc External(g *echo.Group) { g.GET(\"/external\", onMiss) }\nfunc Register(router Router, api Cache, h *orders.PublicHandler) { router.GET(\"/orders\", h.Handle); router.GET(\"/method-expression\", (*orders.PublicHandler).Handle); fromConstructor := orders.NewHandler(); router.GET(\"/constructor\", fromConstructor.Handle); literal := &orders.PublicHandler{}; router.GET(\"/literal\", literal.Handle); { h := &orders.AdminHandler{}; router.GET(\"/admin\", h.Handle) }; switch { case true: h := &orders.AdminHandler{}; router.GET(\"/switch\", h.Handle) }; select { case <-make(chan struct{}): h := &orders.AdminHandler{}; router.GET(\"/select\", h.Handle); default: }; router.GET(\"/health\", func() {}); api.GET(\"/config\", onMiss) }\n",
	} {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := Run(root)
	if err != nil {
		t.Fatal(err)
	}
	endpointIDs := map[string]string{}
	handlerIDs := map[string]string{}
	for _, node := range snapshot.Nodes {
		if node.Kind == "endpoint" {
			endpointIDs[node.Label] = node.ID
		}
		if node.Kind == "method" || node.Kind == "function" {
			handlerIDs[node.Label] = node.ID
		}
	}
	connections := map[string]string{}
	for _, edge := range snapshot.Edges {
		if edge.Label != "handler" {
			continue
		}
		for label, endpointID := range endpointIDs {
			if edge.Source == endpointID {
				connections[label] = edge.Target
			}
		}
	}
	for _, label := range []string{"GET /orders", "GET /method-expression", "GET /constructor", "GET /literal"} {
		if connections[label] != handlerIDs["PublicHandler.Handle"] {
			t.Fatalf("endpoint %q was not connected to PublicHandler.Handle: %#v", label, snapshot.Edges)
		}
	}
	if connections["GET /admin"] != handlerIDs["AdminHandler.Handle"] {
		t.Fatalf("shadowed receiver was not connected to AdminHandler.Handle: %#v", snapshot.Edges)
	}
	for _, label := range []string{"GET /switch", "GET /select"} {
		if connections[label] != handlerIDs["AdminHandler.Handle"] {
			t.Fatalf("clause-local receiver for %q was not connected to AdminHandler.Handle: %#v", label, snapshot.Edges)
		}
	}
	if connections["GET /health"] != handlerIDs["Register"] {
		t.Fatalf("inline callback did not fall back to Register: %#v", snapshot.Edges)
	}
	if connections["GET /external"] != handlerIDs["onMiss"] {
		t.Fatalf("external router receiver was not recognized: %#v", snapshot.Edges)
	}
	if len(endpointIDs) != 9 || endpointIDs["GET /config"] != "" {
		t.Fatalf("unexpected endpoint set: %#v", endpointIDs)
	}
}
