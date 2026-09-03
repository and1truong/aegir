package attention

import (
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/and1truong/aegir/internal/analyzer"
	"github.com/and1truong/aegir/internal/history"
)

var dependencyKinds = map[string]bool{"calls": true, "depends_on": true}

type packageFacts struct {
	node                 analyzer.Node
	members              []string
	incoming             map[string]bool
	outgoing             map[string]bool
	edges                map[string]bool
	incomingEdges        map[string]bool
	outgoingEdges        map[string]bool
	boundaries           map[string]bool
	boundaryEdges        map[string]bool
	stateEdges           map[string]bool
	asyncEdges           map[string]bool
	sharedUnits          map[string]bool
	crossTeamDependents  map[string]bool
	crossTeamEdges       map[string]bool
	outgoingTeamEdges    map[string]bool
	incomingOwnerUnknown bool
	outgoingOwnerUnknown bool
	transitiveCount      int
	transitiveEdges      map[string]bool
	centrality           float64
	inCycle              bool
	localComplexity      float64
	complexities         []float64
	contracts            int
	runtimeTraffic       float64
	runtimeObserved      bool
	velocity             velocityFacts
}

type velocityFacts struct {
	churn       float64
	changes     float64
	topology    float64
	weeks       map[string]bool
	authors     map[string]bool
	evidenceIDs map[string]bool
	topologyIDs map[string]bool
}

