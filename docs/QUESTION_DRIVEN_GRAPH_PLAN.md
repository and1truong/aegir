# Question-driven graph workspace plan

Status: planning only. No production implementation is part of this document.

Branch assessed: `ux/scoped-graph-exploration` at `09d57e8`.

## Outcome and product rules

Aegir should evolve from a dependency graph viewer into a question-driven system-understanding and code-review workspace:

```text
question → projection → evidence → answer
```

The canonical repository graph remains factual input. An investigation selects, ranks, groups, and explains a small visible graph that serves the engineer's current question. Depth remains an explicit maximum traversal distance; relevance decides which candidates deserve the node budget.

The implementation must preserve these constraints:

- Normal target: 10–30 visible nodes.
- Above 40–50 nodes: aggregate aggressively.
- 100+ real nodes: require an explicit user action and warning.
- Never mutate the canonical graph to manufacture a presentation.
- Every real visible edge has a reason for inclusion and evidence.
- Static, runtime-observed, inferred, and stale evidence remain distinguishable.
- Topology changes recompose layout. Decoration-only changes do not.
- Recomposition preserves the focal point in the viewport, not stale node coordinates.
- Mouse-wheel zoom remains physical navigation, not an implicit abstraction change.

## 1. Current-state assessment

### 1.1 Current data path

The implemented path is:

```text
Go analyzer
  → analyzer.Snapshot
  → SQLite snapshots/nodes/edges/analyses
  → GET /api/repositories/:id/graph
  → ProductContext snapshot
  → ProductApp mode-specific source/decor
  → projectGraph/projectPRGraph
  → SystemGraph.build
  → Dagre layout
  → React Flow nodes/edges/viewport
```

Relevant modules:

- `internal/analyzer/analyzer.go`: canonical indexed node/edge structs and Go AST/resource discovery.
- `internal/store/store.go`: normalized snapshot node/edge rows plus JSON bodies, analyses, and persisted reviews.
- `internal/graph/impact.go`: a separate backend impact traversal.
- `internal/review/review.go`: base/head comparison and a one-hop change-context review graph.
- `internal/api/server.go`: whole-snapshot, impact, contract-diff, and review endpoints.
- `web/src/data/types.ts`: frontend graph, evidence, contract, PR, finding, and deep-link types.
- `web/src/product/ProductContext.tsx`: repository and current snapshot loading.
- `web/src/product/ProductApp.tsx`: Explorer and Review state, mode policy, projection calls, decorations, and inspectors.
- `web/src/lib/graphProjection.ts`: semantic-depth traversal, relationship eligibility, budget, flat frontier aggregation, and PR roots.
- `web/src/lib/layout.ts`: synchronous Dagre adapter.
- `web/src/components/graph/SystemGraph.tsx`: visible-model conversion, decoration, sizing, layout, position retention, viewport fitting, and rendering.
- `web/src/lib/graphProjection.test.ts`: eleven pure projection tests using Node's built-in test runner.

### 1.2 Canonical graph model

`analyzer.Node` and frontend `SysNode` currently carry stable ID, kind, label, service/package, file, tags, loose metadata, and optional PR change. `analyzer.Edge` and `SysEdge` carry source, target, kind, label, boundary, synchronous flag, and optional PR change.

The analyzer currently discovers:

- repository service, packages, functions/methods, tests, and ownership/containment links;
- calls/import dependencies and some HTTP endpoints;
- literal SQL tables, message topics, cache keys, and external HTTP hosts;
- static coverage reachability, complexity, rules/violations, contracts, and optional node telemetry.

Important limitations:

- Edge identity is `source|kind|target`. Multiple call sites collapse into one relationship and lose distinct evidence.
- Edges do not carry a source location, evidence references, confidence/provenance, observation time, or runtime metrics.
- Node metadata is a loose `map[string]any` / `Record<string, ...>` rather than typed facts.
- Ownership is not populated as a general node/team model; current ownership analysis mainly detects missing CODEOWNERS.
- Telemetry attaches to nodes only. There is no runtime-observed edge/path model.
- Backend and frontend graph types are manually duplicated string unions.

These gaps prevent edge explainability, strong relevance ranking, ownership questions, and trustworthy runtime/static filtering.

### 1.3 Current projection and traversal

`projectGraph` rebuilds an adjacency map for each call, treats `owns`/`implements` through service/package nodes as zero-cost semantic bridges, then walks upstream and downstream separately. Defaults are upstream depth 1, downstream depth 2, real-node budget 30, branch limit 8, and a hard visible limit of 40 including frontier nodes.

The current projection is effective as a compatibility baseline, but it combines too many responsibilities:

- relationship eligibility;
- direction normalization (`consumes` is reversed visually);
- semantic hop cost;
- traversal;
- a fixed upstream budget split;
- candidate ordering;
- flat relation-category grouping;
- page-based branch overrides;
- synthetic aggregate node/edge construction;
- overview selection;
- PR-root selection.

Flat aggregate nodes are disguised as `SysNode { kind: 'service' }`, and aggregate links are disguised as `depends_on`. That leaks visualization artifacts into the system model and makes the rule “every visible edge is factual” impossible to state cleanly.

Candidate choice is alphabetical after semantic depth. The no-selection overview is the first budgeted service/package set, not a relevant system overview. Branch expansion can explicitly expose nodes beyond the current depth, but this override is only encoded as a page count and is not explained in investigation state.

`projectPRGraph` roots at all nodes/edge endpoints with `pr`, then inherits the general budget. Large change sets may silently omit changed roots. It has no explicit base/head/delta model.

`internal/graph/impact.go` is a second traversal authority with different directions, relationship sets, and hop semantics. It repeatedly scans all edges while walking. `ProductApp` fetches this result only for Impact mode and then applies frontend projection again. This divergence must be removed rather than extended.

### 1.4 Current layout and viewport

`web/src/lib/layout.ts` builds a fresh Dagre graph with LR/TB rank direction, node sizes, rank separation, and node separation. `SystemGraph.build` also:

- turns canonical nodes/edges into React Flow elements;
- creates coverage outcome pseudo-nodes;
- post-sorts nodes in columns to keep decorated groups contiguous;
- creates boundary-box pseudo-nodes;
- chooses edge styles and labels.

`Canvas` then keeps a `positions` map. On topology changes it preserves every retained node's old coordinate and only offsets new Dagre positions around a retained/selected node. It fits when overlap is low, selection is new, or `fitKey` changes.

This behavior intentionally reduced jitter in the scoped-graph iteration, but it now conflicts with the refined principle. A depth 1 → depth 3 transition can retain a stale, sparse arrangement instead of recomposing the best layout. Chrome changes are encoded in `fitKey`, coupling container resize with topology/layout identity.

Decoration changes currently rebuild `build(props)` because `decor` participates in the memo. They usually avoid fit, but conversion, sizing, layout, decoration, viewport control, and user-dragged positions are still owned by one component. There is no layout revision token, stale async-result protection, explicit positioned-graph type, or controlled viewport anchor.

### 1.5 Current renderer and interaction

React Flow renders custom nodes, Bezier edges, boundaries, controls, and minimap. Nodes can be selected and dragged. Edges cannot be selected because `SystemGraphProps` and `<ReactFlow>` have no `selectedEdge`/`onEdgeClick` contract. The custom edge has no wider invisible hit target or selected state. The right inspector shows relationships adjacent to the selected node, not the selected relationship's evidence.

