package attention

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/history"
)

func TestCalculateRanksPackageWithImpactComplexityAndVelocity(t *testing.T) {
	now := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	pkgA := analyzer.Node{ID: "pkg:a", Kind: "package", Label: "a", File: "a"}
	pkgB := analyzer.Node{ID: "pkg:b", Kind: "package", Label: "b", File: "b"}
	pkgC := analyzer.Node{ID: "pkg:c", Kind: "package", Label: "c", File: "c"}
	fnA := analyzer.Node{ID: "fn:a", Kind: "function", Label: "A", Package: pkgA.ID, File: "a/a.go:1"}
	fnB := analyzer.Node{ID: "fn:b", Kind: "function", Label: "B", Package: pkgB.ID, File: "b/b.go:1"}
	fnC := analyzer.Node{ID: "fn:c", Kind: "function", Label: "C", Package: pkgC.ID, File: "c/c.go:1"}
	table := analyzer.Node{ID: "table", Kind: "table", Label: "orders"}
	edges := []analyzer.Edge{
		{ID: "b-a", Source: fnB.ID, Target: fnA.ID, Kind: "calls", EvidenceRefs: []string{"e1"}},
		{ID: "c-b", Source: fnC.ID, Target: fnB.ID, Kind: "calls", EvidenceRefs: []string{"e2"}},
		{ID: "a-table", Source: fnA.ID, Target: table.ID, Kind: "writes", Boundary: "persistence", EvidenceRefs: []string{"e3"}},
	}
	snapshot := analyzer.Snapshot{Nodes: []analyzer.Node{pkgA, pkgB, pkgC, fnA, fnB, fnC, table}, Edges: edges, Analysis: analyzer.Analysis{Complexity: []analyzer.Complexity{{NodeID: fnA.ID, Score: 9}, {NodeID: fnB.ID, Score: 2}, {NodeID: fnC.ID, Score: 1}}}}
	changes := history.Result{Events: []history.ChangeEvent{{ID: "git:new", OccurredAt: now.Add(-24 * time.Hour), AuthorKey: "author", Files: []history.FileChange{{Path: "a/a.go", Additions: 80, Deletions: 20}, {Path: "a/schema/order.sql", Additions: 5}}}}}
	landscape := Calculate("repo", 1, snapshot, &changes, 90, now)
	if len(landscape.Units) != 3 {
		t.Fatalf("expected three package units, got %#v", landscape.Units)
	}
	var a Unit
	for _, unit := range landscape.Units {
		if unit.Unit.ID == pkgA.ID {
			a = unit
		}
	}
	if value(a.Impact.Score) <= 0 || value(a.ChangeComplexity.Score) <= 0 || value(a.ChangeVelocity.Score) <= 0 {
		t.Fatalf("expected explainable scores: %#v", a)
	}
	if a.Impact.Coverage < .799 || a.Impact.Coverage > .801 || a.ChangeVelocity.Coverage != 1 {
		t.Fatalf("unexpected signal coverage: %#v", a)
	}
	if len(a.Impact.Factors[0].EvidenceRefs) == 0 || len(a.ChangeVelocity.Factors[0].EvidenceRefs) == 0 {
		t.Fatalf("expected graph and Git evidence: %#v", a)
	}
	if topology := a.ChangeVelocity.Factors[len(a.ChangeVelocity.Factors)-1]; topology.RawValue == 0 || len(topology.EvidenceRefs) == 0 {
		t.Fatalf("expected contract/schema change evidence: %#v", topology)
	}
	if len(landscape.Findings) == 0 || landscape.Findings[0].Region != "protect" || !strings.Contains(landscape.Findings[0].Title, "high-impact") {
		t.Fatalf("expected an action-oriented protect finding: %#v", landscape.Findings)
	}
}

