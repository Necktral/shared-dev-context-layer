# Agent Council Orchestrator

Status: design v0, intended canon
Scope: deliberative orchestration for AI council input
Principle: many intelligences deliberate; WIS decides.
Default config: `AGENT-COUNCIL-DEFAULT-CONFIG.json`

## 1. Purpose

The Agent Council Orchestrator is the layer that turns many AI perspectives into
a decision packet the operator can actually use.

It does not make canonical decisions. It organizes ideas, objections, risks,
tradeoffs, minority reports, and suggested next actions into a governed
deliberation bundle. Canonical promotion still flows through `Proposal`,
ratification, write audit, and staleness invalidation.

The orchestrator should maximize freedom in the deliberative plane and minimize
freedom in the canonical plane.

## 2. Freedom Model

Agents receive broad creative freedom before ratification:

- propose multiple competing interpretations of the goal
- challenge the premise and ask whether the requested end state is the right one
- submit minority reports without being forced into consensus
- suggest experiments, dry runs, probes, and evidence-gathering tasks
- name missing context and uncertainty explicitly
- recommend changes outside the narrow implementation path when they improve the
  real objective
- produce speculative ideas, as long as they are labeled as speculative

Agents never receive these freedoms:

- ratify their own proposal
- hide disagreement behind a synthesized consensus
- write canonical state without a ratified `Proposal`
- silently downgrade a blocked commit into a preview
- act on stale context after ratification changes canon
- bypass scope, idempotency, audit, or operator-token requirements

The desired behavior is not obedience. It is disciplined agency: strong ideas,
clear dissent, and no hidden authority.

## 3. Council Roles

The orchestrator can call any number of agents, but v1 should normalize their
output into these roles:

| role | responsibility |
| --- | --- |
| `architect` | designs the system shape and interfaces |
| `implementer` | identifies the smallest viable implementation path |
| `critic` | searches for failure modes, contradictions, and weak evidence |
| `operator_advocate` | protects operator usability and decision clarity |
| `risk_auditor` | classifies safety, auth, data, and governance risks |
| `historian` | checks canon, prior decisions, and branch context |
| `wildcard` | proposes non-obvious alternatives and creative reframes |
| `external_reviewer` | independent non-sensitive review through an optional external provider |

A council session does not need every role. Missing roles should be explicit in
the output so the operator knows which perspective was not represented.

The default machine-readable roster lives in
`AGENT-COUNCIL-DEFAULT-CONFIG.json`. It binds each role to an LLM profile,
deliberative freedoms, and non-negotiable governance limits. The file is a seed
configuration, not a new canonical write authority.

## 3.1 External Reviewer: Gemini AI Studio/API

Gemini can be configured as an optional external reviewer for non-sensitive
material only. It is not part of the canonical authority model and does not
receive any ratification, write, or proposal-promotion permission.

Default posture:

- provider id: `gemini_ai_studio`
- role id: `external_reviewer`
- enabled by default: `false`
- API key env var: `GEMINI_API_KEY`
- model env var: `GEMINI_REVIEW_MODEL`
- default model: `gemini-3.1-flash-lite`
- max prompt chars env var: `GEMINI_REVIEW_MAX_CHARS`
- default max prompt chars: `12000`

Sensitivity gate:

- Gemini receives content only when `sensitivity_label` is exactly
  `non_sensitive`.
- The orchestrator must send only sanitized briefs, not raw diffs.
- Missing sensitivity labels block external review.
- Secret material, `.env` contents, tokens, passwords, API keys, personal data,
  operational Auth0/MCP payloads, and unredacted private code are blocked.
- Allowed content is limited to public summaries, non-sensitive docs, general
  architecture questions, and summarized/redacted diffs.

Free-tier note:

- Gemini free-tier/API Studio usage is treated as external processing. Because
  free-tier content may be used to improve provider products, this provider is
  suitable only for explicitly non-sensitive review.

## 4. Orchestration Loop

1. Intake
   - Capture user objective, scope, constraints, known repo context, and current
     canonical decisions.
   - Assign a `session_key`, `target_kind`, `target_key`, and evidence budget.

2. Brief
   - Produce one shared brief for all agents.
   - Include current canon and any known open proposals.
   - State which outputs are allowed: idea, objection, counterproposal, test,
     implementation suggestion, or escalation.

3. Deliberate
   - Agents submit independent opinions.
   - The orchestrator must not ask agents to converge before preserving their
     original positions.

