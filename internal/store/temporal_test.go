package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestMigrationClassifiesLegacyReviewSnapshotsBeforeRecoveringCurrent(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE repositories (id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,module TEXT NOT NULL DEFAULT '',head TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'registered',last_indexed_at TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '');
CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,repository_id TEXT NOT NULL REFERENCES repositories(id),created_at TEXT NOT NULL,head TEXT NOT NULL DEFAULT '',stats_json TEXT NOT NULL);
CREATE TABLE reviews (id TEXT PRIMARY KEY,repository_id TEXT NOT NULL REFERENCES repositories(id),created_at TEXT NOT NULL,base_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),head_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),body_json TEXT NOT NULL);
INSERT INTO repositories(id,name,path,status) VALUES('repo','repo','/repo','ready');
INSERT INTO snapshots(id,repository_id,created_at,head,stats_json) VALUES(1,'repo','2026-01-01T00:00:00Z','index','{}'),(2,'repo','2026-01-02T00:00:00Z','base','{}'),(3,'repo','2026-01-03T00:00:00Z','head','{}');
INSERT INTO reviews(id,repository_id,created_at,base_snapshot_id,head_snapshot_id,body_json) VALUES('review','repo','2026-01-03T00:00:00Z',2,3,'{}');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	value, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer value.Close()
	rows, err := value.db.Query(`SELECT id,snapshot_kind,is_current FROM snapshots ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := []string{}
	for rows.Next() {
		var id, current int
		var kind string
		if err := rows.Scan(&id, &kind, &current); err != nil {
			t.Fatal(err)
		}
		got = append(got, fmt.Sprintf("%d:%s:%d", id, kind, current))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "1:index:1,2:review:0,3:review:0" {
		t.Fatalf("unexpected migrated snapshots: %v", got)
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
