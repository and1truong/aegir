// ---------------------------------------------------------------------------
// Core system model types. Every screen references the same model.
// ---------------------------------------------------------------------------

export type NodeKind =
  | 'service'
  | 'package'
  | 'function'
  | 'method'
  | 'endpoint'
  | 'topic'
  | 'table'
  | 'cache'
  | 'external'
  | 'transaction'
  | 'test'
  | 'contract'
  | 'database'
  | 'broker';

export type EdgeKind =
  | 'calls'
  | 'reads'
  | 'writes'
  | 'publishes'
  | 'consumes'
  | 'depends_on'
  | 'owns'
  | 'implements'
  | 'tests'
  | 'transforms'
  | 'retries';

export type PRChange = 'added' | 'removed' | 'modified';
export type GraphDeltaStatus = 'unchanged' | PRChange;

export type Boundary = 'network' | 'async' | 'persistence' | 'process' | 'transaction';

export interface SysNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** service id this node belongs to (for internals) */
  service?: string;
  /** package id */
  pkg?: string;
  /** path:line */
  file?: string;
  /** team id */
  owner?: string;
  description?: string;
  /** status of this node in PR #1842 */
  pr?: PRChange;
  /** operation label used in data-flow mode */
  op?: string;
  tags?: string[];
  meta?: Record<string, string | number | string[]>;
}

export interface SysEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** label shown on dependency graph (e.g. attempts) */
  label?: string;
  /** transformation shown in dataflow mode (e.g. "Order → OrderCreatedEvent") */
  transform?: string;
  /** which boundary this edge crosses */
  boundary?: Boundary;
  /** transaction id if this edge is executed inside a DB transaction */
  tx?: string;
  pr?: PRChange;
  sync?: boolean;
  evidenceRefs?: string[];
}

export type EvidenceSource = 'CODE' | 'STATIC' | 'RUNTIME' | 'SCHEMA' | 'TEST' | 'GIT' | 'INCIDENT' | 'LINT' | 'INFERRED';
export type EvidenceStrength = 'proven' | 'observed' | 'inferred';

