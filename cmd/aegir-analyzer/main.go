package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/and1truong/aegir/internal/analyzer"
)

func main() {
	repo := flag.String("repo", "", "absolute or relative path to a Git repository")
	coverage := flag.String("coverage", "", "optional Go coverprofile path")
	telemetry := flag.String("telemetry", "", "optional runtime telemetry JSON path")
	flag.Parse()
	if *repo == "" {
		fmt.Fprintln(os.Stderr, "--repo is required")
		os.Exit(2)
	}
	snapshot, err := analyzer.RunWithOptions(*repo, analyzer.Options{CoverageProfile: *coverage, TelemetryFile: *telemetry})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(snapshot); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
