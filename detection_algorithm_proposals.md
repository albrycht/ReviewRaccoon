# Moved-Block Detection Algorithm Proposals

## Scope and hard constraints

- Input is diff-only (`added`/`removed` lines). No full source file context.
- Must work for all programming languages and generic text files.
- No language-aware parsing (no AST, no grammar-specific logic).
- Output must be deterministic enough for UI line annotations.

## Problem definition used for scoring

- `P1` Reflow/shape changes: one-line to multiline and multiline to one-line transformations.
- `P2` Overlapping/conflicting block outputs: multiple detections on same line ranges.
- `P3` Syntax/common-pattern false positives: `try`, `for`, braces, tags, import-like boilerplate.
- `P4` Fixed-gap brittleness: hardcoded gap rules causing over-merge or under-merge.

## Scoring rubric

- **Implementation difficulty (1-100):** 1 = trivial, 100 = very hard at production scale.
- **Problem-fit score (1-100):** overall expected quality on `P1`-`P4` under given constraints.
- `P1`-`P4` subscores are also provided (1-100) for precision.

---

## Approach 1: Normalized k-gram fingerprint anchoring (Winnowing)

**How it works (short):**
- Normalize each changed line (whitespace normalization, optional lowercasing).
- Build rolling hashes of character or generic token k-grams.
- Keep robust fingerprints (winnowing) and find shared rare anchors between removed and added sets.
- Chain anchors in monotonic order to form candidate moved regions.

**Problems it solves best:**
- Strong on `P1` because line breaks change less than underlying substrings.
- Good base for `P4` because chaining can replace rigid fixed-gap rules.
- Moderate on `P3` if anchors are rarity-weighted.

**Implementation difficulty:** **45/100**  
**Problem-fit score (overall):** **78/100**  
**Subscores:** `P1=84`, `P2=60`, `P3=68`, `P4=79`

**Advantages:**
- Language-agnostic and parser-free.
- Fast enough for large diffs with indexing.
- Robust to formatting and indentation changes.
- Good recall for moved text with small edits.

**Disadvantages:**
- By itself does not resolve overlaps (`P2`) fully.
- Common substrings still produce noisy anchors unless down-weighted.
- Parameter tuning (`k`, window size) affects quality significantly.

---

## Approach 2: Local sequence alignment on normalized text streams

**How it works (short):**
- Convert removed and added sides into normalized streams while preserving mapping to line numbers.
- Run local alignment (e.g., Smith-Waterman) with gap penalties.
- Convert aligned spans back to removed/added line intervals.

**Problems it solves best:**
- Excellent on `P1` (line-shape/reflow no longer a blocker).
- Good on `P4` through learned/penalized gaps instead of hardcoded line distance.

**Implementation difficulty:** **62/100**  
**Problem-fit score (overall):** **83/100**  
**Subscores:** `P1=93`, `P2=64`, `P3=66`, `P4=86`

**Advantages:**
- Naturally handles one-to-many and many-to-one line relationships.
- Deterministic and testable.
- Works on arbitrary text.

**Disadvantages:**
- Computationally heavier than simple fuzzy line matching.
- Needs pruning/segmentation for very large diffs.
- Still needs separate logic to suppress syntax-only matches.

---

## Approach 3: Candidate generation + global non-overlap optimization

**How it works (short):**
- Generate many candidate blocks from anchors/alignment.
- Score each candidate by confidence.
- Select final set globally using non-overlap constraints on both removed and added intervals (weighted interval/set-packing style).

**Problems it solves best:**
- Primary fix for `P2` (overlapping/conflicting detections).
- Helps `P4` by selecting globally coherent segments rather than local greedy merges.

**Implementation difficulty:** **71/100**  
**Problem-fit score (overall):** **88/100**  
**Subscores:** `P1=72`, `P2=96`, `P3=74`, `P4=88`

**Advantages:**
- Directly enforces clean, non-overlapping output.
- Improves precision significantly even if candidate generator is noisy.
- Deterministic optimization objective.

**Disadvantages:**
- Requires careful score calibration.
- More complex debugging than greedy heuristics.
- Runtime can grow with candidate count unless aggressively pruned.

---

## Approach 4: Informative-content weighting (IDF/entropy-based scoring)

**How it works (short):**
- Assign low weight to common tokens/lines and high weight to distinctive content.
- Score block similarity by weighted overlap, not raw line or char counts.
- Build rarity from current diff and optional rolling corpus stats.

**Problems it solves best:**
- Primary fix for `P3` (common syntax false positives).
- Improves precision across all approaches when used as final scoring.

**Implementation difficulty:** **39/100**  
**Problem-fit score (overall):** **76/100**  
**Subscores:** `P1=55`, `P2=58`, `P3=94`, `P4=65`

**Advantages:**
- Parser-free and language-agnostic.
- Easy to integrate as scoring layer.
- Large precision gain with modest complexity.

**Disadvantages:**
- Alone it cannot solve reflow segmentation (`P1`) fully.
- If corpus statistics are unstable, scores may drift.
- Needs safeguards for small diffs with little statistical signal.

---

## Approach 5: Adaptive gap model (confidence-conditioned gap penalties)

**How it works (short):**
- Replace fixed max-space constants with dynamic penalties based on confidence, anchor density, and continuity.
- Allow larger internal gaps only when evidence is strong.
- Reject weak matches that rely on large gaps.

