package history

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseGitHistoryClassifiesRenamesAndGeneratedFiles(t *testing.T) {
	input := "commit:abc\t2026-08-01T10:00:00+10:00\tDev@Example.com\tparent\n\n10\t2\tinternal/{old => new}/run.go\n20\t20\tapi/types.pb.go\n-\t-\tasset.png\n"
	result, err := Parse(input, "HEAD", 90, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 1 || len(result.Events[0].Files) != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
	rename := result.Events[0].Files[0]
	if !rename.Rename || rename.OldPath != "internal/old/run.go" || rename.Path != "internal/new/run.go" {
		t.Fatalf("unexpected rename: %#v", rename)
	}
	if !result.Events[0].Files[1].Generated {
		t.Fatal("expected generated protobuf file")
	}
	if rename.Excluded || !result.Events[0].Files[1].Excluded {
		t.Fatalf("unexpected meaningful classification: %#v", result.Events[0].Files)
	}
	if result.Events[0].AuthorKey == "" || result.Events[0].AuthorKey == "Dev@Example.com" {
		t.Fatalf("author identity was not normalized privately: %q", result.Events[0].AuthorKey)
	}
}

func TestUpdateGitAddsOnlyDescendantHistory(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) string {
		command := exec.Command("git", append([]string{"-C", root}, args...)...)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	run("init", "-q")
	run("config", "user.name", "Aegir Test")
	run("config", "user.email", "aegir@example.invalid")
	path := filepath.Join(root, "main.go")
	if err := os.WriteFile(path, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "main.go")
	run("commit", "-qm", "first")
	first := run("rev-parse", "HEAD")
	previous, err := ReadGit(root, first, 90, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "main.go")
	run("commit", "-qm", "second")
	second := run("rev-parse", "HEAD")
	updated, incremental, err := UpdateGit(root, previous, second, 90, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !incremental || updated.Ref != second || len(updated.Events) != 2 {
		t.Fatalf("unexpected incremental history: incremental=%v result=%#v", incremental, updated)
	}
	if updated.Version != FormatVersion || updated.Events[0].Summary != "second" {
		t.Fatalf("missing versioned commit summary: %#v", updated.Events[0])
	}
}

func TestParseGitHistoryDownweightsMassRenamesAndExcludesNonCodeNoise(t *testing.T) {
	input := "commit:abc\t2026-08-01T10:00:00Z\tdev@example.com\tparent\n"
	for index := 0; index < 20; index++ {
		input += fmt.Sprintf("0\t0\told/%d.go => new/%d.go\n", index, index)
	}
	input += "10\t10\tREADME.md\n"
	result, err := Parse(input, "HEAD", 90, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Events[0].RefactorNoise {
		t.Fatal("expected mass rename classification")
	}
	if !result.Events[0].Files[len(result.Events[0].Files)-1].Excluded {
		t.Fatal("expected documentation-only change to be excluded")
	}
}
