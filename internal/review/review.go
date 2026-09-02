package review

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	contractdiff "github.com/and1truong/aegir/internal/contracts"
)

type Summary struct {
	AddedNodes         int `json:"addedNodes"`
	RemovedNodes       int `json:"removedNodes"`
	ModifiedNodes      int `json:"modifiedNodes"`
	AddedEdges         int `json:"addedEdges"`
	RemovedEdges       int `json:"removedEdges"`
	NewViolations      int `json:"newViolations"`
	ResolvedViolations int `json:"resolvedViolations"`
}

type Review struct {
	ID                 string               `json:"id"`
	RepositoryID       string               `json:"repositoryId"`
	BaseRef            string               `json:"baseRef"`
	HeadRef            string               `json:"headRef"`
	BaseSnapshotID     int64                `json:"baseSnapshotId"`
	HeadSnapshotID     int64                `json:"headSnapshotId"`
	CreatedAt          string               `json:"createdAt"`
	Summary            Summary              `json:"summary"`
	Nodes              []analyzer.Node      `json:"nodes"`
	Edges              []analyzer.Edge      `json:"edges"`
	NewViolations      []analyzer.Violation `json:"newViolations"`
	ResolvedViolations []analyzer.Violation `json:"resolvedViolations"`
	ContractDiff       contractdiff.Diff    `json:"contractDiff"`
}

func Compare(repositoryID, baseRef, headRef string, baseID, headID int64, base, head analyzer.Snapshot) Review {
	baseNodes, headNodes := nodeMap(base.Nodes), nodeMap(head.Nodes)
	baseEdges, headEdges := edgeMap(base.Edges), edgeMap(head.Edges)
	changed := map[string]bool{}
	result := Review{RepositoryID: repositoryID, BaseRef: baseRef, HeadRef: headRef, BaseSnapshotID: baseID, HeadSnapshotID: headID, CreatedAt: time.Now().UTC().Format(time.RFC3339), Nodes: []analyzer.Node{}, Edges: []analyzer.Edge{}, NewViolations: []analyzer.Violation{}, ResolvedViolations: []analyzer.Violation{}}
	for id, node := range headNodes {
		before, exists := baseNodes[id]
		if !exists {
			node.Change = "added"
			headNodes[id] = node
			changed[id] = true
			result.Summary.AddedNodes++
		} else if nodeFingerprint(before) != nodeFingerprint(node) {
			node.Change = "modified"
			headNodes[id] = node
			changed[id] = true
			result.Summary.ModifiedNodes++
		}
	}
	for id, node := range baseNodes {
		if _, exists := headNodes[id]; !exists {
			node.Change = "removed"
			baseNodes[id] = node
			changed[id] = true
			result.Summary.RemovedNodes++
		}
	}
	for id, edge := range headEdges {
		if _, exists := baseEdges[id]; !exists {
			edge.Change = "added"
			headEdges[id] = edge
			changed[edge.Source] = true
			changed[edge.Target] = true
			result.Summary.AddedEdges++
		}
	}
	for id, edge := range baseEdges {
		if _, exists := headEdges[id]; !exists {
			edge.Change = "removed"
			baseEdges[id] = edge
			changed[edge.Source] = true
			changed[edge.Target] = true
			result.Summary.RemovedEdges++
		}
	}
	visible := map[string]bool{}
	for id := range changed {
		visible[id] = true
	}
	for _, edges := range [][]analyzer.Edge{base.Edges, head.Edges} {
		for _, edge := range edges {
			if changed[edge.Source] || changed[edge.Target] {
				visible[edge.Source] = true
				visible[edge.Target] = true
			}
		}
	}
	for id := range visible {
		if node, ok := headNodes[id]; ok {
			result.Nodes = append(result.Nodes, node)
		} else if node, ok := baseNodes[id]; ok {
			result.Nodes = append(result.Nodes, node)
		}
	}
	for _, edge := range headEdges {
		if visible[edge.Source] && visible[edge.Target] {
			result.Edges = append(result.Edges, edge)
		}
	}
	for id, edge := range baseEdges {
		if _, exists := headEdges[id]; !exists && visible[edge.Source] && visible[edge.Target] {
			result.Edges = append(result.Edges, edge)
		}
	}
	baseViolations := violationMap(base.Analysis.Violations)
	headViolations := violationMap(head.Analysis.Violations)
	for id, violation := range headViolations {
		if _, exists := baseViolations[id]; !exists {
			violation.Status = "new"
			result.NewViolations = append(result.NewViolations, violation)
		}
	}
	for id, violation := range baseViolations {
		if _, exists := headViolations[id]; !exists {
			violation.Status = "resolved"
			result.ResolvedViolations = append(result.ResolvedViolations, violation)
		}
	}
	result.Summary.NewViolations = len(result.NewViolations)
	result.Summary.ResolvedViolations = len(result.ResolvedViolations)
	result.ContractDiff = contractdiff.Compare(baseID, headID, base.Analysis.Contracts, head.Analysis.Contracts)
	sort.Slice(result.Nodes, func(i, j int) bool { return result.Nodes[i].ID < result.Nodes[j].ID })
	sort.Slice(result.Edges, func(i, j int) bool { return result.Edges[i].ID < result.Edges[j].ID })
	sum := sha256.Sum256([]byte(repositoryID + "\x00" + snapshotFingerprint(base) + "\x00" + snapshotFingerprint(head)))
	result.ID = hex.EncodeToString(sum[:12])
	return result
}

func snapshotFingerprint(snapshot analyzer.Snapshot) string {
	nodes := append([]analyzer.Node(nil), snapshot.Nodes...)
	edges := append([]analyzer.Edge(nil), snapshot.Edges...)
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	hash := sha256.New()
	for _, node := range nodes {
		hash.Write([]byte(node.ID))
		hash.Write([]byte{0})
		hash.Write([]byte(nodeFingerprint(node)))
		hash.Write([]byte{0})
	}
	for _, edge := range edges {
		hash.Write([]byte(edge.ID))
		hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func nodeMap(values []analyzer.Node) map[string]analyzer.Node {
	out := map[string]analyzer.Node{}
	for _, value := range values {
		out[value.ID] = value
	}
	return out
}
func edgeMap(values []analyzer.Edge) map[string]analyzer.Edge {
	out := map[string]analyzer.Edge{}
	for _, value := range values {
		out[value.ID] = value
	}
	return out
}
func violationMap(values []analyzer.Violation) map[string]analyzer.Violation {
	out := map[string]analyzer.Violation{}
	for _, value := range values {
		out[value.ID] = value
	}
	return out
}
func nodeFingerprint(node analyzer.Node) string {
	if node.Meta == nil {
		return ""
	}
	value, _ := node.Meta["fingerprint"].(string)
	return value
}
