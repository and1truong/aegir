package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/and1truong/aegir/internal/api"
	"github.com/and1truong/aegir/internal/store"
)

var version = "dev"

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "version" || os.Args[1] == "--version") {
		fmt.Println(version)
		return
	}

	serve := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := serve.String("addr", "127.0.0.1:4123", "HTTP listen address")
	stateDir := serve.String("state-dir", ".aegir", "directory for persistent local state")
	webDir := serve.String("web-dir", "web/dist", "built frontend directory")
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		fmt.Fprintln(os.Stderr, "usage: aegir <serve|version>\n\n  aegir serve [--addr 127.0.0.1:4123] [--state-dir .aegir] [--web-dir web/dist]\n  aegir version")
		os.Exit(2)
	}
	_ = serve.Parse(os.Args[2:])
	dbPath := filepath.Join(*stateDir, "aegir.db")
	database, err := store.Open(dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer database.Close()
	fmt.Printf("Aegir listening on http://%s (state %s)\n", *addr, dbPath)
	if err := http.ListenAndServe(*addr, api.New(database, *webDir)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
