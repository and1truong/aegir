package analyzer

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type telemetryInput struct {
	NodeID    string   `json:"nodeId"`
	Label     string   `json:"label"`
	File      string   `json:"file"`
	RPM       *float64 `json:"rpm"`
	QPS       *float64 `json:"qps"`
	P50       float64  `json:"p50"`
	P95       float64  `json:"p95"`
	P99       float64  `json:"p99"`
	ErrorRate float64  `json:"errorRate"`
	Window    string   `json:"window"`
	Source    string   `json:"source"`
	Note      string   `json:"note"`
}

func applyTelemetryFile(root, telemetryPath string, nodes map[string]Node, analysis *Analysis) error {
	if !filepath.IsAbs(telemetryPath) {
		telemetryPath = filepath.Join(root, telemetryPath)
	}
	contents, err := os.ReadFile(telemetryPath)
	if err != nil {
		return fmt.Errorf("open telemetry file: %w", err)
	}
	var inputs []telemetryInput
	if err := json.Unmarshal(contents, &inputs); err != nil {
		return fmt.Errorf("parse telemetry file: expected a JSON array: %w", err)
	}
	telemetry := make([]Telemetry, 0, len(inputs))
	for index, input := range inputs {
		nodeID, err := resolveTelemetryNode(input, nodes)
		if err != nil {
			return fmt.Errorf("telemetry item %d: %w", index+1, err)
		}
		if strings.TrimSpace(input.Source) == "" || strings.TrimSpace(input.Window) == "" {
			return fmt.Errorf("telemetry item %d: source and window are required", index+1)
		}
		if input.RPM == nil && input.QPS == nil && input.P50 == 0 && input.P95 == 0 && input.P99 == 0 && input.ErrorRate == 0 {
			return fmt.Errorf("telemetry item %d: at least one metric is required", index+1)
		}
		telemetry = append(telemetry, Telemetry{NodeID: nodeID, RPM: metricValue(input.RPM), QPS: metricValue(input.QPS), TrafficObserved: input.RPM != nil || input.QPS != nil, P50: input.P50, P95: input.P95, P99: input.P99, ErrorRate: input.ErrorRate, Window: input.Window, Source: input.Source, Note: input.Note})
	}
	sort.Slice(telemetry, func(i, j int) bool { return telemetry[i].NodeID < telemetry[j].NodeID })
	analysis.Telemetry = telemetry
	return nil
}

func metricValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func resolveTelemetryNode(input telemetryInput, nodes map[string]Node) (string, error) {
	if input.NodeID != "" {
		if _, exists := nodes[input.NodeID]; !exists {
			return "", fmt.Errorf("nodeId %q does not exist in the indexed graph", input.NodeID)
		}
		return input.NodeID, nil
	}
	if input.Label == "" {
		return "", errors.New("nodeId or label is required")
	}
	matches := []string{}
	for id, node := range nodes {
		if node.Label != input.Label {
			continue
		}
		if input.File != "" {
			file := node.File
			if split := strings.LastIndex(file, ":"); split >= 0 {
				file = file[:split]
			}
			if filepath.ToSlash(file) != filepath.ToSlash(input.File) {
				continue
			}
		}
		matches = append(matches, id)
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no node matches label %q", input.Label)
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("label %q is ambiguous; add file or nodeId", input.Label)
	}
	return matches[0], nil
}