func Calculate(repositoryID string, snapshotID int64, snapshot analyzer.Snapshot, changes *history.Result, windowDays int, now time.Time) Landscape {
	policy := DefaultPolicy()
	byID := map[string]analyzer.Node{}
	facts := map[string]*packageFacts{}
	nodePackage := map[string]string{}
	filePackage := map[string]string{}
	packageDirs := map[string]string{}
	for _, node := range snapshot.Nodes {
		byID[node.ID] = node
		if node.Kind == "package" && !contains(node.Tags, "external") {
			facts[node.ID] = &packageFacts{node: node, incoming: map[string]bool{}, outgoing: map[string]bool{}, edges: map[string]bool{}, incomingEdges: map[string]bool{}, outgoingEdges: map[string]bool{}, boundaries: map[string]bool{}, boundaryEdges: map[string]bool{}, stateEdges: map[string]bool{}, asyncEdges: map[string]bool{}, sharedUnits: map[string]bool{}, crossTeamDependents: map[string]bool{}, crossTeamEdges: map[string]bool{}, outgoingTeamEdges: map[string]bool{}, transitiveEdges: map[string]bool{}, velocity: velocityFacts{weeks: map[string]bool{}, authors: map[string]bool{}, evidenceIDs: map[string]bool{}, topologyIDs: map[string]bool{}}}
		}
	}
	for _, node := range snapshot.Nodes {
		unitID := node.Package
		if node.Kind == "package" {
			unitID = node.ID
		}
		if _, ok := facts[unitID]; !ok {
			continue
		}
		nodePackage[node.ID] = unitID
		facts[unitID].members = append(facts[unitID].members, node.ID)
		if node.Kind == "package" {
			directory := strings.Trim(filepath.ToSlash(sourceFile(node.File)), "/")
			if directory == "." {
				directory = ""
			}
			packageDirs[directory] = unitID
		}
		if file := sourceFile(node.File); file != "" && node.Kind != "package" {
			filePackage[file] = unitID
		}
	}
	telemetryPackage := map[string]string{}
	for nodeID, unitID := range nodePackage {
		telemetryPackage[nodeID] = unitID
	}
	for _, edge := range snapshot.Edges {
		if source, ok := byID[edge.Source]; ok && source.Kind == "endpoint" && edge.Kind == "calls" {
			if unit := nodePackage[edge.Target]; unit != "" {
				telemetryPackage[edge.Source] = unit
			}
		}
	}
	resources := map[string]map[string]bool{}
	for _, edge := range snapshot.Edges {
		sourceUnit, targetUnit := nodePackage[edge.Source], nodePackage[edge.Target]
		if sourceUnit != "" {
			facts[sourceUnit].edges[edge.ID] = true
			if edge.Boundary != "" {
				facts[sourceUnit].boundaries[edge.Boundary] = true
				facts[sourceUnit].boundaryEdges[edge.ID] = true
			}
			if edge.Kind == "reads" || edge.Kind == "writes" {
				facts[sourceUnit].stateEdges[edge.ID] = true
			}
			if edge.Kind == "publishes" || edge.Kind == "consumes" {
				facts[sourceUnit].asyncEdges[edge.ID] = true
			}
			if targetUnit == "" && (edge.Kind == "reads" || edge.Kind == "writes" || edge.Kind == "publishes" || edge.Kind == "consumes") {
				if resources[edge.Target] == nil {
					resources[edge.Target] = map[string]bool{}
				}
				resources[edge.Target][sourceUnit] = true
			}
		}
		if sourceUnit == "" || targetUnit == "" || sourceUnit == targetUnit || !dependencyKinds[edge.Kind] {
			continue
		}
		facts[sourceUnit].outgoing[targetUnit] = true
		facts[sourceUnit].outgoingEdges[edge.ID] = true
		facts[targetUnit].incoming[sourceUnit] = true
		facts[targetUnit].edges[edge.ID] = true
		facts[targetUnit].incomingEdges[edge.ID] = true
		if len(nodeOwners(facts[sourceUnit].node)) == 0 || len(nodeOwners(facts[targetUnit].node)) == 0 {
			facts[targetUnit].incomingOwnerUnknown = true
			facts[sourceUnit].outgoingOwnerUnknown = true
		} else if ownersDiffer(facts[sourceUnit].node, facts[targetUnit].node) {
			facts[targetUnit].crossTeamDependents[sourceUnit] = true
			facts[targetUnit].crossTeamEdges[edge.ID] = true
			facts[sourceUnit].outgoingTeamEdges[edge.ID] = true
		}
	}
	for _, units := range resources {
		for unit := range units {
			for other := range units {
				if unit != other {
					facts[unit].sharedUnits[other] = true
				}
			}
		}
	}
	reachCounts, reachEdges := reverseReachAll(facts)
	cycles := cycleMembership(facts)
	for id, item := range facts {
		item.transitiveCount, item.transitiveEdges = reachCounts[id], reachEdges[id]
		item.inCycle = cycles[id]
	}
	centrality := boundedBetweenness(facts, 64)
	for id, score := range centrality {
		facts[id].centrality = score
	}
	for _, complexity := range snapshot.Analysis.Complexity {
		if unit := nodePackage[complexity.NodeID]; unit != "" {
			facts[unit].complexities = append(facts[unit].complexities, float64(complexity.Score))
		}
	}
	for _, item := range facts {
		if len(item.complexities) > 0 {
			sort.Float64s(item.complexities)
			item.localComplexity = percentile(item.complexities, .90)
		}
	}
	for _, contract := range snapshot.Analysis.Contracts {
		unit := nodePackage[contract.Node]
		if node, ok := byID[contract.Node]; unit == "" && ok {
			unit = unitForFile(node.File, filePackage, packageDirs)
		}
		if unit != "" {
			facts[unit].contracts++
		}
	}
	for _, telemetry := range snapshot.Analysis.Telemetry {
		if unit := telemetryPackage[telemetry.NodeID]; unit != "" {
			facts[unit].runtimeObserved = facts[unit].runtimeObserved || telemetry.TrafficObserved || telemetry.RPM != 0 || telemetry.QPS != 0
			facts[unit].runtimeTraffic += math.Max(telemetry.RPM, telemetry.QPS*60)
		}
	}
	if changes != nil {
		applyVelocity(facts, filePackage, packageDirs, *changes, windowDays, now)
	}

	values := collectValues(facts)
	units := make([]Unit, 0, len(facts))
	for id, item := range facts {
		impact := impactDimension(item, len(facts), values)
		complexity := complexityDimension(item, values)
		velocity := unavailableVelocityDimension()
		if changes != nil {
			velocity = velocityDimension(item, values)
		}
		impactScore, complexityScore := value(impact.Score), value(complexity.Score)
		priorityParts, priorityWeight := float64(impactScore)*.45+float64(complexityScore)*.35, .8
		if velocity.Score != nil {
			priorityParts += float64(*velocity.Score) * .2
			priorityWeight = 1
		}
		priority := int(math.Round(priorityParts / priorityWeight))
		if impactScore >= policy.ImpactHigh && complexityScore >= policy.ComplexityHigh {
			priority += 10
		}
		if velocity.Score != nil && *velocity.Score >= policy.VelocityFast && (impactScore >= policy.ImpactHigh || complexityScore >= policy.ComplexityHigh) {
			priority += 5
		}
		priority = min(priority, 100)
		units = append(units, Unit{Unit: UnitRef{ID: id, Label: item.node.Label, Path: item.node.File, Kind: "package", Team: item.node.Owner, Teams: nodeOwners(item.node), Subsystem: subsystem(item.node.File)}, Impact: impact, ChangeComplexity: complexity, ChangeVelocity: velocity, Priority: priority, Region: region(impactScore, complexityScore, policy), MemberCount: len(item.members)})
	}
	sort.Slice(units, func(i, j int) bool {
		return units[i].Unit.Label < units[j].Unit.Label || units[i].Unit.Label == units[j].Unit.Label && units[i].Unit.ID < units[j].Unit.ID
	})
	optionalSignals := []string{"business criticality", "contract consumers", "critical flows", "runtime paths"}
	if !hasOwnership(facts) {
		optionalSignals = append(optionalSignals, "team ownership")
	}
	landscape := Landscape{Version: 1, ModelVersion: ModelVersion, CalculatedAt: now.UTC().Format(time.RFC3339), SnapshotID: snapshotID, RepositoryID: repositoryID, UnitLevel: "package", WindowDays: windowDays, Policy: policy, Completeness: Completeness{HistoryAvailable: changes != nil, OptionalSignals: optionalSignals, Warnings: []string{}}, Units: units}
	if changes != nil && changes.Shallow {
		landscape.Completeness.HistoryShallow = true
		landscape.Completeness.Warnings = append(landscape.Completeness.Warnings, "Git history is shallow; change velocity may be understated.")
	}
	if changes == nil {
		landscape.Completeness.Warnings = append(landscape.Completeness.Warnings, "Git history is unavailable; change velocity is unknown.")
	}
	landscape.Findings = findings(units, policy)
	return landscape
}

