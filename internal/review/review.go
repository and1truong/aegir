package review

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
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

const PayloadVersion = 2

type ChangeReason struct {
	Kind         string   `json:"kind"`
	Detail       string   `json:"detail"`
	EvidenceRefs []string `json:"evidenceRefs,omitempty"`
}

type NodeDelta struct {
	ID            string         `json:"id"`
	Status        string         `json:"status"`
	Before        *analyzer.Node `json:"before,omitempty"`
	After         *analyzer.Node `json:"after,omitempty"`
	ChangeReasons []ChangeReason `json:"changeReasons"`
}

type EdgeDelta struct {
	ID            string         `json:"id"`
	Status        string         `json:"status"`
	Before        *analyzer.Edge `json:"before,omitempty"`
	After         *analyzer.Edge `json:"after,omitempty"`
	ChangeReasons []ChangeReason `json:"changeReasons"`
}

type GraphDelta struct {
	Nodes []NodeDelta `json:"nodes"`
	Edges []EdgeDelta `json:"edges"`
}

type Review struct {
	PayloadVersion     int                       `json:"payloadVersion"`
	ID                 string                    `json:"id"`
	RepositoryID       string                    `json:"repositoryId"`
	BaseRef            string                    `json:"baseRef"`
	HeadRef            string                    `json:"headRef"`
	BaseSnapshotID     int64                     `json:"baseSnapshotId"`
	HeadSnapshotID     int64                     `json:"headSnapshotId"`
	CreatedAt          string                    `json:"createdAt"`
	Summary            Summary                   `json:"summary"`
	Nodes              []analyzer.Node           `json:"nodes"`
	Edges              []analyzer.Edge           `json:"edges"`
	Evidence           []analyzer.EvidenceRecord `json:"evidence"`
	NewViolations      []analyzer.Violation      `json:"newViolations"`
	ResolvedViolations []analyzer.Violation      `json:"resolvedViolations"`
	ContractDiff       contractdiff.Diff         `json:"contractDiff"`
	Delta              GraphDelta                `json:"delta"`
}