Technical modes and their edge lists are hard-coded in `MODE_RELATIONSHIPS`. Mode-specific decoration logic lives inside `Explorer`; Data Flow currently loops all graph edges inside the node loop, an avoidable `O(V×E)` decoration path. Explorer and Review duplicate depth, filters, branch expansion, selection, inspector, and graph-view controls.

### 1.6 Current PR review and temporal foundation

Review analysis already creates and persists base/head historical snapshots. `review.Compare` marks added/removed/modified nodes and added/removed edges, includes one-hop context from either graph, computes violation and contract deltas, and persists a JSON review.

This is a useful temporal foundation, but the returned graph is a flattened union:

- a node/edge has only one body plus a `pr` marker, not typed `before` and `after` values;
- modified edge semantics are not represented;
- unchanged context versus impacted context is implicit;
- source-diff locations are absent;
- no layout mapping connects base and head identities;
- the PR UI decorates the projected union and has no `changes only` policy.

### 1.7 Current tests

- Projection has pure unit coverage for direction/depth isolation, zero-cost containment, filtering, aggregation, branch expansion, determinism, budget, and PR roots.
- Go tests cover indexing, review comparison, store/API flows, contract diff, and Git safety.
- There are no pure layout tests, relevance fixtures, evidence conformance tests, investigation reducer tests, React interaction tests, accessibility tests, or browser end-to-end tests.

### 1.8 Library capability assessment

Installed versions are `@dagrejs/dagre` 3.1.1 and `@xyflow/react` 12.11.6.

**Dagre should remain the P0 layout engine.** It supports directed LR/TB layout, rank/node/edge separation, rankers, ordering constraints (`left/right`), custom ordering hooks, edge weights/min lengths, and graphlib compound metadata. It is synchronous. Its public API does not provide fixed node coordinates, soft pin constraints, incremental layout, cancellation, or a worker API. Compound metadata exists, but the current adapter does not use it and compound-layout quality must be validated before depending on it.

**React Flow should remain the renderer/viewport host.** It supports edge click/selection, controlled viewport, `getViewport`/`setViewport`, animated `fitView`, fitting a subset, initialized-node detection, parent/subflow rendering, and selection hooks. It deliberately does not solve graph layout, semantic grouping, or pin constraints.

P0 therefore needs no new graph dependency:

1. compute a completely fresh deterministic Dagre layout for each topology revision;
2. translate model coordinates so the focal node has a stable model anchor;
3. set the React Flow viewport so that anchor maps to a stable screen slot;
4. animate the node/viewport transition where it remains readable.

An ELK or constraint-layout dependency is a P1 decision gate only if pin/path/compound experiments prove that Dagre plus post-processing is insufficient. A Web Worker is also deferred until measured layout time justifies it.

## 2. Target architecture

### 2.1 Pipeline and ownership

```text
SystemGraphModel (canonical snapshot facts)
        ↓
GraphIndex (adjacency, ownership, evidence, metrics, versions)
        ↓
InvestigationState + ProjectionDefinition
        ↓
ProjectionEngine
  eligibility → semantic traversal → relevance → grouping → budget
        ↓
VisibleGraph (real nodes, frontier groups, reasons, evidence refs)
        ↓
LayoutEngine(strategy, anchor, soft constraints)
        ↓
PositionedGraph (fresh coordinates + topology revision)
        ↓
ViewportController (anchor continuity)
        ↓
SystemGraphCanvas (React Flow rendering and selection)
```

Search, PR Review, breadcrumbs, saved views, and agent actions update `InvestigationState`. They do not manipulate React Flow nodes or DOM elements.

The current React component named `SystemGraph` is a renderer, not the canonical graph. Rename it to `SystemGraphCanvas` during migration to remove the naming collision.

### 2.2 Proposed core interfaces

The exact syntax may evolve, but ownership boundaries should not.

```ts
interface SystemGraphModel {
  snapshot: { repositoryId: string; snapshotId: number; ref?: string };
  nodes: SystemNode[];
  edges: SystemEdge[];
  evidenceById: Record<EvidenceId, EvidenceRecord>;
  telemetry: TelemetryFact[];
  findings: FindingFact[];
}

interface GraphIndex {
  nodeById: Map<NodeId, SystemNode>;
  edgeById: Map<EdgeId, SystemEdge>;
  incomingByNode: Map<NodeId, EdgeId[]>;
  outgoingByNode: Map<NodeId, EdgeId[]>;
  membership: Map<NodeId, { service?: NodeId; package?: NodeId; team?: TeamId }>;
  evidenceBySubject: Map<NodeOrEdgeRef, EvidenceId[]>;
}

interface InvestigationState {
  context: SnapshotContext | ReviewContext;
  focalNodeId?: NodeId;
  selected: { kind: 'node' | 'edge' | 'frontier'; id: string } | null;
  projectionId: ProjectionId;
  depth: { upstream: ProjectionDepth; downstream: ProjectionDepth };
  relationshipOverrides: Record<EdgeKind, 'default' | 'include' | 'exclude'>;
  evidencePolicy: EvidencePolicy;
  abstraction: AbstractionLevel;
  expandedFrontiers: Record<FrontierId, FrontierExpansion>;
  pinnedNodeIds: NodeId[];
  lockedPath?: LockedPath;
  budget: { target: number; hard: number; allowLargeGraph: boolean };
}

interface ProjectionDefinition {
  id: ProjectionId;
  label: string;
  description: string;
  defaultState: Partial<InvestigationState>;
  relationshipPolicy: RelationshipPolicy;
  semanticCost(edge: SystemEdge, direction: Direction, graph: GraphIndex): number | null;
  relevanceWeights: RelevanceWeights;
  groupingRules: GroupingRule[];
  layoutStrategy: LayoutStrategyId;
}

interface CandidateExplanation {
  total: number;
  components: Array<{ signal: RelevanceSignal; raw: number; normalized: number; weight: number; contribution: number; evidenceIds: EvidenceId[] }>;
  reason: string;
}

type VisibleNode =
  | { kind: 'real'; nodeId: NodeId; reason: InclusionReason; score: CandidateExplanation }
  | { kind: 'frontier'; frontier: FrontierGroup };

interface VisibleEdge {
  id: string;
  kind: 'real' | 'frontier-link' | 'path-link';
  source: string;
  target: string;
  canonicalEdgeIds: EdgeId[];
  reason: InclusionReason;
  evidenceIds: EvidenceId[];
  delta?: GraphDeltaStatus;
}

interface VisibleGraph {
  revision: string;
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  focalNodeId?: NodeId;
  warnings: ProjectionWarning[];
  stats: { candidates: number; visibleReal: number; visibleFrontiers: number; pruned: number };
}

interface PositionedGraph {
  topologyRevision: string;
  layoutRevision: number;
  anchor: { nodeId: NodeId; modelPoint: Point; viewportSlot: { xRatio: number; yRatio: number } } | null;
  nodes: Array<VisibleNode & { position: Point; size: Size }>;
  edges: VisibleEdge[];
  bounds: Rect;
}
```

Frontier controls are explicit `VisibleNode`/`VisibleEdge` variants. They are never inserted into `SystemGraphModel` or mislabeled as services/dependencies.

### 2.3 Investigation state ownership

Create a reducer/store under `web/src/investigation/` rather than adding more `useState` calls to `ProductApp.tsx`.

Recommended files:

