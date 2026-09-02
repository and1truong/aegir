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
};

export function projectionDefinition(id: string) {
  return projectionDefinitions[id] ?? projectionDefinitions.dependencies;
}
