# 0009: Add observability with Powertools for AWS Lambda

- **Status:** Draft
- **Branch:** `add-observability-with-powertools` (started from `development`)
- **Roadmap step:** 6 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0004](0004-standardize-error-responses.md) (the error boundary is the one place that logs unknown errors; that spec left structured logging to this step). Independent of 0010 and 0011, but see "Order and file layout" in Design

## Context

Today the API has no observability beyond what AWS gives for free (finding F10 in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)):

- The only log statement in `src/` is `console.error(logLabel, error)` in `src/handlers/errorBoundary.js`. It is plain text, has no level, no service name and no request identifier, so one failed request cannot be tied to the API Gateway request that caused it.
- There is no tracing, so a slow request cannot be split into API Gateway, Lambda start-up and DynamoDB time.
- There are no custom metrics (cold starts are invisible) and no alarms: nobody is told about a 5xx, a throttle or a latency regression.
- Log groups are created by Serverless Framework without a retention period, so they grow forever (`serverless package` output: the `*LogGroup` resources have only `LogGroupName`).

Facts checked while writing this spec:

- `@aws-lambda-powertools/logger`, `/metrics` and `/tracer` are all at `2.35.0` on npm (`npm view`). Each declares `@middy/core` `4.x || 5.x || 6.x || 7.x` as an optional peer, so the project's `@middy/core` `^7.9.2` is supported. They ship ESM (`"type": "module"`) and declare no `engines` field; the Metrics documentation shows Node.js 24 usage.
- The tracer depends on `aws-xray-sdk-core` (`^3.12.0`), which is not provided by the Lambda runtime and must be packaged with the function.
- The project is plain JavaScript. `serverless package` here produces a classic zip of the repository files (no esbuild bundling: the Serverless Framework v4 documentation says bundling applies when handlers are TypeScript or when `build.esbuild` is configured), so production dependencies travel in `node_modules` and no build change is needed.
- For API Gateway HTTP API (payload version 2.0) the Powertools predefined correlation path `API_GATEWAY_HTTP` is `requestContext.requestId`.
- HTTP API has no throttle metric. Its CloudWatch metrics are `4xx`, `5xx`, `Count`, `IntegrationLatency`, `Latency`, `DataProcessed`, with dimensions `ApiId` and `Stage` (route level only with detailed metrics). Lambda has a `Throttles` metric per function.
- Serverless v4 already supports `provider.tracing.lambda: true` (which adds `xray:PutTraceSegments` and `xray:PutTelemetryRecords` to the generated role; verified in a throwaway `serverless package`) and `provider.logRetentionInDays` (verified: adds `RetentionInDays` to every function log group).

## Goal

Make every request traceable and every failure visible: structured JSON logs carrying a correlation id, X-Ray traces including DynamoDB calls, an EMF cold-start metric, bounded log retention, and CloudWatch alarms on 5xx, throttles and latency that notify an SNS topic, without changing any HTTP response.

## Scope

1. **Dependencies** (justified here, as AGENTS.md requires): `@aws-lambda-powertools/logger`, `@aws-lambda-powertools/metrics`, `@aws-lambda-powertools/tracer`, each `^2.35.0`, as production dependencies.
2. **Observability module** `src/infrastructure/observability.js`: creates and exports one `logger`, one `metrics` and one `tracer`, configured from environment variables (`POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_METRICS_NAMESPACE`, `POWERTOOLS_LOG_LEVEL`). The logger is created with the correlation id search function. No other module imports a Powertools package.
3. **HTTP wrapper** `src/handlers/withObservability.js` exporting `withObservability(handler)`: a middy stack, outermost around every handler, that
   - injects Lambda context into the logger and sets `correlation_id` from `requestContext.requestId`, clearing per-invocation keys between invocations;
   - captures the handler in an X-Ray subsegment;
   - flushes metrics and records a `ColdStart` metric.
4. **Error boundary** (`src/handlers/errorBoundary.js`): the unknown-error branch calls `logger.error(logLabel, error)` instead of `console.error(logLabel, error)`. The mapping table, the labels and the responses do not change.
5. **Handlers**: `hello`, `addTask`, `getTasks`, `getTask`, `updateTask` and `deleteTask` are wrapped with `withObservability`, outermost. Their bodies, use cases and domain are untouched.
6. **DynamoDB tracing**: `src/infrastructure/dynamoClient.js` wraps the low-level client with `tracer.captureAWSv3Client` before building the document client, so each DynamoDB call is a subsegment.
7. **Infrastructure** (the file that holds the provider block, and the file that holds the resources; both are `serverless.yml` until spec 0011 lands):
   - `provider.tracing.lambda: true`.
   - `provider.logRetentionInDays` from a stage parameter (see Design).
   - Environment variables: `POWERTOOLS_SERVICE_NAME` (the service name), `POWERTOOLS_METRICS_NAMESPACE`, `POWERTOOLS_LOG_LEVEL` (a stage parameter), and `STAGE` for the metric dimension.
   - An SNS topic `AlarmTopic`, an optional email subscription, and three alarms (5xx, Lambda throttles, p95 latency) that notify the topic.
   - A `stages:` block with `default` params, so values are per stage with a safe default.
