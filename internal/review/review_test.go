package review

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/and1truong/aegir/internal/analyzer"
)

func TestCompareMarksGraphAndRuleChanges(t *testing.T) {
	baseNode := analyzer.Node{ID: "fn:1", Kind: "function", Label: "Run", Meta: map[string]any{"fingerprint": "a"}}
	headNode := baseNode
	headNode.Meta = map[string]any{"fingerprint": "b"}
	added := analyzer.Node{ID: "fn:2", Kind: "function", Label: "Added", Meta: map[string]any{"fingerprint": "c"}}
	base := analyzer.Snapshot{Repository: analyzer.Repository{Head: "base"}, Nodes: []analyzer.Node{baseNode}, Analysis: analyzer.Analysis{Violations: []analyzer.Violation{}}}
	head := analyzer.Snapshot{Repository: analyzer.Repository{Head: "head"}, Nodes: []analyzer.Node{headNode, added}, Edges: []analyzer.Edge{{ID: "fn:1|calls|fn:2", Source: "fn:1", Target: "fn:2", Kind: "calls"}}, Analysis: analyzer.Analysis{Violations: []analyzer.Violation{{ID: "v1", RuleID: "r1"}}}}
	review := Compare("repo", "main", "HEAD", 1, 2, base, head)
	if review.Summary.ModifiedNodes != 1 || review.Summary.AddedNodes != 1 || review.Summary.AddedEdges != 1 || review.Summary.NewViolations != 1 {
		t.Fatalf("unexpected review: %#v", review.Summary)
	}
}

func TestCompareMarksEvidenceOnlyEdgeChanges(t *testing.T) {
	nodes := []analyzer.Node{{ID: "a", Kind: "function", Label: "A"}, {ID: "b", Kind: "function", Label: "B"}}
	baseEdge := analyzer.Edge{ID: "a|calls|b", Source: "a", Target: "b", Kind: "calls", EvidenceRefs: []string{"old"}}
	headEdge := baseEdge
	headEdge.EvidenceRefs = []string{"new"}
	base := analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{baseEdge}, Evidence: []analyzer.EvidenceRecord{{ID: "old", Subject: analyzer.EvidenceSubject{Kind: "edge", ID: baseEdge.ID}}}}
	head := analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{headEdge}, Evidence: []analyzer.EvidenceRecord{{ID: "old", Subject: analyzer.EvidenceSubject{Kind: "edge", ID: baseEdge.ID}}, {ID: "new", Subject: analyzer.EvidenceSubject{Kind: "edge", ID: baseEdge.ID}}}}
	result := Compare("repo", "base", "head", 1, 2, base, head)
	if len(result.Edges) != 1 || result.Edges[0].Change != "modified" {
		t.Fatalf("expected modified edge for evidence delta, got %#v", result.Edges)
	}
	if result.Summary.ModifiedEdges != 1 {
		t.Fatalf("expected modified edge in summary, got %#v", result.Summary)
	}
	if len(result.Evidence) != 2 {
		t.Fatalf("expected review evidence records, got %#v", result.Evidence)
	}
	if result.PayloadVersion != PayloadVersion || len(result.Delta.Edges) != 1 || result.Delta.Edges[0].Before == nil || result.Delta.Edges[0].After == nil {
		t.Fatalf("expected a versioned before/after edge delta, got %#v", result.Delta)
	}
	if result.Delta.Edges[0].ChangeReasons[0].Kind != "evidence-changed" {
		t.Fatalf("expected typed evidence reason, got %#v", result.Delta.Edges[0].ChangeReasons)
	}
}

func TestCompareReviewIDIncludesComparedEdgeFields(t *testing.T) {
	nodes := []analyzer.Node{{ID: "a"}, {ID: "b"}}
	baseEdge := analyzer.Edge{ID: "edge", Source: "a", Target: "b", Kind: "calls"}
	base := analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{baseEdge}}
	boundaryEdge := baseEdge
	boundaryEdge.Boundary = "external"
	synchronousEdge := baseEdge
	synchronousEdge.Synchronous = true
	unchangedID := Compare("repo", "base", "head", 1, 2, base, base).ID
	boundaryID := Compare("repo", "base", "head", 1, 2, base, analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{boundaryEdge}}).ID
	synchronousID := Compare("repo", "base", "head", 1, 2, base, analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{synchronousEdge}}).ID
	if unchangedID == boundaryID || unchangedID == synchronousID || boundaryID == synchronousID {
		t.Fatalf("review IDs collapsed distinct edge semantics: unchanged=%s boundary=%s synchronous=%s", unchangedID, boundaryID, synchronousID)
	}
}

