import type { EdgeKind } from '../../data/types';
import type { ProjectionDefinition, RelationshipPolicy } from '../types';

const transparentKinds: EdgeKind[] = ['owns', 'implements'];

function definition(id: string, label: string, kinds: EdgeKind[], layoutStrategy: ProjectionDefinition['layoutStrategy'] = 'dependency-LR'): ProjectionDefinition {
  const relationshipPolicy: RelationshipPolicy = {
    defaultKinds: kinds,
    transparentKinds,
    reverseVisualKinds: ['consumes'],
    zeroCostThroughStructuralNodes: true,
  };
  return {
    id,
    label,
    description: `Explore ${label.toLowerCase()} relationships within the selected semantic depth.`,
    relationshipPolicy,
    defaultDepth: { upstream: 1, downstream: 2 },
    layoutStrategy,
    relevanceWeights: { change: 9, direct: 8, runtime: 5, contract: 5, failure: 4, ownership: 3, architecture: 3, structural: 1 },
    category: 'signal',
    groupingDimensions: ['service', 'package', 'relation'],
  };
}

function question(id: string, label: string, description: string, kinds: EdgeKind[], evidenceRequirement?: ProjectionDefinition['evidenceRequirement']): ProjectionDefinition {
  return {
    ...definition(id, label, kinds, id === 'what-changed-architecturally' ? 'review-LR' : id === 'state-mutation' ? 'dataflow-LR' : 'dependency-LR'),
    description,
    category: 'question',
    evidenceRequirement,
  };
}

export const projectionDefinitions: Record<string, ProjectionDefinition> = {
  dependencies: definition('dependencies', 'Dependencies', ['calls', 'depends_on']),
  'data flow': definition('data flow', 'Data flow', ['calls', 'reads', 'writes', 'transforms', 'publishes', 'consumes'], 'dataflow-LR'),
  runtime: definition('runtime', 'Runtime', ['calls', 'reads', 'writes', 'publishes', 'consumes', 'depends_on']),
  impact: definition('impact', 'Impact', ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes']),
  coverage: definition('coverage', 'Coverage', ['calls', 'tests']),
  complexity: definition('complexity', 'Complexity', ['calls', 'depends_on']),
  contracts: definition('contracts', 'Contracts', ['calls', 'depends_on', 'publishes', 'consumes']),
  lint: definition('lint', 'Lint', ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes']),
  review: definition('review', 'Review', ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes'], 'review-LR'),
  'what-can-break': question('what-can-break', 'What can break?', 'Failure-sensitive calls, dependencies, contracts, retries, mutations, and consumers.', ['calls', 'depends_on', 'implements', 'retries', 'writes', 'publishes', 'consumes']),
  'hot-path': question('hot-path', 'Hot path', 'Runtime-observed execution and its synchronous critical dependencies.', ['calls', 'publishes', 'consumes'], 'runtime'),
  'state-mutation': question('state-mutation', 'State mutation', 'Paths from the focal behavior to writes, publishes, and transaction I/O.', ['calls', 'writes', 'publishes']),
  'retry-paths': question('retry-paths', 'Retry paths', 'Retries and surrounding calls that may amplify work or failure.', ['retries', 'calls']),
  'transaction-boundaries': question('transaction-boundaries', 'Transaction boundaries', 'Entry, exit, reads, and writes around transaction-scoped work.', ['calls', 'reads', 'writes']),
  'cross-team-dependencies': question('cross-team-dependencies', 'Cross-team dependencies', 'Calls, events, and contracts that cross known ownership boundaries.', ['calls', 'publishes', 'consumes', 'implements'], 'ownership'),
  'what-changed-architecturally': question('what-changed-architecturally', 'What changed architecturally?', 'Changed graph facts plus ranked structural and impact context.', ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes', 'implements'], 'changes'),
};

projectionDefinitions['hot-path'].groupingDimensions = ['traffic', 'service', 'package', 'relation'];
projectionDefinitions['state-mutation'].groupingDimensions = ['access', 'service', 'package', 'relation'];
projectionDefinitions['cross-team-dependencies'].groupingDimensions = ['team', 'service', 'package', 'relation'];
projectionDefinitions['transaction-boundaries'].groupingDimensions = ['access', 'service', 'package', 'relation'];
projectionDefinitions['what-can-break'].groupingDimensions = ['service', 'team', 'package', 'relation'];

export const questionProjectionIds = Object.values(projectionDefinitions).filter((item) => item.category === 'question').map((item) => item.id);
export const signalProjectionIds = Object.values(projectionDefinitions).filter((item) => item.category === 'signal' && item.id !== 'review').map((item) => item.id);

export function projectionDefinition(id: string) {
  return projectionDefinitions[id] ?? projectionDefinitions.dependencies;
}