8. **Tests**: observability wrapper and module (see Acceptance criteria). Test configuration silences Powertools output.
9. **Documentation**: README (a new "Observability" section: where logs, traces, metrics and alarms live, how to subscribe, the log fields), `docs/ARCHITECTURE.md` (request lifecycle, F10 note, roadmap), the Spanish references.

## Out of scope

- Changing any response body, status code or header (`docs/openapi.yaml` stays as is). The correlation id is not added to responses: API Gateway already identifies the request, and a body change would be a contract decision for the versioning policy.
- Logging inside use cases or the domain. They stay free of logging, metrics and tracing; Clean Architecture's dependency rule is kept.
- Business metrics (tasks created, deleted). Added when a dashboard needs them (YAGNI).
- Logging the incoming event, request body, headers or claims (`POWERTOOLS_LOGGER_LOG_EVENT` stays `false`): bodies hold user data and `Authorization` holds a token.
- HTTP API access logs, dashboards, log insights queries, alarm runbooks.
- Alarm thresholds tuned on real traffic; the first values are conservative defaults.
- Throttling and deletion protection (spec 0010), splitting the config (spec 0011), the deploy pipeline (roadmap step 8).
- Deploying. The maintainer deploys, following the README.

## Design

```
event --> withObservability (logger context + correlation id, tracer segment, metrics flush)
            --> withJsonBody (body handlers only, spec 0004)
                  --> withErrorMapping --> handler --> use case --> repository --> DynamoDB (traced)
```

- **Layering.** Powertools lives in `src/infrastructure/observability.js`; the HTTP adapter (`withObservability`, `errorBoundary`) is the only consumer. Use cases and domain log nothing: an error already travels up as a typed error and is logged once, at the boundary. This keeps logging out of the domain and avoids duplicate log lines.
- **Why a middy wrapper for all handlers.** The Powertools middleware (`injectLambdaContext`, `captureLambdaHandler`, `logMetrics`) are middy middleware. Four handlers already run through middy (`withJsonBody`); the others are plain functions. One wrapper applied to all six gives one behavior and one place to change. A middy instance is itself a callable handler, so `withObservability(withJsonBody(...))` composes; this must be confirmed in the first implementation commit (see Risks).
- **Order.** Observability is outermost so the correlation id and context are set before `withErrorMapping` logs, and so metrics are flushed after the boundary has turned an error into a 500.
- **Log shape.** Powertools JSON: `level`, `message`, `timestamp`, `service`, `xray_trace_id`, `correlation_id`, plus the Lambda context keys (`cold_start`, `function_name`, `function_memory_size`, `function_arn`, `function_request_id`). Errors are serialized by `logger.error(label, error)` with `name`, `message`, `location` and `stack`. The stack stays in logs and never in a response, as today.
- **Correlation id** is `requestContext.requestId` (path `API_GATEWAY_HTTP`). It is the API Gateway request id, not the Lambda `awsRequestId`, because it is the id a caller or an API Gateway access log can quote. The Lambda id is still in `function_request_id`.
- **Stage-aware values** (Serverless v4 `stages:` block, `${param:...}`):

  | Param | `default` | `dev` | Note |
  | --- | --- | --- | --- |
  | `logRetentionInDays` | 90 | 7 | Must be a CloudWatch-valid value |
  | `logLevel` | `INFO` | `DEBUG` | Passed as `POWERTOOLS_LOG_LEVEL` |
  | `alarmEmail` | empty | empty | Set at deploy time: `--param="alarmEmail=..."`; never committed |

  `default` applies to `staging`, `prod` and any other stage name, so an unknown stage gets the stricter values. Spec 0010 uses the same block for its own params.
- **Alarms.** `AlarmTopic` (`AWS::SNS::Topic`) is the single notification target. An email subscription (`AWS::SNS::Subscription`) exists only when `alarmEmail` is not empty, through a CloudFormation condition (verified to resolve in `serverless package`). The maintainer subscribes by deploying with the parameter and confirming the subscription email; a chat or paging integration later subscribes to the same topic without touching the alarms. All alarms use `TreatMissingData: notBreaching` so an idle API does not alarm.

  | Alarm | Metric | Default threshold |
  | --- | --- | --- |
  | `ApiServerErrors` | `AWS/ApiGateway` `5xx`, dimensions `ApiId`, `Stage=$default`, Sum | at least 1 in a 5 minute period |
  | `LambdaThrottles` | `AWS/Lambda` `Throttles`, one metric per function, summed with metric math (`SUM(METRICS())`) | at least 1 in a 5 minute period |
  | `ApiLatencyP95` | `AWS/ApiGateway` `Latency`, p95 | above 1500 ms for 3 consecutive 5 minute periods |

  HTTP API publishes no throttle metric (throttled calls are 429 inside `4xx`), so "throttles" is the Lambda concurrency throttle. Route throttling is spec 0010. The throttles alarm lists the six functions explicitly (`!Ref <Name>LambdaFunction`); a new function must be added to it, which the checklist in README "Observability" states.