type valueSets struct{ incoming, outgoing, boundaries, state, async, shared, crossTeamIncoming, crossTeamOutgoing, contracts, runtime, churn, changes, topology, weeks, authors []float64 }

func collectValues(facts map[string]*packageFacts) valueSets {
	values := valueSets{}
	for _, item := range facts {
		values.incoming = append(values.incoming, float64(len(item.incoming)))
		values.outgoing = append(values.outgoing, float64(len(item.outgoing)))
		values.boundaries = append(values.boundaries, float64(len(item.boundaries)))
		values.state = append(values.state, float64(len(item.stateEdges)))
		values.async = append(values.async, float64(len(item.asyncEdges)))
		values.shared = append(values.shared, float64(len(item.sharedUnits)))
		if ownershipAvailable(item, !item.incomingOwnerUnknown) {
			values.crossTeamIncoming = append(values.crossTeamIncoming, float64(len(item.crossTeamDependents)))
		}
		if ownershipAvailable(item, !item.outgoingOwnerUnknown) {
			values.crossTeamOutgoing = append(values.crossTeamOutgoing, float64(len(item.outgoingTeamEdges)))
		}
		values.contracts = append(values.contracts, float64(item.contracts))
		if item.runtimeObserved {
			values.runtime = append(values.runtime, item.runtimeTraffic)
		}
		values.churn = append(values.churn, item.velocity.churn)
		values.changes = append(values.changes, item.velocity.changes)
		values.topology = append(values.topology, item.velocity.topology)
		values.weeks = append(values.weeks, float64(len(item.velocity.weeks)))
		values.authors = append(values.authors, float64(len(item.velocity.authors)))
	}
	return values
}

