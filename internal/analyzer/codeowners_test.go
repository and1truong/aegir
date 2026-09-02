package analyzer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadCodeOwnersUsesLastMatchingRule(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".github", "CODEOWNERS")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("* @platform\n**/*.go @go\n/internal/payments/ @payments\n*.proto @contracts\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rules := readCodeOwners(root)
	for file, expected := range map[string]string{
		"README.md":                       "@platform",
		"main.go":                         "@go",
		"cmd/main.go":                     "@go",
		"internal/payments/charge.go":     "@payments",
		"internal/payments/service.proto": "@contracts",
	} {
		if actual := ownerFor(rules, file); actual != expected {
			t.Fatalf("ownerFor(%q)=%q want %q", file, actual, expected)
		}
	}
}
