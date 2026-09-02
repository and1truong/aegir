package analyzer

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Node struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Label       string         `json:"label"`
	Service     string         `json:"service,omitempty"`
	Package     string         `json:"pkg,omitempty"`
	File        string         `json:"file,omitempty"`
	Description string         `json:"description,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
	Change      string         `json:"pr,omitempty"`
}

type Edge struct {
	ID           string   `json:"id"`
	Source       string   `json:"source"`
	Target       string   `json:"target"`
	Kind         string   `json:"kind"`
	Label        string   `json:"label,omitempty"`
	Boundary     string   `json:"boundary,omitempty"`
	Synchronous  bool     `json:"sync,omitempty"`
	Change       string   `json:"pr,omitempty"`
	EvidenceRefs []string `json:"evidenceRefs,omitempty"`
}

type EvidenceSubject struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type EvidenceLocation struct {
	File string `json:"file"`
	Line int    `json:"line,omitempty"`
}

type EvidenceRecord struct {
	ID       string            `json:"id"`
	Source   string            `json:"source"`
	Strength string            `json:"strength"`
	Subject  EvidenceSubject   `json:"subject"`
	Summary  string            `json:"summary"`
	Location *EvidenceLocation `json:"location,omitempty"`
}

type Evidence struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type Rule struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	Severity    string `json:"severity"`
	Description string `json:"description"`
	Rationale   string `json:"rationale"`
	Detects     string `json:"detects"`
}

type Violation struct {
	ID           string     `json:"id"`
	RuleID       string     `json:"ruleId"`
	Status       string     `json:"status"`
	Title        string     `json:"title"`
	Path         []string   `json:"path"`
	PrimaryNode  string     `json:"primaryNode"`
	Detail       string     `json:"detail"`
	Consequences []string   `json:"consequences"`
	Evidence     []Evidence `json:"evidence"`
}

type Coverage struct {
	NodeID string   `json:"nodeId"`
	Status string   `json:"status"`
	Line   int      `json:"line,omitempty"`
	Tests  []string `json:"tests"`
	Note   string   `json:"note,omitempty"`
}

type Contract struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Type        string            `json:"type"`
	Node        string            `json:"node"`
	Path        string            `json:"path"`
	Fingerprint string            `json:"fingerprint"`
	Shape       map[string]string `json:"shape"`
	Versions    []any             `json:"versions"`
}

type Options struct {
	CoverageProfile string
	TelemetryFile   string
	RepositoryName  string
}

type Analysis struct {
	Rules      []Rule       `json:"rules"`
	Violations []Violation  `json:"violations"`
	Coverage   []Coverage   `json:"coverage"`
	Contracts  []Contract   `json:"contracts"`
	Complexity []Complexity `json:"complexity"`
	Telemetry  []Telemetry  `json:"telemetry"`
}

type Telemetry struct {
	NodeID    string  `json:"nodeId"`
	RPM       float64 `json:"rpm,omitempty"`
	QPS       float64 `json:"qps,omitempty"`
	P50       float64 `json:"p50,omitempty"`
	P95       float64 `json:"p95,omitempty"`
	P99       float64 `json:"p99,omitempty"`
	ErrorRate float64 `json:"errorRate,omitempty"`
	Window    string  `json:"window"`
	Source    string  `json:"source"`
	Note      string  `json:"note,omitempty"`
}

type Complexity struct {
	NodeID     string `json:"nodeId"`
	Cyclomatic int    `json:"cyclomatic"`
	LOC        int    `json:"loc"`
	FanIn      int    `json:"fanIn"`
	FanOut     int    `json:"fanOut"`
	Score      int    `json:"score"`
}

type Repository struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Module string `json:"module"`
	Head   string `json:"head,omitempty"`
}

type Snapshot struct {
	Repository Repository       `json:"repository"`
	Nodes      []Node           `json:"nodes"`
	Edges      []Edge           `json:"edges"`
	Evidence   []EvidenceRecord `json:"evidence"`
	Analysis   Analysis         `json:"analysis"`
	Stats      map[string]int   `json:"stats"`
}

type function struct {
	node      Node
	pkgDir    string
	packageID string
	decl      *ast.FuncDecl
	file      *ast.File
	imports   map[string]string
	isTest    bool
}

type indexer struct {
	root      string
	module    string
	serviceID string
	fset      *token.FileSet
	nodes     map[string]Node
	edges     map[string]Edge
	evidence  map[string]EvidenceRecord
	functions []function
	byPackage map[string]map[string]string
	packages  map[string]string
	contracts []Contract
}

func stableID(kind, value string) string {
	sum := sha1.Sum([]byte(kind + "\x00" + value))
	return kind + ":" + hex.EncodeToString(sum[:8])
}

func (x *indexer) addEdge(source, kind, target, label, location string) {
	if source == "" || target == "" || source == target {
		return
	}
	id := source + "|" + kind + "|" + target
	edge := x.edges[id]
	if edge.ID == "" {
		edge = Edge{ID: id, Source: source, Target: target, Kind: kind, Label: label, Synchronous: kind == "calls"}
	}
	file, line := splitLocation(location)
	evidenceID := stableID("evidence", id+"\x00"+location+"\x00"+label)
	if !contains(edge.EvidenceRefs, evidenceID) {
		edge.EvidenceRefs = append(edge.EvidenceRefs, evidenceID)
		sort.Strings(edge.EvidenceRefs)
	}
	summary := label
	if summary == "" {
		summary = kind
	}
	record := EvidenceRecord{ID: evidenceID, Source: "STATIC", Strength: "proven", Subject: EvidenceSubject{Kind: "edge", ID: id}, Summary: summary}
	if file != "" {
		record.Source = "CODE"
		record.Location = &EvidenceLocation{File: file, Line: line}
	}
	x.evidence[evidenceID] = record
	x.edges[id] = edge
}

func (x *indexer) addBoundaryEdge(source, kind, target, label, boundary, location string) {
	x.addEdge(source, kind, target, label, location)
	id := source + "|" + kind + "|" + target
	edge := x.edges[id]
	edge.Boundary = boundary
	edge.Synchronous = boundary != "async"
	x.edges[id] = edge
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func splitLocation(value string) (string, int) {
	if value == "" {
		return "", 0
	}
	index := strings.LastIndex(value, ":")
	if index < 0 {
		return value, 0
	}
	line, err := strconv.Atoi(value[index+1:])
	if err != nil {
		return value, 0
	}
	return value[:index], line
}

func (x *indexer) sourceLocation(pos token.Pos) string {
	position := x.fset.Position(pos)
	if !position.IsValid() {
		return ""
	}
	rel, err := filepath.Rel(x.root, position.Filename)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s:%d", filepath.ToSlash(rel), position.Line)
}

func readModule(root string) string {
	b, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1]
		}
	}
	return ""
}

func gitHead(root string) string {
	if output, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output(); err == nil {
		return strings.TrimSpace(string(output))
	}
	head, err := os.ReadFile(filepath.Join(root, ".git", "HEAD"))
	if err != nil {
		return ""
	}
	value := strings.TrimSpace(string(head))
	if strings.HasPrefix(value, "ref: ") {
		refName := strings.TrimPrefix(value, "ref: ")
		ref, err := os.ReadFile(filepath.Join(root, ".git", refName))
		if err == nil {
			return strings.TrimSpace(string(ref))
		}
		if packed, packedErr := os.ReadFile(filepath.Join(root, ".git", "packed-refs")); packedErr == nil {
			for _, line := range strings.Split(string(packed), "\n") {
				fields := strings.Fields(line)
				if len(fields) == 2 && fields[1] == refName {
					return fields[0]
				}
			}
		}
		return ""
	}
	return value
}

func newIndexer(root, repositoryName string) *indexer {
	name := repositoryName
	if name == "" {
		name = filepath.Base(root)
	}
	return &indexer{
		root: root, module: readModule(root), serviceID: stableID("service", name), fset: token.NewFileSet(),
		nodes: map[string]Node{}, edges: map[string]Edge{}, evidence: map[string]EvidenceRecord{}, byPackage: map[string]map[string]string{}, packages: map[string]string{}, contracts: []Contract{},
	}
}

func (x *indexer) packageFor(dir, packageName string) string {
	rel, _ := filepath.Rel(x.root, dir)
	if rel == "." {
		rel = packageName
	}
	id, ok := x.packages[dir]
	if ok {
		return id
	}
	id = stableID("package", filepath.ToSlash(rel))
	x.packages[dir] = id
	x.nodes[id] = Node{ID: id, Kind: "package", Label: filepath.ToSlash(rel), Service: x.serviceID, File: filepath.ToSlash(rel)}
	x.addEdge(x.serviceID, "owns", id, "contains", filepath.ToSlash(rel))
	return id
}

func (x *indexer) localPackageID(importPath string) (string, bool) {
	if x.module == "" {
		return "", false
	}
	if importPath == x.module {
		if id := x.packages[x.root]; id != "" {
			return id, true
		}
		return stableID("package", filepath.Base(x.root)), true
	}
	prefix := x.module + "/"
	if !strings.HasPrefix(importPath, prefix) {
		return "", false
	}
	return stableID("package", strings.TrimPrefix(importPath, prefix)), true
}

func ignoredDir(name string) bool {
	switch name {
	case ".git", ".aegir", "node_modules", "vendor", "dist", "build", ".next", "coverage":
		return true
	default:
		return strings.HasPrefix(name, ".")
	}
}

func (x *indexer) collect() error {
	service := Node{ID: x.serviceID, Kind: "service", Label: filepath.Base(x.root), File: ".", Description: "Repository root", Meta: map[string]any{"module": x.module}}
	x.nodes[service.ID] = service
	return filepath.WalkDir(x.root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != x.root && ignoredDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(x.root, path)
		rel = filepath.ToSlash(rel)
		ext := strings.ToLower(filepath.Ext(path))
		base := strings.ToLower(entry.Name())
		if ext == ".yaml" || ext == ".yml" || ext == ".json" || ext == ".proto" {
			if strings.Contains(base, "openapi") || strings.Contains(base, "swagger") || strings.Contains(base, "asyncapi") || ext == ".proto" {
				typ := "interface"
				if ext == ".proto" {
					typ = "grpc"
				} else if strings.Contains(base, "asyncapi") {
					typ = "kafka"
				} else {
					typ = "openapi"
				}
				contract, contractErr := readContract(path, rel, typ)
				if contractErr != nil {
					return fmt.Errorf("parse contract %s: %w", rel, contractErr)
				}
				n := Node{ID: contract.ID, Kind: "contract", Label: entry.Name(), File: rel, Service: x.serviceID, Description: "Discovered contract file", Meta: map[string]any{"type": typ, "fingerprint": contract.Fingerprint}}
				x.nodes[contract.ID] = n
				x.contracts = append(x.contracts, contract)
			}
		}
		if ext != ".go" || strings.HasSuffix(base, ".generated.go") {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		parsed, err := parser.ParseFile(x.fset, path, source, parser.SkipObjectResolution|parser.ParseComments)
		if err != nil {
			return fmt.Errorf("parse %s: %w", rel, err)
		}
		pkgID := x.packageFor(filepath.Dir(path), parsed.Name.Name)
		imports := map[string]string{}
		for _, spec := range parsed.Imports {
			importPath, _ := strconv.Unquote(spec.Path.Value)
			alias := filepath.Base(importPath)
			if spec.Name != nil {
				alias = spec.Name.Name
			}
			imports[alias] = importPath
			if localID, local := x.localPackageID(importPath); local {
				x.addEdge(pkgID, "depends_on", localID, "imports", x.sourceLocation(spec.Pos()))
			} else {
				extID := stableID("package", importPath)
				if _, exists := x.nodes[extID]; !exists {
					x.nodes[extID] = Node{ID: extID, Kind: "package", Label: importPath, Tags: []string{"external"}}
				}
				x.addEdge(pkgID, "depends_on", extID, "imports", x.sourceLocation(spec.Pos()))
			}
		}
		if x.byPackage[pkgID] == nil {
			x.byPackage[pkgID] = map[string]string{}
		}
		for _, decl := range parsed.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			kind := "function"
			label := fn.Name.Name
			if fn.Recv != nil && len(fn.Recv.List) > 0 {
				kind = "method"
				label = receiverName(fn.Recv.List[0].Type) + "." + fn.Name.Name
			}
			isTest := strings.HasSuffix(base, "_test.go") && strings.HasPrefix(fn.Name.Name, "Test")
			if isTest {
				kind = "test"
			}
			pos := x.fset.Position(fn.Pos())
			id := stableID(kind, rel+":"+label)
			end := x.fset.Position(fn.End())
			startOffset, endOffset := x.fset.File(fn.Pos()).Offset(fn.Pos()), x.fset.File(fn.End()).Offset(fn.End())
			fingerprint := ""
			if startOffset >= 0 && endOffset <= len(source) && startOffset < endOffset {
				sum := sha1.Sum(source[startOffset:endOffset])
				fingerprint = hex.EncodeToString(sum[:])
			}
			n := Node{ID: id, Kind: kind, Label: label, Service: x.serviceID, Package: pkgID, File: fmt.Sprintf("%s:%d", rel, pos.Line), Meta: map[string]any{"exported": ast.IsExported(fn.Name.Name), "startLine": pos.Line, "endLine": end.Line, "fingerprint": fingerprint}}
			x.nodes[id] = n
			x.byPackage[pkgID][fn.Name.Name] = id
			x.byPackage[pkgID][label] = id
			x.functions = append(x.functions, function{node: n, pkgDir: filepath.Dir(path), packageID: pkgID, decl: fn, file: parsed, imports: imports, isTest: isTest})
			x.addEdge(pkgID, "owns", id, "declares", x.sourceLocation(fn.Pos()))
		}
		return nil
	})
}

func receiverName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.StarExpr:
		return receiverName(value.X)
	case *ast.IndexExpr:
		return receiverName(value.X)
	case *ast.IndexListExpr:
		return receiverName(value.X)
	default:
		return "receiver"
	}
}

func literalString(expr ast.Expr) string {
	lit, ok := expr.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return ""
	}
	value, _ := strconv.Unquote(lit.Value)
	return value
}

func (x *indexer) resolveCall(fn function, call *ast.CallExpr) (string, string) {
	switch target := call.Fun.(type) {
	case *ast.Ident:
		return x.byPackage[fn.packageID][target.Name], target.Name
	case *ast.SelectorExpr:
		if ident, ok := target.X.(*ast.Ident); ok {
			if importPath := fn.imports[ident.Name]; importPath != "" {
				if packageID, local := x.localPackageID(importPath); local {
					if id := x.byPackage[packageID][target.Sel.Name]; id != "" {
						return id, importPath + "." + target.Sel.Name
					}
					return packageID, importPath + "." + target.Sel.Name
				}
				return stableID("package", importPath), importPath + "." + target.Sel.Name
			}
		}
		if id := x.byPackage[fn.packageID][target.Sel.Name]; id != "" {
			return id, target.Sel.Name
		}
		return "", target.Sel.Name
	}
	return "", ""
}

func (x *indexer) connect() {
	for _, fn := range x.functions {
		if fn.decl.Body == nil {
			continue
		}
		ast.Inspect(fn.decl.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			targetID, callName := x.resolveCall(fn, call)
			if targetID != "" {
				kind := "calls"
				if fn.isTest && x.nodes[targetID].Kind != "package" {
					kind = "tests"
				}
				x.addEdge(fn.node.ID, kind, targetID, callName, x.sourceLocation(call.Pos()))
			}
			x.connectDataflow(fn, call)
			name := strings.ToUpper(callName)
			if strings.Contains(name, "HANDLEFUNC") || strings.HasSuffix(name, ".GET") || strings.HasSuffix(name, ".POST") || strings.HasSuffix(name, ".PUT") || strings.HasSuffix(name, ".DELETE") {
				path := ""
				for _, arg := range call.Args {
					if value := literalString(arg); strings.HasPrefix(value, "/") {
						path = value
						break
					}
				}
				if path != "" {
					method := "HTTP"
					for _, candidate := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
						if strings.Contains(name, candidate) {
							method = candidate
							break
						}
					}
					id := stableID("endpoint", method+" "+path)
					x.nodes[id] = Node{ID: id, Kind: "endpoint", Label: method + " " + path, Service: x.serviceID, File: fn.node.File}
					x.addEdge(id, "calls", fn.node.ID, "handler", x.sourceLocation(call.Pos()))
				}
			}
			return true
		})
	}
}

var sqlTablePattern = regexp.MustCompile(`(?i)\b(FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_.]*)`)

func expressionName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.SelectorExpr:
		prefix := expressionName(value.X)
		if prefix == "" {
			return value.Sel.Name
		}
		return prefix + "." + value.Sel.Name
	default:
		return ""
	}
}

func callStrings(call *ast.CallExpr) []string {
	values := []string{}
	for _, arg := range call.Args {
		if value := literalString(arg); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func (x *indexer) resourceNode(kind, label, description string) string {
	id := stableID(kind, label)
	if _, exists := x.nodes[id]; !exists {
		x.nodes[id] = Node{ID: id, Kind: kind, Label: label, Service: x.serviceID, Description: description}
	}
	return id
}

func (x *indexer) connectDataflow(fn function, call *ast.CallExpr) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	receiverName := expressionName(selector.X)
	receiver := strings.ToLower(receiverName)
	method := strings.ToLower(selector.Sel.Name)
	values := callStrings(call)

	if method == "query" || method == "querycontext" || method == "queryrow" || method == "queryrowcontext" || method == "select" || method == "get" || method == "exec" || method == "execcontext" || method == "namedexec" {
		for _, query := range values {
			matches := sqlTablePattern.FindAllStringSubmatch(query, -1)
			if len(matches) == 0 {
				continue
			}
			operation := strings.ToUpper(strings.Fields(strings.TrimSpace(query))[0])
			kind := "reads"
			if operation == "INSERT" || operation == "UPDATE" || operation == "DELETE" || operation == "REPLACE" {
				kind = "writes"
			}
			for _, match := range matches {
				table := strings.Trim(match[2], "`\"")
				if strings.EqualFold(table, "SET") {
					continue
				}
				target := x.resourceNode("table", table, "SQL table discovered from a literal query")
				x.addBoundaryEdge(fn.node.ID, kind, target, operation, "persistence", x.sourceLocation(call.Pos()))
			}
			return
		}
	}

	messageReceiver := strings.Contains(receiver, "kafka") || strings.Contains(receiver, "broker") || strings.Contains(receiver, "producer") || strings.Contains(receiver, "publisher") || strings.Contains(receiver, "consumer") || strings.Contains(receiver, "subscriber") || strings.Contains(receiver, "event") || strings.Contains(receiver, "queue")
	messageKind := ""
	if method == "publish" || method == "produce" || (messageReceiver && (method == "send" || method == "sendmessage")) {
		messageKind = "publishes"
	}
	if method == "subscribe" || method == "consume" || (messageReceiver && method == "receive") {
		messageKind = "consumes"
	}
	if messageKind != "" {
		for _, value := range values {
			if value == "" || strings.ContainsAny(value, " /\\") || strings.Contains(value, "://") {
				continue
			}
			target := x.resourceNode("topic", value, "Message topic discovered from a literal call argument")
			x.addBoundaryEdge(fn.node.ID, messageKind, target, selector.Sel.Name, "async", x.sourceLocation(call.Pos()))
			return
		}
	}

	cacheReceiver := strings.Contains(receiver, "cache") || strings.Contains(receiver, "redis")
	if cacheReceiver && (method == "get" || method == "mget" || method == "set" || method == "mset" || method == "del" || method == "delete") {
		for _, value := range values {
			if value == "" || len(value) > 120 {
				continue
			}
			kind := "reads"
			if method != "get" && method != "mget" {
				kind = "writes"
			}
			target := x.resourceNode("cache", value, "Cache key discovered from a literal call argument")
			x.addBoundaryEdge(fn.node.ID, kind, target, selector.Sel.Name, "persistence", x.sourceLocation(call.Pos()))
			return
		}
	}

	httpMethod := method == "get" || method == "post" || method == "head" || method == "do" || method == "request" || method == "newrequest" || method == "newrequestwithcontext"
	httpCall := httpMethod && (fn.imports[receiverName] == "net/http" || strings.Contains(receiver, "http") || strings.Contains(receiver, "client"))
	if !httpCall {
		return
	}
	for _, value := range values {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			continue
		}
		target := x.resourceNode("external", parsed.Host, "External HTTP destination discovered from a literal URL")
		x.addBoundaryEdge(fn.node.ID, "calls", target, strings.ToUpper(method), "network", x.sourceLocation(call.Pos()))
		return
	}
}

