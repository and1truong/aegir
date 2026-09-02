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

func TestStoredSnapshotFingerprintCanonicalizesAnalysisOrdering(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	first := temporalSnapshot("same")
	first.Analysis.Violations = []analyzer.Violation{{ID: "a"}, {ID: "b"}}
	second := temporalSnapshot("same")
	second.Analysis.Violations = []analyzer.Violation{{ID: "b"}, {ID: "a"}}
	firstSaved, err := value.SaveHistoricalSnapshot(ctx, repository.ID, first)
	if err != nil {
		t.Fatal(err)
	}
	secondSaved, err := value.SaveHistoricalSnapshot(ctx, repository.ID, second)
	if err != nil {
		t.Fatal(err)
	}
	if firstSaved.Ref.Fingerprint != secondSaved.Ref.Fingerprint {
		t.Fatalf("stored fingerprints differ: %s != %s", firstSaved.Ref.Fingerprint, secondSaved.Ref.Fingerprint)
	}
}

func TestPreviousComparableSnapshotStaysInTheMatchingStream(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	firstIndex, err := value.SaveSnapshot(ctx, repository.ID, temporalSnapshot("index-1"))
	if err != nil {
		t.Fatal(err)
	}
	base, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("review-base"))
	if err != nil {
		t.Fatal(err)
	}
	head, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("review-head"))
	if err != nil {
		t.Fatal(err)
	}
	item := review.Compare(repository.ID, "base", "head", base.ID, head.ID, temporalSnapshot("review-base"), temporalSnapshot("review-head"))
	if err := value.SaveReview(ctx, item); err != nil {
		t.Fatal(err)
	}
	secondIndex, err := value.SaveSnapshot(ctx, repository.ID, temporalSnapshot("index-2"))
	if err != nil {
		t.Fatal(err)
	}
	indexBase, err := value.PreviousComparableSnapshot(ctx, repository.ID, secondIndex)
	if err != nil {
		t.Fatal(err)
	}
	if indexBase.ID != firstIndex.ID {
		t.Fatalf("index baseline=%d want %d", indexBase.ID, firstIndex.ID)
	}
	reviewBase, err := value.PreviousComparableSnapshot(ctx, repository.ID, head)
	if err != nil {
		t.Fatal(err)
	}
	if reviewBase.ID != base.ID {
		t.Fatalf("review baseline=%d want %d", reviewBase.ID, base.ID)
	}
}

func TestSaveReviewRemovesUnreferencedSupersededSnapshotPair(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	firstBase, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("base"))
	if err != nil {
		t.Fatal(err)
	}
	firstHead, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("head"))
	if err != nil {
		t.Fatal(err)
	}
	first := review.Compare(repository.ID, "base", "head", firstBase.ID, firstHead.ID, temporalSnapshot("base"), temporalSnapshot("head"))
	if err := value.SaveReview(ctx, first); err != nil {
		t.Fatal(err)
	}
	secondBase, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("base"))
	if err != nil {
		t.Fatal(err)
	}
	secondHead, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot("head"))
	if err != nil {
		t.Fatal(err)
	}
	second := review.Compare(repository.ID, "base", "head", secondBase.ID, secondHead.ID, temporalSnapshot("base"), temporalSnapshot("head"))
	if first.ID != second.ID {
		t.Fatalf("review IDs differ: %q != %q", first.ID, second.ID)
	}
	if err := value.SaveReview(ctx, second); err != nil {
		t.Fatal(err)
	}
	for _, snapshotID := range []int64{firstBase.ID, firstHead.ID} {
		if _, err := value.SnapshotByID(ctx, repository.ID, snapshotID); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("expected superseded snapshot %d to be removed, got %v", snapshotID, err)
		}
	}
	base, err := value.PreviousComparableSnapshot(ctx, repository.ID, secondHead)
	if err != nil {
		t.Fatal(err)
	}
	if base.ID != secondBase.ID {
		t.Fatalf("review baseline=%d want %d", base.ID, secondBase.ID)
	}
}

