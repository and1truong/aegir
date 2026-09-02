package attention

import (
	"testing"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/review"
)

func TestForReviewRanksTouchedPackagesAgainstBaseline(t *testing.T) {
	pkgA := analyzer.Node{ID: "pkg:a", Kind: "package", Label: "a"}
	pkgB := analyzer.Node{ID: "pkg:b", Kind: "package", Label: "b"}
	fnA := analyzer.Node{ID: "fn:a", Kind: "function", Package: pkgA.ID}
	fnB := analyzer.Node{ID: "fn:b", Kind: "function", Package: pkgB.ID}
	baseSnapshot := analyzer.Snapshot{Nodes: []analyzer.Node{pkgA, pkgB, fnA, fnB}}
	headSnapshot := baseSnapshot
	base := Landscape{Units: []Unit{{Unit: UnitRef{ID: pkgA.ID}, Priority: 70, Region: "investigate"}, {Unit: UnitRef{ID: pkgB.ID}, Priority: 20, Region: "low-attention"}}}
	head := base
	change := review.Review{ID: "review:1", Summary: review.Summary{AddedNodes: 1, AddedEdges: 1}, Delta: review.GraphDelta{
		Nodes: []review.NodeDelta{{ID: fnA.ID, Status: "modified", After: &fnA}},
		Edges: []review.EdgeDelta{{ID: "a-b", Status: "added", After: &analyzer.Edge{ID: "a-b", Source: fnA.ID, Target: fnB.ID}}},
	}}
	result := ForReview(base, head, baseSnapshot, headSnapshot, change)
	if result.TouchedUnits != 2 || result.HighAttentionUnits != 1 || result.NewNodes != 1 || result.NewRelationships != 1 {
		t.Fatalf("unexpected review attention summary: %#v", result)
	}
	if !result.Units[0].Touched || result.Units[0].Unit.Unit.ID != pkgA.ID || result.Units[0].FocalNodeID == "" {
		t.Fatalf("expected highest-risk touched package first: %#v", result.Units)
	}
}
