Build a high-fidelity interactive frontend prototype for a developer tool focused on **system understanding, architectural impact analysis, and AI-assisted code review**.

This is a UI/UX prototype only.

Everything uses coherent mock data.

Do NOT build:

* repository indexing
* AST parsing
* real GitHub integration
* real LLM integration
* telemetry ingestion
* backend APIs
* real static analysis

Use React + TypeScript.

Prefer:

* Tailwind
* React Flow or equivalent
* Lucide icons
* local mocked TypeScript datasets

The prototype must feel like a real engineering product, not a generic dashboard.

---

# PRODUCT THESIS

GitHub shows what text changed.

This product shows:

* what system changed
* what depends on it
* what data flows through it
* what contracts changed
* what runtime paths are affected
* what architectural rules are violated
* what complexity was introduced
* what behavior is insufficiently tested
* what reviewers should investigate

The system graph is not just a visualization.

Treat it as an **executable system model** supporting:

* exploration
* querying
* linting
* impact analysis
* diffing
* code review
* AI-assisted reasoning

---

# TARGET USERS

Design primarily for:

* Staff Engineers
* Principal Engineers
* senior backend engineers
* platform engineers
* architects
* technical leads reviewing large or AI-generated PRs

---

# VISUAL DIRECTION

Desktop-first engineering workspace.

Style references:

* Linear
* GitHub
* Grafana
* Datadog
* IDE tooling
* observability products

Characteristics:

* dense but readable
* serious
* minimal
* information-first
* restrained use of cards
* strong hierarchy
* monospaced text where appropriate
* side panels and inspectors
* graph should feel like an engineering instrument

Avoid:

* marketing dashboards
* oversized cards
* decorative analytics
* meaningless charts
* colorful graph spaghetti

---

# APPLICATION SHELL

Persistent left navigation:

* Overview
* System Explorer
* Pull Requests
* Rules
* Search
* Settings

Repository selector:

`acme/commerce-platform`

Mock system:

Services:

* checkout-api
* order-service
* payment-service
* fulfillment-service
* analytics-service
* notification-service

Infrastructure:

* PostgreSQL
* Redis
* Kafka
* Stripe
* Fraud API

Engineering teams:

* Checkout Platform
* Payments
* Risk Platform
* Fulfillment

Use realistic Go packages/functions.

---

# MOCK SYSTEM MODEL

Create internally coherent graph data.

Support node types:

* service
* package
* function
* method
* HTTP endpoint
* event/topic
* DB table
* cache
* external API
* transaction
* test
* schema/contract

Support edge types:

* calls
* reads
* writes
* publishes
* consumes
* depends on
* owns
* implements
* tests
* transforms
* retries

Every screen should reference the same underlying mock model.

---

# SCREEN 1 — SYSTEM EXPLORER

Primary purpose:

Understand an unfamiliar system quickly.

Three-panel workspace:

LEFT:
Navigator

CENTER:
Graph / Dataflow

RIGHT:
Inspector

---

# LEFT NAVIGATOR

Tabs:

* Services
* Packages
* APIs
* Events
* Databases
* Infrastructure

Example:

checkout-api
internal/http
CreateOrderHandler
internal/order
CreateOrder
ValidateOrder
internal/payment
AuthorizePayment

payment-service
consumer
OrderCreatedConsumer
domain
ChargeCustomer

Kafka
order.created
payment.completed
fulfillment.requested

PostgreSQL
orders
order_items
payments
customers
fulfillment_jobs

Support:

* search
* filter
* expand/collapse
* selecting item focuses graph

---

# GRAPH MODES

At the top of the workspace provide modes:

* Dependencies
* Data Flow
* Runtime
* Impact
* Complexity
* Test Coverage
* Contract Impact
* Lint

These are visualization layers over the same system model.

Do not show all layers simultaneously.

---

# DEPENDENCY GRAPH

Example contextual graph:

POST /orders
→ CreateOrderHandler
→ CreateOrder
→ FraudClient.Check
→ OrderRepository.Insert
→ orders
→ Kafka.Publish
→ order.created
→ PaymentConsumer
→ ChargeCustomer
→ Stripe