```text
web/src/investigation/types.ts
web/src/investigation/reducer.ts
web/src/investigation/history.ts
web/src/investigation/commands.ts
web/src/investigation/InvestigationProvider.tsx
```

Use a plain reducer and React context first. The state transitions must be serializable and unit-testable; no state-management dependency is justified yet. UI-only state such as rail open, inspector open, focus mode, hover, and current canvas viewport stays outside the investigation snapshot.

An investigation snapshot contains the engineer's semantic context: repository/snapshot or review ID, focal node, projection, depths, relationship/evidence filters, abstraction, frontier expansions, pins, locked path, and selected semantic entity. Query text, modal state, transient loading, node hover, physical zoom, and stale fetched responses do not belong.

### 2.4 Evidence model

Replace single free-text evidence with references to typed records:

```ts
type EvidenceSource = 'CODE' | 'STATIC' | 'RUNTIME' | 'SCHEMA' | 'TEST' | 'GIT' | 'INCIDENT' | 'LINT' | 'INFERRED';
type EvidenceStrength = 'proven' | 'observed' | 'inferred';

interface EvidenceRecord {
  id: EvidenceId;
  source: EvidenceSource;
  strength: EvidenceStrength;
  subject: { kind: 'node' | 'edge' | 'finding' | 'contract'; id: string };
  summary: string;
  location?: { file: string; line?: number; endLine?: number; symbol?: string };
  snapshotId?: number;
  commit?: string;
  reviewId?: string;
  observedAt?: string;
  validUntil?: string;
  metrics?: Record<string, number | string>;
}
```

Do not introduce fake percentage confidence. Proven/observed/inferred plus source, timestamp, and concrete facts are explainable. Staleness is derived from observation/validity time and policy, not painted as certainty.

Backend changes should preserve multiple observations per canonical relationship. A relationship identity may remain `(source, kind, target)` while `EdgeEvidence` contains many call sites/observations. If source-level call sites must be independently diffed, add stable observation IDs rather than multiplying visual edges by default.

### 2.5 Projection engine boundary

P0 projection remains a pure TypeScript engine because the browser already receives the complete snapshot and interactive state changes must be immediate. Build `GraphIndex` once per snapshot/review rather than rebuilding adjacency per projection.

Deprecate the backend `/impact` traversal once the Impact compatibility preset is implemented by the formal engine. Until removal, do not add new question semantics to `internal/graph.Analyze`.

If later graph sizes require server queries, preserve the same JSON projection definitions and shared conformance fixtures. Do not maintain two undocumented semantic engines.

## 3. P0 plan

### P0-A — Characterization tests and investigation state foundation

**User problem.** Navigation, technical mode, depth, branch expansion, and PR state are scattered, so adding questions, breadcrumbs, saved views, and agent actions would produce inconsistent behavior.

**Implementation.**

- Add the serializable `InvestigationState`, action union, reducer, defaults, and snapshot-history boundary.
- Move focal selection, mode/projection ID, depths, relationship overrides, and expanded frontiers out of Explorer/Review local state.
- Keep rail/inspector/focus/theme as shell state.
- Add compatibility adapters from existing mode names and `BranchExpansions` so the UI can migrate without a rewrite.
- Add characterization fixtures for the current scoped projection before splitting it.

**Affected modules.** New `web/src/investigation/*`; `ProductApp.tsx`; `GraphScopeControls.tsx`; current projection tests.

**Tests.** Reducer action/state tests; repository/review context reset; serializability; default 1/2 depth; independent relationship overrides; undoable semantic actions; current projection golden fixtures.

**Risk.** History can accidentally capture transient UI or enormous sets. Use IDs and small records only; cap history initially at 50 snapshots.

**Done when.** Explorer and Review derive semantic graph state from one reducer, current behavior is unchanged, and any state transition can be constructed without DOM access.

**Unblocks.** Breadcrumbs, saved views, agent actions, question presets, evidence filters, pins, and path lock.

### P0-B — Formal graph index and projection pipeline

**User problem.** Current traversal works for depth but cannot explain inclusion, compose question policies, or efficiently support ranking/grouping.

**Implementation.**

- Build an immutable `GraphIndex` once per canonical snapshot/review context.
- Split `graphProjection.ts` into stages:

```text
projectionDefinition
→ eligible adjacency
→ semantic traversal candidates
→ relevance scores
→ grouping plan
→ budget allocation
→ VisibleGraph
```

- Make direction and semantic cost explicit in `RelationshipPolicy`.
- Preserve zero-cost containment as a compatibility policy, not a global hidden rule.
- Return inclusion reasons, score breakdowns, pruned counts, and warnings.
- Introduce typed frontier nodes/links and stop fabricating `SysNode`/`depends_on` artifacts.
- Implement existing technical modes as registry presets so migration is incremental.
- Retire frontend use of `/impact` after an Impact preset passes shared fixtures.

**Affected modules.** Split `web/src/lib/graphProjection.ts` into `web/src/graph/index.ts`, `projection/*`, and compatibility adapter; `ProductApp.tsx`; `SystemGraphCanvas` input types; eventually `internal/graph/impact.go` and API route.

**Tests.** Eligibility, visual direction, zero-cost semantics, cycles, independent depths, root guarantees, budget accounting including frontiers, deterministic order, inclusion reasons, empty/missing roots, and compatibility fixtures for every current mode.

**Risk.** A generic engine can become a callback framework that is harder to reason about. Keep policies declarative; only semantic cost and score signal extraction may be functions in P0.

**Done when.** Every visible entity has a typed reason, all current graph modes use one engine, and projection code no longer emits canonical-looking synthetic entities.

**Unblocks.** P0 question framework, relevance, hierarchical aggregation, PR policy, P1 abstraction/path/evidence filtering.

### P0-C — Edge evidence and inspectability

**User problem.** An engineer cannot answer why an edge exists or trace it to code/runtime/schema evidence.

**Implementation.**

- Extend analyzer edge output with `evidenceRefs`; add persisted evidence records to snapshot storage.
- At minimum, emit CODE/STATIC evidence with file and call/resource location for calls, tests, reads, writes, publishes, consumes, external HTTP, imports, owns, and endpoint-handler links.
- Preserve multiple evidence records for a collapsed canonical edge.
- Extend review comparison to mark evidence introduced/removed in a PR.
- Add `selectedEdgeId` through canvas props and `onEdgeClick`; add a wide transparent interaction path so thin edges are selectable.
- Build an Edge Inspector showing relationship, direction, evidence list, provenance/strength, location links, boundary, sync/async, delta, runtime facts when present, and “why visible.”
- Treat frontier links separately: their inspector explains grouping/hidden count and contains no fabricated code evidence.

**Affected modules.** `internal/analyzer/analyzer.go`; analyzer discovery functions/tests; `internal/store/store.go` migration and snapshot load/save; `internal/review/review.go`; frontend graph/evidence types; `SystemGraph.tsx`; Explorer/Review inspector components.

**Tests.** Multiple call sites on one edge; evidence JSON round trip; review evidence delta; every real visible edge has at least one evidence record; edge hit/selection interaction; stale selection cleared after projection; source deep link formatting.

**Risk.** Database growth and unstable source locations. Store compact evidence records, use stable observation fingerprints, and regard line numbers as snapshot-relative.

**Done when.** Clicking every real edge in the demo produces a non-empty, source-traceable explanation, and projection tests fail if a visible real edge lacks evidence.

**Unblocks.** Explainable relevance, provenance filtering, PR source links, question answers, and agent trust.