- **Tracing.** `provider.tracing.lambda: true` makes each function `Active`; the Powertools tracer adds the handler subsegment and, through `captureAWSv3Client`, one per DynamoDB call. API Gateway HTTP API does not take part in X-Ray (to be confirmed, see Risks), so a trace starts at Lambda. The tracer disables itself outside Lambda, so tests are unaffected.
- **Metrics.** EMF is printed to the log and parsed by CloudWatch: no `PutMetricData` permission and no extra latency. Only `ColdStart` is emitted now.

Alternatives rejected:

- **Hand-rolled JSON logger on `console`**: solves format only, and we would reimplement context injection, correlation and sampling. Powertools is the AWS-maintained answer for exactly this.
- **Only native metrics and `tracing.lambda` without the Powertools tracer/metrics packages**: smaller package, but no DynamoDB subsegments and no cold-start metric, which are the two things native data cannot show. Kept as the fallback if package size or cold start proves unacceptable (see Decisions).
- **OpenTelemetry / ADOT layer**: a heavier moving part and a Lambda layer to manage; the roadmap asks for AWS-native tooling.
- **Logging in use cases**: couples the application layer to a logger and duplicates the boundary's line.
- **A custom `errorBoundary` option to inject the logger**: the singleton module is simpler; tests spy on it. A second logger implementation does not exist (YAGNI).

Principles: SRP (one module owns Powertools configuration, one wrapper owns the per-request concerns, the boundary owns error logging), DIP kept (inward layers know nothing about logging), OCP (a new handler is one wrapper call), KISS and YAGNI (one metric, three alarms, no dashboards).

**Order and file layout.** This spec only adds to the provider block, the resources and `package.json`. It is written so it applies to `serverless.yml` as it is today and, if spec 0011 lands first, to the split files (alarms and topic in a new `resources/observability.yml`). See the order recommendation in Decisions.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none; no response changes |
| Client-visible behavior | none |
| Infrastructure | Lambda active tracing (adds X-Ray permissions to the role), log retention on all log groups (in place, no replacement), new environment variables, one SNS topic, one conditional subscription, three alarms, a `stages:` block. Log groups already exist: setting retention is an in-place update |
| Data model | none |
| Dependencies | three Powertools packages (and their transitive `aws-xray-sdk-core`, `@aws/lambda-invoke-store`); larger zip and a few milliseconds of cold start, to be measured |
| Documentation | README, `docs/ARCHITECTURE.md`, Spanish references, this spec |

## Acceptance criteria

