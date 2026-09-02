package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/review"
	_ "modernc.org/sqlite"
)

type Repository struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	Module        string `json:"module,omitempty"`
	Head          string `json:"head,omitempty"`
	Status        string `json:"status"`
	LastIndexedAt string `json:"lastIndexedAt,omitempty"`
	Error         string `json:"error,omitempty"`
}

type Snapshot struct {
	ID         int64                     `json:"id"`
	CreatedAt  string                    `json:"createdAt"`
	Ref        SnapshotRef               `json:"ref"`
	Repository Repository                `json:"repository"`
	Nodes      []analyzer.Node           `json:"nodes"`
	Edges      []analyzer.Edge           `json:"edges"`
	Evidence   []analyzer.EvidenceRecord `json:"evidence"`
	Analysis   analyzer.Analysis         `json:"analysis"`
	Stats      map[string]int            `json:"stats"`
}

const SnapshotRefVersion = 1

type SnapshotRef struct {
	Version      int    `json:"version"`
	RepositoryID string `json:"repositoryId"`
	SnapshotID   int64  `json:"snapshotId"`
	Commit       string `json:"commit,omitempty"`
	CreatedAt    string `json:"createdAt"`
	Kind         string `json:"kind"`
	Fingerprint  string `json:"fingerprint"`
	StorageBytes int64  `json:"storageBytes"`
}

type Timeline struct {
	Version   int             `json:"version"`
	Snapshots []SnapshotRef   `json:"snapshots"`
	Reviews   []review.Review `json:"reviews"`
}

