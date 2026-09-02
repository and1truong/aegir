# Attention model

Aegir's first repository view answers **what matters → where → why → evidence**. The semantic graph remains the explanation layer.

## Unit and score contract

The initial architectural unit is a non-external Go package. Package identity is already stable in indexed graphs and can be mapped back to source symbols without inventing a second hierarchy.

All scores are deterministic integers from 0–100. Raw factors are normalized against the repository cohort using a bounded, log-scaled p95 reference. A dimension is the weighted mean of available factors; unavailable factors are omitted from the denominator and reported through `coverage`. Zero is an observed value, never a substitute for missing data.

The versioned `attention-v1.0` model uses:

- Impact / Criticality: direct dependents (20%), transitive dependent reach (15%), dependency brokerage (15%), shared state/event reach (10%), cross-team dependents (10%), owned contracts (10%), runtime traffic (10%), and business criticality (10%). Runtime, ownership and business factors remain explicitly unavailable when no source exists.
- Change Complexity: fan-out (15%), technical boundary variety (15%), cross-team dependencies (10%), stateful relationships (15%), async relationships (15%), cycles (15%), contract coupling (10%), and p90 indexed symbol complexity (5%).
- Change Velocity: recency-weighted meaningful churn (35%), recency-weighted change sets (25%), active weeks (15%), distinct anonymized authors (10%), and contract/schema changes (15%). Git signals use a 30-day half-life.

Generated files, documentation and lockfiles are excluded from velocity. Git is read with whitespace ignored; rename-only files are ignored, and mass-rename commits are downweighted. Per-commit churn is capped to prevent a single bulk change from dominating.

Team ownership is loaded from the first standard `CODEOWNERS` file (`.github/`, repository root, then `docs/`) using last-match-wins rules. It feeds cross-team impact/complexity factors and the optional team filter; repositories without ownership keep those factors explicitly unavailable.

Default action thresholds are impact 50 and complexity 60. Velocity 65 is considered fast. The threshold set has its own `default-v1` policy identity so later calibration never silently changes saved interpretations.

## Findings

Packages are ranked by a weighted priority of impact (45%), complexity (35%), and velocity (20%). Missing velocity is excluded and the remaining weights are renormalized. Deterministic interaction bonuses prioritize high-impact/high-complexity packages and fast-changing packages that are also high on either axis.

At most three findings above priority 45 are shown. Low-attention packages are suppressed even when velocity is high. A finding contains the strongest observed factor from each relevant dimension and concrete graph/Git evidence references. No LLM is required.

## Persistence and evolution

Normalized, privacy-preserving Git change events are cached by repository, immutable ref and time window. Descendant refs extend the last cache incrementally; rewritten history falls back to a full bounded scan. Attention profiles are cached by snapshot, model version and window, then recalculated after 24 hours so recency decay continues to evolve without a re-index.

Both tables are additive SQLite migrations with cascading repository/snapshot ownership. Older databases need no manual migration, and a model-version bump naturally invalidates prior profiles.

## API layers

- `GET /api/repositories/{id}/attention`: repository landscape, factors, findings, thresholds and completeness.
- `GET /api/repositories/{id}/attention/evidence`: one unit plus resolved dependency edges, source locations and anonymized Git changes.
- `GET /api/repositories/{id}/attention/reviews/{reviewID}`: baseline landscape with touched-package, new-relationship and review-priority overlays.

The UI uses the landscape for summary and map, the focused graph for explanation, and the evidence endpoint only when the user asks for concrete details.

## Calibration

Calibration is explicit and fixture-driven:

1. Capture representative small, medium and large repository landscapes from the API.
2. Ask maintainers to label packages that merit protect, simplify or stabilize action without seeing the score.
3. Compare labels with region and top-N precision; inspect factor explanations for false positives.
4. Change weights or thresholds only with a new model/policy version and regression fixtures.

Useful acceptance measures are top-three precision, stable ranking under a formatting-only commit, bounded movement after a mass rename, and map/evidence response time by repository size. Absolute scores are not compared across model versions.
