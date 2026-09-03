.PHONY: build test lint release-snapshot clean

build:
	npm --prefix web ci
	npm --prefix web run build
	go generate ./internal/frontend
	go build -o bin/aegir ./cmd/aegir

test:
	go test ./...
	npm --prefix web ci
	npm --prefix web test
	npm --prefix web run typecheck

lint:
	test -z "$(gofmt -l .)"
	go vet ./...

release-snapshot:
	goreleaser release --snapshot --clean

clean:
	rm -rf bin/ web/dist/ dist/