func TestCompareReviewIDIncludesCanonicalNodeFields(t *testing.T) {
	baseNode := analyzer.Node{ID: "node", Kind: "function", Label: "Run", Service: "service", Package: "pkg", File: "run.go", Description: "description", Tags: []string{"a"}, Meta: map[string]any{"fingerprint": "same", "owner": "one"}}
	base := analyzer.Snapshot{Nodes: []analyzer.Node{baseNode}}
	unchangedID := Compare("repo", "base", "head", 1, 2, base, base).ID
	tests := map[string]func(*analyzer.Node){
		"kind":        func(node *analyzer.Node) { node.Kind = "method" },
		"label":       func(node *analyzer.Node) { node.Label = "Execute" },
		"service":     func(node *analyzer.Node) { node.Service = "other" },
		"package":     func(node *analyzer.Node) { node.Package = "other" },
		"file":        func(node *analyzer.Node) { node.File = "other.go" },
		"description": func(node *analyzer.Node) { node.Description = "other" },
		"tags":        func(node *analyzer.Node) { node.Tags = []string{"b"} },
		"owners":      func(node *analyzer.Node) { node.Owners = []string{"two"} },
		"metadata":    func(node *analyzer.Node) { node.Meta["owner"] = "two" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			headNode := baseNode
			headNode.Meta = map[string]any{"fingerprint": "same", "owner": "one"}
			mutate(&headNode)
			result := Compare("repo", "base", "head", 1, 2, base, analyzer.Snapshot{Nodes: []analyzer.Node{headNode}})
			if result.ID == unchangedID || result.Summary.ModifiedNodes != 1 {
				t.Fatalf("node change was not represented: id=%s summary=%#v", result.ID, result.Summary)
			}
		})
	}
	reordered := baseNode
	reordered.Tags = []string{"b", "a"}
	ordered := baseNode
	ordered.Tags = []string{"a", "b"}
	if Compare("repo", "base", "head", 1, 2, analyzer.Snapshot{Nodes: []analyzer.Node{ordered}}, analyzer.Snapshot{Nodes: []analyzer.Node{ordered}}).ID != Compare("repo", "base", "head", 3, 4, analyzer.Snapshot{Nodes: []analyzer.Node{reordered}}, analyzer.Snapshot{Nodes: []analyzer.Node{reordered}}).ID {
		t.Fatal("tag ordering changed canonical node identity")
	}
	ordered.Owners = []string{"a", "b"}
	reordered.Owners = []string{"b", "a"}
	if Compare("repo", "base", "head", 1, 2, analyzer.Snapshot{Nodes: []analyzer.Node{ordered}}, analyzer.Snapshot{Nodes: []analyzer.Node{ordered}}).ID != Compare("repo", "base", "head", 3, 4, analyzer.Snapshot{Nodes: []analyzer.Node{reordered}}, analyzer.Snapshot{Nodes: []analyzer.Node{reordered}}).ID {
		t.Fatal("owner ordering changed canonical node identity")
	}
}

func TestCompareReviewIDCanonicalizesSnapshotOrdering(t *testing.T) {
	first := analyzer.Snapshot{
		Analysis: analyzer.Analysis{
			Rules:      []analyzer.Rule{{ID: "a"}, {ID: "b"}},
			Violations: []analyzer.Violation{{ID: "a"}, {ID: "b"}},
			Coverage:   []analyzer.Coverage{{NodeID: "a"}, {NodeID: "b"}},
			Contracts:  []analyzer.Contract{{ID: "a"}, {ID: "b"}},
			Complexity: []analyzer.Complexity{{NodeID: "a"}, {NodeID: "b"}},
			Telemetry:  []analyzer.Telemetry{{NodeID: "a"}, {NodeID: "b"}},
		},
		Evidence: []analyzer.EvidenceRecord{{ID: "a"}, {ID: "b"}},
	}
	second := analyzer.Snapshot{
		Analysis: analyzer.Analysis{
			Rules:      []analyzer.Rule{{ID: "b"}, {ID: "a"}},
			Violations: []analyzer.Violation{{ID: "b"}, {ID: "a"}},
			Coverage:   []analyzer.Coverage{{NodeID: "b"}, {NodeID: "a"}},
			Contracts:  []analyzer.Contract{{ID: "b"}, {ID: "a"}},
			Complexity: []analyzer.Complexity{{NodeID: "b"}, {NodeID: "a"}},
			Telemetry:  []analyzer.Telemetry{{NodeID: "b"}, {NodeID: "a"}},
		},
		Evidence: []analyzer.EvidenceRecord{{ID: "b"}, {ID: "a"}},
	}
	firstID := Compare("repo", "base", "head", 1, 2, first, first).ID
	secondID := Compare("repo", "base", "head", 3, 4, second, second).ID
	if firstID != secondID {
		t.Fatalf("review IDs differ for reordered snapshots: %s != %s", firstID, secondID)
	}
}

