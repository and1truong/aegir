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

func TestCodeOwnerDirectoryPatterns(t *testing.T) {
	for _, test := range []struct {
		pattern string
		matches []string
		misses  []string
	}{
		{pattern: "/docs", matches: []string{"docs/api.go"}, misses: []string{"internal/docs/api.go"}},
		{pattern: "apps/", matches: []string{"apps/main.go", "nested/apps/main.go"}},
		{pattern: "docs/*", matches: []string{"docs/readme.md"}, misses: []string{"docs/api/index.md"}},
		{pattern: "**/logs", matches: []string{"logs/build.txt", "deep/logs/build.txt"}},
	} {
		pattern := codeOwnerPattern(test.pattern)
		for _, path := range test.matches {
			if !pattern.MatchString(path) {
				t.Errorf("pattern %q should match %q", test.pattern, path)
			}
		}
		for _, path := range test.misses {
			if pattern.MatchString(path) {
				t.Errorf("pattern %q should not match %q", test.pattern, path)
			}
		}
	}
}