### P0-D — Deterministic relevance ranking

**User problem.** Alphabetical first-N pruning hides important changes and shows arbitrary neighbors.

**Implementation.**

- Score traversal candidates, never the whole graph indiscriminately.
- Initial normalized signals and precedence:
  1. PR/change: changed entity, changed evidence, or one semantic step from change.
  2. Direct semantic relationship to focal/path node.
  3. Runtime: observed edge/path, bounded log-scaled traffic, high latency/error/lag.
  4. Contract: changed/breaking contract or consumer relation.
  5. Failure propagation: synchronous external dependency, retry, mutation, unhandled failure finding.
  6. Ownership boundary crossing.
  7. Architecture significance: endpoint, transaction, external, table/topic/contract, rule finding.
  8. Structural support: bounded fan-in/out, cycle/betweenness/centrality only as a small tie-supporting signal.
- Each projection defines weights and may disable unavailable signals. Normalize within a candidate frontier, use saturation/log transforms, and do not compare incomparable raw units.
- Tie-break by semantic depth, relationship priority, stable node kind order, label, then ID.
- Return `CandidateExplanation`; provide a developer-only “Why ranked?” panel and deterministic JSON debug export.

**Affected modules.** New `projection/relevance.ts`, projection definitions, GraphIndex metric access, debug UI; telemetry/contract/review adapters.

**Tests.** Table-driven score fixtures; priority ordering; missing-signal behavior; log/saturation boundaries; deterministic ties; no centrality-only winner; snapshot/golden explanation output.

**Risk.** Weight proliferation can become opaque or imply false precision. Keep small integer weights, labeled contributions, version each preset, and validate rankings with scenarios rather than optimizing a synthetic score.

**Done when.** The same input/state always yields the same explainable order, PR-relevant and direct semantic candidates outrank structural popularity, and top-N selection is never alphabetical by accident.

**Unblocks.** Hierarchical top-N groups, question presets, smart overview, and review-first ordering.

### P0-E — Question-driven projection registry

**User problem.** Engineers must translate their question into technical mode/filter operations.

**Implementation.**

- Introduce a registry of `ProjectionDefinition`; retain technical modes as an “Explore by signal” secondary section.
- Implement initial question presets using the same engine:
  - **What can break?** synchronous calls, external dependencies, contracts, retries, mutations, downstream consumers, failure findings.
  - **Hot path.** runtime-observed calls/consumption, traffic/latency, synchronous critical dependencies; clearly degrade to “no runtime evidence” rather than inventing a path.
  - **State mutation.** endpoint/caller path to writes, cache mutations, publishes, and transactions.
  - **Retry paths.** retry edges, nesting, upstream/downstream amplification context.
  - **Transaction boundaries.** transaction nodes/groups, I/O within them, entry/exit relationships.
  - **Cross-team dependencies.** only boundary-crossing calls/events/contracts with minimal containment context.
  - **What changed architecturally?** PR delta roots plus structural/context relevance.
- Depth remains editable and is applied after eligibility/cost as maximum reach. Relevance only chooses within that reachable set.
- Show active question, a one-line definition, missing-evidence warnings, and “why these nodes” debug details.
- Avoid bespoke React graph components. A preset supplies policies, grouping defaults, labels, and inspector sections.

**Affected modules.** `projection/definitions/*`; Explorer toolbar/question picker; `GraphScopeControls`; ownership/runtime/contract adapters; Review preset selection.

**Tests.** One fixture per question with eligible/ineligible relations, depth boundaries, evidence degradation, expected top paths, and deterministic warnings.

**Risk.** Mode explosion and overlapping names. Launch with the seven explicit questions, group technical modes separately, and require every new preset to state unique user question and acceptance fixture.

**Done when.** Selecting a question changes structured investigation state, not renderer code, and each preset produces a small explainable graph under the same depth/budget controls.

**Unblocks.** Agent commands, saved views, semantic paths, and focused UX validation.

### P0-F — Hierarchical frontier aggregation

**User problem.** A flat `+127 callers` hides system structure and expands into another explosion.

**Implementation.**

- Define `FrontierGroup` with stable ID, parent frontier, grouping dimension/value, member IDs, visible/hidden counts, aggregate relevance, relation mix, evidence summary, and child-group availability.
- Default high fan-in/fan-out strategy:
  1. group candidates by service;
  2. rank groups by highest member score plus bounded aggregate evidence/change/runtime signals;
  3. show top groups fitting budget and an explicit Remainder group;
  4. drill a service group into package/component, then relation-specific leaf candidates.
- Support dimensions service, team, architecture layer, relation type, and runtime importance. A projection chooses an ordered grouping strategy; users may switch dimension where useful.
- Allocate budget between required roots/pins/path, real candidates, group controls, and remainder controls. Never add aggregate controls after the hard cap as an afterthought.
- Expansion replaces the selected group with its children within the same global budget. It does not expose unrelated branches. Collapse restores the exact parent frontier.
- Preserve explicit depth overrides as labeled frontier state (`withinDepth` versus `expandedBeyondDepth`); do not silently violate maximum depth.

**Affected modules.** `projection/grouping.ts`, `projection/budget.ts`, VisibleGraph types, frontier node component/inspector, Investigation reducer/controls. Remove `BranchExpansions` page-count encoding after compatibility migration.

**Tests.** 127-caller fixture grouped by service/package; top-N + remainder; stable IDs/counts; ranking affects group order; expand/collapse isolation; hard budget; pinned/path reservation; depth override labeling; missing service/team fallback.

**Risk.** Nested grouping can feel like a tree browser rather than a system graph. Limit default hierarchy to two group levels before leaves, show concise group labels, and keep group expansion local.

**Done when.** The high-fan-in scenario starts with meaningful ranked groups, never exceeds the hard budget, and reaches a caller through progressive expansion without revealing unrelated nodes.

**Unblocks.** Smarter mode-specific grouping, abstraction levels, mixed-abstraction experiments, and scalable agent projections.

### P0-G — Active-node anchor and recomposed layout

**User problem.** Current stale-coordinate preservation produces sparse or misleading arrangements after topology changes.

**Implementation.**

- Extract `LayoutEngine` from `SystemGraph.tsx`; input is only `VisibleGraph`, measured sizes, strategy, anchor, and soft constraints; output is `PositionedGraph`.
- Define topology revision separately from decoration revision and container-size revision.
- On every topology revision, run Dagre from scratch using deterministic input and sibling order. Do not reuse retained coordinates.
- Normalize positions by translating the focal node center to model `(0,0)` (or another documented anchor).
- `ViewportController` captures the focal node's current screen slot before update. After applying fresh positions, set the viewport so model anchor maps to that slot, clamped to a useful area (default approximately 42% width, 50% height to leave downstream space).
- If focal node changes, animate to the default slot; if focal disappears, choose locked-path head, first pin, or first root, then fit as fallback.
- Use Dagre ordering constraints/custom order for deterministic semantic sibling order. Define strategies initially as `dependency-LR`, `dataflow-LR`, and `review-LR`; TB remains an explicit option, not automatic magic.
- Decoration changes update React Flow data only. Rail/inspector resize recomputes viewport mapping or fits bounds without recomputing Dagre.
- Add CSS/React Flow transition only after testing that 150–250 ms improves tracking; disable for reduced-motion and very large deltas.

