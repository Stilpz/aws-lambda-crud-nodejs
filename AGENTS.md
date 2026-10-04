# AGENTS.md

Operating contract for working in this repository, for any AI agent or contributor. It is the source of truth for *how* to work; `specs/` is the source of truth for *what* to change. When they disagree with a request, stop and say so instead of improvising.

An agent may also keep a local, git-ignored `CLAUDE.md` with the project definition and personal environment notes. It adds context on top of this file and never overrides it: on any conflict, this file and the approved specs win.

## Project

Serverless Tasks API: AWS Lambda (Node.js 24, ES modules, `arm64`) behind an API Gateway HTTP API with a Cognito JWT authorizer, DynamoDB storage, deployed with Serverless Framework v4. Each user sees only their own tasks. A React frontend will consume it later. Release baseline: tag `v1.0.0`.

Where things are: `src/` code, `tests/` Vitest tests, `serverless.yml` infrastructure, `docs/openapi.yaml` API contract, `docs/ARCHITECTURE.md` design and findings, `specs/` change contracts, `scripts/smoke.sh` post-deploy check.

Commands:

```bash
npm ci               # install
npm run lint         # ESLint
npm test             # Vitest; DynamoDB is mocked, nothing reaches AWS
npx @redocly/cli lint docs/openapi.yaml   # when the API contract changes
```

## Spec-driven workflow (harness)

1. **No spec, no change.** Every modification of code, infrastructure or the public API needs its own spec in `specs/`, written from `specs/TEMPLATE.md`, numbered sequentially, and `Approved` by the maintainer before implementation starts. Only typo fixes and documentation corrections with no behavior or contract change are exempt.
2. **The spec is the contract.** Implement exactly its Scope. Everything in Out of scope stays out, even if it looks like an improvement. A new idea becomes a new spec, never an extra commit.
3. **Read the spec first**, then the code. State at the start which spec governs the work.
4. **If reality disagrees with the spec, stop.** Amend the spec in its own commit with the reason, get it re-approved, then continue. Never deviate silently.
5. **Prove every acceptance criterion** with the commands in the spec's Verification section, and tick them. Report outcomes faithfully: failing checks are reported with their output.
6. **Close the loop:** set the spec `Implemented`, update the docs it names, and link the spec in the pull request.
7. **Do not reorder, add or drop roadmap steps** (spec 0000) without amending it.
8. Behavior-preserving specs (refactors) keep existing tests unchanged. Editing an existing assertion is a red flag that needs justification in the spec.

The process is described in full in `specs/README.md`.

## Architecture rules

Target layers (spec 0000): `handlers → application (use cases) → domain`, with persistence behind a `TaskRepository` port implemented in `infrastructure`.

- Dependencies point inward. The domain imports nothing from other layers.
- Handlers never import the AWS SDK; only `src/infrastructure/` does.
- Use cases never import middy or API Gateway types.
- Only the repository knows keys, condition expressions, index names and cursor formats.
- **Ownership is mandatory:** identity comes only from the verified JWT (`getOwnerId`), never from the body, path or query. Every read, update and delete is scoped to the caller. Another user's task is indistinguishable from a missing one (`404`).
- The current state of the layering is whatever the latest `Implemented` spec says; do not assume a later step.

## Engineering standards

- **Clean Code:** intention-revealing names, small functions with one level of abstraction, no dead code or commented-out code, comments explain *why* not *what*, early returns over nesting.
- **SOLID:** one reason to change per module; extend by adding implementations; small role-specific ports; depend on abstractions injected from a composition root. Implementations of a port must honor its documented behavior.
- **KISS and YAGNI:** the simplest design that satisfies the spec. No speculative abstractions, no frameworks for problems we do not have, no generic helper before its third use, no unused parameters or options.
- **Patterns only to remove a real problem:** Repository, Dependency Injection (constructors and factories), Use Case, single error-mapping boundary. No pattern for its own sake.
- Match the style of the surrounding file (ES modules, existing indentation and quotes); `npm run lint` must stay clean.
- Prefer plain objects and functions over classes unless state or polymorphism is needed.
- Keep functions and modules small enough to read without scrolling; split when a second responsibility appears.

## Tests

- Test at the layer where the logic lives: use cases against an in-memory repository, the repository against a fake or local client, handlers only for HTTP mapping.
- New behavior ships with tests in the same commit series. No test is deleted or weakened to make a change pass.
- Tests never reach AWS. Use `tests/helpers.js`.

## Git and delivery

- All branches start from `development` (or a release tag whose commit contains it) and their pull request targets `development`. Names: lowercase, hyphens, 3 to 5 words, no spaces, accents or special characters, not ending in a hyphen.
- Promotion is `development → staging → production → main` by pull requests with merge commits, never squash. Never commit directly to those four branches.
- **Atomic commits**, one logical, independently revertible change each. Messages are English with this structure:

  ```
  Descriptive title

  What: one paragraph.

  Why: one paragraph explaining the motivation, not a restatement of the diff.
  ```

- **No AI attribution** in commit messages: no `Co-Authored-By` line, no "Generated with" line, no mention of AI assistance.
- Never amend or rewrite commits from earlier turns, never force-push, never skip hooks.
- **Do not push, tag, open pull requests, deploy or delete remote resources unless the maintainer asked for that action.** Ask first; approval for one action does not extend to the next.

## Documentation

- English files are authoritative. Spanish references (`README.es.md`, `CONTRIBUTING.es.md`, `docs/ARCHITECTURE.es.md`) are untracked (excluded through `.git/info/exclude`) and must keep the same headings, table rows and code blocks as their English file. Update them whenever the English file changes.
- Changing a route, status code or field updates `docs/openapi.yaml` and the README API tables in the same change.
- Contract changes follow `docs/API_VERSIONING.md`: the spec names the class of change (breaking, non-breaking, fix or operational), and `CHANGELOG.md` gets an entry under `Unreleased`.
- Specs are English only and are not translated.

## Security and safety

- Never commit credentials, tokens, `.env` files or account ids. Never print tokens in logs or docs.
- Do not add dependencies without a spec that justifies them.
- Keep the Lambda role least-privilege; widening IAM needs a spec.
- Do not run destructive or costly AWS commands (deploys, `serverless remove`, user or table deletion) without explicit approval.

## Definition of done

- [ ] A spec governs the change and is `Approved` (then `Implemented` on close).
- [ ] Only the spec's Scope was changed; nothing from Out of scope.
- [ ] Acceptance criteria verified with the spec's commands.
- [ ] `npm run lint` and `npm test` pass; new behavior is tested.
- [ ] Docs, OpenAPI and the Spanish references are updated where affected.
- [ ] Commits are atomic and follow the message format; no attribution lines.
- [ ] The pull request targets `development` and links the spec.

## Quick pointers

- Roadmap and principles: `specs/0000-roadmap-to-layered-architecture.md`
- Spec process and template: `specs/README.md`, `specs/TEMPLATE.md`
- Design, decisions and review findings: `docs/ARCHITECTURE.md`
- Contributor workflow for forks: `CONTRIBUTING.md`
