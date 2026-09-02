package attention

import (
	"fmt"
	"testing"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/history"
)

func BenchmarkCalculateThousandPackages(b *testing.B) {
	nodes := make([]analyzer.Node, 0, 2000)
	edges := make([]analyzer.Edge, 0, 999)
	for index := 0; index < 1000; index++ {
		packageID := fmt.Sprintf("package:%04d", index)
		functionID := fmt.Sprintf("function:%04d", index)
		nodes = append(nodes, analyzer.Node{ID: packageID, Kind: "package", Label: packageID}, analyzer.Node{ID: functionID, Kind: "function", Package: packageID, File: fmt.Sprintf("pkg/%04d/code.go:1", index)})
		if index > 0 {
			edges = append(edges, analyzer.Edge{ID: fmt.Sprintf("edge:%04d", index), Source: functionID, Target: fmt.Sprintf("function:%04d", index-1), Kind: "calls"})
		}
	}
	snapshot := analyzer.Snapshot{Nodes: nodes, Edges: edges}
	changes := history.Result{}
	now := time.Now()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		Calculate("repository", 1, snapshot, &changes, 90, now)
	}
}