func impactDimension(item *packageFacts, total int, values valueSets) Dimension {
	factors := []Factor{
		observed("direct-dependents", "Direct dependents", float64(len(item.incoming)), "packages", .20, normalize(float64(len(item.incoming)), values.incoming), edgeRefs(item.incomingEdges)),
		observed("transitive-reach", "Transitive dependent reach", float64(item.transitiveCount), "packages", .15, ratio(item.transitiveCount, max(1, total-1)), edgeRefs(item.transitiveEdges)),
		observed("dependency-brokerage", "Dependency brokerage", item.centrality, "normalized", .15, item.centrality, edgeRefs(item.edges)),
		observed("shared-resource-reach", "Shared state and event reach", float64(len(item.sharedUnits)), "packages", .10, normalize(float64(len(item.sharedUnits)), values.shared), edgeRefs(item.stateEdges, item.asyncEdges)),
		ownershipFactor("cross-team-dependents", "Cross-team dependents", float64(len(item.crossTeamDependents)), "packages", .10, normalize(float64(len(item.crossTeamDependents)), values.crossTeamIncoming), edgeRefs(item.crossTeamEdges), ownershipAvailable(item, !item.incomingOwnerUnknown)),
		observed("owned-contracts", "Owned contracts", float64(item.contracts), "contracts", .10, normalize(float64(item.contracts), values.contracts), nil),
	}
	if item.runtimeObserved {
		factors = append(factors, observed("runtime-traffic", "Observed runtime traffic", item.runtimeTraffic, "requests/min", .10, normalize(item.runtimeTraffic, values.runtime), nil))
	} else {
		factors = append(factors, Factor{ID: "runtime-traffic", Label: "Observed runtime traffic", Weight: .10, Status: "unavailable", EvidenceRefs: []EvidenceRef{}})
	}
	factors = append(factors, Factor{ID: "business-criticality", Label: "Business criticality", Weight: .10, Status: "unavailable", EvidenceRefs: []EvidenceRef{}})
	return dimension(factors)
}

func complexityDimension(item *packageFacts, values valueSets) Dimension {
	cycle := 0.0
	if item.inCycle {
		cycle = 1
	}
	factors := []Factor{
		observed("fan-out", "Dependency fan-out", float64(len(item.outgoing)), "packages", .15, normalize(float64(len(item.outgoing)), values.outgoing), edgeRefs(item.outgoingEdges)),
		observed("boundary-variety", "Technical boundary variety", float64(len(item.boundaries)), "boundary types", .15, normalize(float64(len(item.boundaries)), values.boundaries), edgeRefs(item.boundaryEdges)),
		ownershipFactor("cross-team-dependencies", "Cross-team dependencies", float64(len(item.outgoingTeamEdges)), "relationships", .10, normalize(float64(len(item.outgoingTeamEdges)), values.crossTeamOutgoing), edgeRefs(item.outgoingTeamEdges), ownershipAvailable(item, !item.outgoingOwnerUnknown)),
		observed("stateful-dependencies", "Stateful dependencies", float64(len(item.stateEdges)), "relationships", .15, normalize(float64(len(item.stateEdges)), values.state), edgeRefs(item.stateEdges)),
		observed("async-dependencies", "Async and event dependencies", float64(len(item.asyncEdges)), "relationships", .15, normalize(float64(len(item.asyncEdges)), values.async), edgeRefs(item.asyncEdges)),
		observed("cycle-participation", "Dependency cycle participation", cycle, "boolean", .15, cycle, edgeRefs(item.edges)),
		observed("contract-coupling", "Contracts owned or affected", float64(item.contracts), "contracts", .10, normalize(float64(item.contracts), values.contracts), nil),
		observed("local-complexity", "90th-percentile symbol complexity", item.localComplexity, "score", .05, math.Min(1, item.localComplexity/10), nil),
	}
	return dimension(factors)
}