func TestCompareCanonicalizesViolationReasonsAndEvidenceReferences(t *testing.T) {
	nodes := []analyzer.Node{{ID: "a"}, {ID: "b"}}
	head := analyzer.Snapshot{
		Nodes: nodes,
		Edges: []analyzer.Edge{{ID: "edge", Source: "a", Target: "b", Kind: "calls", EvidenceRefs: []string{"z", "a"}}},
		Analysis: analyzer.Analysis{Violations: []analyzer.Violation{
			{ID: "z", PrimaryNode: "a", Title: "Zeta"},
			{ID: "a", PrimaryNode: "a", Title: "Alpha"},
		}},
	}
	result := Compare("repo", "base", "head", 1, 2, analyzer.Snapshot{Nodes: nodes}, head)
	if len(result.NewViolations) != 2 || result.NewViolations[0].ID != "a" || result.NewViolations[1].ID != "z" {
		t.Fatalf("violations are not canonical: %#v", result.NewViolations)
	}
	if len(result.Delta.Nodes) != 1 || len(result.Delta.Nodes[0].ChangeReasons) != 2 || result.Delta.Nodes[0].ChangeReasons[0].Detail != "Alpha" || result.Delta.Nodes[0].ChangeReasons[1].Detail != "Zeta" {
		t.Fatalf("node reasons are not canonical: %#v", result.Delta.Nodes)
	}
	if len(result.Delta.Edges) != 1 || len(result.Delta.Edges[0].ChangeReasons) != 1 || strings.Join(result.Delta.Edges[0].ChangeReasons[0].EvidenceRefs, ",") != "a,z" {
		t.Fatalf("reason evidence references are not canonical: %#v", result.Delta.Edges)
	}
}

func TestCompareSerializesExplicitEmptyEvidenceRefs(t *testing.T) {
	nodes := []analyzer.Node{{ID: "a", Kind: "function", Label: "A"}, {ID: "b", Kind: "function", Label: "B"}}
	baseEdge := analyzer.Edge{ID: "a|calls|b", Source: "a", Target: "b", Kind: "calls", EvidenceRefs: []string{"old"}}
	headEdge := analyzer.Edge{ID: baseEdge.ID, Source: "a", Target: "b", Kind: "calls"}
	result := Compare("repo", "base", "head", 1, 2, analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{baseEdge}}, analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{headEdge}})
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var encoded struct {
		Edges []struct {
			EvidenceRefs json.RawMessage `json:"evidenceRefs"`
		} `json:"edges"`
		Delta struct {
			Edges []struct {
				After struct {
					EvidenceRefs json.RawMessage `json:"evidenceRefs"`
				} `json:"after"`
			} `json:"edges"`
		} `json:"delta"`
	}
	if err := json.Unmarshal(payload, &encoded); err != nil {
		t.Fatal(err)
	}
	if len(encoded.Edges) != 1 || string(encoded.Edges[0].EvidenceRefs) != "[]" || len(encoded.Delta.Edges) != 1 || string(encoded.Delta.Edges[0].After.EvidenceRefs) != "[]" {
		t.Fatalf("expected explicit empty evidence refs in v2 review payload: %s", payload)
	}
}

func TestComparePreservesRemovedBodiesAndEvidence(t *testing.T) {
	nodes := []analyzer.Node{{ID: "endpoint", Kind: "endpoint", Label: "POST /orders"}, {ID: "handler", Kind: "function", Label: "CreateOrder"}}
	edge := analyzer.Edge{ID: "endpoint|calls|handler", Source: "endpoint", Target: "handler", Kind: "calls", EvidenceRefs: []string{"callsite"}}
	base := analyzer.Snapshot{Nodes: nodes, Edges: []analyzer.Edge{edge}, Evidence: []analyzer.EvidenceRecord{{ID: "callsite", Subject: analyzer.EvidenceSubject{Kind: "edge", ID: edge.ID}, Location: &analyzer.EvidenceLocation{File: "routes.go", Line: 42}}}}
	head := analyzer.Snapshot{Nodes: nodes[:1]}
	result := Compare("repo", "base", "head", 1, 2, base, head)
	if len(result.Delta.Nodes) != 1 || result.Delta.Nodes[0].Before == nil || result.Delta.Nodes[0].Status != "removed" {
		t.Fatalf("expected removed node body, got %#v", result.Delta.Nodes)
	}
	if len(result.Delta.Edges) != 1 || result.Delta.Edges[0].Before == nil || result.Delta.Edges[0].After != nil {
		t.Fatalf("expected removed edge before body, got %#v", result.Delta.Edges)
	}
	if len(result.Evidence) != 1 || result.Evidence[0].Location == nil || result.Evidence[0].Location.Line != 42 {
		t.Fatalf("expected removed call-site evidence, got %#v", result.Evidence)
	}
}

