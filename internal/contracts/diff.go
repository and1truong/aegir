package contracts

import (
	"sort"
	"strings"

	"github.com/and1truong/aegir/internal/analyzer"
)

type FieldChange struct {
	Kind   string `json:"kind"`
	Path   string `json:"path"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
	Compat string `json:"compat"`
	Note   string `json:"note"`
}

type Change struct {
	ContractID    string        `json:"contractId"`
	Name          string        `json:"name"`
	Type          string        `json:"type"`
	Status        string        `json:"status"`
	Compatibility string        `json:"compatibility"`
	Fields        []FieldChange `json:"fields"`
}

type Diff struct {
	BaseSnapshotID int64    `json:"baseSnapshotId"`
	HeadSnapshotID int64    `json:"headSnapshotId"`
	Changes        []Change `json:"changes"`
}

func Compare(baseID, headID int64, base, head []analyzer.Contract) Diff {
	result := Diff{BaseSnapshotID: baseID, HeadSnapshotID: headID, Changes: []Change{}}
	baseByPath, headByPath := map[string]analyzer.Contract{}, map[string]analyzer.Contract{}
	for _, contract := range base {
		baseByPath[contract.Path] = contract
	}
	for _, contract := range head {
		headByPath[contract.Path] = contract
	}
	paths := map[string]bool{}
	for path := range baseByPath {
		paths[path] = true
	}
	for path := range headByPath {
		paths[path] = true
	}
	ordered := make([]string, 0, len(paths))
	for path := range paths {
		ordered = append(ordered, path)
	}
	sort.Strings(ordered)
	for _, path := range ordered {
		before, beforeOK := baseByPath[path]
		after, afterOK := headByPath[path]
		switch {
		case !beforeOK:
			result.Changes = append(result.Changes, Change{ContractID: after.ID, Name: after.Name, Type: after.Type, Status: "added", Compatibility: "safe", Fields: []FieldChange{}})
		case !afterOK:
			result.Changes = append(result.Changes, Change{ContractID: before.ID, Name: before.Name, Type: before.Type, Status: "removed", Compatibility: "break", Fields: []FieldChange{}})
		case before.Fingerprint != after.Fingerprint:
			fields := compareShape(before.Shape, after.Shape)
			compatibility := "safe"
			for _, field := range fields {
				compatibility = worst(compatibility, field.Compat)
			}
			result.Changes = append(result.Changes, Change{ContractID: after.ID, Name: after.Name, Type: after.Type, Status: "modified", Compatibility: compatibility, Fields: fields})
		}
	}
	return result
}

func compareShape(before, after map[string]string) []FieldChange {
	keys := map[string]bool{}
	for key := range before {
		keys[key] = true
	}
	for key := range after {
		keys[key] = true
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	out := []FieldChange{}
	for _, path := range ordered {
		old, oldOK := before[path]
		next, nextOK := after[path]
		if oldOK && nextOK && old == next {
			continue
		}
		change := FieldChange{Path: path, Before: old, After: next}
		switch {
		case !oldOK:
			change.Kind = "added"
			change.Compat, change.Note = addedCompatibility(path)
		case !nextOK:
			change.Kind = "removed"
			change.Compat, change.Note = removedCompatibility(path)
		default:
			change.Kind = "changed"
			change.Compat, change.Note = changedCompatibility(path)
		}
		out = append(out, change)
	}
	return out
}

func documentation(path string) bool {
	return strings.Contains(path, "/description") || strings.Contains(path, "/summary") || strings.Contains(path, "/example") || strings.Contains(path, "/title")
}
func addedCompatibility(path string) (string, string) {
	if strings.Contains(path, "/required/") {
		return "break", "A newly required field can reject existing payloads."
	}
	if strings.Contains(path, "/enum/") {
		return "potential", "A new enum value can break exhaustive consumers."
	}
	return "safe", "Additive contract element."
}
func removedCompatibility(path string) (string, string) {
	if documentation(path) {
		return "safe", "Documentation-only element removed."
	}
	return "break", "Existing producers or consumers may rely on the removed element."
}
func changedCompatibility(path string) (string, string) {
	if documentation(path) {
		return "safe", "Documentation-only value changed."
	}
	if strings.Contains(path, "/type") || strings.Contains(path, "/required") || strings.Contains(path, "/enum/") {
		return "break", "Constraint or value-domain change."
	}
	return "potential", "Behavioral contract value changed; consumer verification required."
}
func worst(left, right string) string {
	rank := map[string]int{"safe": 0, "conditional": 1, "potential": 2, "break": 3}
	if rank[right] > rank[left] {
		return right
	}
	return left
}