func velocityDimension(item *packageFacts, values valueSets) Dimension {
	factors := []Factor{
		observed("meaningful-churn", "Recency-weighted meaningful churn", item.velocity.churn, "changed lines", .35, normalize(item.velocity.churn, values.churn), gitRefs(item.velocity.evidenceIDs)),
		observed("change-sets", "Recency-weighted change sets", item.velocity.changes, "changes", .25, normalize(item.velocity.changes, values.changes), gitRefs(item.velocity.evidenceIDs)),
		observed("active-weeks", "Active weeks", float64(len(item.velocity.weeks)), "weeks", .15, normalize(float64(len(item.velocity.weeks)), values.weeks), gitRefs(item.velocity.evidenceIDs)),
		observed("distinct-authors", "Distinct authors", float64(len(item.velocity.authors)), "authors", .10, normalize(float64(len(item.velocity.authors)), values.authors), gitRefs(item.velocity.evidenceIDs)),
		observed("topology-change-frequency", "Contract and schema changes", item.velocity.topology, "changes", .15, normalize(item.velocity.topology, values.topology), gitRefs(item.velocity.topologyIDs)),
	}
	return dimension(factors)
}

func observed(id, label string, raw float64, unit string, weight, normalized float64, evidence []EvidenceRef) Factor {
	if evidence == nil || raw == 0 {
		evidence = []EvidenceRef{}
	}
	return Factor{ID: id, Label: label, RawValue: raw, DisplayValue: displayValue(raw, unit), Normalized: clamp(normalized), Weight: weight, Status: "observed", EvidenceRefs: evidence}
}

func ownershipFactor(id, label string, raw float64, unit string, weight, normalized float64, evidence []EvidenceRef, available bool) Factor {
	if !available {
		return Factor{ID: id, Label: label, Weight: weight, Status: "unavailable", EvidenceRefs: []EvidenceRef{}}
	}
	return observed(id, label, raw, unit, weight, normalized, evidence)
}

func ownershipAvailable(item *packageFacts, relationshipsKnown bool) bool {
	return len(nodeOwners(item.node)) > 0 && relationshipsKnown
}

func hasOwnership(facts map[string]*packageFacts) bool {
	for _, item := range facts {
		if len(nodeOwners(item.node)) > 0 {
			return true
		}
	}
	return false
}

func nodeOwners(node analyzer.Node) []string {
	if len(node.Owners) > 0 {
		return node.Owners
	}
	if node.Owner != "" {
		return []string{node.Owner}
	}
	return nil
}

func ownersDiffer(left, right analyzer.Node) bool {
	leftOwners, rightOwners := nodeOwners(left), nodeOwners(right)
	if len(leftOwners) == 0 || len(rightOwners) == 0 {
		return false
	}
	for _, leftOwner := range leftOwners {
		for _, rightOwner := range rightOwners {
			if leftOwner == rightOwner {
				return false
			}
		}
	}
	return true
}

func subsystem(path string) string {
	path = strings.Trim(filepath.ToSlash(path), "/")
	if index := strings.Index(path, "/"); index >= 0 {
		return path[:index]
	}
	return "root"
}

func dimension(factors []Factor) Dimension {
	available, contribution := 0.0, 0.0
	for index := range factors {
		if factors[index].Status != "observed" {
			continue
		}
		available += factors[index].Weight
		factors[index].Contribution = factors[index].Normalized * factors[index].Weight
		contribution += factors[index].Contribution
	}
	if available == 0 {
		return Dimension{Score: nil, Coverage: 0, Factors: factors}
	}
	score := int(math.Round(100 * contribution / available))
	return Dimension{Score: &score, Coverage: available, Factors: factors}
}

func unavailableDimension(factors []Factor) Dimension {
	return Dimension{Score: nil, Coverage: 0, Factors: factors}
}

func unavailableVelocityDimension() Dimension {
	return unavailableDimension([]Factor{
		{ID: "meaningful-churn", Label: "Recency-weighted meaningful churn", Weight: .35, Status: "unavailable", EvidenceRefs: []EvidenceRef{}},
		{ID: "change-sets", Label: "Recency-weighted change sets", Weight: .25, Status: "unavailable", EvidenceRefs: []EvidenceRef{}},
		{ID: "active-weeks", Label: "Active weeks", Weight: .15, Status: "unavailable", EvidenceRefs: []EvidenceRef{}},
		{ID: "distinct-authors", Label: "Distinct authors", Weight: .10, Status: "unavailable", EvidenceRefs: []EvidenceRef{}},
		{ID: "topology-change-frequency", Label: "Contract and schema changes", Weight: .15, Status: "unavailable", EvidenceRefs: []EvidenceRef{}},
	})
}