- [ ] Every handler is wrapped with `withObservability`, outermost; `hello` included.
- [ ] No file under `src/application/` or `src/domain/` imports a Powertools package or a logger; only `src/infrastructure/observability.js` imports `@aws-lambda-powertools/*` (plus `dynamoClient.js` through that module).
- [ ] `console.error` no longer appears in `src/`.
- [ ] A test proves the correlation id: a wrapped handler called with `requestContext.requestId = "abc"` sees `logger.getCorrelationId() === "abc"`, and the id does not leak into the next invocation.
- [ ] Boundary tests prove an unknown error is logged once with the label and the error through the logger, and the response is still `500` with the fixed message; the known-error cases, status codes and bodies are unchanged. The assertion that changes (a spy on `logger.error` instead of `console.error`) is justified in its commit message.
- [ ] A test proves `ColdStart` is the only metric flushed on the first invocation and none on the second.
- [ ] All existing handler, use-case, repository and pagination tests pass with their assertions unchanged (any call-convention change they need, such as passing a Lambda context, is limited to the shared helper and is justified in its commit).
- [ ] Test output contains no Powertools JSON lines (log level and metrics are silenced in `vitest.config.js` through environment variables).
- [ ] `docs/openapi.yaml` is unchanged.
- [ ] `serverless print --stage dev` and `--stage staging` show `provider.tracing.lambda: true`, the Powertools environment variables and the per-stage retention and log level (dev 7 days and `DEBUG`, staging 90 days and `INFO`).
- [ ] `serverless package` for dev shows `RetentionInDays` on all six log groups, `TracingConfig.Mode: Active` on all six functions, `AlarmTopic`, the three alarms with their dimensions, and `AlarmEmailSubscription` only when `--param="alarmEmail=..."` is passed.
- [ ] README and ARCHITECTURE document the log fields, where to look, how to subscribe to alarms and the "new function" checklist, with matching structure in the Spanish files.
- [ ] After the maintainer deploys to `dev` (post-deploy, not blocking the merge of the code): a request produces one JSON log line per event with the same `correlation_id` as the API Gateway request id; a trace with a DynamoDB subsegment is visible; a `ColdStart` metric appears in the namespace; forcing a 500 or lowering a threshold moves an alarm to `ALARM` and the confirmed email receives it.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
grep -rn "console\.error" src                                    # prints nothing
grep -rln "aws-lambda-powertools" src                            # only src/infrastructure/observability.js
grep -rln "logger\|aws-lambda-powertools" src/application src/domain   # prints nothing
git diff <base> --stat -- docs/openapi.yaml                      # prints nothing
npm view @aws-lambda-powertools/logger version                   # still within ^2.35.0 at implementation time
npx serverless print --stage dev
npx serverless print --stage staging
npx serverless package --stage dev --package /tmp/pkg-dev --param="alarmEmail=ops@example.com"
# then inspect /tmp/pkg-dev/cloudformation-template-update-stack.json for the resources listed above
```

Post-deploy checks (maintainer): `aws logs tail /aws/lambda/aws-lambda-crud-nodejs-dev-getTasks --since 5m`, X-Ray console for the trace, `aws cloudwatch describe-alarms --alarm-name-prefix aws-lambda-crud-nodejs-dev`, `aws cloudwatch list-metrics --namespace <namespace>`.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the three Powertools dependencies and `src/infrastructure/observability.js`, with a test that the logger, metrics and tracer are configured from the environment. Silence Powertools in `vitest.config.js`. First thing proven here: a middy instance wraps another (spike inside the next commit's test).
3. Add `withObservability` with its tests (correlation id, no leak between invocations, `ColdStart` once).
4. Log unknown errors through the logger in `errorBoundary.js` and update its test spy.
5. Wrap the six handlers with `withObservability`.
6. Trace DynamoDB calls in `dynamoClient.js`.
7. Infrastructure: `stages:` params, active tracing, log retention, Powertools environment variables.
8. Infrastructure: alarm topic, conditional subscription and the three alarms.
9. Documentation and Spanish references, close this spec.

## Risks and rollback

- **Risk:** a middy instance may not compose as a handler of another middy instance, or the Powertools middleware may need a Lambda `context` that the handler tests do not pass. Mitigated by proving both in commits 2 and 3 before any handler changes; if composition fails, the wrapper becomes a single shared middy stack used by `withJsonBody` and a new `withHttp` for the plain handlers, and this spec is amended.
- **Risk:** cold start and zip size grow (X-Ray SDK and Powertools). Mitigated by measuring `Init Duration` before and after on dev; the fallback is `tracing.lambda` only plus the logger, dropping the tracer and metrics packages (amend the spec).
- **Risk:** Powertools mutates a shared logger across invocations. Mitigated by `resetKeys` in the middleware and the leak test.
- **Risk:** log level `DEBUG` in dev may log more than expected. The project never logs request bodies or tokens; the criteria and the Out of scope list pin that.
- **Risk:** alarm noise. `notBreaching` for missing data and the conservative thresholds keep an idle stage quiet; thresholds are tuned in a later change.
- **Unverified at spec time:** that API Gateway HTTP API cannot emit X-Ray segments; that it returns an `apigw-requestid` response header equal to `requestContext.requestId` (useful for support); the `Stage` dimension value `$default` on the `AWS/ApiGateway` metrics. Each is checked on the deployed dev stage; none changes the code.
- **Rollback:** revert the merge and redeploy. Retention and tracing revert in place; the topic, subscription and alarms are deleted by the stack update. Logs already written stay in CloudWatch.

## Decisions to confirm

1. **Implementation order of the runtime chain.** Recommended: spec 0011 (split config) first, then this spec, then 0010. It differs from the roadmap's number order (6, 9, 10), which needs a one-line amendment to spec 0000's suggested order.
2. **Include the Powertools tracer and metrics packages** (adds `aws-xray-sdk-core`, DynamoDB subsegments, `ColdStart`), versus Lambda active tracing and the logger only. Recommended: include, and fall back if cold start is hurt.
3. **Log retention**: dev 7 days, every other stage 90 days. Recommended as stated; the alternative is a flat 30.
4. **Alarm notification**: one SNS topic with an email subscription created only when `alarmEmail` is passed at deploy time, subscribed by the maintainer. Recommended; the address is never committed.
5. **Alarm thresholds**: 5xx at least 1 per 5 minutes, Lambda throttles at least 1 per 5 minutes, p95 latency above 1500 ms for 3 periods; business metrics deferred. Recommended as defaults, to be tuned on real traffic.
