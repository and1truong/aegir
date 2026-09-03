// Package frontend exposes the production frontend embedded in the Aegir binary.
package frontend

import (
	"embed"
	"io/fs"
)

// Files contains the files generated from web/dist. Run go generate ./internal/frontend
// after building the frontend to refresh them.
//
//go:embed all:dist
var files embed.FS

// Filesystem returns the frontend build rooted at its dist directory.
func Filesystem() fs.FS {
	frontend, err := fs.Sub(files, "dist")
	if err != nil {
		panic(err)
	}
	return frontend
}