func applyVelocity(facts map[string]*packageFacts, files, packageDirs map[string]string, changes history.Result, windowDays int, now time.Time) {
	for _, event := range changes.Events {
		age := math.Max(0, now.Sub(event.OccurredAt).Hours()/24)
		if age > float64(windowDays) {
			continue
		}
		decay := math.Exp(-math.Ln2 * age / 30)
		perUnit := map[string]int{}
		topologyUnits := map[string]bool{}
		for _, file := range event.Files {
			if file.Generated || file.Excluded || file.Rename && file.Additions+file.Deletions == 0 {
				continue
			}
			unit := unitForFile(file.Path, files, packageDirs)
			if unit == "" && file.OldPath != "" {
				unit = unitForFile(file.OldPath, files, packageDirs)
			}
			if unit != "" {
				perUnit[unit] += file.Additions + file.Deletions
				if architectureBearing(file.Path) {
					topologyUnits[unit] = true
				}
			}
		}
		for unit, lines := range perUnit {
			item := facts[unit]
			noiseWeight := 1.0
			if event.RefactorNoise {
				noiseWeight = .2
			}
			item.velocity.churn += float64(min(lines, 1000)) * decay * noiseWeight
			item.velocity.changes += decay * noiseWeight
			year, week := event.OccurredAt.UTC().ISOWeek()
			item.velocity.weeks[fmt.Sprintf("%04d-W%02d", year, week)] = true
			item.velocity.authors[event.AuthorKey] = true
			item.velocity.evidenceIDs[event.ID] = true
			if topologyUnits[unit] {
				item.velocity.topology += decay * noiseWeight
				item.velocity.topologyIDs[event.ID] = true
			}
		}
	}
}

func unitForFile(path string, files, packageDirs map[string]string) string {
	path = strings.TrimPrefix(filepath.ToSlash(sourceFile(path)), "./")
	if unit := files[path]; unit != "" {
		return unit
	}
	best, bestUnit := "", ""
	if !strings.Contains(path, "/") {
		bestUnit = packageDirs[""]
	}
	for directory, unit := range packageDirs {
		if directory != "" && (path == directory || strings.HasPrefix(path, directory+"/")) && (len(directory) > len(best) || len(directory) == len(best) && unit < bestUnit) {
			best, bestUnit = directory, unit
		}
	}
	return bestUnit
}

func architectureBearing(path string) bool {
	value := strings.ToLower("/" + path)
	return strings.HasSuffix(value, ".proto") || strings.HasSuffix(value, ".sql") || strings.Contains(value, "/openapi") || strings.Contains(value, "/swagger") || strings.Contains(value, "/schema/") || strings.Contains(value, "/migrations/")
}

func reverseReachAll(facts map[string]*packageFacts) (map[string]int, map[string]map[string]bool) {
	ids := make([]string, 0, len(facts))
	for id := range facts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	indices := map[string]int{}
	neighbors, incomingEdges := map[string][]string{}, map[string][]string{}
	for index, id := range ids {
		indices[id] = index
		for next := range facts[id].incoming {
			neighbors[id] = append(neighbors[id], next)
		}
		for edgeID := range facts[id].incomingEdges {
			incomingEdges[id] = append(incomingEdges[id], edgeID)
		}
		sort.Strings(neighbors[id])
		sort.Strings(incomingEdges[id])
	}
	seen, queue := make([]int, len(ids)), make([]string, 0, len(ids))
	counts, evidence := map[string]int{}, map[string]map[string]bool{}
	for rootIndex, root := range ids {
		epoch := rootIndex + 1
		queue = append(queue[:0], root)
		edges := map[string]bool{}
		for cursor := 0; cursor < len(queue); cursor++ {
			current := queue[cursor]
			for _, edgeID := range incomingEdges[current] {
				if len(edges) < 50 {
					edges[edgeID] = true
				}
			}
			for _, next := range neighbors[current] {
				index := indices[next]
				if next != root && seen[index] != epoch {
					seen[index] = epoch
					counts[root]++
					queue = append(queue, next)
				}
			}
		}
		evidence[root] = edges
	}
	return counts, evidence
}