func (x *indexer) analyze() Analysis {
	rules := []Rule{
		{ID: "AEGIR-ARCH-001", Title: "Package dependency cycle", Category: "Architecture", Severity: "high", Description: "Packages form a dependency cycle.", Rationale: "Cycles make boundaries and independent change difficult.", Detects: "strongly connected components in package dependency edges"},
		{ID: "AEGIR-ARCH-002", Title: "Function has high fan-out", Category: "Architecture", Severity: "medium", Description: "A function directly calls more than twelve symbols.", Rationale: "High fan-out is a concrete signal of coordination complexity.", Detects: "outgoing calls > 12"},
		{ID: "AEGIR-OWN-001", Title: "Repository has no CODEOWNERS", Category: "Ownership", Severity: "low", Description: "No CODEOWNERS file was found.", Rationale: "Changes lack an explicit review owner.", Detects: "missing CODEOWNERS in standard locations"},
		{ID: "AEGIR-TEST-001", Title: "Exported symbol has no reachable test", Category: "Reliability", Severity: "low", Description: "No test reaches an exported function or method in the indexed call graph.", Rationale: "Changed public behavior may have no direct verification path.", Detects: "static test reachability over calls/tests edges"},
		{ID: "AEGIR-COMPLEXITY-001", Title: "Function has high cyclomatic complexity", Category: "Architecture", Severity: "medium", Description: "A function has more than fifteen independent control-flow paths.", Rationale: "Branch-heavy functions are harder to understand, test, and change safely.", Detects: "cyclomatic complexity > 15"},
	}
	violations := []Violation{}
	out := map[string][]string{}
	testRoots := []string{}
	for _, edge := range x.edges {
		if edge.Kind == "calls" || edge.Kind == "tests" {
			out[edge.Source] = append(out[edge.Source], edge.Target)
		}
		if edge.Kind == "calls" { /* counted below */
		}
	}
	for _, node := range x.nodes {
		if node.Kind == "test" {
			testRoots = append(testRoots, node.ID)
		}
	}
	reachedBy := map[string][]string{}
	for _, root := range testRoots {
		seen := map[string]bool{root: true}
		queue := []string{root}
		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]
			for _, next := range out[cur] {
				if !seen[next] {
					seen[next] = true
					queue = append(queue, next)
					reachedBy[next] = append(reachedBy[next], root)
				}
			}
		}
	}
	for _, cycle := range x.packageCycles() {
		labels := make([]string, 0, len(cycle))
		for _, id := range cycle {
			labels = append(labels, x.nodes[id].Label)
		}
		violations = append(violations, Violation{
			ID: stableID("violation", "package-cycle:"+strings.Join(cycle, ":")), RuleID: "AEGIR-ARCH-001", Status: "existing",
			Title: "Package dependency cycle: " + strings.Join(labels, " → "), Path: cycle, PrimaryNode: cycle[0],
			Detail: "These packages form a strongly connected component in the import graph.", Consequences: []string{"Packages cannot be changed or tested as independent boundaries."},
			Evidence: []Evidence{{Kind: "GRAPH", Text: strings.Join(labels, " → ")}},
		})
	}
	coverage := []Coverage{}
	complexity := []Complexity{}
	functionByID := map[string]function{}
	for _, fn := range x.functions {
		functionByID[fn.node.ID] = fn
	}
	for _, node := range x.nodes {
		if node.Kind != "function" && node.Kind != "method" {
			continue
		}
		tests := unique(reachedBy[node.ID])
		status := "uncovered"
		if len(tests) > 0 {
			status = "covered"
		}
		coverage = append(coverage, Coverage{NodeID: node.ID, Status: status, Tests: tests, Note: "Static reachability from Go test functions; import runtime coverage to confirm execution."})
		calls := 0
		for _, edge := range x.edges {
			if edge.Source == node.ID && edge.Kind == "calls" {
				calls++
			}
		}
		if calls > 12 {
			violations = append(violations, Violation{ID: stableID("violation", "fanout:"+node.ID), RuleID: "AEGIR-ARCH-002", Status: "existing", Title: node.Label + " has high fan-out", Path: []string{node.ID}, PrimaryNode: node.ID, Detail: fmt.Sprintf("%s has %d direct call edges.", node.Label, calls), Consequences: []string{"Changes can affect many collaborators."}, Evidence: []Evidence{{Kind: "GRAPH", Text: fmt.Sprintf("%d outgoing calls", calls)}}})
		}
		if exported, _ := node.Meta["exported"].(bool); exported && len(tests) == 0 {
			violations = append(violations, Violation{ID: stableID("violation", "untested:"+node.ID), RuleID: "AEGIR-TEST-001", Status: "existing", Title: node.Label + " has no reachable test", Path: []string{node.ID}, PrimaryNode: node.ID, Detail: "No Go test function reaches this symbol in the indexed call graph.", Consequences: []string{"Behavior changes may be unverified."}, Evidence: []Evidence{{Kind: "TEST", Text: "No static test path found"}}})
		}
		fn := functionByID[node.ID]
		cyclomatic := cyclomaticComplexity(fn.decl)
		start, _ := numberMeta(node.Meta["startLine"])
		end, _ := numberMeta(node.Meta["endLine"])
		loc := end - start + 1
		fanIn, fanOut := 0, 0
		for _, edge := range x.edges {
			if edge.Kind != "calls" {
				continue
			}
			if edge.Source == node.ID {
				fanOut++
			}
			if edge.Target == node.ID {
				fanIn++
			}
		}
		score := 1 + (cyclomatic-1)/3 + fanOut/4 + loc/100
		if score > 10 {
			score = 10
		}
		complexity = append(complexity, Complexity{NodeID: node.ID, Cyclomatic: cyclomatic, LOC: loc, FanIn: fanIn, FanOut: fanOut, Score: score})
		if cyclomatic > 15 {
			violations = append(violations, Violation{ID: stableID("violation", "complexity:"+node.ID), RuleID: "AEGIR-COMPLEXITY-001", Status: "existing", Title: node.Label + " has high cyclomatic complexity", Path: []string{node.ID}, PrimaryNode: node.ID, Detail: fmt.Sprintf("%s has cyclomatic complexity %d across %d lines.", node.Label, cyclomatic, loc), Consequences: []string{"More independent paths require proportionally more tests."}, Evidence: []Evidence{{Kind: "CODE", Text: fmt.Sprintf("cyclomatic=%d loc=%d", cyclomatic, loc)}}})
		}
	}
	if !hasCodeowners(x.root) {
		violations = append(violations, Violation{ID: stableID("violation", "codeowners"), RuleID: "AEGIR-OWN-001", Status: "existing", Title: "Repository has no CODEOWNERS", Path: []string{x.serviceID}, PrimaryNode: x.serviceID, Detail: "No CODEOWNERS file exists in .github/, docs/, or the repository root.", Consequences: []string{"Review ownership is implicit."}, Evidence: []Evidence{{Kind: "GIT", Text: "CODEOWNERS not found"}}})
	}
	sort.Slice(coverage, func(i, j int) bool { return coverage[i].NodeID < coverage[j].NodeID })
	sort.Slice(complexity, func(i, j int) bool { return complexity[i].NodeID < complexity[j].NodeID })
	return Analysis{Rules: rules, Violations: violations, Coverage: coverage, Contracts: x.contracts, Complexity: complexity}
}