type CompactionResult struct {
	DeletedReviews   int64 `json:"deletedReviews"`
	DeletedSnapshots int64 `json:"deletedSnapshots"`
	ReclaimedBytes   int64 `json:"reclaimedBytes"`
}

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL DEFAULT '',
  head TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'registered',
  last_indexed_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  head TEXT NOT NULL DEFAULT '',
  stats_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  body_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, node_id)
);
CREATE TABLE IF NOT EXISTS edges (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  body_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, edge_id)
);
CREATE TABLE IF NOT EXISTS evidence (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  source TEXT NOT NULL,
  strength TEXT NOT NULL,
  body_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS analyses (
  snapshot_id INTEGER PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE,
  body_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  base_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  head_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  body_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_repository ON snapshots(repository_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_snapshot_kind ON nodes(snapshot_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_snapshot_source ON edges(snapshot_id, source);
CREATE INDEX IF NOT EXISTS idx_edges_snapshot_target ON edges(snapshot_id, target);
CREATE INDEX IF NOT EXISTS idx_evidence_snapshot_subject ON evidence(snapshot_id, subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_reviews_repository ON reviews(repository_id, created_at DESC);
`); err != nil {
		return err
	}
	for _, column := range []struct{ name, definition string }{
		{"snapshot_kind", "TEXT NOT NULL DEFAULT 'index'"},
		{"is_current", "INTEGER NOT NULL DEFAULT 0"},
		{"fingerprint", "TEXT NOT NULL DEFAULT ''"},
	} {
		if err := s.ensureSnapshotColumn(ctx, column.name, column.definition); err != nil {
			return err
		}
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE snapshots SET is_current=1 WHERE id IN (SELECT MAX(id) FROM snapshots GROUP BY repository_id) AND NOT EXISTS (SELECT 1 FROM snapshots current WHERE current.repository_id=snapshots.repository_id AND current.is_current=1)`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_snapshots_current ON snapshots(repository_id,is_current,id DESC)`)
	return err
}

func (s *Store) ensureSnapshotColumn(ctx context.Context, name, definition string) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(snapshots)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid int
		var columnName, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		found = found || columnName == name
	}
	if err := rows.Err(); err != nil || found {
		return err
	}
	_, err = s.db.ExecContext(ctx, `ALTER TABLE snapshots ADD COLUMN `+name+` `+definition)
	return err
}

func repositoryID(path string) string {
	sum := sha256.Sum256([]byte(path))
	return hex.EncodeToString(sum[:8])
}

func (s *Store) Register(ctx context.Context, path string) (Repository, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Repository{}, err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		return Repository{}, fmt.Errorf("resolve repository path: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Repository{}, err
	}
	if !info.IsDir() {
		return Repository{}, errors.New("repository path is not a directory")
	}
	if _, err := os.Stat(filepath.Join(abs, ".git")); err != nil {
		return Repository{}, errors.New("repository path does not contain .git")
	}
	repository := Repository{ID: repositoryID(abs), Name: filepath.Base(abs), Path: abs, Status: "registered"}
	_, err = s.db.ExecContext(ctx, `INSERT INTO repositories(id,name,path,status) VALUES(?,?,?,?)
ON CONFLICT(path) DO UPDATE SET name=excluded.name RETURNING id`, repository.ID, repository.Name, repository.Path, repository.Status)
	if err != nil {
		return Repository{}, err
	}
	return s.Repository(ctx, repository.ID)
}

func scanRepository(scanner interface{ Scan(...any) error }) (Repository, error) {
	var r Repository
	err := scanner.Scan(&r.ID, &r.Name, &r.Path, &r.Module, &r.Head, &r.Status, &r.LastIndexedAt, &r.Error)
	return r, err
}

const repositoryColumns = `id,name,path,module,head,status,last_indexed_at,error`

func (s *Store) Repository(ctx context.Context, id string) (Repository, error) {
	return scanRepository(s.db.QueryRowContext(ctx, `SELECT `+repositoryColumns+` FROM repositories WHERE id=?`, id))
}

func (s *Store) Repositories(ctx context.Context) ([]Repository, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+repositoryColumns+` FROM repositories ORDER BY name,path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Repository{}
	for rows.Next() {
		r, err := scanRepository(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SetIndexing(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE repositories SET status='indexing',error='' WHERE id=?`, id)
	return err
}

func (s *Store) SetIndexError(ctx context.Context, id string, indexErr error) {
	_, _ = s.db.ExecContext(ctx, `UPDATE repositories SET status='error',error=? WHERE id=?`, indexErr.Error(), id)
}

func (s *Store) SaveSnapshot(ctx context.Context, repositoryID string, indexed analyzer.Snapshot) (Snapshot, error) {
	return s.saveSnapshot(ctx, repositoryID, indexed, true)
}

func (s *Store) SaveHistoricalSnapshot(ctx context.Context, repositoryID string, indexed analyzer.Snapshot) (Snapshot, error) {
	return s.saveSnapshot(ctx, repositoryID, indexed, false)
}

func (s *Store) saveSnapshot(ctx context.Context, repositoryID string, indexed analyzer.Snapshot, updateRepository bool) (Snapshot, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	createdAt := time.Now().UTC().Format(time.RFC3339)
	statsJSON, _ := json.Marshal(indexed.Stats)
	fingerprintBody, _ := json.Marshal(indexed)
	fingerprintSum := sha256.Sum256(fingerprintBody)
	fingerprint := hex.EncodeToString(fingerprintSum[:])
	kind := "review"
	isCurrent := 0
	if updateRepository {
		kind = "index"
		isCurrent = 1
		if _, err := tx.ExecContext(ctx, `UPDATE snapshots SET is_current=0 WHERE repository_id=?`, repositoryID); err != nil {
			return Snapshot{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO snapshots(repository_id,created_at,head,stats_json,snapshot_kind,is_current,fingerprint) VALUES(?,?,?,?,?,?,?)`, repositoryID, createdAt, indexed.Repository.Head, string(statsJSON), kind, isCurrent, fingerprint)
	if err != nil {
		return Snapshot{}, err
	}
	snapshotID, err := result.LastInsertId()
	if err != nil {
		return Snapshot{}, err
	}
	for _, node := range indexed.Nodes {
		body, _ := json.Marshal(node)
		if _, err := tx.ExecContext(ctx, `INSERT INTO nodes(snapshot_id,node_id,kind,label,body_json) VALUES(?,?,?,?,?)`, snapshotID, node.ID, node.Kind, node.Label, string(body)); err != nil {
			return Snapshot{}, err
		}
	}
	for _, edge := range indexed.Edges {
		body, _ := json.Marshal(edge)
		if _, err := tx.ExecContext(ctx, `INSERT INTO edges(snapshot_id,edge_id,source,target,kind,body_json) VALUES(?,?,?,?,?,?)`, snapshotID, edge.ID, edge.Source, edge.Target, edge.Kind, string(body)); err != nil {
			return Snapshot{}, err
		}
	}
	for _, evidence := range indexed.Evidence {
		body, _ := json.Marshal(evidence)
		if _, err := tx.ExecContext(ctx, `INSERT INTO evidence(snapshot_id,evidence_id,subject_kind,subject_id,source,strength,body_json) VALUES(?,?,?,?,?,?,?)`, snapshotID, evidence.ID, evidence.Subject.Kind, evidence.Subject.ID, evidence.Source, evidence.Strength, string(body)); err != nil {
			return Snapshot{}, err
		}
	}
	analysisJSON, _ := json.Marshal(indexed.Analysis)
	if _, err := tx.ExecContext(ctx, `INSERT INTO analyses(snapshot_id,body_json) VALUES(?,?)`, snapshotID, string(analysisJSON)); err != nil {
		return Snapshot{}, err
	}
	if updateRepository {
		if _, err := tx.ExecContext(ctx, `UPDATE repositories SET module=?,head=?,status='ready',last_indexed_at=?,error='' WHERE id=?`, indexed.Repository.Module, indexed.Repository.Head, createdAt, repositoryID); err != nil {
			return Snapshot{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return s.SnapshotByID(ctx, repositoryID, snapshotID)
}

func (s *Store) SaveReview(ctx context.Context, value review.Review) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO reviews(id,repository_id,created_at,base_snapshot_id,head_snapshot_id,body_json) VALUES(?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,base_snapshot_id=excluded.base_snapshot_id,head_snapshot_id=excluded.head_snapshot_id,body_json=excluded.body_json`, value.ID, value.RepositoryID, value.CreatedAt, value.BaseSnapshotID, value.HeadSnapshotID, string(body))
	return err
}

func (s *Store) Review(ctx context.Context, repositoryID, id string) (review.Review, error) {
	var body string
	if err := s.db.QueryRowContext(ctx, `SELECT body_json FROM reviews WHERE repository_id=? AND id=?`, repositoryID, id).Scan(&body); err != nil {
		return review.Review{}, err
	}
	var value review.Review
	if err := json.Unmarshal([]byte(body), &value); err != nil {
		return review.Review{}, err
	}
	review.UpgradeLegacy(&value)
	return value, nil
}

func (s *Store) LatestReview(ctx context.Context, repositoryID string) (review.Review, error) {
	var body string
	if err := s.db.QueryRowContext(ctx, `SELECT body_json FROM reviews WHERE repository_id=? ORDER BY created_at DESC LIMIT 1`, repositoryID).Scan(&body); err != nil {
		return review.Review{}, err
	}
	var value review.Review
	if err := json.Unmarshal([]byte(body), &value); err != nil {
		return review.Review{}, err
	}
	review.UpgradeLegacy(&value)
	return value, nil
}

func (s *Store) Reviews(ctx context.Context, repositoryID string) ([]review.Review, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT body_json FROM reviews WHERE repository_id=? ORDER BY created_at,id`, repositoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []review.Review{}
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		var value review.Review
		if err := json.Unmarshal([]byte(body), &value); err != nil {
			return nil, err
		}
		review.UpgradeLegacy(&value)
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) Snapshot(ctx context.Context, repositoryID string) (Snapshot, error) {
	var id int64
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM snapshots WHERE repository_id=? AND is_current=1 ORDER BY id DESC LIMIT 1`, repositoryID).Scan(&id); err != nil {
		return Snapshot{}, err
	}
	return s.SnapshotByID(ctx, repositoryID, id)
}

func (s *Store) Timeline(ctx context.Context, repositoryID string) (Timeline, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT s.id,s.created_at,s.head,s.snapshot_kind,s.fingerprint,
		COALESCE(LENGTH(s.stats_json),0)+COALESCE((SELECT SUM(LENGTH(body_json)) FROM nodes WHERE snapshot_id=s.id),0)+COALESCE((SELECT SUM(LENGTH(body_json)) FROM edges WHERE snapshot_id=s.id),0)+COALESCE((SELECT SUM(LENGTH(body_json)) FROM evidence WHERE snapshot_id=s.id),0)+COALESCE((SELECT LENGTH(body_json) FROM analyses WHERE snapshot_id=s.id),0)
		FROM snapshots s WHERE s.repository_id=? ORDER BY s.created_at,s.id`, repositoryID)
	if err != nil {
		return Timeline{}, err
	}
	defer rows.Close()
	refs := []SnapshotRef{}
	for rows.Next() {
		ref := SnapshotRef{Version: SnapshotRefVersion, RepositoryID: repositoryID}
		if err := rows.Scan(&ref.SnapshotID, &ref.CreatedAt, &ref.Commit, &ref.Kind, &ref.Fingerprint, &ref.StorageBytes); err != nil {
			return Timeline{}, err
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		return Timeline{}, err
	}
	reviews, err := s.Reviews(ctx, repositoryID)
	if err != nil {
		return Timeline{}, err
	}
	return Timeline{Version: 1, Snapshots: refs, Reviews: reviews}, nil
}

func (s *Store) CompactTimeline(ctx context.Context, repositoryID string, keepReviews int) (CompactionResult, error) {
	if keepReviews < 0 {
		return CompactionResult{}, errors.New("keepReviews must be non-negative")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CompactionResult{}, err
	}
	defer tx.Rollback()
	var beforeBytes int64
	_ = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(pgsize),0) FROM dbstat`).Scan(&beforeBytes)
	deletedReviews, err := tx.ExecContext(ctx, `DELETE FROM reviews WHERE repository_id=? AND id NOT IN (SELECT id FROM reviews WHERE repository_id=? ORDER BY created_at DESC,id DESC LIMIT ?)`, repositoryID, repositoryID, keepReviews)
	if err != nil {
		return CompactionResult{}, err
	}
	deletedSnapshots, err := tx.ExecContext(ctx, `DELETE FROM snapshots WHERE repository_id=? AND is_current=0 AND id NOT IN (SELECT base_snapshot_id FROM reviews WHERE repository_id=? UNION SELECT head_snapshot_id FROM reviews WHERE repository_id=?)`, repositoryID, repositoryID, repositoryID)
	if err != nil {
		return CompactionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompactionResult{}, err
	}
	reviewCount, _ := deletedReviews.RowsAffected()
	snapshotCount, _ := deletedSnapshots.RowsAffected()
	var afterBytes int64
	_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(pgsize),0) FROM dbstat`).Scan(&afterBytes)
	return CompactionResult{DeletedReviews: reviewCount, DeletedSnapshots: snapshotCount, ReclaimedBytes: max(0, beforeBytes-afterBytes)}, nil
}

func (s *Store) PreviousSnapshot(ctx context.Context, repositoryID string, beforeID int64) (Snapshot, error) {
	var id int64
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM snapshots WHERE repository_id=? AND id<? ORDER BY id DESC LIMIT 1`, repositoryID, beforeID).Scan(&id); err != nil {
		return Snapshot{}, err
	}
	return s.SnapshotByID(ctx, repositoryID, id)
}

func (s *Store) SnapshotByID(ctx context.Context, repositoryID string, id int64) (Snapshot, error) {
	repository, err := s.Repository(ctx, repositoryID)
	if err != nil {
		return Snapshot{}, err
	}
	var snapshot Snapshot
	var statsJSON string
	var commit, kind, fingerprint string
	err = s.db.QueryRowContext(ctx, `SELECT id,created_at,head,stats_json,snapshot_kind,fingerprint FROM snapshots WHERE repository_id=? AND id=?`, repositoryID, id).Scan(&snapshot.ID, &snapshot.CreatedAt, &commit, &statsJSON, &kind, &fingerprint)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.Repository = repository
	snapshot.Ref = SnapshotRef{Version: SnapshotRefVersion, RepositoryID: repositoryID, SnapshotID: snapshot.ID, Commit: commit, CreatedAt: snapshot.CreatedAt, Kind: kind, Fingerprint: fingerprint}
	if err := json.Unmarshal([]byte(statsJSON), &snapshot.Stats); err != nil {
		return Snapshot{}, err
	}
	nodeRows, err := s.db.QueryContext(ctx, `SELECT body_json FROM nodes WHERE snapshot_id=? ORDER BY kind,label,node_id`, snapshot.ID)
	if err != nil {
		return Snapshot{}, err
	}
	for nodeRows.Next() {
		var body string
		var node analyzer.Node
		if err := nodeRows.Scan(&body); err != nil {
			nodeRows.Close()
			return Snapshot{}, err
		}
		if err := json.Unmarshal([]byte(body), &node); err != nil {
			nodeRows.Close()
			return Snapshot{}, err
		}
		snapshot.Nodes = append(snapshot.Nodes, node)
	}
	if err := nodeRows.Close(); err != nil {
		return Snapshot{}, err
	}
	edgeRows, err := s.db.QueryContext(ctx, `SELECT body_json FROM edges WHERE snapshot_id=? ORDER BY edge_id`, snapshot.ID)
	if err != nil {
		return Snapshot{}, err
	}
	for edgeRows.Next() {
		var body string
		var edge analyzer.Edge
		if err := edgeRows.Scan(&body); err != nil {
			edgeRows.Close()
			return Snapshot{}, err
		}
		if err := json.Unmarshal([]byte(body), &edge); err != nil {
			edgeRows.Close()
			return Snapshot{}, err
		}
		snapshot.Edges = append(snapshot.Edges, edge)
	}
	if err := edgeRows.Close(); err != nil {
		return Snapshot{}, err
	}
	evidenceRows, err := s.db.QueryContext(ctx, `SELECT body_json FROM evidence WHERE snapshot_id=? ORDER BY evidence_id`, snapshot.ID)
	if err != nil {
		return Snapshot{}, err
	}
	for evidenceRows.Next() {
		var body string
		var evidence analyzer.EvidenceRecord
		if err := evidenceRows.Scan(&body); err != nil {
			evidenceRows.Close()
			return Snapshot{}, err
		}
		if err := json.Unmarshal([]byte(body), &evidence); err != nil {
			evidenceRows.Close()
			return Snapshot{}, err
		}
		snapshot.Evidence = append(snapshot.Evidence, evidence)
	}
	if err := evidenceRows.Close(); err != nil {
		return Snapshot{}, err
	}
	var analysisJSON string
	if err := s.db.QueryRowContext(ctx, `SELECT body_json FROM analyses WHERE snapshot_id=?`, snapshot.ID).Scan(&analysisJSON); err != nil {
		return Snapshot{}, err
	}
	if err := json.Unmarshal([]byte(analysisJSON), &snapshot.Analysis); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}
