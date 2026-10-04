# 0000: Roadmap to a layered architecture and a React-ready API

- **Status:** Approved
- **Branch:** none (this spec governs the sequence; each step has its own spec and branch)
- **Baseline:** release [`v1.0.0`](https://github.com/Stilpz/aws-lambda-crud-nodejs/releases/tag/v1.0.0), commit `65d1523`
- **Supersedes / depends on:** none

## Context

`v1.0.0` ships an authenticated, per-user Tasks API. It works, but its handlers mix HTTP, business rules and DynamoDB access, ownership scoping depends on each handler remembering it, and several production concerns (observability, delivery, hardening, CORS) are open. A React frontend is planned next and needs a stable, well-described API. The review findings are in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Goal

Move the codebase, in small verifiable steps, to the layered architecture below, while keeping the public API stable and preparing it to be consumed by a React frontend.

## Target architecture

```
HTTP adapter (handlers + middy)  ──▶  Application (use cases)  ──▶  Domain (Task, rules, errors)
                                                │
                                                ▼  port: TaskRepository
                                    Infrastructure (DynamoTaskRepository, config, logger)
```

Dependency rule: dependencies point inward. Handlers never import the AWS SDK. Use cases never import middy or API Gateway types. The domain imports nothing from the other layers. Only the repository knows the table design.

## Engineering principles (apply to every step)

- **Clean Code:** intention-revealing names, small functions with one level of abstraction, no dead code, comments only for the why.
- **SOLID:** one reason to change per module (S); extend by adding implementations, not by editing callers (O); small, role-specific ports (I); depend on abstractions injected from a composition root (D). Liskov: any `TaskRepository` implementation must honor the port's documented behavior, enforced by shared tests.
- **KISS and YAGNI:** the simplest structure that satisfies the spec. No class hierarchies, frameworks or abstractions for needs that do not exist yet. A generic helper is extracted only on its third use.
- **Patterns, used when they remove a real problem:** Repository (persistence behind a port), Dependency Injection through factories and constructors, Use Case / Application Service, and a single error-mapping boundary. No pattern is added for its own sake.
- **Tests:** behavior-preserving steps keep existing tests unchanged; new logic is tested at the layer where it lives.

## Steps

Each step gets its own spec, written and approved before the work starts, numbered in the order the specs are written. The branch names below are fixed by this roadmap.

| Step | Branch | Outcome |
| --- | --- | --- |
| 1 | `extract-task-repository-port` | `TaskRepository` port and `DynamoTaskRepository`; handlers use the port; behavior unchanged. Spec [0001](0001-extract-task-repository-port.md) |
| 2 | `add-task-use-cases` | `application/` use cases that take `ownerId`; thin handlers moved to `src/handlers/`. Spec [0003](0003-add-task-use-cases.md) |
| 3 | `standardize-error-responses` | Typed errors mapped in one place; the `{ message }` shape is kept. Spec [0004](0004-standardize-error-responses.md) |
| 4 | `migrate-orphan-task-owners` | Script that assigns `ownerId` to pre-ownership tasks, or deletes them; dry run by default. Spec [0005](0005-migrate-orphan-task-owners.md), superseded by step 5 |
| 5 | `redesign-task-table-keys` | Table keyed by `ownerId` and a time-sortable id: consistent listing, no secondary index. Spec [0006](0006-redesign-task-table-keys.md) |
| 6 | `add-observability-with-powertools` | Structured logs, correlation id, tracing, metrics, alarms |
| 7 | `add-ci-quality-gates` | OpenAPI lint, coverage threshold, dependency audit, DynamoDB Local integration job |
| 8 | `add-deploy-pipeline-oidc` | Deploy from GitHub Actions through an AWS OIDC role; smoke test after each deploy |
| 9 | `harden-production-resources` | Retention, point-in-time recovery, deletion protection, throttling, per-function IAM |
| 10 | `split-serverless-config-files` | `serverless.yml` split into `resources/` and `functions/` files |
| 11 | `add-patch-task-route` | `PATCH /tasks/{id}`; `PUT` kept and deprecated; optional idempotency key on `POST` |
| 12 | `evaluate-typescript-migration` | Decision record: TypeScript or JSDoc types; Serverless v4 versus SAM or CDK |

Suggested order: 1, 2, 4, 5, then 6 to 8, then 9 to 12. Steps 1 to 3 are low risk and unblock the rest. Step 5 is the only breaking change and needs a maintenance window plus the migration from step 4.

## Frontend readiness track (React)

The frontend comes after the API is stable. These items prepare the ground; each becomes its own spec and branch when started, and none starts before step 2 is merged.

| Item | Branch | Why the React app needs it |
| --- | --- | --- |
| CORS with explicit origins | `add-explicit-cors-origins` | Browsers on another origin cannot call the API without it. Allowed origins per stage, `Authorization` and `Content-Type` headers allowed |
| Typed client from the contract | `generate-typed-api-client` | Generate types and a client from `docs/openapi.yaml` (for example `openapi-typescript`), so the frontend cannot drift from the API |
| Browser-safe sign-in | `add-spa-cognito-app-client` | A separate app client for the SPA using the hosted UI with authorization code and PKCE, with callback and logout URLs per stage. `USER_PASSWORD_AUTH` stays for scripts and tests only |
| Contract stability policy | `define-api-versioning-policy` | Rules for what counts as breaking, how it is announced and deprecated. The OpenAPI file is the single source of truth |
| Frontend home | `decide-frontend-repository-layout` | Decision record: a `web/` workspace in this repository or a separate repository, how it is built, tested and deployed (for example S3 and CloudFront), and how it consumes the generated client |

Properties the API already offers to a React client and must keep: cursor pagination (fits infinite scroll), a stable error shape with per-field `errors`, ownership-scoped data, and a consistent single-task read.

## Out of scope

- Writing the frontend itself.
- Splitting the service, adding a message bus or CQRS.
- Any step not listed here. A new need is a new spec that amends this roadmap.

## Acceptance criteria

- [x] The roadmap and the frontend track are recorded in `specs/`.
- [ ] Each step is closed by its own spec reaching `Implemented`.
- [ ] `docs/ARCHITECTURE.md` reflects the architecture after each step.

## Change control

Changing the order, adding or dropping a step requires amending this spec in its own commit, with the reason in the message, and re-approval by the maintainer.