func TestCalculateDoesNotPromoteLowAttentionPackageForVelocityAlone(t *testing.T) {
	now := time.Now()
	snapshot := analyzer.Snapshot{Nodes: []analyzer.Node{{ID: "pkg:a", Kind: "package", Label: "a"}, {ID: "fn:a", Kind: "function", Package: "pkg:a", File: "a/a.go:1"}}}
	changes := history.Result{Events: []history.ChangeEvent{{ID: "git:new", OccurredAt: now, AuthorKey: "author", Files: []history.FileChange{{Path: "a/a.go", Additions: 1000}}}}}
	landscape := Calculate("repo", 1, snapshot, &changes, 90, now)
	if landscape.Units[0].Region != "low-attention" || len(landscape.Findings) != 0 {
		t.Fatalf("velocity-only noise became a finding: %#v", landscape)
	}
}

func TestCalculateUsesAvailableRuntimeSignalAndP90Complexity(t *testing.T) {
	pkg := analyzer.Node{ID: "pkg:a", Kind: "package", Label: "a"}
	nodes := []analyzer.Node{pkg}
	complexity := []analyzer.Complexity{}
	for index := 1; index <= 10; index++ {
		node := analyzer.Node{ID: fmt.Sprintf("fn:%d", index), Kind: "function", Package: pkg.ID, File: fmt.Sprintf("a/%d.go:1", index)}
		nodes = append(nodes, node)
		complexity = append(complexity, analyzer.Complexity{NodeID: node.ID, Score: index})
	}
	snapshot := analyzer.Snapshot{Nodes: nodes, Analysis: analyzer.Analysis{Complexity: complexity, Telemetry: []analyzer.Telemetry{{NodeID: "fn:1", RPM: 120}}}}
	landscape := Calculate("repo", 1, snapshot, &history.Result{}, 90, time.Now())
	unit := landscape.Units[0]
	if unit.Impact.Coverage < .899 || unit.Impact.Coverage > .901 {
		t.Fatalf("runtime signal was not included: %#v", unit.Impact)
	}
	if got := unit.ChangeComplexity.Factors[len(unit.ChangeComplexity.Factors)-1].RawValue; got != 9 {
		t.Fatalf("p90 complexity=%v want 9", got)
	}
}

func TestCalculateDistinguishesUnavailableVelocityFromZero(t *testing.T) {
	snapshot := analyzer.Snapshot{Nodes: []analyzer.Node{{ID: "pkg:a", Kind: "package", Label: "a"}}}
	landscape := Calculate("repo", 1, snapshot, nil, 90, time.Now())
	if landscape.Units[0].ChangeVelocity.Score != nil || landscape.Completeness.HistoryAvailable {
		t.Fatalf("unavailable velocity became zero: %#v", landscape)
	}
	zeroHistory := history.Result{Events: []history.ChangeEvent{}}
	landscape = Calculate("repo", 1, snapshot, &zeroHistory, 90, time.Now())
	if landscape.Units[0].ChangeVelocity.Score == nil || *landscape.Units[0].ChangeVelocity.Score != 0 {
		t.Fatalf("observed zero history was not retained: %#v", landscape.Units[0].ChangeVelocity)
	}
}

func TestCalculateMarksEveryPackageInDependencyCycle(t *testing.T) {
	packages := []analyzer.Node{{ID: "pkg:a", Kind: "package", Label: "a"}, {ID: "pkg:b", Kind: "package", Label: "b"}}
	functions := []analyzer.Node{{ID: "fn:a", Kind: "function", Package: "pkg:a"}, {ID: "fn:b", Kind: "function", Package: "pkg:b"}}
	snapshot := analyzer.Snapshot{Nodes: append(packages, functions...), Edges: []analyzer.Edge{{ID: "a-b", Source: "fn:a", Target: "fn:b", Kind: "calls"}, {ID: "b-a", Source: "fn:b", Target: "fn:a", Kind: "calls"}}}
	landscape := Calculate("repo", 1, snapshot, &history.Result{}, 90, time.Now())
	for _, unit := range landscape.Units {
		cycle := unit.ChangeComplexity.Factors[4]
		if cycle.RawValue != 1 {
			t.Fatalf("package %s was not marked cyclic: %#v", unit.Unit.ID, cycle)
		}
	}
}
