package review

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestAnalyzeRefDoesNotModifyWorktree(t *testing.T) {
	repository := t.TempDir()
	runGit := func(args ...string) {
		command := exec.Command("git", append([]string{"-C", repository}, args...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	runGit("init", "-q")
	runGit("config", "user.email", "aegir@example.test")
	runGit("config", "user.name", "Aegir Test")
	if err := os.WriteFile(filepath.Join(repository, "go.mod"), []byte("module example.com/sample\n\ngo 1.25\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "main.go"), []byte("package sample\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", ".")
	runGit("commit", "-q", "-m", "base")
	base, err := AnalyzeRef(repository, "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	headSource := "package sample\nfunc Run() { helper() }\nfunc helper() {}\n"
	if err := os.WriteFile(filepath.Join(repository, "main.go"), []byte(headSource), 0o644); err != nil {
		t.Fatal(err)
	}
	head, err := AnalyzeRef(repository, "WORKTREE")
	if err != nil {
		t.Fatal(err)
	}
	value := Compare("repo", "HEAD", "WORKTREE", 1, 2, base, head)
	if value.Summary.ModifiedNodes != 1 || value.Summary.AddedNodes != 1 || value.Summary.AddedEdges != 2 {
		t.Fatalf("unexpected diff: %#v", value.Summary)
	}
	content, err := os.ReadFile(filepath.Join(repository, "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != headSource {
		t.Fatal("review analysis modified the worktree")
	}
	if err := os.WriteFile(filepath.Join(repository, "main.go"), []byte(headSource+"func another() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := AnalyzeRef(repository, "WORKTREE")
	if err != nil {
		t.Fatal(err)
	}
	second := Compare("repo", "HEAD", "WORKTREE", 1, 3, base, changed)
	if second.ID == value.ID {
		t.Fatal("worktree content changes must produce a distinct review ID")
	}
}