func TestSaveReviewSnapshotsRollsBackBothSnapshots(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	head := temporalSnapshot("head")
	head.Nodes = append(head.Nodes, head.Nodes[0])
	if _, err := value.SaveReviewSnapshots(ctx, repository.ID, "base", "head", temporalSnapshot("base"), head); err == nil {
		t.Fatal("expected duplicate head node to fail")
	}
	timeline, err := value.Timeline(ctx, repository.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Snapshots) != 0 || len(timeline.Reviews) != 0 {
		t.Fatalf("partial review persisted: snapshots=%d reviews=%d", len(timeline.Snapshots), len(timeline.Reviews))
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
CREATE TABLE nodes (snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),node_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,body_json TEXT NOT NULL,PRIMARY KEY(snapshot_id,node_id));
CREATE TABLE analyses (snapshot_id INTEGER PRIMARY KEY REFERENCES snapshots(id),body_json TEXT NOT NULL);
CREATE TABLE reviews (id TEXT PRIMARY KEY,repository_id TEXT NOT NULL REFERENCES repositories(id),created_at TEXT NOT NULL,base_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),head_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),body_json TEXT NOT NULL);
INSERT INTO repositories(id,name,path,status) VALUES('repo','repo','/repo','ready');
INSERT INTO snapshots(id,repository_id,created_at,head,stats_json) VALUES(1,'repo','2026-01-01T00:00:00Z','index','{}'),(2,'repo','2026-01-02T00:00:00Z','base','{}'),(3,'repo','2026-01-03T00:00:00Z','head','{}');
INSERT INTO nodes(snapshot_id,node_id,kind,label,body_json) VALUES(1,'node','function','one','{"id":"node","kind":"function","label":"one"}'),(2,'node','function','two','{"id":"node","kind":"function","label":"two"}'),(3,'node','function','three','{"id":"node","kind":"function","label":"three"}');
INSERT INTO analyses(snapshot_id,body_json) VALUES(1,'{}'),(2,'{}'),(3,'{}');
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
	rows, err := value.db.Query(`SELECT id,snapshot_kind,is_current,fingerprint FROM snapshots ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := []string{}
	fingerprints := map[string]bool{}
	for rows.Next() {
		var id, current int
		var kind, fingerprint string
		if err := rows.Scan(&id, &kind, &current, &fingerprint); err != nil {
			t.Fatal(err)
		}
		if fingerprint == "" {
			t.Fatalf("snapshot %d has no backfilled fingerprint", id)
		}
		fingerprints[fingerprint] = true
		got = append(got, fmt.Sprintf("%d:%s:%d", id, kind, current))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "1:index:1,2:review:0,3:review:0" {
		t.Fatalf("unexpected migrated snapshots: %v", got)
	}
	if len(fingerprints) != 3 {
		t.Fatalf("expected distinct backfilled fingerprints, got %d", len(fingerprints))
	}
}

func TestTimelineIsDeterministicAndCompactsOldReviews(t *testing.T) {
	value, repository := openTemporalStore(t)
	ctx := context.Background()
	if _, err := value.SaveSnapshot(ctx, repository.ID, temporalSnapshot("current")); err != nil {
		t.Fatal(err)
	}
	latestID := ""
	for _, edge := range []analyzer.Edge{{ID: "a|calls|b", Source: "a", Target: "b", Kind: "calls"}, {ID: "a|depends_on|b", Source: "a", Target: "b", Kind: "depends_on"}} {
		base, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot(edge.Kind+"-base"))
		if err != nil {
			t.Fatal(err)
		}
		head, err := value.SaveHistoricalSnapshot(ctx, repository.ID, temporalSnapshot(edge.Kind+"-head", edge))
		if err != nil {
			t.Fatal(err)
		}
		item := review.Compare(repository.ID, base.Ref.Commit, head.Ref.Commit, base.ID, head.ID, temporalSnapshot(base.Ref.Commit), temporalSnapshot(head.Ref.Commit, edge))
		item.CreatedAt = "2026-01-01T00:00:00Z"
		if err := value.SaveReview(ctx, item); err != nil {
			t.Fatal(err)
		}
		latestID = item.ID
	}
	latest, err := value.LatestReview(ctx, repository.ID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.ID != latestID {
		t.Fatalf("latest review=%s want %s", latest.ID, latestID)
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
	if len(timeline.Snapshots) != 3 || len(timeline.Reviews) != 1 || timeline.Reviews[0].ID != latestID {
		t.Fatalf("unexpected compacted timeline: snapshots=%d reviews=%d", len(timeline.Snapshots), len(timeline.Reviews))
	}
	if _, err := value.SnapshotByID(ctx, repository.ID, 2); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected compacted snapshot to be missing, got %v", err)
	}
}
