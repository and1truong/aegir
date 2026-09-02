package history

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

type FileChange struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Generated bool   `json:"generated,omitempty"`
	Rename    bool   `json:"rename,omitempty"`
	Excluded  bool   `json:"excluded,omitempty"`
}

type ChangeEvent struct {
	ID            string       `json:"id"`
	Commit        string       `json:"commit"`
	Summary       string       `json:"summary,omitempty"`
	OccurredAt    time.Time    `json:"occurredAt"`
	AuthorKey     string       `json:"authorKey"`
	Parents       []string     `json:"parents"`
	Files         []FileChange `json:"files"`
	RefactorNoise bool         `json:"refactorNoise,omitempty"`
}

type Result struct {
	Version      int           `json:"version"`
	Ref          string        `json:"ref"`
	WindowDays   int           `json:"windowDays"`
	CompleteFrom time.Time     `json:"completeFrom"`
	Shallow      bool          `json:"shallow"`
	Events       []ChangeEvent `json:"events"`
}

const FormatVersion = 2

func ReadGit(root, ref string, windowDays int, now time.Time) (Result, error) {
	if ref == "" {
		ref = "HEAD"
	}
	if windowDays <= 0 {
		return Result{}, fmt.Errorf("windowDays must be positive")
	}
	since := now.UTC().AddDate(0, 0, -windowDays)
	return readGit(root, ref, ref, windowDays, since)
}

func UpdateGit(root string, previous Result, ref string, windowDays int, now time.Time) (Result, bool, error) {
	if ref == "" {
		ref = "HEAD"
	}
	if previous.Ref == "" || previous.Ref == "HEAD" || ref == "HEAD" || previous.WindowDays != windowDays {
		result, err := ReadGit(root, ref, windowDays, now)
		return result, false, err
	}
	if err := exec.Command("git", "-C", root, "merge-base", "--is-ancestor", previous.Ref, ref).Run(); err != nil {
		result, readErr := ReadGit(root, ref, windowDays, now)
		return result, false, readErr
	}
	since := now.UTC().AddDate(0, 0, -windowDays)
	delta, err := readGit(root, previous.Ref+".."+ref, ref, windowDays, since)
	if err != nil {
		return Result{}, false, err
	}
	seen := map[string]bool{}
	for _, event := range delta.Events {
		seen[event.ID] = true
	}
	for _, event := range previous.Events {
		if !event.OccurredAt.Before(since) && !seen[event.ID] {
			delta.Events = append(delta.Events, event)
		}
	}
	sort.Slice(delta.Events, func(i, j int) bool {
		if delta.Events[i].OccurredAt.Equal(delta.Events[j].OccurredAt) {
			return delta.Events[i].ID < delta.Events[j].ID
		}
		return delta.Events[i].OccurredAt.After(delta.Events[j].OccurredAt)
	})
	return delta, true, nil
}

func readGit(root, revision, resultRef string, windowDays int, since time.Time) (Result, error) {
	command := exec.Command("git", "-C", root, "-c", "core.quotepath=false", "log", revision, "--since="+since.Format(time.RFC3339), "--format=commit:%H%x09%aI%x09%ae%x09%P%x09%s", "--numstat", "--find-renames", "--ignore-all-space", "--no-merges")
	output, err := command.CombinedOutput()
	if err != nil {
		return Result{}, fmt.Errorf("read Git history: %w: %s", err, strings.TrimSpace(string(output)))
	}
	result, err := Parse(string(output), resultRef, windowDays, since)
	if err != nil {
		return Result{}, err
	}
	shallow, _ := exec.Command("git", "-C", root, "rev-parse", "--is-shallow-repository").Output()
	result.Shallow = strings.TrimSpace(string(shallow)) == "true"
	return result, nil
}

func Parse(input, ref string, windowDays int, completeFrom time.Time) (Result, error) {
	result := Result{Version: FormatVersion, Ref: ref, WindowDays: windowDays, CompleteFrom: completeFrom.UTC(), Events: []ChangeEvent{}}
	var current *ChangeEvent
	scanner := bufio.NewScanner(strings.NewReader(input))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "commit:") {
			fields := strings.SplitN(strings.TrimPrefix(line, "commit:"), "\t", 5)
			if len(fields) < 4 {
				return Result{}, fmt.Errorf("invalid Git history header")
			}
			occurredAt, err := time.Parse(time.RFC3339, fields[1])
			if err != nil {
				return Result{}, fmt.Errorf("parse Git author time: %w", err)
			}
			author := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(fields[2]))))
			summary := ""
			if len(fields) == 5 {
				summary = fields[4]
			}
			result.Events = append(result.Events, ChangeEvent{ID: "git:" + fields[0], Commit: fields[0], Summary: summary, OccurredAt: occurredAt, AuthorKey: hex.EncodeToString(author[:8]), Parents: strings.Fields(fields[3]), Files: []FileChange{}})
			current = &result.Events[len(result.Events)-1]
			continue
		}
		if current == nil || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.SplitN(line, "\t", 3)
		if len(fields) != 3 {
			continue
		}
		additions, addErr := strconv.Atoi(fields[0])
		deletions, deleteErr := strconv.Atoi(fields[1])
		if addErr != nil || deleteErr != nil {
			continue // binary change
		}
		oldPath, path, renamed := renamePaths(fields[2])
		generated := isGenerated(path)
		current.Files = append(current.Files, FileChange{Path: path, OldPath: oldPath, Additions: additions, Deletions: deletions, Generated: generated, Rename: renamed, Excluded: generated || !isMeaningful(path)})
	}
	if err := scanner.Err(); err != nil {
		return Result{}, err
	}
	for index := range result.Events {
		renamed := 0
		for _, file := range result.Events[index].Files {
			if file.Rename {
				renamed++
			}
		}
		result.Events[index].RefactorNoise = len(result.Events[index].Files) >= 20 && renamed*5 >= len(result.Events[index].Files)*4
	}
	return result, nil
}

func renamePaths(path string) (string, string, bool) {
	if !strings.Contains(path, " => ") {
		return "", path, false
	}
	open, close := strings.Index(path, "{"), strings.Index(path, "}")
	if open >= 0 && close > open {
		parts := strings.SplitN(path[open+1:close], " => ", 2)
		if len(parts) == 2 {
			return path[:open] + parts[0] + path[close+1:], path[:open] + parts[1] + path[close+1:], true
		}
	}
	parts := strings.SplitN(path, " => ", 2)
	return parts[0], parts[1], true
}

func isGenerated(path string) bool {
	value := strings.ToLower("/" + strings.TrimSpace(path))
	return strings.Contains(value, "/vendor/") || strings.Contains(value, "/node_modules/") || strings.Contains(value, "/dist/") || strings.HasSuffix(value, ".generated.go") || strings.HasSuffix(value, "_generated.go") || strings.HasSuffix(value, ".pb.go")
}

func isMeaningful(path string) bool {
	value := strings.ToLower(strings.TrimSpace(path))
	base := value
	if index := strings.LastIndex(base, "/"); index >= 0 {
		base = base[index+1:]
	}
	if strings.HasSuffix(value, ".md") || strings.HasSuffix(value, ".txt") || strings.HasSuffix(value, ".lock") {
		return false
	}
	switch base {
	case "license", "license.md", "copying", "go.sum", "package-lock.json", "yarn.lock", "pnpm-lock.yaml":
		return false
	default:
		return true
	}
}