Allow:

* pan
* zoom
* select node
* expand upstream
* expand downstream
* collapse branch
* fit selection
* filter edge types
* choose dependency depth

Never render the entire repository by default.

Graph must always be contextual.

---

# DATA FLOW MODE

Render data movement rather than structural dependencies.

Example:

HTTP Request
→ JSON Decode
→ ValidateOrder
→ CreateOrder
→ INSERT orders
→ publish order.created
→ PaymentConsumer
→ Stripe API
→ UPDATE payments

Explicitly visualize boundaries:

* network boundary
* transaction boundary
* persistence boundary
* async boundary
* process/service boundary

Show transformations on edges where useful.

---

# RUNTIME OVERLAY

Use mock production telemetry.

Examples:

POST /orders
8.2k rpm
p99 184ms

CreateOrder
p99 121ms

Fraud API
p99 91ms
1.1% errors

PostgreSQL
3.1k qps
p99 28ms

Stripe
p99 210ms

Use:

* edge thickness for traffic volume
* concise node metrics
* inspector for detailed telemetry

Runtime numbers are factual mock telemetry.

Do not present them as AI predictions.

---

# IMPACT MODE

Selecting a node and clicking:

`Show Impact`

highlights:

Direct dependents
Transitive dependents

Example:

CreateOrder

Direct:

* CreateOrderHandler
* orders
* order.created

Transitive:

* payment-service
* fulfillment-service
* analytics-service
* Stripe

Summary:

Direct dependents: 3
Transitive dependents: 8
Services affected: 4
Teams affected: 3

Depth:

1 hop
2 hops
3 hops
All

---

# COMPLEXITY MODE

Visualize complexity as multiple dimensions, not just cyclomatic complexity.

Each relevant node may have:

Local complexity:

* cognitive complexity
* cyclomatic complexity
* LOC
* nesting

Dependency complexity:

* fan-in
* fan-out
* graph depth
* cycles

Change complexity:

* change frequency
* churn
* author count

System complexity:

* services touched
* tables touched
* topics touched
* external dependencies
* failure boundaries

Example inspector:

CreateOrder

Local complexity       7/10
Dependency complexity  9/10
Change complexity      8/10
System complexity      9/10

Fan-in                 12
Fan-out                 9
External dependencies   2
Topics                   2
Tables                   3
Teams affected           3

Support:

* complexity heat overlay
* filter complexity > threshold
* highlight hotspots

Also support PR complexity diff:

BASE:
CreateOrder C5

PR:
CreateOrder C8

Show:

Complexity +3
Fan-out 4 → 7
Failure paths 3 → 8
External dependencies 0 → 1

---

# TEST COVERAGE MODE

Do NOT only show line coverage.

Visualize **behavior/path coverage** on the graph.

Example:

POST /orders ✅
→ CreateOrder ✅
→ ValidateOrder ✅
→ FraudClient.Check ⚠
→ approved ✅
→ rejected ✅
→ timeout ❌
→ 500/retry ❌
→ OrderRepository.Insert ✅
→ Kafka.Publish ⚠
→ publish failure ❌

Inspector:

CreateOrder

Line coverage            91%
Branch coverage          76%
Behavior paths          12 / 16
Failure paths            3 / 7
Integration paths        4 / 5
PR impact coverage       62%

Missing:

* Fraud timeout
* Fraud 500 + retry exhaustion
* Kafka publish failure

Allow graph to visualize:

* covered node/path
* partially covered
* uncovered
* unknown

Make edge/path coverage first-class.

---

# RISK HOTSPOTS

Provide a useful system-level hotspot mode based on combinations such as:

complexity
× runtime traffic
× change frequency
× test weakness

Example:

CreateOrder

High complexity
8.2k rpm
19 changes / 90 days
31% failure-path coverage

Flag as high-risk hotspot.

Do not pretend there is a scientifically precise single risk score.

Show contributing dimensions instead.

---

# GRAPH LINTER

The graph must be lintable.

Create mock deterministic architectural/system rules.

Examples:

ARCH-014
External network I/O inside DB transaction

ARCH-021
Synchronous request path exceeds 4 network hops

