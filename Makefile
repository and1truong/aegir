.PHONY: build test lint release-snapshot clean

build:
	bun install --cwd web --frozen-lockfile
	bun run --cwd web build
	go generate ./internal/frontend
	go build -o bin/aegir ./cmd/aegir

test:
	go test ./...
	bun install --cwd web --frozen-lockfile
	bun run --cwd web test
	bun run --cwd web typecheck

lint:
	test -z "$(gofmt -l .)"
	go vet ./...

release-snapshot:
	goreleaser release --snapshot --clean

clean:
	rm -rf bin/ web/dist/ dist/