func cyclomaticComplexity(decl *ast.FuncDecl) int {
	if decl == nil || decl.Body == nil {
		return 1
	}
	value := 1
	ast.Inspect(decl.Body, func(node ast.Node) bool {
		switch current := node.(type) {
		case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
			value++
		case *ast.CaseClause:
			if len(current.List) > 0 {
				value++
			}
		case *ast.CommClause:
			if current.Comm != nil {
				value++
			}
		case *ast.BinaryExpr:
			if current.Op == token.LAND || current.Op == token.LOR {
				value++
			}
		}
		return true
	})
	return value
}

func (x *indexer) packageCycles() [][]string {
	adjacency := map[string][]string{}
	for _, edge := range x.edges {
		if edge.Kind != "depends_on" || x.nodes[edge.Source].Kind != "package" || x.nodes[edge.Target].Kind != "package" {
			continue
		}
		if tags := x.nodes[edge.Target].Tags; len(tags) > 0 && tags[0] == "external" {
			continue
		}
		adjacency[edge.Source] = append(adjacency[edge.Source], edge.Target)
	}
	index := 0
	indices, low, onStack := map[string]int{}, map[string]int{}, map[string]bool{}
	stack := []string{}
	components := [][]string{}
	var visit func(string)
	visit = func(node string) {
		index++
		indices[node], low[node], onStack[node] = index, index, true
		stack = append(stack, node)
		for _, next := range adjacency[node] {
			if indices[next] == 0 {
				visit(next)
				if low[next] < low[node] {
					low[node] = low[next]
				}
			} else if onStack[next] && indices[next] < low[node] {
				low[node] = indices[next]
			}
		}
		if low[node] != indices[node] {
			return
		}
		component := []string{}
		for len(stack) > 0 {
			last := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			onStack[last] = false
			component = append(component, last)
			if last == node {
				break
			}
		}
		if len(component) > 1 {
			sort.Strings(component)
			components = append(components, component)
		}
	}
	for id, node := range x.nodes {
		if node.Kind == "package" && indices[id] == 0 {
			visit(id)
		}
	}
	sort.Slice(components, func(i, j int) bool { return strings.Join(components[i], ":") < strings.Join(components[j], ":") })
	return components
}