ARCH-032
Cross-team internal package dependency

REL-008
Retry exists at multiple layers of same call chain

DATA-011
Kafka consumer mutates state without visible idempotency boundary

OWN-004
Dependency has no owner

CONTRACT-009
Consumer incompatible with contract change

Graph Lint mode:

* highlight violating node or path
* warning markers attached directly to graph
* severity
* rule ID

Click violation:

ARCH-014 — External I/O inside transaction

Path:

CreateOrder
→ DB Transaction
→ FraudClient.Check

Potential consequences:

* transaction duration tied to external latency
* DB connection held during network I/O
* timeout may extend lock duration

Evidence:

CODE
GRAPH
DATAFLOW

Also provide violations panel grouped by:

* Architecture
* Reliability
* Performance
* Data
* Ownership
* Contracts

---

# GRAPH DIFF / NEW VIOLATIONS

For PR review, lint the graph diff.

Do not focus on historical violations by default.

Show:

Existing violations: 14
New violations introduced: 2
Resolved violations: 1

Example:

BASE:

CreateOrder
→ PostgreSQL

PR:

CreateOrder
→ PostgreSQL
→ Fraud API
⚠ ARCH-014

The most important question is:

**Did this PR introduce a new system-level violation?**

---

# CONTRACT IMPACT MODE

Visualize API/schema compatibility and concrete consumer impact.

Support mock contracts:

* REST/OpenAPI
* Kafka events
* protobuf/gRPC
* DB schemas
* exported interfaces

Example API change:

GET /orders/{id}

BEFORE:

status:
pending | paid

AFTER:

status:
pending | paid | fraud_rejected

Show consumers:

Order API
→ Web frontend ✅
→ Mobile app ⚠
→ Billing job ❌

Click Billing:

BROKEN CONTRACT

Changed contract:
Order.status added `fraud_rejected`

Consumer:
billing/order_mapper.go:84

Problem:
consumer uses exhaustive handling and has no branch for new enum value

Evidence:

SCHEMA
GRAPH
CODE

Distinguish:

* SAFE
* CONDITIONALLY SAFE
* POTENTIALLY BREAKING
* CONFIRMED BREAK

Never call something a confirmed break without concrete consumer evidence.

---

# CONTRACT DIFF

Also support event contract example:

`order.created`

Version before vs after.

Example removed field:

customer.email

Consumers:

payment-service ✅
fulfillment-service ✅
analytics-service ❌

The graph should clearly show where compatibility breaks.

---

# NODE INSPECTOR

Selecting `CreateOrder` should show:

Identity:

CreateOrder
checkout/internal/order/create_order.go:42

Owner:
Checkout Platform

Called by:

* CreateOrderHandler
* RetryOrderJob

Calls:

* ValidateOrder
* FraudClient.Check
* OrderRepository.Insert
* Kafka.Publish

Reads:

* customers

Writes:

* orders
* order_items

Publishes:

* order.created

Runtime:

8.2k rpm
p50 42ms
p95 121ms
p99 184ms
0.18% error rate

Complexity:

Local 7/10
Dependency 9/10
System 9/10

Coverage:

Branch 76%
Failure paths 3/7

Recent changes:

PR #1842
PR #1798

Related incident:

INC-481
Duplicate OrderCreated caused duplicate payment attempts

Everything should deep-link back into graph context.

---

# SCREEN 2 — PULL REQUEST REVIEW

Mock PR:

PR #1842

Title:
Add fraud validation before order creation

Author:
alex.chen

Branch:
feature/fraud-validation

Files changed:
8

+214
-47

Main semantic change:

`FraudClient.Check()` is inserted into `CreateOrder()`.

Retry behavior also changes.

---

# PR REVIEW LAYOUT

LEFT:
Files and review steps

CENTER:
Primary investigation workspace

RIGHT:
Agent + evidence panel

---

# PR HEADER

Show:

PR title
author
branch
commit
files changed
CI status
review status

Actions:

* Start Review
* Architecture Diff
* Impact
* Findings

Progress:

3 / 8 review steps completed

---

# STEP-BY-STEP REVIEW

Review must feel like an investigation.

