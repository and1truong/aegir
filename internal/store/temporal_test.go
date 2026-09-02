package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/review"
)

func temporalSnapshot(head string, edges ...analyzer.Edge) analyzer.Snapshot {
	return analyzer.Snapshot{
		Repository: analyzer.Repository{Head: head},
		Nodes:      []analyzer.Node{{ID: "a", Kind: "function", Label: "A"}, {ID: "b", Kind: "function", Label: "B"}},
		Edges:      edges,
		Evidence:   []analyzer.EvidenceRecord{{ID: "evidence:" + head, Source: "GIT", Strength: "proven", Subject: analyzer.EvidenceSubject{Kind: "node", ID: "a"}, Summary: head}},
		Stats:      map[string]int{"nodes": 2, "edges": len(edges)},
	}
}

func openTemporalStore(t *testing.T) (*Store, Repository) {
	t.Helper()
	repositoryPath := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(filepath.Join(repositoryPath, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	value, err := Open(filepath.Join(t.TempDir(), "aegir.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = value.Close() })
	repository, err := value.Register(context.Background(), repositoryPath)
	if err != nil {
		t.Fatal(err)
	}
	return value, repository
}

func TestHistoricalSnapshotsDoNotReplaceCurrentGraph(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	current, err := value.SaveSnapshot(ctx, repository.ID, temporalSnapshot("current"))
	if err != nil {
		t.Fatal(err)
	}
	historical, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("historical"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := value.Snapshot(ctx, repository.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != current.ID || got.ID == historical.ID || got.Ref.Kind != "index" || got.Ref.Version != SnapshotRefVersion {
		t.Fatalf("unexpected current snapshot: %#v", got.Ref)
	}
}

func TestTimelineIsDeterministicAndCompactsOldReviews(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	if _, err := value.SaveSnapshot(ctx, repository.ID, temporalSnapshot("current")); err != nil {
		t.Fatal(err)
	}
	for index, edge := range []analyzer.Edge{{ID: "a|calls|b", Source: "a", Target: "b", Kind: "calls"}, {ID: "a|depends_on|b", Source: "a", Target: "b", Kind: "depends_on"}} {
		base, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot(edge.Kind+"-base"))
		if err != nil {
			t.Fatal(err)
		}
		head, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot(edge.Kind+"-head", edge))
		if err != nil {
			t.Fatal(err)
		}
		item := review.Compare(repository.ID, base.Ref.Commit, head.Ref.Commit, base.ID, head.ID, temporalSnapshot(base.Ref.Commit), temporalSnapshot(head.Ref.Commit, edge))
		item.CreatedAt = []string{"2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"}[index]
		if err := value.SaveReview(ctx, item); err != nil {
			t.Fatal(err)
		}
	}
	timeline, err := value.Timeline(ctx, repository.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Snapshots) != 5 || len(timeline.Reviews) != 2 || timeline.Snapshots[0].StorageBytes <= 0 {
		t.Fatalf("unexpected timeline sizes: snapshots=%d reviews=%d", len(timeline.Snapshots), len(timeline.Reviews))
	}
	result, err := value.CompactTimeline(ctx, repository.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.DeletedReviews != 1 || result.DeletedSnapshots != 2 {
		t.Fatalf("unexpected compaction: %#v", result)
	}
	timeline, err = value.Timeline(ctx, repository.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Snapshots) != 3 || len(timeline.Reviews) != 1 {
		t.Fatalf("unexpected compacted timeline: snapshots=%d reviews=%d", len(timeline.Snapshots), len(timeline.Reviews))
	}
	if _, err := value.SnapshotByID(ctx, repository.ID, 2); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected compacted snapshot to be missing, got %v", err)
	}
}