**Affected modules.** New `web/src/layout/types.ts`, `dagreLayout.ts`, `anchor.ts`, `viewport.ts`; slim `SystemGraph.tsx` into conversion/rendering; Explorer/Review remove layout-shaped `fitKey` strings.

**Tests.** Pure deterministic positions; active node model anchor; depth 1→3 fresh sibling positions; large→small compaction; sibling ordering; decoration-only no layout call; container resize no layout call; viewport transform maps focal center within tolerance; missing anchor fallback; reduced-motion transition; latest layout revision wins.

**Risk.** Dagre ordering constraints may be insufficient for pins/compound nodes, and viewport animation can fight user panning. Anchor only on semantic investigation changes, not hover/decor; cancel animation on user interaction; defer harder constraints to a measured P1 decision.

**Done when.** Depth/filter/question changes fully recompose the visible graph while the same focal node remains in the same screen neighborhood, and no retained node keeps a stale coordinate merely because its ID survived.

**Unblocks.** Pins, path locking, abstraction transitions, PR overlay stability, and mixed-level experiments.

### P0-H — First-class PR graph delta and overlay

**User problem.** A union graph with color badges does not explain the architecture delta or what to review first.

**Implementation.**

- Introduce backend `GraphDelta` with explicit node/edge entries:

```text
status: unchanged | added | removed | modified
before?: canonical body/evidence refs
after?: canonical body/evidence refs
changeReasons: typed field/evidence/ownership/contract/runtime/finding changes
```

- Compare node/edge/evidence fingerprints. Preserve removed facts from base and added facts from head without overwriting one body.
- Include context by projection policy, not by hard-coded one-hop union in `review.Compare`.
- Default Review projection roots at all changes, reserves budget for changed entities, ranks downstream impact, and groups overflow rather than silently dropping roots.
- Render unchanged context subdued, additions emphasized, removals ghosted/dashed, modifications marked, and changed evidence visible in inspector.
- Add `Changes only`, `Changes + impact` (default), and `Blast radius from selection` policies.
- Keep shared identities in one layout. Removed-only nodes participate in layout; fresh overlay layout is anchored on selected/primary changed node. Do not default to side-by-side graphs.
- Link node/edge evidence to source diff when file/line/hunk mapping exists.
- Model change reasons for added/removed dependency, contract, ownership boundary, runtime-critical dependency, architecture violation, and uncovered behavior path.

**Affected modules.** `internal/review/review.go` and tests; analyzer fingerprints/evidence; store review JSON (versioned payload); API types; frontend delta types/adapters; Review UI/inspectors/projection definitions/layout decorations.

**Tests.** Added/removed/modified node and edge; evidence-only change; ownership/contract/runtime/finding delta; all changes reserved or grouped; changes-only policy; removed endpoint evidence; deterministic overlay; source-diff deep link; old persisted review compatibility or explicit migration error.

**Risk.** Stable identity and evidence mapping across refactors/renames are imperfect. Report remove+add when identity cannot be proven; do not infer rename certainty without evidence.

**Done when.** In the Fraud API scenario, the new synchronous dependency is the primary visual fact, its downstream context is visible but subdued, and its inspector links to the introducing code evidence.

**Unblocks.** Temporal graph, architecture evolution, PR question presets, risky-path agent actions, and review saved views.

### P0-I — Breadcrumbs and investigation navigation

**User problem.** Changing focal nodes loses the reasoning chain that led there.

**Implementation.**

- Maintain bounded back/forward stacks of semantic `InvestigationSnapshot`s.
- Push history for focal-node changes, question changes, context changes, path-query application, and meaningful saved-view loads.
- Replace the current entry for depth/filter/frontier/pin refinements until the user navigates to another focal subject; this avoids browser-history chaos.
- Breadcrumbs show the navigation/context trail (for example checkout-api → CreateOrder → order.created → payment-service), not containment hierarchy.
- Back/forward restore the full semantic snapshot. “Jump to previous focal node” is a direct history action.
- Physical viewport, rail/inspector state, hover, and transient selection are not restored. The viewport is recomputed around the restored focal anchor.

**Affected modules.** `investigation/history.ts`; breadcrumb toolbar; reducer commands; Explorer/Review context changes.

**Tests.** Push versus replace rules; back/forward truncation; same-node refinements; repository/review boundary; deleted/missing focal fallback; bounded history; serialization.

**Risk.** Restoring stale frontier IDs after graph/context change. Namespace IDs by snapshot/projection version and prune invalid expansions with a visible warning.

**Done when.** A four-step investigation can be traversed backward/forward with its question/depth/filters intact and each restored graph anchors the correct focal node.

**Unblocks.** Saved views, agent undo, path investigations, and repeatable review workflows.

## 4. P1 plan

### P1-A — Provenance/confidence filtering

**Problem and UX.** Engineers need to decide whether inferred/stale relationships are acceptable without encoding every evidence dimension in edge color. Add one global Evidence control: `Proven only`, `+ Observed`, `+ Inferred`, plus a stale-data toggle/warning. Inspector retains full provenance details.

**Technical owner.** `EvidencePolicy` in InvestigationState filters candidate edges before traversal; an edge is eligible when at least one evidence record satisfies policy. Visible edges expose which records survived. Findings and nodes use the same policy where applicable.

**Modules/tests.** Evidence policy/reducer, projection eligibility, toolbar, edge inspector; fixtures for mixed evidence, multiple records, stale observed evidence, path breakage, and warning text.

**Risks/acceptance/unblocks.** Strict filters can disconnect the focal node; show an empty-state explanation and suggested policy change. Done when static/runtime/inferred facts are never conflated and filtering is deterministic. Unblocks trustworthy agent commands and saved evidence views.

### P1-B — Explicit abstraction levels

**Problem and UX.** Service dependencies and symbol/data-flow investigations need different intentional granularity. Add explicit `Service`, `Component/Module`, `Package`, and `Symbol` controls with projection defaults and user override. Physical zoom never changes topology. Drill-down/up keeps focal lineage and question.

**Technical owner.** Add canonical membership/index maps and an `AbstractionProjector` before relevance. It maps real nodes to representative IDs and folds parallel relationships while retaining canonical node/edge/evidence membership. A representative edge inspector lists underlying relations. Component is initially a configured/package-derived concept; do not invent it when no metadata exists.

**Modules/tests.** GraphIndex membership, abstraction projector, VisibleGraph representative variants, controls/history; fold/unfold identity, edge evidence union, cross-level focal mapping, budget, and deterministic transitions.

**Risks/acceptance/unblocks.** Aggregation can manufacture misleading service-to-service dependencies. Labels must say “contains N underlying relationships,” and evidence remains accessible. Done when one investigation can move service→package→symbol without losing question/path context. Unblocks smarter grouping and mixed-level experiments.

### P1-C — Smarter reusable frontier grouping

**Problem and UX.** Different questions need different meaningful groupings. Callers may group by service/team/traffic; consumers by topic/team/contract; DB access by service/read-write/runtime.

**Technical owner.** Generalize P0 `GroupingRule` into ordered, projection-owned dimension extractors with labels, fallback bucket, group scoring, and allowed next dimensions. Keep dimensions declarative and shared; presets choose sequences rather than implement grouping code.

**Modules/tests.** `projection/groupingDimensions.ts`, registry definitions, group inspector; dimension extraction, fallback, scoring, top-N/remainder, expansion path, and evidence summary fixtures.