Steps:

1. Understand changes
2. Map affected system
3. Trace dataflow
4. Analyze contracts
5. Analyze complexity
6. Analyze runtime impact
7. Inspect tests
8. Produce findings

Each step can be:

* Pending
* Running
* Completed
* Needs Attention

Click step to inspect supporting evidence.

---

# STEP 1 — UNDERSTAND CHANGES

Show semantic diff:

Changed symbols:

* CreateOrder
* FraudClient
* RetryPolicy

Semantic changes:

* external call to Fraud API
* fraud validation before persistence
  ~ retries 2 → 4
* ErrFraudRejected

Show source diff beside semantic summary.

---

# STEP 2 — MAP AFFECTED SYSTEM

Render only PR-relevant graph:

POST /orders
→ CreateOrder
→ Fraud API [NEW]
→ orders
→ order.created
→ payment-service

Summary:

Direct impact: 4
Transitive impact: 11
Affected services: 3
Affected teams: 3

---

# STEP 3 — DATAFLOW DIFF

BEFORE:

POST /orders
→ ValidateOrder
→ DB transaction
→ INSERT orders
→ order.created

AFTER:

POST /orders
→ ValidateOrder
→ Fraud API
→ DB transaction
→ INSERT orders
→ order.created

Highlight:

New synchronous network dependency introduced into checkout critical path.

Show boundaries clearly.

---

# STEP 4 — CONTRACT ANALYSIS

Inspect mocked:

* Order HTTP contract
* Fraud API
* order.created schema
* database schema

Example:

New HTTP response:

422 fraud_rejected

No existing public field removed.

Potential consumer concern:

Mobile client may not handle new status.

Another mock example should demonstrate a confirmed broken downstream consumer.

---

# STEP 5 — COMPLEXITY ANALYSIS

Show graph change:

BASE:

CreateOrder

Fan-out: 4
Failure paths: 3
External dependencies: 0

PR:

Fan-out: 7
Failure paths: 8
External dependencies: 1

Show:

System complexity increased.

Do not reduce everything to one arbitrary score.

---

# STEP 6 — RUNTIME IMPACT

Show facts:

POST /orders
8.2k rpm
p99 184ms

Fraud API
p99 91ms
p99.9 380ms
1.1% errors

Observation:

FraudClient.Check now runs synchronously on a high-volume request path.

Potential concern:

Checkout latency and availability now depend on Fraud API.

Evidence:

RUNTIME
GRAPH
DATAFLOW

No invented performance prediction.

---

# STEP 7 — TEST ANALYSIS

Impacted behavior paths:

Happy path ✅
Fraud rejected ✅
Fraud timeout ❌
Fraud 500 + retry ❌
DB failure ✅
Duplicate request ✅
Kafka publish failure ❌

Show:

Impacted paths: 12
Covered: 8
Partial: 1
Uncovered: 3

PR impact coverage:
67%

---

# STEP 8 — FINAL FINDINGS

Example HIGH finding:

Retry policy may amplify Fraud API load.

Evidence:

* retries increased 2 → 4
* Fraud API has 1.1% current error rate
* call is synchronous
* POST /orders serves 8.2k rpm

Potential impact:

Fraud API degradation may cause retry amplification.

Links:

View code
View graph
View runtime
View retry path

---

Example HIGH finding:

New contract break in Billing consumer.

Evidence:

Order status adds `fraud_rejected`.

Billing consumer has exhaustive enum handling with no fallback.

Links:

View schema
View consumer
View contract graph

---

Example MEDIUM finding:

Fraud timeout path is untested.

Evidence:

No impacted test traverses timeout → retry exhaustion.

---

# AGENT PANEL

AI is not a generic floating chatbot.

It operates on structured system evidence.

Show activity/evidence log:

Analyzed 8 changed files

Detected 3 changed symbols

Exploring callers of CreateOrder

Found:
CreateOrderHandler
RetryOrderJob

Tracing order.created

Found consumers:
payment-service
fulfillment-service
analytics-service

Inspecting contracts

Detected 1 potentially breaking contract change

Loaded runtime context

Matched related incident INC-481

Analyzed impacted test paths

