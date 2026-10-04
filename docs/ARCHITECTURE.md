# Architecture

This document describes how the Tasks API is built today, why it is built that way, what a review of it found, and the roadmap to a layered architecture. For setup and usage see the [README](../README.md); for the API contract see [`openapi.yaml`](openapi.yaml).

## 1. Context

A small multi-user task service. Each user signs in with Amazon Cognito and manages only their own tasks. It is deliberately simple: one bounded context, one table, five functions. The goal of this document is to keep it simple while making it easy to evolve safely.

## 2. Current architecture

```
                      ┌────────────────────────── AWS account, one stack per stage ──────────────────────────┐
                      │                                                                                       │
Client ──HTTPS + JWT──┼─▶ API Gateway (HTTP API) ──▶ JWT authorizer ──▶ Lambda (one function per route) ──▶ DynamoDB
                      │                                    │                                                  │
                      │                                    └── validates the token against the Cognito user pool
                      └───────────────────────────────────────────────────────────────────────────────────────┘
```

| Concern | Choice |
| --- | --- |
| Compute | One Node.js 24 (`arm64`, ES modules) Lambda per route |
| API | API Gateway HTTP API with a Cognito JWT authorizer on every route except `GET /` |
| Identity | Cognito user pool `tasks-<stage>` and an app client without a secret |
| Data | DynamoDB `TaskTable-<stage>`, on-demand billing, partition key `id`, GSI `ownerId-createdAt-index` |
| Request handling | middy: JSON body parser, Ajv JSON Schema validation, error-to-HTTP mapping |
| Infrastructure as code | Serverless Framework v4, a single `serverless.yml` |
| Delivery | CI runs lint and unit tests on the four long-lived branches; deploys are manual |

### Request lifecycle

1. API Gateway validates the JWT (issuer, audience, expiry). Failure ends the request with `401`; no function runs.
2. The route's Lambda receives the event with the verified claims in `requestContext.authorizer.jwt.claims`.
3. `getOwnerId` (`src/auth.js`) reads `sub`. This is the only source of identity.
4. For routes with a body, the middy stack parses it (`415` and `422` on failure) and validates it against a schema (`400`).
5. The handler calls the task repository (`src/infrastructure/taskRepository.js`), always scoped to the caller. `DynamoTaskRepository` is the only code that talks to DynamoDB, through the shared document client (`src/infrastructure/dynamoClient.js`).
6. The handler returns `{ statusCode, body }`; unexpected errors are logged and answered with `500` and a fixed message.

### Access patterns and ownership

All of these live in `DynamoTaskRepository` (`src/infrastructure/dynamoTaskRepository.js`), behind the `TaskRepository` port documented in `src/domain/taskRepository.js`. Handlers do not build DynamoDB requests.

| Operation | DynamoDB call | How ownership is enforced |
| --- | --- | --- |
| Create | `PutItem` with `attribute_not_exists(id)` | `ownerId` is set from the token |
| List | `Query` on `ownerId-createdAt-index` | The key condition is the caller's `ownerId`; the cursor's owner is rebuilt from the token |
| Get | `GetItem` with `ConsistentRead` | The item is returned only if its `ownerId` matches, otherwise `404` |
| Update | `UpdateItem` | Condition `attribute_exists(id) AND ownerId = :ownerId`; failure is `404` |
| Delete | `DeleteItem` | Same condition as update |

## 3. Decision log

| Decision | Reason | Trade-off |
| --- | --- | --- |
| One Lambda per route | Independent deploys, scaling and least-privilege per function; simple mental model | Some duplication of bootstrapping; more functions to observe |
| HTTP API instead of REST API | Cheaper and lower latency, native JWT authorizer | No usage plans or API keys, no request validation at the gateway |
| Cognito JWT authorizer at the gateway | Authentication is not application code; invalid calls never cost a function invocation | Coupled to Cognito's token format |
| Ownership via `sub` stored on each item | Simple, no extra table | Not part of the key, so it needs a GSI to list (see findings) |
| `404` for other users' tasks | Does not reveal which ids exist | Slightly harder to debug a wrong token |
| Conditional writes for update and delete | Atomic ownership check, no read-then-write race | Condition failures need mapping to `404` |
| ESM + AWS SDK v3 | Required by middy 7; smaller, modular SDK | Node 22+ needed |
| Validation with JSON Schema (Ajv) | One declarative source per body, used by `POST` and `PUT` | Messages come from Ajv, not hand-written |
| Stage-per-stack naming (`-<stage>`) | Stages share an account without touching each other's data or users | Resources are replaced if the naming changes |

## 4. Review findings

Found while auditing the code against the documentation. Status is as of this document.

| # | Finding | Status |
| --- | --- | --- |
| F1 | `package.json` had no name, license or Node engine | Fixed |
| F2 | The listing reads a GSI and is eventually consistent, undocumented | Documented; removed by roadmap step 5 |
| F3 | No machine-readable API contract | Fixed (`openapi.yaml`) |
| F4 | No contributor guide for forks | Fixed (`CONTRIBUTING.md`) |
| F5 | README lacked consumer guidance, error model, troubleshooting and security notes | Fixed |
| F6 | Tasks created before `ownerId` are unreachable | Documented; roadmap step 4 provides a migration |
| F7 | No end-to-end check of authentication and isolation | Fixed (`scripts/smoke.sh`); to be run in CI by step 8 |
| F8 | `GET /tasks/{id}` used an eventually consistent read, so a task could be missing right after it was created | Fixed (`ConsistentRead`) |
| F9 | Handlers combine HTTP, rules and persistence; ownership scoping depends on each handler remembering it | Partly fixed: persistence and ownership conditions are behind the repository port ([spec 0001](../specs/0001-extract-task-repository-port.md)). Open: use cases and thin handlers, roadmap step 2 |
| F10 | No observability, deploy pipeline, production safeguards (retention, point-in-time recovery, deletion protection) or CORS | Open; roadmap steps 6 to 9 |
| F11 | `PUT` has PATCH semantics; `POST` is not idempotent | Open; roadmap step 11 |