func cycleMembership(facts map[string]*packageFacts) map[string]bool {
	nextIndex := 0
	indices, low, onStack, result := map[string]int{}, map[string]int{}, map[string]bool{}, map[string]bool{}
	stack := []string{}
	var visit func(string)
	visit = func(node string) {
		nextIndex++
		indices[node], low[node] = nextIndex, nextIndex
		stack = append(stack, node)
		onStack[node] = true
		for next := range facts[node].outgoing {
			if indices[next] == 0 {
				visit(next)
				low[node] = min(low[node], low[next])
			} else if onStack[next] {
				low[node] = min(low[node], indices[next])
			}
		}
		if low[node] != indices[node] {
			return
		}
		component := []string{}
		for {
			member := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			onStack[member] = false
			component = append(component, member)
			if member == node {
				break
			}
		}
		if len(component) > 1 || facts[node].outgoing[node] {
			for _, member := range component {
				result[member] = true
			}
		}
	}
	ids := make([]string, 0, len(facts))
	for id := range facts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if indices[id] == 0 {
			visit(id)
		}
	}
	return result
}

func boundedBetweenness(facts map[string]*packageFacts, limit int) map[string]float64 {
	all := make([]string, 0, len(facts))
	for id := range facts {
		all = append(all, id)
	}
	sort.Strings(all)
	ids := all
	if len(all) > limit {
		ids = make([]string, limit)
		for index := range ids {
			ids[index] = all[index*(len(all)-1)/(limit-1)]
		}
	}
	scores := map[string]float64{}
	for _, source := range ids {
		stack, queue := []string{}, []string{source}
		paths, distance, predecessors := map[string]float64{source: 1}, map[string]int{source: 0}, map[string][]string{}
		for len(queue) > 0 {
			node := queue[0]
			queue = queue[1:]
			stack = append(stack, node)
			for target := range facts[node].outgoing {
				if _, ok := distance[target]; !ok {
					distance[target] = distance[node] + 1
					queue = append(queue, target)
				}
				if distance[target] == distance[node]+1 {
					paths[target] += paths[node]
					predecessors[target] = append(predecessors[target], node)
				}
			}
		}
		dependency := map[string]float64{}
		for len(stack) > 0 {
			node := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, previous := range predecessors[node] {
				if paths[node] != 0 {
					dependency[previous] += paths[previous] / paths[node] * (1 + dependency[node])
				}
			}
			if node != source {
				scores[node] += dependency[node]
			}
		}
	}
	maximum := 0.0
	for _, score := range scores {
		maximum = math.Max(maximum, score)
	}
	if maximum > 0 {
		for id := range scores {
			scores[id] /= maximum
		}
	}
	return scores
}

func normalize(value float64, cohort []float64) float64 {
	if value <= 0 {
		return 0
	}
	copyValues := append([]float64(nil), cohort...)
	sort.Float64s(copyValues)
	index := int(math.Ceil(float64(len(copyValues))*.95)) - 1
	if index < 0 {
		return 0
	}
	scale := math.Max(1, copyValues[min(index, len(copyValues)-1)])
	return math.Min(1, math.Log1p(value)/math.Log1p(scale))
}

func percentile(sorted []float64, quantile float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(math.Ceil(float64(len(sorted))*quantile)) - 1
	return sorted[max(0, min(index, len(sorted)-1))]
}

func displayValue(raw float64, unit string) string {
	if unit == "normalized" {
		return fmt.Sprintf("%.2f", raw)
	}
	if math.Abs(raw-math.Round(raw)) < .005 {
		return fmt.Sprintf("%.0f %s", raw, unit)
	}
	return fmt.Sprintf("%.1f %s", raw, unit)
}