Detected 3 uncovered paths

Ran graph rules

2 new violations found

Do NOT expose chain-of-thought.

Show retrieved evidence/actions only.

---

# ASK THE SYSTEM

Allow mocked questions:

* What breaks if Fraud API is unavailable?
* Why is payment-service affected?
* Show high-risk execution paths.
* What changed in system complexity?
* Does this affect idempotency?
* Which consumers may break?
* Which paths are untested?
* What architectural rules does this PR violate?
* What should I review first?

Answers should deep-link into relevant graph state.

---

# ARCHITECTURE DIFF

Dedicated PR mode.

BEFORE:

Checkout
→ PostgreSQL
→ Kafka

AFTER:

Checkout
→ Fraud API
→ PostgreSQL
→ Kafka

Summary:

New external dependency:
Fraud API

New synchronous failure boundary:
Yes

New team dependency:
Risk Platform

New graph violations:
1

Complexity:
increased

Uncovered new paths:
3

---

# EVIDENCE-FIRST AI

Every finding must expose evidence source badges.

Available badges:

CODE
GRAPH
DATAFLOW
RUNTIME
TEST
SCHEMA
GIT
INCIDENT
LINT

Examples:

Checkout now synchronously depends on Fraud API

Evidence:
CODE · GRAPH · DATAFLOW

Billing may break on fraud_rejected

Evidence:
SCHEMA · GRAPH · CODE

Do not render unsupported AI statements as facts.

---

# GLOBAL SEARCH

Provide command/search UX.

Example queries:

CreateOrder

Who consumes order.created?

What depends on payments?

Show checkout critical path

Show complexity hotspots

Show uncovered failure paths

Show new architecture violations in PR #1842

Which consumers break after this contract change?

What changed around idempotency recently?

Results deep-link into relevant Explorer/PR state.

---

# MOCK DATA REQUIREMENTS

Create enough coherent mock data to feel real.

Minimum:

6 services
30 functions/modules
3 HTTP endpoints
4 Kafka topics
5 DB tables
Redis
PostgreSQL
Stripe
Fraud API
4 engineering teams
4 historical PRs
2 incidents
20 tests
runtime metrics
complexity metrics
coverage information
5+ graph lint rules
3 contract versions

Relationships must remain internally consistent across every screen.

---

# INTERACTION REQUIREMENTS

All important interactions must work:

* navigation
* graph selection
* upstream/downstream expansion
* edge filters
* graph modes
* dataflow mode
* runtime overlay
* impact depth
* complexity layer
* test coverage layer
* lint overlay
* contract impact visualization
* graph diff
* architecture diff
* review step navigation
* agent evidence activity
* findings navigation
* global search
* inspector deep links

---

# IMPORTANT UX PRINCIPLES

1. Never dump the full repository graph.

2. Graph always has context:
   node, service, PR, impact, flow, rule, contract, etc.

3. Do not overload the graph with every metric simultaneously.

4. Visualization layers should be intentionally switched.

5. Distinguish clearly between:
   static code facts
   runtime facts
   deterministic rule results
   AI observations

6. AI is an interface over system knowledge, not the source of truth.

7. Findings must be traceable:
   finding → evidence → graph/path → code.

8. Prioritize new PR-introduced problems over historical technical debt.

9. Test coverage should focus heavily on behavior and affected paths.

10. Contract analysis should distinguish schema compatibility from actual consumer compatibility.

11. Complexity should be multidimensional.

12. Do not invent fake precision.

13. Graph linting should feel like architecture linting, not ESLint rendered visually.

14. Optimize everything around this question:

**Can a senior engineer understand and verify the system-level impact of an unfamiliar code change substantially faster than by reading the diff manually?**

---

# DELIVERABLE

Build a polished, working frontend prototype using only local mock data.

Do not spend effort on backend architecture.

Prioritize:

1. System Explorer
2. PR investigation workflow
3. Graph mode switching
4. Impact visualization
5. Graph linting
6. Contract break visualization
7. Test-path coverage
8. Complexity visualization
9. Evidence-first agent workflow

The prototype should be convincing enough that we can use it to decide which concepts deserve real implementation.