**Risks/acceptance/unblocks.** Too many choices increase cognitive load. Show one preset default and an inspector switch, not a global matrix. Done when each listed example is expressed as configuration. Unblocks saved grouping preferences and agent “group by team.”

### P1-D — Pin nodes

**Problem and UX.** Users need reference points while changing focal nodes. Add pin/unpin in node inspector/context action, a pinned strip/count, `Clear pins`, and a sensible default maximum of five with confirmation to exceed.

**Technical owner.** Pins are required VisibleGraph nodes before budget allocation. Projection includes shortest containment/context connectors when necessary. Layout treats pins as soft constraints: anchor remains primary; Dagre recomposes; a post-layout pass reserves stable semantic lanes/order for pins rather than preserving raw coordinates. If this fails usability tests, run the layout-engine decision gate.

**Modules/tests.** Investigation reducer, budget reservation, projection connector reasons, node UI, layout soft constraints; pin survival, inaccessible pin warning, budget, deterministic lane order, clear pins, and focal-plus-five-pins layout.

**Risks/acceptance/unblocks.** Pins can make every projection cluttered or over-constrain layout. Cap, warn, and let users temporarily hide pins. Done when a table and two services survive question/depth changes without breaking focal anchoring. Unblocks comparison saved views and mixed abstraction.

### P1-E — Semantic path-query engine and “Why affected?”

**Problem and UX.** Graph-theory shortest paths can traverse meaningless containment/import shortcuts. Users need minimal paths with a stated semantic interpretation.

**Technical owner.** Add `PathQueryDefinition` using the same GraphIndex, relationship/evidence policies, semantic costs, forbidden transitions, direction rules, and path ranking. Implement deterministic weighted search (Dijkstra/A* only if a valid heuristic exists) with path explanations. Query types: semantic dependency, runtime-observed, failure propagation, and data lineage. Prefer fewer semantic hops, then stronger evidence/relevance, then stable tie-breaks.

**Modules/tests.** `path/query.ts`, definition registry, target picker, result chooser, projection adapter; cycles, zero-cost containment, async publish/consume semantics, runtime-only gaps, multiple equal paths, failure/data policies, no-path explanations.

**Risks/acceptance/unblocks.** A “shortest” path may still not be causally sufficient. Label the path type and evidence; allow alternate paths. Done when “Why is payment-service affected?” returns the minimal explained CreateOrder→order.created→PaymentConsumer route. Unblocks path lock and agent path commands.

### P1-F — Path locking

**Problem and UX.** Once a critical path is found, unrelated context should not compete for attention. `Lock path` makes path nodes/edges required and primary; optional nearby context is subdued and budgeted separately. Unlock restores prior projection.

**Technical owner.** `LockedPath` stores path query/version, ordered canonical node/edge IDs, evidence policy, and endpoints. Projection reserves it before ranking. Layout applies path-order constraints/shared lane; focal anchor remains the selected path node. Stale paths revalidate against context and show broken segments.

**Modules/tests.** Investigation state/commands, projection budget, layout constraints, path controls; ordered path preservation, context dimming, depth interaction, stale edge, PR delta path, and unlock restoration.

**Risks/acceptance/unblocks.** Lock can imply the route is the only route. Label path type and show alternate-path count. Done when the POST /orders→ChargeCustomer sequence remains visually primary through filter and node selection changes. Unblocks critical-path saved views and review workflows.

### P1-G — Saved views

**Problem and UX.** Investigations should be repeatable and shareable. Save a named semantic snapshot including focal node, projection, abstraction, depth, filters, grouping expansions, pins, path lock, evidence threshold, and context ID.

**Technical owner.** Start with versioned localStorage records behind a `SavedViewRepository` interface. Validate/migrate schema, resolve missing IDs, and display stale-context warnings. Add backend persistence only after collaboration requirements are explicit.

**Modules/tests.** `savedViews/schema.ts`, repository adapter, menu/dialog, investigation hydrate action; round trip, schema migration, duplicate names, missing snapshot/node, localStorage failure, and PR context.

**Risks/acceptance/unblocks.** Snapshot-specific views become stale. Store semantic identifiers plus snapshot context and report partial restoration. Done when the four example views round-trip exactly on the same snapshot. Unblocks team sharing later and agent-generated view previews.

### P1-H — Agent-to-graph actions

**Problem and UX.** Agent answers must produce inspectable graph state, not chat prose or DOM automation. The agent proposes an action preview (“Apply risky-path projection; hide inferred edges; focus 3 changed roots”), user applies it, and Undo restores the prior investigation.

**Technical owner.** Define deterministic command DTOs over reducer actions:

```text
setProjection, setFocalNode, setDepth, setEvidencePolicy,
setRelationshipOverride, expandFrontier, setAbstraction,
runPathQuery, lockPath, setPins, applySavedView
```

An action planner may map language to commands, but validation and execution are deterministic. Responses include command provenance (`user`, `agent`, saved view), preconditions, preview diff, and resulting projection revision. No DOM selectors are permitted.

**Modules/tests.** `investigation/commands.ts`, command validator/executor, agent tool/API contract, preview UI, history/undo; valid/invalid IDs, permission/precondition failures, deterministic result, preview/apply equality, undo, stale context, and all example commands.

**Risks/acceptance/unblocks.** Silent agent state changes erode trust. Require preview for multi-action/high-impact changes, display active agent-applied state, and make one-click undo persistent. Done when all supplied phrases map to explicit commands and visible state changes with provenance. Unblocks P2 agent-assisted temporal/architecture queries.

## 5. P2 plan

### P2-A — Temporal graph

Start with the snapshots already created for base/head reviews. Add versioned `SnapshotRef`, evidence validity, and a delta index that can reconstruct base/head without embedding an untyped flattened union. UI offers base↔head and a small commit/release selector only when snapshots exist.

Minimal milestone: answer “when was this dependency introduced?” across persisted review snapshots, not full Git history. Store/reuse fingerprints and deltas; do not re-index every commit. Measure database growth per snapshot and add retention/compaction before broader history. Later allow explicit background indexing for selected releases/commits.

Tests cover historical reconstruction, missing snapshots, evidence validity, delta chains, retention, and deterministic time comparisons. Decision gate: if full snapshots are cheap enough for local repos, keep them; otherwise add checkpoint + delta reconstruction only after profiling.

### P2-B — Structural analytics

Add a versioned analytics module over canonical snapshots: coupling, fan-in/out, cycles, dependency depth, ownership-boundary density, and carefully bounded betweenness/centrality. Compute only metrics with a user-facing question:

- ranking support and hotspot discovery;
- cycle/coupling review;
- refactoring candidates backed by edges/evidence;
- architecture change explanation.

Centrality never becomes a standalone importance truth. Every metric exposes definition, graph scope, abstraction, and snapshot. Avoid cross-version comparison when node identity/abstraction changed. Validate on fixtures with known values and on scenarios where high centrality is intentionally irrelevant.

### P2-C — Architecture evolution

Build on temporal snapshots plus structural analytics. Show meaningful deltas: new/removed dependency, coupling and boundary-density change, cycle introduction/removal, ownership change, complexity change, and test-protection change. Prefer ranked change lists with focused graph projections over animated full-graph movies.

Avoid vanity metrics such as raw node/edge count without semantic normalization. A metric is accepted only if it can trigger a concrete review/refactoring question and link to changed relationships/evidence.

### P2-D — Explicit semantic zoom shortcuts