4. Normalize
   - Convert every opinion into structured claims:
     `claim`, `rationale`, `evidence`, `risk`, `confidence`, `requested_action`.
   - Mark each claim as `supported`, `contested`, `speculative`, or `blocked`.

5. Synthesize
   - Group compatible claims.
   - Preserve dissent as first-class signal.
   - Create a decision packet with recommended actions and alternatives.

6. Propose
   - If a canonical change is recommended, create one or more `Proposal` records.
   - Competing recommendations become competing proposals or objections, not one
     flattened compromise.

7. Ratify
   - Human/operator ratification remains the only path to canonical promotion.
   - Ratification invalidates stale context for the affected scope.

## 5. Decision Packet Shape

The orchestrator output should be stable and readable by both humans and tools:

```json
{
  "version": "agent_council_packet_v1",
  "session": {
    "session_key": "string",
    "target_kind": "decision|context_item|task|project",
    "target_key": "string",
    "scope": {}
  },
  "summary": {
    "operator_question": "string",
    "recommended_action": "string",
    "confidence": "low|medium|high",
    "requires_ratification": true
  },
  "positions": [
    {
      "role": "architect",
      "stance": "support|object|counter|explore",
      "claim": "string",
      "rationale": "string",
      "evidence": ["string"],
      "risks": ["string"],
      "confidence": "low|medium|high"
    }
  ],
  "dissent": [
    {
      "claim": "string",
      "why_it_matters": "string",
      "operator_decision_needed": "string"
    }
  ],
  "proposal_candidates": [
    {
      "target_kind": "decision",
      "target_key": "string",
      "rationale": "string",
      "proposed_payload": {}
    }
  ],
  "next_actions": ["string"]
}
```

For v1 this packet can live inside `Proposal.proposed_payload` and
`proposal.*` events. A future schema can persist `CouncilSession` and
`CouncilSubmission` if query pressure justifies it.

## 6. Governance Rules

- The orchestrator is allowed to be bold in analysis and conservative in writes.
- Every synthesized recommendation must keep source positions addressable.
- A dissenting position must not be deleted because the majority disagrees.
- If evidence is weak, the packet must say so and propose the next probe.
- If the council output implies a canonical change, it must route through
  `propose_change`.
- If multiple canonical changes compete, preserve them as separate proposal
  candidates.
- The operator UI should show the recommended path first, then the strongest
  objection, then the minimum ratification question.

## 7. Implementation Plan

Phase A: document and dogfood

- Use this document as the source of truth for council behavior.
- Use `AGENT-COUNCIL-DEFAULT-CONFIG.json` as the default role/LLM roster.
- Keep Gemini as config/docs only until a runner is explicitly introduced.
- Manually create a council packet for the next design-heavy task.
- Store it as a `Proposal` candidate without adding new tables.

Phase B: stateless orchestrator service

- Add a pure service that accepts agent submissions and returns an
  `agent_council_packet_v1`.
- Add unit tests for dissent preservation, weak-evidence labeling, and proposal
  candidate generation.

Phase C: MCP tools

- Add read/write tools:
  - `open_council_session`
  - `submit_council_position`
  - `synthesize_council_packet`
  - `promote_council_packet_to_proposals`
- All commit paths keep dry-run default, idempotency, audit, and ratification.

Phase D: persistence, if needed

- Add `council_sessions` and `council_submissions` only if `Proposal` plus
  events becomes insufficient.
- Treat persistence as `persisted_contract` under `CONTRACT-GOVERNANCE.md`.

## 8. Anti-Patterns

- A single "AI consensus" answer that hides disagreements.
- Agent votes as a substitute for operator judgment.
- Ranking ideas only by confidence instead of evidence.
- Treating creative speculation as canon.
- Letting the orchestrator become a write authority.
- Creating one huge proposal when the real decision is several separable
  operator choices.

## 9. V1 Acceptance Criteria

- The operator can see the best recommendation and the strongest objection in
  the same packet.
- At least one minority report can survive synthesis unchanged in meaning.
- Every canonical recommendation maps to a `Proposal` candidate.
- No agent path can ratify or commit canon by itself.
- Weak evidence produces a probe request, not a confident recommendation.
- Stale context after ratification remains invalidated by the existing
  deliberative write path.
- External review is blocked unless the brief is sanitized and explicitly
  labeled `non_sensitive`.
