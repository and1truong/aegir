package analyzer

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type coverageBlock struct {
	file                                  string
	startLine, endLine, statements, count int
}

var coverageLine = regexp.MustCompile(`^(.+):(\d+)\.\d+,(\d+)\.\d+\s+(\d+)\s+(\d+)$`)

func applyCoverageProfile(root, module, profilePath string, nodes map[string]Node, analysis *Analysis) error {
	if !filepath.IsAbs(profilePath) {
		profilePath = filepath.Join(root, profilePath)
	}
	file, err := os.Open(profilePath)
	if err != nil {
		return fmt.Errorf("open coverage profile: %w", err)
	}
	defer file.Close()
	blocks := []coverageBlock{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "mode:") {
			continue
		}
		match := coverageLine.FindStringSubmatch(line)
		if match == nil {
			return fmt.Errorf("invalid coverage profile line: %s", line)
		}
		start, _ := strconv.Atoi(match[2])
		end, _ := strconv.Atoi(match[3])
		statements, _ := strconv.Atoi(match[4])
		count, _ := strconv.Atoi(match[5])
		blocks = append(blocks, coverageBlock{file: normalizeCoverageFile(root, module, match[1]), startLine: start, endLine: end, statements: statements, count: count})
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	byNode := map[string]int{}
	for index, item := range analysis.Coverage {
		byNode[item.NodeID] = index
	}
	for id, node := range nodes {
		if node.Kind != "function" && node.Kind != "method" {
			continue
		}
		fileName := node.File
		if split := strings.LastIndex(fileName, ":"); split >= 0 {
			fileName = fileName[:split]
		}
		start, _ := numberMeta(node.Meta["startLine"])
		end, _ := numberMeta(node.Meta["endLine"])
		total, covered := 0, 0
		for _, block := range blocks {
			if block.file == filepath.ToSlash(fileName) && block.startLine >= start && block.startLine <= end {
				total += block.statements
				if block.count > 0 {
					covered += block.statements
				}
			}
		}
		if total == 0 {
			continue
		}
		percent := covered * 100 / total
		status := "uncovered"
		if covered == total {
			status = "covered"
		} else if covered > 0 {
			status = "partial"
		}
		item := Coverage{NodeID: id, Status: status, Line: percent, Tests: []string{}, Note: "Measured from Go coverprofile " + filepath.Base(profilePath)}
		if index, ok := byNode[id]; ok {
			item.Tests = analysis.Coverage[index].Tests
			analysis.Coverage[index] = item
		} else {
			analysis.Coverage = append(analysis.Coverage, item)
		}
	}
	return nil
}

func normalizeCoverageFile(root, module, path string) string {
	path = filepath.ToSlash(path)
	root = filepath.ToSlash(root)
	if strings.HasPrefix(path, root+"/") {
		return strings.TrimPrefix(path, root+"/")
	}
	if module != "" && strings.HasPrefix(path, module+"/") {
		return strings.TrimPrefix(path, module+"/")
	}
	return strings.TrimPrefix(path, "./")
}

func numberMeta(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case float64:
		return int(number), true
	default:
		return 0, false
	}
}