Prototype keyboard shortcuts `1 Service`, `2 Component`, `3 Package/Symbol`, `4 Execution detail` as explicit abstraction commands. Show the selected level in the toolbar and a preview/tooltip; never bind topology change to wheel zoom. Test discoverability, accidental activation in text inputs, focal mapping, and whether four levels are actually distinguishable. Ship only if user studies outperform the normal abstraction control.

### P2-E — Mixed abstraction investigation

Prototype a strict “focus branch detail” rule: one focal branch may be expanded one level below the global abstraction; all other nodes remain at the global level. Every mixed node displays its level, representative edges retain canonical membership, and there is never more than one detailed branch by default.

Evaluate checkout-api→CreateOrder→Fraud API against cognitive load and edge ambiguity. Reject or keep experimental if users cannot predict drill-up behavior or confuse representative service edges with direct symbol calls.

### P2-F — Advanced edge handling

Run isolated prototypes, in this order:

1. selective labels for selected/path/delta edges;
2. semantic ports by relation/boundary;
3. path-specific highlighting and shared trunks;
4. relation lanes/orthogonal routing;
5. semantic bundling only for true aggregate relationships.

Measure crossing count, direction recognition, click accuracy, focal/path comprehension, and layout time. Do not bundle relationships whose individual evidence must remain distinguishable. Dagre edge routes are currently discarded in favor of Bezier paths; any routing change must preserve edge selection/evidence mapping. Consider ELK only after these prototypes demonstrate a material benefit that Dagre/post-processing cannot provide.

## 6. Recommended sequence and dependency map

### P0 order

```text
P0-A characterization + InvestigationState
  → P0-B GraphIndex + formal ProjectionEngine
      → P0-C edge evidence/selection
          → P0-D explainable relevance
              → P0-E question registry
                  → P0-F hierarchical aggregation
      → P0-G anchored recomposed layout
  → P0-H PR GraphDelta (uses evidence, ranking, grouping, layout)
  → P0-I breadcrumbs/history (uses stable investigation snapshots)
```

P0-G can begin after P0-B's `VisibleGraph` contract stabilizes and run alongside P0-C–F. P0-H should not precede evidence or typed delta entities; otherwise it would repeat the current paint-only overlay. P0-I reducer history can be prototyped in P0-A but ships after projection IDs/frontier IDs stabilize.

### P1 order

```text
P1-A provenance filtering
  → P1-B abstraction levels
      → P1-C reusable smart grouping
P1-D pins (after anchored layout)
P1-E semantic path query
  → P1-F path locking
P1-G saved views (after state schema stabilizes)
  → P1-H agent graph actions (after commands/path/saved state are deterministic)
```

Pins and path query can proceed in parallel. Agent actions are deliberately last because they should compose proven commands rather than define architecture.

### P2 order

```text
P2-A temporal graph
  → P2-B structural analytics
      → P2-C architecture evolution
P2-D explicit abstraction shortcuts
  → P2-E mixed abstraction experiment
P2-F advanced edge prototypes after path/delta evidence UX is stable
```

## 7. Incremental migration strategy

1. **Freeze behavior with fixtures.** Keep `projectGraph` and current renderer untouched while adding characterization tests.
2. **Introduce InvestigationState behind adapters.** Existing controls dispatch actions; current projection still consumes converted `GraphProjectionOptions`.
3. **Build GraphIndex and VisibleGraph alongside current output.** In development, run old/new projectors and compare real node/edge sets for compatibility presets.
4. **Switch one mode first.** Dependencies becomes the tracer mode. Then Data Flow, Runtime, Impact, Coverage, Complexity, Contracts, Lint, and Review.
5. **Add typed frontier rendering.** Keep a temporary adapter capable of rendering old aggregate nodes until all modes migrate, then delete it.
6. **Extract layout after VisibleGraph stabilizes.** Run old and new layout in story fixtures; switch to fresh anchored recomposition behind one feature flag if necessary.
7. **Version backend payloads before evidence/delta changes.** Add optional fields/migrations so existing databases load; rebuild snapshots only when required. Persist a review payload version.
8. **Replace PR union incrementally.** First create GraphDelta from existing review data, then add before/after bodies and evidence/source links.
9. **Remove compatibility debt.** Delete backend impact traversal/endpoint usage, `BranchExpansions`, fake service aggregates, layout position retention, and duplicated Explorer/Review graph state only after parity tests pass.

Avoid a repository-wide rewrite. Each milestone must leave Dependencies and Review usable.

## 8. Test strategy

### Pure TypeScript tests

Continue using Node's test runner for pure modules initially:

- GraphIndex adjacency/membership/evidence indexing.
- Projection eligibility, semantic depth, cycles, reasons, and budgets.
- Relevance normalization, weights, ties, and explanation snapshots.
- Hierarchical grouping, top-N/remainder, expansion, and stable IDs.
- Investigation reducer, history push/replace, command validation, saved view hydration.
- Path query/path lock and abstraction folding.
- GraphDelta adapters and evidence policies.
- Dagre adapter determinism, anchor normalization, sibling constraints, and topology/decor revision keys.

Use small named fixtures plus generated high-fan-in/cycle/property-style cases. Golden snapshots should contain IDs/reasons/scores, not brittle pixel dumps.

### Go tests

- Multiple evidence observations per edge and exact call/resource locations.
- Store schema migration and evidence/snapshot round trips.
- Review before/after delta, evidence delta, contract/violation/ownership/runtime changes.
- Backward compatibility for existing local database/review JSON.
- API payload contract tests and source-link safety.

Share JSON conformance fixtures if any semantic query moves to Go.

### Component and interaction tests

The current dependency set has no browser component harness. At the first edge-selection/investigation-toolbar milestone, add the minimum justified stack: Vitest + Testing Library for reducer-connected components, and Playwright for a few real-canvas flows. Do not attempt to assert Dagre pixels in jsdom.

Cover:

- node/edge/frontier selection and inspector switching;
- depth/question/evidence controls dispatch correct commands;
- expand/collapse and breadcrumb back/forward;
- pin/path controls and agent preview/apply/undo;
- edge keyboard focus/hit target/accessibility;
- focus/rail/inspector regressions.

### Layout/async race tests

- Revision N+1 finishing before N must remain applied; N is discarded.
- Decoration revisions never start layout.
- Container resize updates viewport but not topology layout.
- Same focal node maps to the same screen slot within tolerance after depth 1→3 and 3→1.
- New focal node animates to default slot; user pan cancels animation.
- Reduced-motion disables animation.

Even while Dagre is synchronous, build revision handling into the interface so a future worker cannot introduce stale results.

## 9. Performance strategy

### Projection

- Build `GraphIndex` in `O(V+E)` once per snapshot/review.
- Traverse only eligible reachable candidates to depth; avoid full graph scoring when unnecessary.
- Memoize eligibility/index views by snapshot revision + evidence policy + abstraction.
- Cache projection output by stable hash of InvestigationState fields that affect semantics. Exclude inspector/rail/viewport.
- Keep required roots/pins/path and frontier summaries compact. Do not materialize every group member as a visual node.

### Relevance and grouping

- Pre-normalize snapshot metrics (bounded fan-in/out, telemetry ranges) in GraphIndex.
- Score each candidate once per projection and reuse score for group aggregation.
- Use deterministic partial sorting/top-k only after profiling; normal reachable sets and 30-node output likely make full sort acceptable.

### Layout

