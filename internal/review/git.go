package review

import (
	"archive/tar"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/and1truong/aegir/internal/analyzer"
)

func AnalyzeRef(repositoryPath, ref string) (analyzer.Snapshot, error) {
	if ref == "" || ref == "WORKTREE" {
		return analyzer.Run(repositoryPath)
	}
	hash, err := gitOutput(repositoryPath, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return analyzer.Snapshot{}, fmt.Errorf("resolve Git ref %q: %w", ref, err)
	}
	command := exec.Command("git", "-C", repositoryPath, "archive", "--format=tar", hash)
	archive, err := command.Output()
	if err != nil {
		return analyzer.Snapshot{}, fmt.Errorf("archive Git ref %q: %w", ref, err)
	}
	directory, err := os.MkdirTemp("", "aegir-ref-*")
	if err != nil {
		return analyzer.Snapshot{}, err
	}
	defer os.RemoveAll(directory)
	if err := extractTar(directory, archive); err != nil {
		return analyzer.Snapshot{}, err
	}
	if err := os.MkdirAll(filepath.Join(directory, ".git"), 0o755); err != nil {
		return analyzer.Snapshot{}, err
	}
	if err := os.WriteFile(filepath.Join(directory, ".git", "HEAD"), []byte(hash+"\n"), 0o644); err != nil {
		return analyzer.Snapshot{}, err
	}
	abs, _ := filepath.Abs(repositoryPath)
	snapshot, err := analyzer.RunWithOptions(directory, analyzer.Options{RepositoryName: filepath.Base(abs)})
	if err != nil {
		return analyzer.Snapshot{}, err
	}
	snapshot.Repository.Name = filepath.Base(abs)
	snapshot.Repository.Path = abs
	snapshot.Repository.Head = hash
	return snapshot, nil
}

func gitOutput(repositoryPath string, args ...string) (string, error) {
	commandArgs := append([]string{"-C", repositoryPath}, args...)
	output, err := exec.Command("git", commandArgs...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func extractTar(root string, archive []byte) error {
	reader := tar.NewReader(bytes.NewReader(archive))
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(header.Name)
		if clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return errors.New("Git archive contains an invalid path")
		}
		target := filepath.Join(root, clean)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode)&0o755|0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, reader)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
	}
}
