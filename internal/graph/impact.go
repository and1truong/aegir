package graph

import "github.com/and1truong/aegir/internal/analyzer"

type Impact struct {
	Root       string          `json:"root"`
	Hops       map[string]int  `json:"hops"`
	Direct     []string        `json:"direct"`
	Transitive []string        `json:"transitive"`
	Nodes      []analyzer.Node `json:"nodes"`
	Edges      []analyzer.Edge `json:"edges"`
}

func Analyze(root string, depth int, nodes []analyzer.Node, edges []analyzer.Edge) Impact {
	if depth < 1 {
		depth = 1
	}
	byID := map[string]analyzer.Node{}
	for _, node := range nodes {
		byID[node.ID] = node
	}
	hops := map[string]int{root: 0}
	queue := []string{root}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		hop := hops[current]
		if hop >= depth {
			continue
		}
		for _, edge := range edges {
			next := ""
			if edge.Target == current && (edge.Kind == "calls" || edge.Kind == "tests" || edge.Kind == "depends_on") {
				next = edge.Source
			}
			if edge.Source == current && (edge.Kind == "writes" || edge.Kind == "publishes" || edge.Kind == "owns") {
				next = edge.Target
			}
			if next != "" {
				if _, seen := hops[next]; !seen {
					if _, ok := byID[next]; ok {
						hops[next] = hop + 1
						queue = append(queue, next)
					}
				}
			}
		}
	}
	result := Impact{Root: root, Hops: hops, Direct: []string{}, Transitive: []string{}, Nodes: []analyzer.Node{}, Edges: []analyzer.Edge{}}
	visible := map[string]bool{}
	for id, hop := range hops {
		visible[id] = true
		if id == root {
			continue
		}
		if hop == 1 {
			result.Direct = append(result.Direct, id)
		} else {
			result.Transitive = append(result.Transitive, id)
		}
	}
	for _, node := range nodes {
		if visible[node.ID] {
			result.Nodes = append(result.Nodes, node)
		}
	}
	for _, edge := range edges {
		if visible[edge.Source] && visible[edge.Target] {
			result.Edges = append(result.Edges, edge)
		}
	}
	return result
}
