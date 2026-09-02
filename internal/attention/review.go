package attention

import (
	"fmt"
	"sort"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/review"
)

type reviewCounts struct {
	statuses map[string]bool
	nodes    map[string]bool
	edges    map[string]bool
}

func ForReview(base, head Landscape, baseSnapshot, headSnapshot analyzer.Snapshot, value review.Review) ReviewAttention {
	baseUnits := nodeUnits(baseSnapshot)
	headUnits := nodeUnits(headSnapshot)
	counts := map[string]*reviewCounts{}
	touch := func(unit, status, nodeID, edgeID string) {
		if unit == "" {
			return
		}
		if counts[unit] == nil {
			counts[unit] = &reviewCounts{statuses: map[string]bool{}, nodes: map[string]bool{}, edges: map[string]bool{}}
		}
		if status != "" {
			counts[unit].statuses[status] = true
		}
		if nodeID != "" {
			counts[unit].nodes[nodeID] = true
		}
		if edgeID != "" {
			counts[unit].edges[edgeID] = true
		}
	}
	for _, delta := range value.Delta.Nodes {
		unit := headUnits[delta.ID]
		if unit == "" {
			unit = baseUnits[delta.ID]
		}
		touch(unit, delta.Status, delta.ID, "")
	}
	for _, delta := range value.Delta.Edges {
		edge := delta.After
		units := headUnits
		if edge == nil {
			edge = delta.Before
			units = baseUnits
		}
		if edge == nil {
			continue
		}
		touch(units[edge.Source], delta.Status, edge.Source, delta.ID)
		touch(units[edge.Target], delta.Status, edge.Target, delta.ID)
	}

	byID := map[string]Unit{}
	for _, unit := range base.Units {
		byID[unit.Unit.ID] = unit
	}
	for _, unit := range head.Units {
		byID[unit.Unit.ID] = unit
	}
	result := ReviewAttention{Version: 1, ReviewID: value.ID, Baseline: head, Units: []ReviewUnit{}, NewNodes: value.Summary.AddedNodes, NewRelationships: value.Summary.AddedEdges}
	for id, unit := range byID {
		item := ReviewUnit{Unit: unit, ChangeStatuses: []string{}, ReviewPriority: unit.Priority}
		if changed := counts[id]; changed != nil {
			item.Touched = true
			item.ChangedNodes = len(changed.nodes)
			item.ChangedRelationships = len(changed.edges)
			for status := range changed.statuses {
				item.ChangeStatuses = append(item.ChangeStatuses, status)
			}
			focalNodes := make([]string, 0, len(changed.nodes))
			for nodeID := range changed.nodes {
				focalNodes = append(focalNodes, nodeID)
			}
			sort.Strings(focalNodes)
			item.FocalNodeID = focalNodes[0]
			sort.Strings(item.ChangeStatuses)
			item.ReviewPriority = min(100, unit.Priority+min(20, item.ChangedNodes*2+item.ChangedRelationships*3))
			result.TouchedUnits++
			if unit.Region == "investigate" {
				result.HighAttentionUnits++
			}
		}
		result.Units = append(result.Units, item)
	}
	sort.Slice(result.Units, func(i, j int) bool {
		if result.Units[i].Touched != result.Units[j].Touched {
			return result.Units[i].Touched
		}
		if result.Units[i].ReviewPriority != result.Units[j].ReviewPriority {
			return result.Units[i].ReviewPriority > result.Units[j].ReviewPriority
		}
		return result.Units[i].Unit.Unit.ID < result.Units[j].Unit.Unit.ID
	})
	result.Summary = fmt.Sprintf("This change touches %d package%s; %d %s in the investigate / stabilize region.", result.TouchedUnits, plural(result.TouchedUnits), result.HighAttentionUnits, isAre(result.HighAttentionUnits))
	return result
}

func nodeUnits(snapshot analyzer.Snapshot) map[string]string {
	packages := map[string]bool{}
	for _, node := range snapshot.Nodes {
		if node.Kind == "package" {
			packages[node.ID] = true
		}
	}
	result := map[string]string{}
	for _, node := range snapshot.Nodes {
		unit := node.Package
		if node.Kind == "package" {
			unit = node.ID
		}
		if packages[unit] {
			result[node.ID] = unit
		}
	}
	return result
}

func plural(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func isAre(count int) string {
	if count == 1 {
		return "is"
	}
	return "are"
}
