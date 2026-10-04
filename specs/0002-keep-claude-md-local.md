# 0002: Keep CLAUDE.md local and move the shared agent rules to AGENTS.md

- **Status:** Approved
- **Branch:** `keep-claude-md-local` (stacked on `extract-task-repository-port`, which introduces the files it changes)
- **Roadmap step:** process change, outside the architecture roadmap of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** amends the CLAUDE.md part of the commit "Add CLAUDE.md and AGENTS.md" in spec [0001](0001-extract-task-repository-port.md); must merge after it

## Context

`CLAUDE.md` was added as a tracked file that defines how agents work in this repository, and README, CONTRIBUTING and `AGENTS.md` link to it. The maintainer wants `CLAUDE.md` to be a **local, git-ignored** file that defines the project (its stack, architecture and complete instructions for agents) and serves as one of the sources of truth for the agent they work with. If it is simply ignored, every tracked link to it breaks for anyone who clones or forks, and the operating rules that contributors and other agents need disappear from the repository.

## Goal

Make `CLAUDE.md` local and ignored, keep the shared rules versioned in `AGENTS.md`, and leave no broken links.

## Scope

1. Add `CLAUDE.md` to `.gitignore` and stop tracking it (`git rm --cached`), keeping the file on disk.
2. Move the shareable operating rules (spec-driven workflow, architecture rules, engineering standards, tests, git and delivery, documentation, safety, definition of done) from `CLAUDE.md` into `AGENTS.md`, which stays tracked and becomes the complete, shared contract for any agent or contributor.
3. Repoint every tracked reference from `CLAUDE.md` to `AGENTS.md`: `README.md`, `CONTRIBUTING.md` and their Spanish references, and `specs/`.
4. Rewrite the local `CLAUDE.md` as the project definition for the maintainer's agent: purpose, stack, architecture and current state, commands, repository map, full working instructions, local environment notes and preferences. It defers to `AGENTS.md` and `specs/` where they overlap.

## Out of scope

- Changing any rule's substance. Rules move; they are not rewritten.
- Any code, infrastructure or API change.
- Tracking a template of the local file. If one is wanted later, it is a new spec.

## Design

- **Two files, two jobs.** `AGENTS.md` (tracked) is the contract everyone is bound to. `CLAUDE.md` (local) adds the project definition and personal environment on top. Where both say something, `AGENTS.md` and the approved specs win; `CLAUDE.md` must not contradict them.
- **No duplication of rules.** The local file states what is specific (stack, state, local setup) and links to `AGENTS.md` for the rules, so there is one place to edit a rule.
- **Single source for the rules in the repository,** so forks and other tools get them without any local file.
- Alternatives rejected: *keeping CLAUDE.md tracked and also ignoring it* (git keeps tracking a tracked file, so the ignore would do nothing); *duplicating the rules in both files* (they would drift).

## Contract impact

| Area | Impact |
| --- | --- |
| Public API, infrastructure, data model | none |
| Documentation | `AGENTS.md` expanded; links in `README.md`, `CONTRIBUTING.md` and the Spanish references repointed; `.gitignore` |
| Local only | `CLAUDE.md` rewritten and ignored |

## Acceptance criteria

- [ ] `git ls-files CLAUDE.md` prints nothing and `git check-ignore CLAUDE.md` reports it ignored.
- [ ] `CLAUDE.md` exists on disk and defines the project, stack, architecture, commands and instructions.
- [ ] `AGENTS.md` contains every rule that was in the tracked `CLAUDE.md`, with no rule lost or changed.
- [ ] `git grep -n "CLAUDE" -- ':!specs'` prints nothing that links to the file (only the ignore entry), and the Spanish references no longer link to it.
- [ ] `npm run lint` and `npm test` pass and no code file changed.
- [ ] The pull request links this spec and states it matches it.

## Verification

```bash
git ls-files CLAUDE.md                 # prints nothing
git check-ignore -v CLAUDE.md          # shows the .gitignore rule
git grep -n "CLAUDE" -- . ':!specs'    # only the .gitignore entry
git diff --stat <base>..HEAD -- src tests serverless.yml docs/openapi.yaml   # empty
npm run lint && npm test
```

## Commit plan

1. Add this spec.
2. Make AGENTS.md the complete shared contract.
3. Point the docs at AGENTS.md instead of CLAUDE.md.
4. Stop tracking CLAUDE.md and ignore it.

## Risks and rollback

- **Risk:** the local file drifts from the shared rules. Mitigated by keeping rules only in `AGENTS.md` and having the local file link to them.
- **Risk:** a fork or another machine has no `CLAUDE.md`. Intended: everything they need is in `AGENTS.md` and `specs/`.
- **Rollback:** revert the merge; `CLAUDE.md` would be tracked again from the previous content.