func Compare(repositoryID, baseRef, headRef string, baseID, headID int64, base, head analyzer.Snapshot) Review {
	baseNodes, headNodes := nodeMap(base.Nodes), nodeMap(head.Nodes)
	baseEdges, headEdges := edgeMap(base.Edges), edgeMap(head.Edges)
	changed := map[string]bool{}
	result := Review{PayloadVersion: PayloadVersion, RepositoryID: repositoryID, BaseRef: baseRef, HeadRef: headRef, BaseSnapshotID: baseID, HeadSnapshotID: headID, CreatedAt: time.Now().UTC().Format(time.RFC3339), Nodes: []analyzer.Node{}, Edges: []analyzer.Edge{}, Evidence: []analyzer.EvidenceRecord{}, NewViolations: []analyzer.Violation{}, ResolvedViolations: []analyzer.Violation{}, Delta: GraphDelta{Nodes: []NodeDelta{}, Edges: []EdgeDelta{}}}
	for id, node := range headNodes {
		before, exists := baseNodes[id]
		if !exists {
			node.Change = "added"
			headNodes[id] = node
			changed[id] = true
			result.Summary.AddedNodes++
			after := node
			result.Delta.Nodes = append(result.Delta.Nodes, NodeDelta{ID: id, Status: "added", After: &after, ChangeReasons: []ChangeReason{{Kind: "entity-added", Detail: "Node exists only in the head graph."}}})
		} else if nodeFingerprint(before) != nodeFingerprint(node) {
			node.Change = "modified"
			headNodes[id] = node
			changed[id] = true
			result.Summary.ModifiedNodes++
			beforeCopy, afterCopy := before, node
			result.Delta.Nodes = append(result.Delta.Nodes, NodeDelta{ID: id, Status: "modified", Before: &beforeCopy, After: &afterCopy, ChangeReasons: nodeChangeReasons(before, node)})
		}
	}
	for id, node := range baseNodes {
		if _, exists := headNodes[id]; !exists {
			node.Change = "removed"
			baseNodes[id] = node
			changed[id] = true
			result.Summary.RemovedNodes++
			before := node
			result.Delta.Nodes = append(result.Delta.Nodes, NodeDelta{ID: id, Status: "removed", Before: &before, ChangeReasons: []ChangeReason{{Kind: "entity-removed", Detail: "Node exists only in the base graph."}}})
		}
	}
	for id, edge := range headEdges {
		before, exists := baseEdges[id]
		if !exists {
			edge.Change = "added"
			headEdges[id] = edge
			changed[edge.Source] = true
			changed[edge.Target] = true
			result.Summary.AddedEdges++
			after := edge
			result.Delta.Edges = append(result.Delta.Edges, EdgeDelta{ID: id, Status: "added", After: &after, ChangeReasons: []ChangeReason{{Kind: "dependency-added", Detail: "Relationship exists only in the head graph.", EvidenceRefs: append([]string(nil), edge.EvidenceRefs...)}}})
		} else if edgeFingerprint(before) != edgeFingerprint(edge) {
			edge.Change = "modified"
			headEdges[id] = edge
			changed[edge.Source] = true
			changed[edge.Target] = true
			beforeCopy, afterCopy := before, edge
			result.Delta.Edges = append(result.Delta.Edges, EdgeDelta{ID: id, Status: "modified", Before: &beforeCopy, After: &afterCopy, ChangeReasons: edgeChangeReasons(before, edge)})
		}
	}
	for id, edge := range baseEdges {
		if _, exists := headEdges[id]; !exists {
			edge.Change = "removed"
			baseEdges[id] = edge
			changed[edge.Source] = true
			changed[edge.Target] = true
			result.Summary.RemovedEdges++
			before := edge
			result.Delta.Edges = append(result.Delta.Edges, EdgeDelta{ID: id, Status: "removed", Before: &before, ChangeReasons: []ChangeReason{{Kind: "dependency-removed", Detail: "Relationship exists only in the base graph.", EvidenceRefs: append([]string(nil), edge.EvidenceRefs...)}}})
		}
	}
	baseViolations := violationMap(base.Analysis.Violations)
	headViolations := violationMap(head.Analysis.Violations)
	for id, violation := range headViolations {
		if _, exists := baseViolations[id]; !exists {
			violation.Status = "new"
			result.NewViolations = append(result.NewViolations, violation)
			changed[violation.PrimaryNode] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, violation.PrimaryNode, ChangeReason{Kind: "architecture-violation", Detail: violation.Title})
		}
	}
	for id, violation := range baseViolations {
		if _, exists := headViolations[id]; !exists {
			violation.Status = "resolved"
			result.ResolvedViolations = append(result.ResolvedViolations, violation)
			changed[violation.PrimaryNode] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, violation.PrimaryNode, ChangeReason{Kind: "architecture-violation-resolved", Detail: violation.Title})
		}
	}
	result.Summary.NewViolations = len(result.NewViolations)
	result.Summary.ResolvedViolations = len(result.ResolvedViolations)
	result.ContractDiff = contractdiff.Compare(baseID, headID, base.Analysis.Contracts, head.Analysis.Contracts)
	baseContracts, headContracts := contractMap(base.Analysis.Contracts), contractMap(head.Analysis.Contracts)
	for _, change := range result.ContractDiff.Changes {
		contract, exists := headContracts[change.ContractID]
		if !exists {
			contract = baseContracts[change.ContractID]
		}
		if contract.Node != "" {
			changed[contract.Node] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, contract.Node, ChangeReason{Kind: "contract-changed", Detail: change.Name + " is " + change.Status + "."})
		}
	}
	baseTelemetry, headTelemetry := telemetryMap(base.Analysis.Telemetry), telemetryMap(head.Analysis.Telemetry)
	for id, after := range headTelemetry {
		if before, exists := baseTelemetry[id]; !exists || !reflect.DeepEqual(before, after) {
			changed[id] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, id, ChangeReason{Kind: "runtime-changed", Detail: "Runtime measurements or observation metadata changed."})
		}
	}
	for id := range baseTelemetry {
		if _, exists := headTelemetry[id]; !exists {
			changed[id] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, id, ChangeReason{Kind: "runtime-changed", Detail: "Runtime measurements are no longer present in the head snapshot."})
		}
	}
	baseComplexity, headComplexity := complexityMap(base.Analysis.Complexity), complexityMap(head.Analysis.Complexity)
	for id, after := range headComplexity {
		if before, exists := baseComplexity[id]; exists && !reflect.DeepEqual(before, after) {
			changed[id] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, id, ChangeReason{Kind: "complexity-changed", Detail: fmt.Sprintf("Complexity score %d → %d; cyclomatic %d → %d.", before.Score, after.Score, before.Cyclomatic, after.Cyclomatic)})
		}
	}
	baseCoverage, headCoverage := coverageMap(base.Analysis.Coverage), coverageMap(head.Analysis.Coverage)
	for id, after := range headCoverage {
		before, exists := baseCoverage[id]
		if exists && (before.Status != after.Status || before.Line != after.Line || !reflect.DeepEqual(before.Tests, after.Tests)) {
			changed[id] = true
			addNodeDeltaReason(&result, baseNodes, headNodes, id, ChangeReason{Kind: "test-protection-changed", Detail: fmt.Sprintf("Test protection %s (%d tests) → %s (%d tests).", before.Status, len(before.Tests), after.Status, len(after.Tests))})
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
	evidenceByID := map[string]analyzer.EvidenceRecord{}
	for _, records := range [][]analyzer.EvidenceRecord{base.Evidence, head.Evidence} {
		for _, record := range records {
			evidenceByID[record.ID] = record
		}
	}
	usedEvidence := map[string]bool{}
	for _, edge := range result.Edges {
		for _, evidenceID := range edge.EvidenceRefs {
			if record, ok := evidenceByID[evidenceID]; ok && !usedEvidence[evidenceID] {
				result.Evidence = append(result.Evidence, record)
				usedEvidence[evidenceID] = true
			}
		}
	}
	sort.Slice(result.Nodes, func(i, j int) bool { return result.Nodes[i].ID < result.Nodes[j].ID })
	sort.Slice(result.Edges, func(i, j int) bool { return result.Edges[i].ID < result.Edges[j].ID })
	sort.Slice(result.Evidence, func(i, j int) bool { return result.Evidence[i].ID < result.Evidence[j].ID })
	sort.Slice(result.Delta.Nodes, func(i, j int) bool { return result.Delta.Nodes[i].ID < result.Delta.Nodes[j].ID })
	sort.Slice(result.Delta.Edges, func(i, j int) bool { return result.Delta.Edges[i].ID < result.Delta.Edges[j].ID })
	sum := sha256.Sum256([]byte(repositoryID + "\x00" + snapshotFingerprint(base) + "\x00" + snapshotFingerprint(head)))
	result.ID = hex.EncodeToString(sum[:12])
	return result
}

func addNodeDeltaReason(result *Review, baseNodes, headNodes map[string]analyzer.Node, id string, reason ChangeReason) {
	if id == "" {
		return
	}
	for index := range result.Delta.Nodes {
		if result.Delta.Nodes[index].ID == id {
			result.Delta.Nodes[index].ChangeReasons = append(result.Delta.Nodes[index].ChangeReasons, reason)
			return
		}
	}
	before, hasBefore := baseNodes[id]
	after, hasAfter := headNodes[id]
	if !hasBefore && !hasAfter {
		return
	}
	entry := NodeDelta{ID: id, Status: "modified", ChangeReasons: []ChangeReason{reason}}
	if hasBefore {
		beforeCopy := before
		entry.Before = &beforeCopy
	}
	if hasAfter {
		after.Change = "modified"
		headNodes[id] = after
		afterCopy := after
		entry.After = &afterCopy
	}
	result.Delta.Nodes = append(result.Delta.Nodes, entry)
}

func nodeChangeReasons(before, after analyzer.Node) []ChangeReason {
	reasons := []ChangeReason{}
	if before.Kind != after.Kind || before.Label != after.Label || before.File != after.File || before.Description != after.Description {
		reasons = append(reasons, ChangeReason{Kind: "field-changed", Detail: "Canonical node fields changed."})
	}
	if before.Service != after.Service || before.Package != after.Package {
		reasons = append(reasons, ChangeReason{Kind: "ownership-changed", Detail: "Service or package membership changed."})
	}
	if strings.Join(before.Tags, "\x00") != strings.Join(after.Tags, "\x00") {
		reasons = append(reasons, ChangeReason{Kind: "classification-changed", Detail: "Node tags changed."})
	}
	if len(reasons) == 0 {
		reasons = append(reasons, ChangeReason{Kind: "implementation-changed", Detail: "The indexed implementation fingerprint changed."})
	}
	return reasons
}

func edgeChangeReasons(before, after analyzer.Edge) []ChangeReason {
	reasons := []ChangeReason{}
	if before.Kind != after.Kind || before.Source != after.Source || before.Target != after.Target || before.Label != after.Label || before.Boundary != after.Boundary || before.Synchronous != after.Synchronous {
		reasons = append(reasons, ChangeReason{Kind: "relationship-changed", Detail: "Relationship semantics changed."})
	}
	if strings.Join(before.EvidenceRefs, "\x00") != strings.Join(after.EvidenceRefs, "\x00") {
		reasons = append(reasons, ChangeReason{Kind: "evidence-changed", Detail: "Relationship evidence changed.", EvidenceRefs: append([]string(nil), after.EvidenceRefs...)})
	}
	return reasons
}

func complexityMap(values []analyzer.Complexity) map[string]analyzer.Complexity {
	result := map[string]analyzer.Complexity{}
	for _, value := range values {
		result[value.NodeID] = value
	}
	return result
}

func coverageMap(values []analyzer.Coverage) map[string]analyzer.Coverage {
	result := map[string]analyzer.Coverage{}
	for _, value := range values {
		result[value.NodeID] = value
	}
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
		hash.Write([]byte(edge.Kind + "\x00" + edge.Label + "\x00" + strings.Join(edge.EvidenceRefs, "\x00")))
		hash.Write([]byte{0})
	}
	analysis, _ := json.Marshal(snapshot.Analysis)
	evidence, _ := json.Marshal(snapshot.Evidence)
	hash.Write(analysis)
	hash.Write([]byte{0})
	hash.Write(evidence)
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
func contractMap(values []analyzer.Contract) map[string]analyzer.Contract {
	out := map[string]analyzer.Contract{}
	for _, value := range values {
		out[value.ID] = value
	}
	return out
}
func telemetryMap(values []analyzer.Telemetry) map[string]analyzer.Telemetry {
	out := map[string]analyzer.Telemetry{}
	for _, value := range values {
		out[value.NodeID] = value
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

func edgeFingerprint(edge analyzer.Edge) string {
	synchronous := "false"
	if edge.Synchronous {
		synchronous = "true"
	}
	return strings.Join([]string{edge.Source, edge.Target, edge.Kind, edge.Label, edge.Boundary, synchronous, strings.Join(edge.EvidenceRefs, "\x00")}, "\x01")
}

// UpgradeLegacy reconstructs typed delta entries for persisted v1 review payloads.
func UpgradeLegacy(value *Review) {
	if value.PayloadVersion >= PayloadVersion {
		return
	}
	value.PayloadVersion = PayloadVersion
	value.Delta = GraphDelta{Nodes: []NodeDelta{}, Edges: []EdgeDelta{}}
	for _, node := range value.Nodes {
		switch node.Change {
		case "added":
			after := node
			value.Delta.Nodes = append(value.Delta.Nodes, NodeDelta{ID: node.ID, Status: "added", After: &after, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Recovered from a persisted v1 review."}}})
		case "removed":
			before := node
			value.Delta.Nodes = append(value.Delta.Nodes, NodeDelta{ID: node.ID, Status: "removed", Before: &before, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Recovered from a persisted v1 review."}}})
		case "modified":
			after := node
			value.Delta.Nodes = append(value.Delta.Nodes, NodeDelta{ID: node.ID, Status: "modified", After: &after, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Persisted v1 review did not retain the before body."}}})
		}
	}
	for _, edge := range value.Edges {
		switch edge.Change {
		case "added":
			after := edge
			value.Delta.Edges = append(value.Delta.Edges, EdgeDelta{ID: edge.ID, Status: "added", After: &after, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Recovered from a persisted v1 review."}}})
		case "removed":
			before := edge
			value.Delta.Edges = append(value.Delta.Edges, EdgeDelta{ID: edge.ID, Status: "removed", Before: &before, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Recovered from a persisted v1 review."}}})
		case "modified":
			after := edge
			value.Delta.Edges = append(value.Delta.Edges, EdgeDelta{ID: edge.ID, Status: "modified", After: &after, ChangeReasons: []ChangeReason{{Kind: "legacy-change", Detail: "Persisted v1 review did not retain the before body."}}})
		}
	}
}