export interface EvidenceRecord {
  id: string;
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

export interface GraphChangeReason {
  kind: string;
  detail: string;
  evidenceRefs?: string[];
}

export interface GraphNodeDelta {
  id: string;
  status: GraphDeltaStatus;
  before?: SysNode;
  after?: SysNode;
  changeReasons: GraphChangeReason[];
}

export interface GraphEdgeDelta {
  id: string;
  status: GraphDeltaStatus;
  before?: SysEdge;
  after?: SysEdge;
  changeReasons: GraphChangeReason[];
}

export interface GraphDelta {
  nodes: GraphNodeDelta[];
  edges: GraphEdgeDelta[];
}

export interface Team {
  id: string;
  name: string;
  slack: string;
  oncall: string;
}

export interface Service {
  id: string;
  name: string;
  team?: string;
  path: string;
  lang: string;
  tier: string;
  description: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: 'sev1' | 'sev2' | 'sev3';
  date: string;
  durationMin: number;
  summary: string;
  rootCause: string;
  nodes: string[];
  relatedPR?: string;
}

// ---------------------------------------------------------------------------
// Runtime telemetry (factual mock production data)
// ---------------------------------------------------------------------------
export interface Telemetry {
  nodeId: string;
  /** requests / messages per minute */
  rpm?: number;
  /** queries per second (datastores) */
  qps?: number;
  p50?: number;
  p95?: number;
  p99?: number;
  p999?: number;
  /** percent */
  errorRate?: number;
  lag?: number;
  note?: string;
  window: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Complexity (multi-dimensional)
// ---------------------------------------------------------------------------
export interface ComplexityProfile {
  local: number;
  dependency: number;
  change: number;
  system: number;
  cognitive: number;
  cyclomatic: number;
  loc: number;
  nesting: number;
  fanIn: number;
  fanOut: number;
  depth: number;
  cycles: number;
  changes90d: number;
  churn: number;
  authors: number;
  services: number;
  tables: number;
  topics: number;
  external: number;
  failurePaths: number;
  teams: number;
}

// ---------------------------------------------------------------------------
// Coverage (behavior / path oriented)
// ---------------------------------------------------------------------------
export type CoverageStatus = 'covered' | 'partial' | 'uncovered' | 'unknown';

export interface Outcome {
  id: string;
  label: string;
  status: CoverageStatus;
  tests: string[];
}

export interface NodeCoverage {
  nodeId: string;
  status: CoverageStatus;
  line?: number;
  branch?: number;
  tests: string[];
  outcomes?: Outcome[];
  note?: string;
}

export interface BehaviorPath {
  id: string;
  label: string;
  nodes: string[];
  status: CoverageStatus;
  tests: string[];
  failure: boolean;
  integration: boolean;
  prImpacted: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Lint rules / violations
// ---------------------------------------------------------------------------
export type RuleCategory = 'Architecture' | 'Reliability' | 'Performance' | 'Data' | 'Ownership' | 'Contracts';
export type Severity = 'high' | 'medium' | 'low';
export type EvidenceKind = 'CODE' | 'GRAPH' | 'DATAFLOW' | 'RUNTIME' | 'TEST' | 'SCHEMA' | 'GIT' | 'INCIDENT' | 'LINT';

export interface Evidence {
  kind: EvidenceKind;
  text: string;
  link?: DeepLink;
}

export interface Rule {
  id: string;
  title: string;
  category: RuleCategory;
  severity: Severity;
  description: string;
  rationale: string;
  detects: string;
}

export interface Violation {
  id: string;
  ruleId: string;
  status: 'existing' | 'new' | 'resolved';
  title: string;
  /** ordered path of node ids */
  path: string[];
  primaryNode: string;
  detail: string;
  consequences: string[];
  evidence: Evidence[];
  pr?: string;
  incident?: string;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
export type Compat = 'safe' | 'conditional' | 'potential' | 'break';
export type ContractType = 'openapi' | 'kafka' | 'grpc' | 'db' | 'interface';

export interface ContractVersion {
  version: string;
  date: string;
  pr?: string;
  schema: string;
}

export interface Contract {
  id: string;
  name: string;
  type: ContractType;
  owner?: string;
  node: string;
  versions: ContractVersion[];
}

export interface ContractFieldChange {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before?: string;
  after?: string;
  compat: Compat;
  note: string;
}

export interface ConsumerImpact {
  consumerNode: string;
  label: string;
  service?: string;
  status: Compat;
  reason: string;
  evidence: Evidence[];
  code?: { file: string; line: number; snippet: string };
}

export interface ContractChange {
  id: string;
  contractId: string;
  from: string;
  to: string;
  pr: string;
  title: string;
  summary: string;
  schemaCompat: Compat;
  changes: ContractFieldChange[];
  consumers: ConsumerImpact[];
  incident?: string;
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------
export interface DiffLine {
  t: 'ctx' | 'add' | 'del';
  text: string;
  old?: number;
  new?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface PRFile {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
  symbols: string[];
  hunks: DiffHunk[];
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  commit: string;
  state: 'open' | 'merged';
  ci: 'passing' | 'failing' | 'running';
  reviewStatus: string;
  createdAt: string;
  mergedAt?: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  summary: string;
  touchedNodes: string[];
  files: PRFile[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'attention';

export interface ReviewStep {
  n: number;
  id: string;
  title: string;
  short: string;
  finalStatus: StepStatus;
  summary: string;
}

export interface SemanticChange {
  kind: 'added' | 'changed' | 'removed';
  text: string;
  detail: string;
  evidence: EvidenceKind[];
  link?: DeepLink;
}

export interface Finding {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  category: string;
  source: 'rule' | 'contract' | 'test' | 'ai' | 'incident';
  facts: Evidence[];
  observation: string;
  impact: string;
  links: { label: string; link: DeepLink }[];
  ruleId?: string;
  newInPR: boolean;
}

export interface AgentEvent {
  id: string;
  text: string;
  detail?: string[];
  evidence: EvidenceKind[];
  link?: DeepLink;
  /** review step this event belongs to */
  step: number;
}

export interface AgentAnswer {
  id: string;
  question: string;
  summary: string;
  facts: Evidence[];
  links: { label: string; link: DeepLink }[];
}

// ---------------------------------------------------------------------------
// Navigation / deep links
// ---------------------------------------------------------------------------
export type GraphMode =
  | 'dependencies'
  | 'dataflow'
  | 'runtime'
  | 'impact'
  | 'complexity'
  | 'coverage'
  | 'contracts'
  | 'lint';

export type GraphVersion = 'base' | 'pr' | 'diff';

export type PRView = 'review' | 'archdiff' | 'impact' | 'findings';

export type DeepLink =
  | { kind: 'node'; id: string; mode?: GraphMode; version?: GraphVersion }
  | { kind: 'path'; id: string; mode?: GraphMode; version?: GraphVersion; select?: string }
  | { kind: 'impact'; id: string; depth?: number }
  | { kind: 'violation'; id: string }
  | { kind: 'contract'; changeId: string; consumer?: string }
  | { kind: 'coveragePath'; id: string }
  | { kind: 'pr'; step?: number; view?: PRView; finding?: string; file?: string }
  | { kind: 'code'; nodeId?: string; file?: string; line?: number }
  | { kind: 'rules'; category?: RuleCategory; filter?: 'all' | 'new' | 'existing' | 'resolved' }
  | { kind: 'screen'; screen: Screen };

export type Screen = 'overview' | 'explorer' | 'pulls' | 'rules' | 'search' | 'settings';