- Layout only `VisibleGraph`, normally 10–30 and hard-capped near 40–50.
- Cache raw positioned output by topology hash, layout strategy, ordered nodes/edges, sizes, and constraints. Anchor translation is cheap and separate.
- Keep Dagre synchronous in P0. Measure p50/p95 layout duration in development.
- Move pure layout to a worker only if p95 exceeds roughly one animation frame for normal graphs or advanced P1 layouts block input. Use monotonic revision IDs and discard stale responses.
- Never use coordinate preservation as a performance shortcut; it is a different UX behavior.

### Storage/temporal

- Evidence records deduplicate stable source observations within a snapshot.
- Measure snapshot/evidence/review bytes per repository before introducing delta chains.
- Prefer full snapshots for simplicity until actual storage/time measurements justify checkpoint+delta reconstruction.

## 10. UX validation scenarios

### Scenario 1 — High fan-in utility node

Select a node with 127 callers across Payments (48), Checkout (31), Fulfillment (21), and other services (27).

Expected: active node is anchored; graph shows ranked service groups plus remainder under the hard budget. Payments drills into package/component groups, then callers. Other branches do not expand. Group inspector explains counts, ranking signals, and depth status.

### Scenario 2 — PR adds external dependency

CreateOrder adds a synchronous call to Fraud API.

Expected: `Changes + impact` overlay emphasizes the new edge/external node, subdues unchanged orders/order.created context, and shows impacted payment-service. Edge inspector links to the introduced call site/diff, marks STATIC/CODE evidence, sync network boundary, and PR delta. `Changes only` removes context without changing delta meaning.

### Scenario 3 — Why is payment-service affected?

From CreateOrder, run semantic “Why affected?” targeting payment-service.

Expected: minimal explained route CreateOrder → order.created → PaymentConsumer is rendered. Publish/consume direction and evidence are explicit. A runtime-only query either shows an observed route or clearly states insufficient runtime evidence.

### Scenario 4 — State mutation

Select POST /orders and choose State mutation.

Expected: only relevant handler/call paths to transaction, DB/cache writes, and event publishes appear. Reads and unrelated calls are pruned unless required context. Transaction boundaries and each mutation's source evidence are inspectable.

### Scenario 5 — Change active node / topology size

Move from a large depth-3 projection to a small utility-node projection, then back via breadcrumb.

Expected: every topology is freshly compacted. The current focal node remains in the same screen neighborhood; retained nodes do not keep stale coordinates. Back restores semantic investigation state and recomposes around the previous focal node.

### Scenario 6 — Agent graph action

Ask “Show only risky paths introduced by this PR.”

Expected: agent proposes explicit commands (PR risk projection, evidence policy, changed roots/path constraints), previews what will change, and applies them through InvestigationState. UI marks agent-applied state and provides Undo. No DOM manipulation occurs.

Additional validation should cover cross-team grouping, retry amplification, five pins, locked critical path, evidence policy disconnect, and abstraction drill-down.

## 11. Risks and open questions

| Risk/open question | Mitigation or decision gate |
|---|---|
| Relevance weights become opaque or political. | Small deterministic weights, versioned presets, contribution inspector, scenario-based review, no ML in P0/P1. |
| Question preset proliferation recreates mode overload. | Require a unique engineer question, fixture, default grouping, and owner; keep technical modes secondary. |
| Edge identity collapses materially different call sites. | Keep canonical relationship plus multiple evidence observations; split only when semantics/delta require it. |
| Ownership/team data is currently absent. | Add a typed ownership ingestion milestone before promising Cross-team quality; degrade visibly when unavailable. |
| Runtime telemetry is node-only and manually imported. | Do not infer runtime edges. Hot Path states missing edge evidence until an observed path model exists. |
| Dagre pin/compound limitations. | Use anchor/order/soft post-processing first; evaluate ELK against concrete pin/mixed-level fixtures before adding it. |
| Anchor animation fights user navigation. | Trigger only on semantic revisions, cancel on pan/zoom, respect reduced motion. |
| Hierarchical groups hide surprising outliers. | Group score includes max member score; inspector exposes top members and remainder; allow dimension switch. |
| Pins/path consume the entire budget. | Reserve budget explicitly, cap pins, warn, and provide context-hide controls. |
| Mixed abstraction confuses representative versus direct edges. | P2 experiment with one detailed branch and explicit level/evidence labels; do not ship by default. |
| PR identity across rename/refactor is uncertain. | Prefer honest remove+add; add rename only with Git/static evidence and stated confidence. |
| Historical storage grows quickly. | Start with review snapshots, measure, retain/checkpoint only after data justifies complexity. |
| Agent actions silently distort the view. | Explicit command schema, preview/apply, provenance indicator, validation, and one-click undo. |
| Frontend/backend traversal divergence returns. | One P0 TS projection authority; shared JSON conformance fixtures before any server port. |
| Existing `ProductApp.tsx` is already a monolith. | Extract investigation, projection, inspector, and graph-view shell by milestone; no adjacent UI rewrite. |

Open product decisions to validate during P0:

1. Default focal viewport slot: center versus approximately 42% width for LR downstream space.
2. Whether branch expansion may intentionally exceed depth, and how prominently that override is labeled.
3. Exact meaning of “failure propagation” per relation and whether async consumers are included by default.
4. Source of architecture-layer/team metadata for real repositories.
5. Whether changed-root count can exceed the hard visual budget; recommended answer is preserve all changes as ranked groups, not render all roots.
6. Which runtime observation format can prove edge/path execution rather than only node activity.

## 12. Explicit non-goals

Do not build yet:

- ML/LLM relevance ranking or unexplained anomaly scores.
- Automatic topology/abstraction mutation on mouse-wheel zoom.
- Full-history indexing and animated architecture replay before PR snapshot/delta UX works.
- Default whole-repository or 100+ node visualization.
- PageRank/eigenvector centrality as the primary importance model.
- Arbitrary agent DOM manipulation or freeform graph JSON injection.
- A separate React graph implementation for each question/mode.
- Fake numeric confidence when only source/provenance category is known.
- ELK, Web Workers, or another state library without a measured P1 need.
- Edge bundling, 3D graphs, force-layout motion, or styling gimmicks without comprehension evidence.
- Backend collaboration/sharing for saved views before the local schema and workflows stabilize.

## Final recommendation

**Architecture.** Establish `InvestigationState → ProjectionEngine → VisibleGraph → LayoutEngine → PositionedGraph → SystemGraphCanvas`, backed by typed edge evidence and a reusable GraphIndex. Keep canonical facts, visible presentation, and positions strictly separate.

**P0 order.** Investigation state and characterization → formal projection/index → edge evidence → deterministic relevance → question registry → hierarchical aggregation → anchored fresh layout → first-class PR delta → breadcrumbs/history.

**P1 order.** Evidence filtering → abstraction → smarter grouping; pins after anchored layout; semantic path query → path lock; saved views → agent commands.

**P2 order.** Review-snapshot temporal graph → structural analytics → architecture evolution; explicit abstraction shortcuts → mixed-level experiment; advanced edge handling last.

**Biggest architectural refactor.** Split the current combined projection/layout/render/state responsibilities into explicit, typed intermediate models, and make one serializable InvestigationState the only semantic control surface.

**Biggest UX risk.** Relevance and grouping may hide something the engineer considers important. The mitigation is deterministic ranking, visible reasons, top-member-aware groups, explicit depth/budget, evidence inspection, and easy overrides—not more color or opaque intelligence.
