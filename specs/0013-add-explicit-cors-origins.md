# 0013: Add explicit CORS origins

- **Status:** Approved
- **Branch:** `add-explicit-cors-origins` (started from `development`)
- **Roadmap step:** Frontend readiness track, item "CORS with explicit origins" of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** depends on step 2 ([0003](0003-add-task-use-cases.md), merged). Related to 0010 (hardening; the roadmap lists "explicit CORS origins" under step 9 as well, see Decision 5), 0011 (config split: the per-stage origins file lives with the split configuration if it lands first), 0012 (`PATCH` and the `Deprecation`/`Sunset` headers) and 0015 (the SPA origin is also the Cognito callback origin).

## Context

`serverless.yml` has no `httpApi.cors`, so API Gateway sends no CORS headers and answers no preflight. A browser on another origin (the React app, in development on `http://localhost:<port>` and later on its own domain) cannot call the API: every request that carries `Authorization` or `Content-Type: application/json` is preceded by an `OPTIONS` preflight, and without CORS configuration the browser blocks the call before it is sent. The README lists this as a known limitation ("No CORS configuration") and finding F10 in `docs/ARCHITECTURE.md` leaves it open.

How API Gateway HTTP API behaves (AWS documentation, "Configure CORS for HTTP APIs"):

- When CORS is configured on the API, API Gateway answers preflight `OPTIONS` requests itself, **even if no `OPTIONS` route exists**, and adds the configured headers to the responses of real requests.
- It **ignores** CORS headers returned by the Lambda integration. The configuration is the only source, so the handlers must not set CORS headers (and none do today).
- CORS headers are returned only for requests that carry an `Origin` header; a preflight needs `Origin` and `Access-Control-Request-Method`.
- The `$default`-route-plus-authorizer caveat in the same page (an `OPTIONS /{proxy+}` route is needed to allow unauthenticated preflights) does not apply: this API has no `$default` route and the JWT authorizer is attached per route (`serverless.yml`), so the automatic preflight response never meets an authorizer.

Serverless Framework v4 maps `provider.httpApi.cors` to the API's CORS configuration. Its documented properties are `allowedOrigins`, `allowedHeaders`, `allowedMethods`, `allowCredentials`, `exposedResponseHeaders` and `maxAge`; `cors: true` applies defaults with `Access-Control-Allow-Origin: *`, which this spec rejects.

## Goal

Configure CORS on the HTTP API with an explicit list of allowed origins per stage, only the headers and methods the API uses, no wildcard origin and no credentials, so a browser app on an approved origin can call every route.

## Scope

1. **`serverless.yml`:** `provider.httpApi.cors` with:
   - `allowedOrigins` taken from per-stage configuration (see Design), never `*`.
   - `allowedHeaders`: `Authorization`, `Content-Type`.
   - `allowedMethods`: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
   - `exposedResponseHeaders`: `Deprecation`, `Sunset` (so a browser client can read the deprecation signals of spec 0012).
   - `allowCredentials`: omitted (false). Authentication is a bearer token in a header, not a cookie.
   - `maxAge`: one fixed value in seconds (Decision 3).
2. **Per-stage origins** defined outside the CORS block, one list per stage, with a safe default for any unlisted stage (local-development origins only).
3. **Tests:**
   - A Vitest configuration test that reads `serverless.yml` and asserts the invariants (no `*`, no `allowCredentials: true` together with a wildcard, `Authorization` and `Content-Type` allowed, every method used by a function event is allowed, every configured origin is `https://` or an `http://localhost` origin).
   - Post-deploy checks in `scripts/smoke.sh` against the real stage (preflight and actual request, allowed and disallowed origin).
4. **Documentation:** README (CORS section replacing the known limitation, how to add an origin, how to test with curl), `docs/ARCHITECTURE.md` (F10 partly closed, decision note), the Spanish references.

## Out of scope

- Setting CORS headers in the Lambda handlers or adding `@middy/http-cors`: API Gateway ignores them once CORS is configured, so they would be dead code.
- Hosting the frontend, choosing its domains or CloudFront/S3 (roadmap item `decide-frontend-repository-layout`). This spec only needs the list of origins; production origins are filled in by the maintainer when they exist.
- Cognito callback and logout URLs: spec 0015 (they reuse the same per-stage origin list, but are a different resource with different rules).
- Route throttling, WAF and the other hardening items of step 9.
- A `$default` route or any `OPTIONS` route: not needed (see Context).
- Allowing credentials or cookies.

## Design

### Where the origins live

The origins differ per stage and must not be hard-coded in the CORS block. Serverless Framework v4 resolves stage-specific parameters, with precedence CLI `--param`, then `stages.<stage>.params`, then `stages.default.params`, referenced as `${param:name}` (Serverless "Parameters" guide):