**Problems it solves best:**
- Primary fix for `P4`.
- Secondary help for `P2` by reducing accidental merges/splits.

**Implementation difficulty:** **52/100**  
**Problem-fit score (overall):** **73/100**  
**Subscores:** `P1=69`, `P2=70`, `P3=52`, `P4=92`

**Advantages:**
- Keeps system flexible without hardcoded brittle thresholds.
- Improves behavior across repository styles.
- Deterministic and tunable.

**Disadvantages:**
- Not sufficient as standalone detector.
- Requires robust confidence features from other stages.
- Can become hard to tune without benchmark suites.

---

## Approach 6: Multi-granularity matching (line + chunk + stream hierarchy)

**How it works (short):**
- Stage 1: fast line/chunk anchors.
- Stage 2: refine uncertain regions with stream alignment.
- Stage 3: reconcile segments and score globally.

**Problems it solves best:**
- High practical performance on `P1` and `P4`.
- Better stability on large diffs by limiting expensive alignment to hard regions.

**Implementation difficulty:** **68/100**  
**Problem-fit score (overall):** **86/100**  
**Subscores:** `P1=90`, `P2=82`, `P3=71`, `P4=88`

**Advantages:**
- Good latency/quality trade-off at scale.
- Degrades gracefully: easy cases stay cheap, hard cases get deeper analysis.
- Fits deterministic production use.

**Disadvantages:**
- Pipeline complexity and more moving parts.
- Requires good handoff criteria between stages.
- Harder observability unless each stage exposes diagnostics.

---

## Approach 7: LLM-assisted adjudication (hybrid only)

**How it works (short):**
- Deterministic engine proposes candidates and confidence.
- LLM is invoked only for ambiguous low-confidence regions.
- LLM output is validated by deterministic constraints before acceptance.

**Problems it solves best:**
- Can improve edge `P1` semantics beyond pure string matching.
- Helps borderline `P3` decisions when patterns are context-sensitive.

**Implementation difficulty:** **64/100**  
**Problem-fit score (overall):** **69/100**  
**Subscores:** `P1=82`, `P2=58`, `P3=73`, `P4=64`

**Advantages:**
- Better handling of difficult ambiguous edits.
- Works without language parsers.
- Incremental adoption possible.

**Disadvantages:**
- Non-determinism and output variance.
- Cost, latency, and data-governance concerns.
- Requires strict post-validation and caching.

---

## Approach 8: Pure LLM moved-block detection (no deterministic core)

**How it works (short):**
- Send diff to LLM and request moved block intervals directly.
- Optionally ask for confidence and rationale.

**Problems it solves best:**
- Potentially strong semantic reasoning in some edge cases.

**Implementation difficulty:** **34/100** (initial), **82/100** (production-hardening)  
**Problem-fit score (overall):** **47/100**  
**Subscores:** `P1=75`, `P2=40`, `P3=52`, `P4=38`

**Advantages:**
- Very fast to prototype.
- Minimal algorithm engineering at first.

**Disadvantages:**
- Weak determinism and reproducibility.
- Hard to guarantee exact line interval stability.
- Expensive and latency-heavy on large diffs.
- Context-window limits and chunk-boundary misses.
- High operational risk for UI-grade precision.

---

## Approach 9: Current-style line fuzzy matching with tuned heuristics (incremental baseline)

**How it works (short):**
- Keep line-level fuzzy matching.
- Add stricter filtering, improved overlap rules, and better thresholds.

**Problems it solves best:**
- Low-risk incremental quality uplift.
- Partial improvement for `P2`/`P3` with minimal architecture change.

**Implementation difficulty:** **28/100**  
**Problem-fit score (overall):** **58/100**  
**Subscores:** `P1=35`, `P2=62`, `P3=61`, `P4=49`

**Advantages:**
- Fast to ship.
- Reuses existing tests and structures.
- Low migration risk.

**Disadvantages:**
- Fundamental `P1` limitation remains.
- Heuristic complexity will keep growing.
- Ceiling on long-term quality.

---

## Ranked recommendation under your constraints

1. **Approach 6** (Multi-granularity deterministic pipeline) - **86/100**
2. **Approach 3** (Global non-overlap optimization) - **88/100** as mandatory post-processing layer
3. **Approach 2** (Local stream alignment) - **83/100** core for reflow robustness
4. **Approach 4** (Informative-content weighting) - **76/100** mandatory precision layer
5. **Approach 5** (Adaptive gap model) - **73/100** replace fixed hardcoded gap behavior
6. **Approach 1** (Fingerprint anchoring) - **78/100** high-value fast candidate generator
7. **Approach 7** (LLM hybrid) - **69/100** optional, only after deterministic core is strong
8. **Approach 9** (Heuristic baseline tuning) - **58/100** short-term patch only
9. **Approach 8** (Pure LLM) - **47/100** not recommended as primary detector

## Suggested production target architecture

- **Core:** `Approach 1 + Approach 2 + Approach 3 + Approach 4 + Approach 5`
- **Operational mode:** deterministic by default, no LLM dependency.
- **Optional enhancement:** `Approach 7` only for abstained/ambiguous regions with strict validator.

This composition provides the best expected balance for your constraints: diff-only, parser-free, language-agnostic, and UI-stable outputs.