## 5. Target architecture

A layered "ports and adapters" structure inside the same Lambda-per-route deployment. Nothing changes for API consumers.

```
HTTP adapter (handlers + middy)  ──▶  Application (use cases)  ──▶  Domain (Task, rules, errors)
                                                │
                                                ▼  port: TaskRepository
                                    Infrastructure (DynamoTaskRepository, config, logger)
```

| Layer | Responsibility | Knows about |
| --- | --- | --- |
| `src/handlers/` | Parse and validate the request, read the caller from the JWT, call a use case, map the result or a typed error to HTTP | Application |
| `src/application/` | One function per use case (`createTask`, `listTasks`, `getTask`, `updateTask`, `deleteTask`). Each takes `ownerId` as a required argument, so scoping cannot be forgotten | Domain and the repository port |
| `src/domain/` | The `Task` shape, invariants, typed errors (`TaskNotFoundError`, `InvalidCursorError`) | Nothing else |
| `src/infrastructure/` | `DynamoTaskRepository` (the only code that knows keys, conditions and cursors), validated configuration, logger | AWS SDK |

Rules: dependencies point inward; handlers never import the AWS SDK; use cases never import middy or API Gateway types; the repository is the only place that knows the table design.

Testing follows the layers: use cases run against an in-memory repository (fast, no SDK mocks), the repository against DynamoDB Local, and handlers only prove HTTP mapping.

Scope boundary: this stays a single service. Splitting into services, a message bus or CQRS is not justified by the current size.

## 6. Roadmap

The roadmap is governed by [spec 0000](../specs/0000-roadmap-to-layered-architecture.md); this table is a summary. Every step is delivered under its own approved spec in [`specs/`](../specs/README.md), which fixes its scope, acceptance criteria and commit plan, and a change that is not in its spec is drift. Each step is its own branch, started from `development`, with its own pull request to `development` and small atomic commits.

| Step | Branch | Outcome | How it is verified |
| --- | --- | --- | --- |
| 1 | `extract-task-repository-port` | `TaskRepository` port and `DynamoTaskRepository`; handlers use it; behavior unchanged. **Done**, [spec 0001](../specs/0001-extract-task-repository-port.md) | Existing tests green; repository tests |
| 2 | `add-task-use-cases` | `application/` use cases take `ownerId`; handlers become thin; domain errors | Use-case tests with an in-memory repository |
| 3 | `standardize-error-responses` | Typed errors and one error mapper; keep the `{ message }` shape unless RFC 9457 is chosen | OpenAPI examples match responses |
| 4 | `migrate-orphan-task-owners` | Script that assigns `ownerId` to tasks created before ownership; explicit `--owner`, dry run by default | Dry run on the dev table |
| 5 | `redesign-task-table-keys` | New table keyed `PK = ownerId`, `SK = id` with a time-sortable id (such as ULID): consistent listing, no GSI, ownership implicit in the key. Side-by-side migration, then drop the old table | Smoke test; migration check. Breaking for cursors |
| 6 | `add-observability-with-powertools` | Structured logs, correlation id, tracing, metrics, log retention, alarms on 5xx, throttles and latency | Logs and alarms visible in dev |
| 7 | `add-ci-quality-gates` | OpenAPI lint, coverage threshold, dependency audit, template validation, DynamoDB Local integration job | CI green on a pull request |
| 8 | `add-deploy-pipeline-oidc` | Deploy from GitHub Actions through an AWS OIDC role (no long-lived keys): `development` to dev, `staging` to staging, `production` to prod with manual approval; run `scripts/smoke.sh` after each deploy | Deploy to dev from CI |
| 9 | `harden-production-resources` | `DeletionPolicy: Retain`, point-in-time recovery, deletion protection, explicit CORS origins, route throttling, per-function IAM, MFA option, SRP or hosted UI with PKCE instead of `USER_PASSWORD_AUTH` outside dev | Template validation; deploy to staging |
| 10 | `split-serverless-config-files` | `serverless.yml` split into `resources/` and `functions/` files | `serverless print` output unchanged |
| 11 | `add-patch-task-route` | `PATCH /tasks/{id}` for partial updates; `PUT` kept and marked deprecated; optional idempotency key on `POST` | OpenAPI and tests |
| 12 | `evaluate-typescript-migration` | Decision record: TypeScript or JSDoc types; and Serverless v4 (needs an account and org) versus SAM or CDK | Decision record in `docs/` |

Suggested order: 1, 2, 4, 5 (data model), 6, 7, 8 (operations), then 9 to 12. Steps 1 to 3 are low risk and unblock the rest. Step 5 is the only breaking change: it needs a maintenance window and the migration from step 4.

## 7. Open decisions

- Keep the `{ message }` error shape, or adopt RFC 9457 problem details (breaking for clients).
- Whether to move away from Serverless Framework v4, which requires an account and an `org`, so forks without one cannot deploy as is.
- Whether the listing should keep a GSI (cheap to keep, eventually consistent) or move to the key redesign of step 5.