func TestUpgradeLegacyReviewCreatesExplicitCompatibilityDelta(t *testing.T) {
	legacy := Review{Nodes: []analyzer.Node{{ID: "new", Change: "added"}, {ID: "same"}}, Edges: []analyzer.Edge{{ID: "old", Change: "removed"}}}
	UpgradeLegacy(&legacy)
	if legacy.PayloadVersion != PayloadVersion || len(legacy.Delta.Nodes) != 1 || len(legacy.Delta.Edges) != 1 {
		t.Fatalf("legacy review was not upgraded: %#v", legacy)
	}
	if legacy.Delta.Nodes[0].ChangeReasons[0].Kind != "legacy-change" {
		t.Fatalf("expected explicit compatibility reason: %#v", legacy.Delta.Nodes[0])
	}
}

func TestCompareModelsFindingContractAndRuntimeReasons(t *testing.T) {
	node := analyzer.Node{ID: "handler", Kind: "function", Label: "Handler", Meta: map[string]any{"fingerprint": "same"}}
	base := analyzer.Snapshot{Nodes: []analyzer.Node{node}, Analysis: analyzer.Analysis{
		Contracts: []analyzer.Contract{{ID: "contract", Name: "Orders", Node: node.ID, Fingerprint: "old", Shape: map[string]string{"required:id": "string"}}},
		Telemetry: []analyzer.Telemetry{{NodeID: node.ID, RPM: 10, Window: "5m", Source: "test"}},
	}}
	head := analyzer.Snapshot{Nodes: []analyzer.Node{node}, Analysis: analyzer.Analysis{
		Contracts:  []analyzer.Contract{{ID: "contract", Name: "Orders", Node: node.ID, Fingerprint: "new", Shape: map[string]string{"required:id": "number"}}},
		Telemetry:  []analyzer.Telemetry{{NodeID: node.ID, RPM: 20, Window: "5m", Source: "test"}},
		Violations: []analyzer.Violation{{ID: "violation", PrimaryNode: node.ID, Title: "New boundary violation"}},
	}}
	result := Compare("repo", "base", "head", 1, 2, base, head)
	if result.Summary.ModifiedNodes != 1 {
		t.Fatalf("expected analysis-only modification in summary, got %#v", result.Summary)
	}
	if len(result.Delta.Nodes) != 1 || result.Delta.Nodes[0].Status != "modified" {
		t.Fatalf("expected analysis-only node delta, got %#v", result.Delta.Nodes)
	}
	kinds := map[string]bool{}
	for _, reason := range result.Delta.Nodes[0].ChangeReasons {
		kinds[reason.Kind] = true
	}
	for _, expected := range []string{"architecture-violation", "contract-changed", "runtime-changed"} {
		if !kinds[expected] {
			t.Fatalf("missing %s reason in %#v", expected, result.Delta.Nodes[0].ChangeReasons)
		}
	}
}

func TestCompareModelsComplexityAndTestProtectionReasons(t *testing.T) {
	node := analyzer.Node{ID: "handler", Kind: "function", Label: "Handler", Meta: map[string]any{"fingerprint": "same"}}
	base := analyzer.Snapshot{Nodes: []analyzer.Node{node}, Analysis: analyzer.Analysis{
		Complexity: []analyzer.Complexity{{NodeID: node.ID, Cyclomatic: 4, Score: 3}},
		Coverage:   []analyzer.Coverage{{NodeID: node.ID, Status: "covered", Line: 90, Tests: []string{"test"}}},
	}}
	head := analyzer.Snapshot{Nodes: []analyzer.Node{node}, Analysis: analyzer.Analysis{
		Complexity: []analyzer.Complexity{{NodeID: node.ID, Cyclomatic: 12, Score: 8}},
		Coverage:   []analyzer.Coverage{{NodeID: node.ID, Status: "uncovered", Line: 0, Tests: []string{}}},
	}}
	result := Compare("repo", "base", "head", 1, 2, base, head)
	kinds := map[string]bool{}
	for _, reason := range result.Delta.Nodes[0].ChangeReasons {
		kinds[reason.Kind] = true
	}
	if !kinds["complexity-changed"] || !kinds["test-protection-changed"] {
		t.Fatalf("missing architecture evolution reasons: %#v", result.Delta.Nodes[0].ChangeReasons)
	}
}
