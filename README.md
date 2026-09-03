# Aegir

Aegir is a local-first code-intelligence tool. It indexes a local Git repository, ranks the architectural areas that deserve attention, and uses an evidence-backed semantic graph to explain dependencies and impact.

## Run locally

Requirements: Go 1.25+, Node.js 22+, and npm.

```sh
npm --prefix web install
npm run build
./bin/aegir serve
```

Open `http://127.0.0.1:4123` and enter the absolute path of a local Git repository.

For development, run the API and Vite client separately:

```sh
npm run dev:api
npm run dev:web
```

Vite proxies `/api` to the Go server at `127.0.0.1:4123`.

## Graph scope semantics

Graph exploration is projected from the selected node with one upstream and two downstream semantic hops by default. Behavior relationships such as calls, data access, publishing, and consumption count as one hop. Structural `owns` and `implements` links that connect services or packages are transparent context bridges and do not consume a hop. Depth zero shows only the selected node; `All` still respects the 30-node projection budget.

Each semantic branch initially shows at most eight nodes. Additional nodes are represented by expandable frontier aggregates, so expanding one branch does not reveal unrelated branches. With no selection, the graph shows a budgeted service/package overview instead of the raw repository graph.

## Current product path

- Attention Summary and a package-level Attention Map: impact/criticality × change complexity, with recency-weighted change velocity as bubble area
- Inspectable factor contributions, signal coverage, source/Git evidence, configurable 30/90/180-day windows, search, region filters and graph drill-down
- Change-review attention overlays that rank touched packages against the repository baseline
- Go AST indexing for packages, functions, methods, tests, calls, imports, common HTTP routes, and conservative data-flow discovery for SQL, messaging, caches, and external HTTP
- Contract normalization and historical compatibility diffs for OpenAPI, AsyncAPI, JSON/YAML schemas, and protobuf files
- Persistent repository snapshots, nodes, edges, and analysis results in `.aegir/aegir.db`
- Deterministic impact queries, package-cycle/fan-out/complexity/ownership rules, static test reachability, and optional Go coverprofile measurements
- Read-only local Git-ref/worktree reviews with persisted graph, rule, and contract diffs
- Real repository overview, dependency/data-flow/runtime/impact/complexity/coverage/contract/lint layers, rules, search, review, and re-index workflows

The deterministic score contract, cache behavior and calibration process are documented in [docs/ATTENTION_MODEL.md](docs/ATTENTION_MODEL.md).

## Releases

GitHub Releases provide prebuilt archives for macOS, Linux, and Windows. Each archive includes the server binaries and the built frontend under `web/dist`. The maintainer process, CI gates, checksum verification, and local release dry run are documented in [docs/RELEASING.md](docs/RELEASING.md).

Runtime facts can be imported in Settings from a JSON array. Identify each node with `nodeId`, or with a unique `label` and optional repository-relative `file`. Every record requires `source` and `window` plus at least one measured metric:

```json
[
  {
    "label": "CreateOrder",
    "file": "internal/order/create.go",
    "rpm": 8200,
    "p99": 184,
    "errorRate": 0.18,
    "window": "5m",
    "source": "prometheus-export"
  }
]
```

Hosted Git-provider ingestion, consumer-aware contract verification, and AI-assisted evidence synthesis remain product work. Local review and deterministic analyses do not substitute mock results.