func hasCodeowners(root string) bool {
	for _, path := range []string{"CODEOWNERS", filepath.Join(".github", "CODEOWNERS"), filepath.Join("docs", "CODEOWNERS")} {
		if _, err := os.Stat(filepath.Join(root, path)); err == nil {
			return true
		}
	}
	return false
}

func unique(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}

func Run(root string) (Snapshot, error) { return RunWithOptions(root, Options{}) }

func RunWithOptions(root string, options Options) (Snapshot, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return Snapshot{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Snapshot{}, err
	}
	if !info.IsDir() {
		return Snapshot{}, errors.New("repository path is not a directory")
	}
	if _, err := os.Stat(filepath.Join(abs, ".git")); err != nil {
		return Snapshot{}, errors.New("repository path does not contain .git")
	}
	x := newIndexer(abs, options.RepositoryName)
	if err := x.collect(); err != nil {
		return Snapshot{}, err
	}
	x.connect()
	analysis := x.analyze()
	if options.CoverageProfile != "" {
		if err := applyCoverageProfile(abs, x.module, options.CoverageProfile, x.nodes, &analysis); err != nil {
			return Snapshot{}, err
		}
	}
	if options.TelemetryFile != "" {
		if err := applyTelemetryFile(abs, options.TelemetryFile, x.nodes, &analysis); err != nil {
			return Snapshot{}, err
		}
	}
	nodes := make([]Node, 0, len(x.nodes))
	for _, n := range x.nodes {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	edges := make([]Edge, 0, len(x.edges))
	for _, e := range x.edges {
		edges = append(edges, e)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	evidence := make([]EvidenceRecord, 0, len(x.evidence))
	for _, record := range x.evidence {
		evidence = append(evidence, record)
	}
	sort.Slice(evidence, func(i, j int) bool { return evidence[i].ID < evidence[j].ID })
	stats := map[string]int{"nodes": len(nodes), "edges": len(edges), "violations": len(analysis.Violations), "contracts": len(analysis.Contracts)}
	return Snapshot{Repository: Repository{Name: filepath.Base(abs), Path: abs, Module: x.module, Head: gitHead(abs)}, Nodes: nodes, Edges: edges, Evidence: evidence, Analysis: analysis, Stats: stats}, nil
}