```yaml
stages:
  default:
    params:
      webOrigins:
        - http://localhost:5173
  prod:
    params:
      webOrigins:
        - https://app.example.com   # placeholder; the maintainer sets the real domain

provider:
  httpApi:
    cors:
      allowedOrigins: ${param:webOrigins}
```

`http://localhost:5173` is the Vite development server default and is an assumption about the future frontend tooling (Decision 1). The `default` entry makes every personal stage (a fork deploying `--stage alice`) work for local development and nothing else; `staging` and `prod` list their real origins. Because the origins are not secrets and the repository has no account ids in them, they are committed (no `.env`).

The Serverless guide only shows string values for parameters. Whether a YAML list resolves correctly through `${param:...}` into `allowedOrigins` is **not verified by this spec**. The first implementation commit proves it with `serverless print --stage <stage>` (output must show a list). If it does not resolve, the fallback is a plain file per stage (`config/cors-origins.<stage>.yml`, loaded with `${file(...)}`), which also fits the config split of spec 0011. The tests and acceptance criteria are written against the resolved result, so either mechanism passes them.

### Header, method and age choices

- **Headers.** `Authorization` is not a CORS-safelisted header and `application/json` is not a safelisted `Content-Type`, so both force a preflight and both must be allowed. Nothing else is sent by the contract (`docs/openapi.yaml`). A header the client does not send needs no entry (least privilege, KISS); a future one is a spec amendment.
- **Methods.** `PUT`, `PATCH` and `DELETE` are never CORS-safelisted, so they always preflight. `PATCH` is listed now even though the route arrives with spec 0012, so the two specs can merge in either order. A method without a route is answered by API Gateway as a missing route, not as a success, so listing it is harmless.
- **Exposed headers.** A browser hides every non-safelisted response header from scripts unless listed. `Deprecation` and `Sunset` are the headers 0012 adds; without this, a frontend cannot see that it uses a deprecated route.
- **Max age.** The browser caches the preflight result for this many seconds. Browsers cap the value (Chromium at 2 hours, Firefox at 24 hours, from memory, not verified here), so a value above 7200 gains nothing. See Decision 3.
- **Credentials.** `allowCredentials` stays off. The CORS specification forbids `Access-Control-Allow-Origin: *` together with credentials, and this design never uses a wildcard in the first place, so the invalid combination cannot be produced; a configuration test pins that.

### Preflight and the JWT authorizer

The JWT authorizer is attached to the individual routes, and the preflight is answered by API Gateway before routing to a function, so it needs no token (a browser never sends `Authorization` on a preflight). Real requests keep going through the authorizer unchanged. Whether API Gateway adds the CORS headers also to a `401` produced by the authorizer is **not verified here**: the smoke test records it, and the README documents the observed behavior (a missing `Access-Control-Allow-Origin` on a `401` makes the browser report a CORS error instead of a `401`, which a frontend must handle by treating an opaque network failure on an authenticated call as "session may have expired").

### How it is tested

1. **Configuration test (`tests/cors.test.js`)** reads the resolved CORS block from `serverless.yml` with a YAML parser and asserts the invariants listed in Scope. It runs in CI with the rest of the suite, needs no AWS and catches a wildcard or a missing header on the pull request. It needs a YAML parser, which is not in `package-lock.json` today: `yaml` (version 2.9.1 at the time of writing, from `npm view yaml version`) added as a dev dependency (Decision 4).
2. **Behavior check in `scripts/smoke.sh`**, against the deployed stage, with `curl`:
   - Preflight from an allowed origin: `OPTIONS /tasks` with `Origin`, `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization,content-type` answers `2xx` with `Access-Control-Allow-Origin` equal to that exact origin (never `*`) and the allowed headers and methods.
   - Preflight from a disallowed origin: no `Access-Control-Allow-Origin` header.
   - Real request with an allowed `Origin`: the response carries `Access-Control-Allow-Origin` equal to it.
   - The check reads the stage's allowed origin from the stack or from a `CORS_ORIGIN` variable, so it does not hard-code one.
3. Manual in a browser once the frontend exists; out of scope here.

### Alternatives rejected

- *`cors: true`:* the framework default is `Access-Control-Allow-Origin: *` with a broad header list. Wildcards are what this item exists to remove.
- *Per-function `cors` blocks:* the origin policy is a property of the API, not of a route; one block avoids six copies that drift.
- *`@middy/http-cors` in the handlers:* API Gateway discards integration CORS headers once API-level CORS is configured, and the authorizer's `401` never reaches a handler. It would also duplicate the policy in code.
- *Reflecting the request `Origin` in a handler:* turns "allowed list" into "allow everyone".
- *Allowing `https://*`:* the API Gateway documentation permits that pattern; it allows any HTTPS site.

### Principles applied

