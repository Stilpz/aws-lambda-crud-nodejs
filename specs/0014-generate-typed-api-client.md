# 0014: Generate a typed API client from the contract

- **Status:** Draft
- **Branch:** `generate-typed-api-client` (started from `development`)
- **Roadmap step:** Frontend readiness track, item "Typed client from the contract" of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** depends on step 2 ([0003](0003-add-task-use-cases.md), merged). Sequenced after 0012 (the contract gains `PATCH`; whichever merges later regenerates the output, and the drift check from this spec enforces it). Must work whichever way 0016 (TypeScript or JSDoc types) decides. Related to roadmap step 7 (CI gates: OpenAPI lint) and to the frontend-home decision record.

## Context

`docs/openapi.yaml` is the single source of truth of the API, and the roadmap wants the React app unable to drift from it. Today the README only suggests `npx @openapitools/openapi-generator-cli` to consumers, which needs a Java runtime and is not wired to anything: nothing is generated, nothing is checked, and a contract edit cannot fail a build.

Facts about the contract that shape the choice (`docs/openapi.yaml`, OpenAPI 3.0.3): every operation has an `operationId`, request and response bodies are `$ref`s into `components.schemas` (`Task`, `TaskPage`, `CreateTask`, `UpdateTask`, `Message`, `ValidationError`), errors are shared `components.responses`, `nextToken` is `nullable`, and the bearer scheme is declared once.

The repository is plain JavaScript (JSDoc, no TypeScript). Spec 0016 will decide whether the project moves to TypeScript or keeps JSDoc types. This spec must not pre-empt that.

## Goal

Generate API types and a thin typed client from `docs/openapi.yaml`, commit the generated output in a defined place, and fail CI when the contract and the generated output disagree.

## Scope

