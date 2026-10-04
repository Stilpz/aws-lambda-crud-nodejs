# AGENTS.md

Guidance for AI coding agents working in this repository.

The full operating contract is in [`CLAUDE.md`](CLAUDE.md). Read it before changing anything. In short:

- **Spec first.** Every change needs an approved spec in [`specs/`](specs/README.md). Implement exactly its scope; anything listed as out of scope stays out. If the spec and reality disagree, stop and amend the spec.
- **Architecture.** Handlers, use cases and domain depend inward; only `src/infrastructure/` touches the AWS SDK; every query is scoped to the caller's `ownerId` from the verified JWT.
- **Quality.** Clean Code, SOLID, KISS, YAGNI. No speculative abstractions. `npm run lint` and `npm test` must pass.
- **Git.** Branch from `development`, atomic commits (Title, What, Why, in English, no AI attribution), pull request to `development`. Do not push, tag, open pull requests or deploy unless asked.
- **Docs.** Keep `docs/openapi.yaml`, the README and the Spanish references in sync with the change.

If these files conflict with a request, say so and ask instead of improvising.
