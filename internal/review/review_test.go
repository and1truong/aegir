package review

import (
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
