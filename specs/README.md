# Specs

Every change to this project is governed by a **spec**: a short, reviewed document that states what will change, what will not, and how anyone can tell it is done. A spec is a contract. Code that goes beyond its spec is drift, and drift is a defect.

## The rule

> **No spec, no change.** Each modification of the code, the infrastructure or the public API starts with its own spec, and a spec is `Approved` before implementation begins.

Typo fixes and documentation-only corrections that change no behavior and no contract are the only exception.

## Lifecycle

```
Draft ──review──▶ Approved ──implementation──▶ Implemented
                      │
                      └──▶ Superseded (by a newer spec) / Rejected
```

| Status | Meaning |
| --- | --- |
| `Draft` | Being written. Nothing may be implemented from it |
| `Approved` | Agreed. Implementation may start, and its scope is frozen |
| `Implemented` | Merged to `development`, acceptance criteria verified |
| `Superseded` | Replaced by a later spec, which it names |
| `Rejected` | Decided against, kept for the record with the reason |

## How a spec is used

1. **Write** it from [`TEMPLATE.md`](TEMPLATE.md) as `specs/NNNN-short-title.md`. Numbers are sequential and never reused.
2. **Approve** it. The maintainer sets `Status: Approved` (or approves the pull request that adds it). The spec lands in the repository before, or together with, the first implementation commit.
3. **Implement** exactly what it says, on a branch named in the spec, started from `development`.
4. **Verify** every acceptance criterion and tick it in the spec.
5. **Close** it: set `Status: Implemented` and record the pull request.

## Keeping to the contract

- **Scope is frozen once Approved.** Anything in "Out of scope" stays out. New ideas become a new spec, not an extra commit.
- **The pull request links its spec** and states that the change matches it. A reviewer compares the diff against the spec's scope and acceptance criteria.
- **If reality disagrees with the spec**, stop. Amend the spec in its own commit (and say why in the commit message), get it re-approved, then continue. Never silently deviate.
- **Behavior-preserving work says so.** A refactoring spec lists the existing tests that must keep passing unchanged, and any change to them is a red flag that needs justification.
- **Contracts that outlive specs** live elsewhere and are updated by the spec that touches them: the API in [`docs/openapi.yaml`](../docs/openapi.yaml), the design in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Index

| Spec | Title | Status |
| --- | --- | --- |
| [0000](0000-roadmap-to-layered-architecture.md) | Roadmap to a layered architecture and a React-ready API | Approved |
| [0001](0001-extract-task-repository-port.md) | Extract the task repository port | Implemented |
| [0002](0002-keep-claude-md-local.md) | Keep CLAUDE.md local and move the shared agent rules to AGENTS.md | Implemented |
| [0003](0003-add-task-use-cases.md) | Add task use cases and thin handlers | Implemented |
| [0004](0004-standardize-error-responses.md) | Standardize error responses behind one boundary | Implemented |
| [0005](0005-migrate-orphan-task-owners.md) | Migrate tasks that have no owner | Draft |

Specs are written in English and are not translated: they are contracts, and one authoritative text avoids divergence.