func ratio(value, total int) float64 {
	if total <= 0 {
		return 0
	}
	return math.Min(1, float64(value)/float64(total))
}
func clamp(value float64) float64 { return math.Max(0, math.Min(1, value)) }
func value(score *int) int {
	if score == nil {
		return 0
	}
	return *score
}
func sourceFile(value string) string {
	if index := strings.LastIndex(value, ":"); index >= 0 {
		return value[:index]
	}
	return value
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func edgeRefs(groups ...map[string]bool) []EvidenceRef { return refs("edge", groups...) }
func gitRefs(groups ...map[string]bool) []EvidenceRef  { return refs("git-change", groups...) }
func refs(kind string, groups ...map[string]bool) []EvidenceRef {
	ids := map[string]bool{}
	for _, group := range groups {
		for id := range group {
			ids[id] = true
		}
	}
	ordered := make([]string, 0, len(ids))
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)
	if len(ordered) > 50 {
		ordered = ordered[:50]
	}
	result := make([]EvidenceRef, len(ordered))
	for index, id := range ordered {
		result[index] = EvidenceRef{Kind: kind, ID: id}
	}
	return result
}

func region(impact, complexity int, policy Policy) string {
	if impact >= policy.ImpactHigh && complexity >= policy.ComplexityHigh {
		return "investigate"
	}
	if impact >= policy.ImpactHigh {
		return "protect"
	}
	if complexity >= policy.ComplexityHigh {
		return "simplify"
	}
	return "low-attention"
}

func findings(units []Unit, policy Policy) []Finding {
	candidates := append([]Unit(nil), units...)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Priority > candidates[j].Priority || candidates[i].Priority == candidates[j].Priority && candidates[i].Unit.ID < candidates[j].Unit.ID
	})
	result := []Finding{}
	for _, unit := range candidates {
		if unit.Priority < policy.MinimumFindingPriority || unit.Region == "low-attention" {
			continue
		}
		dimensions := []Dimension{unit.Impact, unit.ChangeComplexity, unit.ChangeVelocity}
		title := fmt.Sprintf("%s deserves attention", unit.Unit.Label)
		switch unit.Region {
		case "investigate":
			title = fmt.Sprintf("%s combines high impact and change complexity", unit.Unit.Label)
		case "protect":
			title = fmt.Sprintf("%s is high-impact and should be protected", unit.Unit.Label)
		case "simplify":
			title = fmt.Sprintf("%s is costly to change and should be simplified", unit.Unit.Label)
			dimensions = []Dimension{unit.ChangeComplexity, unit.ChangeVelocity, unit.Impact}
		}
		dominant, evidence := []string{}, []EvidenceRef{}
		for _, dimension := range dimensions {
			factor, ok := strongestFactor(dimension)
			if !ok {
				continue
			}
			dominant = append(dominant, factor.Label+": "+factor.DisplayValue)
			evidence = append(evidence, factor.EvidenceRefs...)
		}
		explanation := strings.Join(dominant, "; ")
		result = append(result, Finding{ID: "attention:" + unit.Unit.ID, UnitID: unit.Unit.ID, Priority: unit.Priority, Region: unit.Region, Title: title, Explanation: explanation, DominantFactors: dominant, EvidenceRefs: uniqueEvidence(evidence)})
		if len(result) == policy.MaximumFindings {
			break
		}
	}
	return result
}

func strongestFactor(dimension Dimension) (Factor, bool) {
	factors := append([]Factor(nil), dimension.Factors...)
	sort.Slice(factors, func(i, j int) bool {
		return factors[i].Contribution > factors[j].Contribution || factors[i].Contribution == factors[j].Contribution && factors[i].ID < factors[j].ID
	})
	if len(factors) == 0 || factors[0].Contribution <= 0 {
		return Factor{}, false
	}
	return factors[0], true
}

func uniqueEvidence(values []EvidenceRef) []EvidenceRef {
	seen := map[string]bool{}
	result := make([]EvidenceRef, 0, len(values))
	for _, value := range values {
		key := value.Kind + "\x00" + value.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
}