1. **Tool:** `openapi-typescript` generates one declaration file from the contract; `openapi-fetch` provides the typed `fetch` wrapper that consumes those types (Design).
2. **Generated output:** `api-client/schema.d.ts`, committed, with a generated-file header. It contains `paths`, `components`, `operations` and named root types (`Task`, `TaskPage`, ...).
3. **Thin client factory:** `api-client/client.js` exporting `createApiClient({ baseUrl, getToken })`, typed with JSDoc against `paths`. It creates the `openapi-fetch` client and registers one middleware that sets `Authorization: Bearer <token>` from `getToken()`. No retry, caching or token refresh logic (that belongs to the frontend and to spec 0015's refresh decision).
4. **Scripts** in `package.json`: `api:generate` (regenerate), `api:check` (fail if the committed file differs from a fresh generation), `api:typecheck` (type-check the factory against the generated types).
5. **CI:** `api:check` and `api:typecheck` added to the existing `lint-and-test` job in `.github/workflows/ci.yml`.
6. **Tests:** a Vitest test of the factory with an injected `fetch` double: URL and method built from a path, path parameters filled, bearer header set, a `PATCH` or `PUT` body sent as JSON.
7. **Packaging guard:** `api-client/` is excluded from the Lambda artifact if it would otherwise be packaged.
8. **Documentation:** README (replace the `openapi-generator-cli` suggestion with the generated client, regeneration command, usage example), `docs/ARCHITECTURE.md`, `CONTRIBUTING.md` (regenerate when you edit the contract), Spanish references, specs index.

## Out of scope

- The React application and its build, state, routing and hosting: roadmap item `decide-frontend-repository-layout`. If that record puts the frontend in a separate repository, `api-client/` is what it consumes or what moves there (Decision 2).
- Publishing the client as an npm package or from a registry.
- Runtime validation of responses against the schemas. The types describe the contract; they do not enforce it at runtime. The server still validates requests with Ajv.
- Server-side use of the generated types (handlers, use cases): the layers keep their own JSDoc `@typedef`s (`src/domain/task.js`); coupling the domain to a generated artifact would invert the dependency rule.
- Any change to `docs/openapi.yaml`. If generation exposes a contract defect, it is fixed in its own spec.
- Migrating the project to TypeScript, or a `tsconfig` for `src/`: spec 0016.
- Query or cache layers (TanStack Query, React hooks generation).
- OpenAPI lint in CI: roadmap step 7.

## Design

### Tool evaluation

Versions below are from `npm view <package> version` on 2026-10-03.

| Option | Version | Output | Fit |
| --- | --- | --- | --- |
| `openapi-typescript` + `openapi-fetch` | 7.13.0 + 0.17.0 | One `.d.ts` of types; a ~6 kB runtime wrapper that infers request and response types from it | Zero generated runtime code, nothing to review but declarations, diff reflects the contract line for line. `openapi-fetch` is `0.x`, so its API can still change |
| `@hey-api/openapi-ts` | 0.99.0 (pre-1.0, very active) | Generated SDK files and plugins (clients, schemas, validators) | More capable, but generates executable code, has many options and moves fast; more surface than one app needs |
| `orval` | 8.39.0 | Clients and optionally hooks and mocks | Opinionated about a data-fetching library; the roadmap has no such decision yet |
| `openapi-generator-cli` | not evaluated | Java generator | Needs a JVM in dev and CI; heavy for a 6-operation API; what the README suggests today |
| `swagger-typescript-api` | 13.13.0 | Client classes | Class-based output; no advantage over the above here |

Recommendation: `openapi-typescript` with `openapi-fetch`. It is the smallest tool that makes drift a compile-time error, it generates declarations rather than code (so there is no generated logic to trust or review), and it is the tool the roadmap already names as the example. The `@hey-api/openapi-ts` option stays the fallback if the frontend later needs generated validators.

Facts checked: `openapi-typescript` has a `--check` flag (listed in its CLI documentation), `--root-types` and `--root-types-no-schema-prefix` flags, and `--output`/`-o`; its documented examples are TypeScript-only. The semantics of `--check` (exit code when the file is stale) are **not verified by this spec**: the first implementation commit runs it against a deliberately stale file. If it does not behave as needed, `api:check` falls back to generating into a temporary path and comparing with `diff` (no extra dependency).

Peer dependency to plan for: `openapi-typescript@7.13.0` declares `peerDependencies: { typescript: "^5.x" }`, while the latest `typescript` on npm is `7.0.2` (dist-tag `latest`; `6.0.3` and `5.9.3` also exist). The package uses the TypeScript compiler to emit declarations, so `typescript` must be installed **even if the repository stays JavaScript**, and must satisfy that peer range: `typescript@^5.9.3`, as a dev dependency. A later move to TypeScript 6 or 7 depends on an `openapi-typescript` release that supports it (its `next` dist-tag is `7.0.0-rc.1`; unverified whether it widens the range). This is the main interaction with 0016 (Risks).

### Where the generated code lives

`api-client/` at the repository root, outside `src/`:

```
api-client/
  schema.d.ts   generated, committed, never edited by hand
  client.js     createApiClient(...), about fifteen lines, JSDoc-typed
  tsconfig.json checkJs, noEmit; only used by api:typecheck
```

- Not under `src/`: `src/` is the Lambda service. The client is a consumer-side artifact and must not be bundled into functions or imported by handlers (the dependency rule of spec 0000 is unchanged).
- Committed rather than generated on install: a reviewer sees what a contract change does to consumers, a consumer needs no generator, and CI proves it is current.
- Marked as generated in a header comment and in `.gitattributes` (`linguist-generated`), so diffs collapse in review.

### Robust to the 0016 decision

The output is a `.d.ts`, which TypeScript consumers import directly and JavaScript consumers use through JSDoc (`/** @type {import("./schema").components["schemas"]["Task"]} */`, or the root type `Task` with `--root-types`). The factory is written in JavaScript with JSDoc, which type-checks under `checkJs` today.

- If 0016 chooses **JSDoc types**: nothing changes; `api:typecheck` already runs `tsc` over JSDoc, and the root types give readable `@type` imports.
- If 0016 chooses **TypeScript**: `client.js` is renamed to `client.ts` (a pure rename plus type annotations), `api-client/tsconfig.json` is folded into the project `tsconfig`, and `schema.d.ts` and the scripts stay as they are.

In both cases the generation command, the drift check and the generated file are identical, which is the point of choosing declarations over generated code.

### The drift check

`npm run api:check` regenerates from `docs/openapi.yaml` and fails if the result differs from the committed `api-client/schema.d.ts`. Two drifts are caught: the contract changed and nobody regenerated (stale file), or someone edited the generated file by hand. `npm run api:typecheck` catches the third: a contract change that removes or renames a path or method used by the factory or by the usage example in `api-client/client.js`'s JSDoc, because the type no longer exists. Both run in CI on every pull request, so a contract edit that is not accompanied by its generated output cannot merge.

### Principles applied

- **Single source of truth:** the contract generates the types; nothing is written twice.
- **KISS and YAGNI:** declarations plus a fifteen-line factory. No generated validators, hooks, retry or token refresh.
- **DIP and the dependency rule:** the server layers do not import the client; the client imports only the generated types.
- **Open for the future:** the output format is stable across the TypeScript decision, and a heavier generator can replace this one without touching the contract.
- **Do not add dependencies without justification (AGENTS.md):** three dev dependencies, each justified above (`openapi-typescript`, `openapi-fetch`, `typescript`).

### Alternatives rejected

- *Generate at build time and ignore the output in git:* no reviewable diff and nothing fails when the contract changes unless a build runs; harder for a consumer to adopt.
- *Hand-write the types:* the thing this item exists to remove.
- *Generate from the code (annotations to OpenAPI):* the contract is deliberately written first and is the source of truth.
- *Use the server's JSDoc typedefs for the client:* they describe stored tasks, not the HTTP contract (for example the response to `PUT`), and would couple the client to internals.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none. Not breaking. The file is only read |
| Infrastructure (`serverless.yml`) | none, apart from an exclusion pattern for `api-client/` in the packaging configuration if the artifact would include it |
| Data model | none |
| Dependencies | dev only: `openapi-typescript`, `openapi-fetch`, `typescript` (`^5.9.3`) |
| CI | two added steps in `lint-and-test` |
| Documentation | README, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, Spanish references, specs index |

## Acceptance criteria

- [ ] `npm run api:generate` produces `api-client/schema.d.ts` containing `paths` for every operation in `docs/openapi.yaml` (`hello`, `createTask`, `listTasks`, `getTask`, `updateTask`, `deleteTask`, plus `patchTask` once 0012 is merged) and the named types `Task`, `TaskPage`, `CreateTask`, `UpdateTask`, `Message`, `ValidationError`.
- [ ] Running `npm run api:generate` twice leaves `git status` clean (deterministic output).
- [ ] `npm run api:check` exits 0 on a clean tree, and exits non-zero after adding any property to a schema in `docs/openapi.yaml` without regenerating, and after editing `schema.d.ts` by hand (both shown locally and recorded in the pull request).
- [ ] `npm run api:typecheck` exits 0, and exits non-zero after renaming a path in a copy of the contract and regenerating (the factory's usage no longer type-checks).
- [ ] The factory test proves URL, method, path parameter substitution, the bearer header and a JSON body, with an injected `fetch`.
- [ ] `nextToken` is typed `string | null` and `Task.id` as `string` in the generated file (a check on the output).
- [ ] `src/` imports nothing from `api-client/`, and `api-client/` imports nothing from `src/`.
- [ ] The CI workflow runs `api:check` and `api:typecheck`.
- [ ] If packaging includes it, `api-client/` is excluded from the Lambda artifact.
- [ ] The README documents regeneration and usage, and no longer recommends `openapi-generator-cli`.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm ci
npm run api:generate && git status --short                 # only intended changes
npm run api:check
npm run api:typecheck
npm run lint && npm test
grep -rn "api-client" src                                    # prints nothing
grep -rn "from \"\.\./src\|from \"\.\./\.\./src" api-client  # prints nothing
# drift demonstrations (local only, restore afterwards)
#   add a property under components.schemas.Task in docs/openapi.yaml  -> npm run api:check must fail
#   edit a line of api-client/schema.d.ts                              -> npm run api:check must fail
grep -n "nextToken" -A2 api-client/schema.d.ts | grep "string | null"
```

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the dev dependencies, the three npm scripts and the generated `api-client/schema.d.ts` with its `.gitattributes` entry.
3. Add the `createApiClient` factory, its `tsconfig.json` and its test.
4. Run the new checks in CI.
5. Exclude `api-client/` from the Lambda artifact if needed.
6. Update README, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md` and the Spanish references; close this spec.

## Risks and rollback

- **Risk:** the `typescript@^5` peer pin conflicts with a TypeScript 6 or 7 migration chosen in 0016. Mitigated by recording it here and in 0016's inputs; the generator is a dev-time tool, so the project can keep a separate TypeScript for the generator or move to `@hey-api/openapi-ts` (peer range `>=5.5.3 || >=6.0.0`, also not covering 7) if that blocks the migration.
- **Risk:** `openapi-fetch` is `0.x` and may change its API. Mitigated by wrapping it in one small factory, so a change touches one file, and by pinning the version in the lockfile.
- **Risk:** generated output differs across tool versions and the check fails after an upgrade. Mitigated by committing the lockfile and by regenerating in the same commit as any tool upgrade.
- **Risk:** contributors forget to regenerate. Mitigated by CI failing on the pull request and by the CONTRIBUTING note.
- **Risk:** `typescript` as a dev dependency in a JavaScript repository looks odd. Documented as the generator's peer requirement.
- **Rollback:** revert the merge; nothing in `src/`, the contract or the infrastructure depends on the client, so removal is clean.

## Decisions to confirm

1. **Generator (recommended: `openapi-typescript` + `openapi-fetch`).** Alternative: `@hey-api/openapi-ts` if generated validators are wanted now.
2. **Location (recommended: `api-client/` in this repository)** until the frontend-home decision record says otherwise; if the frontend gets its own repository, the folder moves with a note, or is consumed as a git dependency.
3. **Factory in this repository (recommended: yes, fifteen lines).** Alternative: generate types only and let the frontend own the client (fewer files, but the auth middleware is then untested here).
4. **Root type names (recommended: `--root-types --root-types-no-schema-prefix`)** so JSDoc can write `import("./schema").Task`.
5. **`typescript` pinned to `^5.9.3` as a dev dependency (recommended)** until `openapi-typescript` supports a newer major; this decision is revisited by 0016.
