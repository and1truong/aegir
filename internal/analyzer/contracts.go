package analyzer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

func readContract(path, relativePath, contractType string) (Contract, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Contract{}, err
	}
	var document any
	switch {
	case strings.HasSuffix(strings.ToLower(path), ".json"):
		if err := json.Unmarshal(content, &document); err != nil {
			return Contract{}, err
		}
	case strings.HasSuffix(strings.ToLower(path), ".proto"):
		document = normalizedProto(string(content))
	default:
		if err := yaml.Unmarshal(content, &document); err != nil {
			return Contract{}, err
		}
	}
	shape := map[string]string{}
	flattenContract("", document, shape)
	keys := make([]string, 0, len(shape))
	for key := range shape {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	hash := sha256.New()
	for _, key := range keys {
		fmt.Fprintf(hash, "%s=%s\n", key, shape[key])
	}
	id := stableID("contract", relativePath)
	return Contract{ID: id, Name: relativePath, Type: contractType, Node: id, Path: relativePath, Fingerprint: hex.EncodeToString(hash.Sum(nil)), Shape: shape, Versions: []any{}}, nil
}

func flattenContract(path string, value any, out map[string]string) {
	if path == "" {
		path = "/"
	}
	switch current := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(current))
		for key := range current {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			flattenContract(joinPointer(path, key), current[key], out)
		}
	case []any:
		for index, item := range current {
			flattenContract(joinPointer(path, strconv.Itoa(index)), item, out)
		}
	case nil:
		out[path] = "null"
	case string:
		out[path] = "string:" + current
	case bool:
		out[path] = "bool:" + strconv.FormatBool(current)
	case int:
		out[path] = "number:" + strconv.Itoa(current)
	case int64:
		out[path] = "number:" + strconv.FormatInt(current, 10)
	case float64:
		out[path] = "number:" + strconv.FormatFloat(current, 'g', -1, 64)
	default:
		out[path] = fmt.Sprintf("%T:%v", current, current)
	}
}

func joinPointer(base, part string) string {
	part = strings.ReplaceAll(strings.ReplaceAll(part, "~", "~0"), "/", "~1")
	if base == "/" {
		return "/" + part
	}
	return base + "/" + part
}

func normalizedProto(content string) []any {
	lines := []any{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.SplitN(line, "//", 2)[0])
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