- **KISS and YAGNI:** one block, only the headers the contract uses, no handler code.
- **Least privilege:** explicit origins, headers and methods; no credentials.
- **Single source of truth:** origins in one per-stage list that spec 0015 reuses.
- **Verification over assumption:** the tests assert the resolved configuration and the deployed behavior, and the two unverified facts above are checked by named commands.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none to paths or schemas. The API now answers preflight; the CORS behavior is described in the `info.description`. The `Deprecation` and `Sunset` header components belong to spec 0012. Not breaking. |
| Client-visible behavior | Browsers on an allowed origin can call the API. Other origins are unchanged (still blocked). Non-browser clients are unaffected. |
| Infrastructure (`serverless.yml`) | `provider.httpApi.cors` and the per-stage origin parameters. Update of the HTTP API's CORS configuration: no replacement and no interruption (CloudFormation reports the CORS properties as updatable without interruption). |
| Data model | none |
| Dependencies | `yaml` as a dev dependency for the configuration test, if Decision 4 is confirmed |
| Documentation | README, `docs/ARCHITECTURE.md`, Spanish references, specs index |

## Acceptance criteria

- [ ] `serverless print --stage dev` shows `allowedOrigins` as a list taken from the per-stage configuration, and `--stage prod` shows a different list.
- [ ] No resolved configuration contains `*` in `allowedOrigins`, `allowedHeaders` or `allowedMethods`, and `allowCredentials` is not `true`.
- [ ] `Authorization` and `Content-Type` are allowed, every HTTP method of a function event in `serverless.yml` is allowed, and `Deprecation` and `Sunset` are exposed.
- [ ] `tests/cors.test.js` asserts the points above and fails when a wildcard or a missing header is introduced (shown by temporarily editing `serverless.yml` locally).
- [ ] After a deploy to `dev`: a preflight from the dev origin answers `2xx` with `Access-Control-Allow-Origin` equal to that origin, and from `https://evil.example` returns no `Access-Control-Allow-Origin`.
- [ ] A real `GET /tasks` with the dev origin and a valid token returns `Access-Control-Allow-Origin` equal to the origin.
- [ ] The behavior of a `401` with an `Origin` header is recorded in the README as observed.
- [ ] `scripts/smoke.sh` passes `bash -n` and includes the CORS checks.
- [ ] No handler sets a CORS header (`grep` below prints nothing).
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
serverless print --stage dev  | grep -A4 allowedOrigins
serverless print --stage prod | grep -A4 allowedOrigins
grep -rniE "access-control" src                       # prints nothing
bash -n scripts/smoke.sh
# after the maintainer deploys to dev (API_URL and ORIGIN set):
curl -si -X OPTIONS "$API_URL/tasks" -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" | grep -i "^access-control"
curl -si -X OPTIONS "$API_URL/tasks" -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" | grep -ci "access-control-allow-origin"   # 0
curl -si "$API_URL/tasks" -H "Origin: $ORIGIN" -H "Authorization: Bearer $TOKEN" | grep -i "^access-control-allow-origin"
curl -si "$API_URL/tasks" -H "Origin: $ORIGIN" | head -n 12   # records the 401 behavior
```

`serverless print` needs the Serverless Framework login the maintainer already uses to deploy; it makes no AWS call that changes anything.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the per-stage origin parameters and the CORS block to `serverless.yml`.
3. Add `yaml` as a dev dependency and `tests/cors.test.js`.
4. Add the CORS checks to `scripts/smoke.sh`.
5. Update README, `docs/ARCHITECTURE.md` and the Spanish references; record the observed `401` behavior after the first deploy; close this spec.

## Risks and rollback

- **Risk:** the `${param:...}` list does not resolve. Mitigated by the `serverless print` check in the first implementation commit and the file-based fallback.
- **Risk:** a production origin typo silently blocks the real frontend. Mitigated by the smoke test using the stage's configured origin and the configuration test's origin format rules.
- **Risk:** the `401` without CORS headers confuses frontend developers. Mitigated by documenting it.
- **Risk:** the CORS limit on `maxAge` makes a changed policy linger in browsers. Mitigated by a modest value (Decision 3).
- **Rollback:** revert the merge and redeploy; the CORS configuration is removed and cross-origin browser calls are blocked again. No data or resource is replaced.

## Decisions to confirm

1. **Development origin (recommended: `http://localhost:5173`)** as the `default` list, matching the Vite dev server. Change it if the frontend uses another tool or port.
2. **Parameter mechanism (recommended: `stages.<stage>.params` lists)** with `${file(...)}` per stage as the fallback if lists do not resolve.
3. **`maxAge` (recommended: `3600`)**, one value for all stages: long enough to avoid a preflight per call, short enough that a policy change takes effect within an hour.
4. **`yaml` dev dependency (recommended: add it)** for the configuration test. Alternative: no unit test and rely on the smoke check only (zero dependencies, but a wildcard would only be caught after a deploy).
5. **Relation to step 9 (recommended: this spec owns CORS)** and the roadmap row of step 9 loses "explicit CORS origins" when this spec closes.
