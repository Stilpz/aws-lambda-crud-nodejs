# 0015: Add a Cognito app client for the SPA

- **Status:** Approved
- **Branch:** `add-spa-cognito-app-client` (started from `development`)
- **Roadmap step:** Frontend readiness track, item "Browser-safe sign-in" of [0000](0000-roadmap-to-layered-architecture.md)
- **Amendments:** 1 (see the end of this spec)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** depends on step 2 ([0003](0003-add-task-use-cases.md)), the CORS configuration of [0013](0013-add-explicit-cors-origins.md), the hardening of [0010](0010-harden-production-resources.md) and the configuration split of [0011](0011-split-serverless-config-files.md), all merged. It does not depend on the typed client of [0014](0014-generate-typed-api-client.md), so its branch is cut from `development` and the two pull requests merge independently. Opened for review against the deploy role template of the deploy pipeline spec (0008), which needs the new resource types (see Contract impact).

## Context

The only app client, `UserPoolClient` in `resources/auth.yml`, has no secret and no OAuth settings, takes its sign-in flows from the stage parameter `authFlows` (since spec 0010: `dev` allows `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` and `ALLOW_ADMIN_USER_PASSWORD_AUTH`; every other stage allows SRP, refresh and the admin flow only), and no user pool domain exists. The admin flow is what `scripts/smoke.sh` uses (it creates users with the AWS CLI, signs them in with `admin-initiate-auth`, then sends the **ID token**). That is right for scripts and wrong for a browser: a SPA would have to collect passwords itself and send them to the Cognito API, and a public client cannot keep a secret.

The browser-safe pattern is the OAuth 2.0 authorization code flow with PKCE against Cognito's hosted sign-in pages: the SPA redirects to Cognito, the user types the password on a Cognito page, Cognito redirects back with a one-time code, and the SPA exchanges the code (plus the PKCE verifier) for tokens at the token endpoint.

One fact makes this more than adding a client. The JWT authorizer is configured with a single audience, `!Ref UserPoolClient` (`serverless.yml`, `provider.httpApi.authorizers.cognitoAuthorizer.audience`). API Gateway validates `aud` or, only when `aud` is absent, `client_id` against the audience list (AWS documentation, "Control access to HTTP APIs with JWT authorizers"). A token issued to a second client has that client's id in `aud` (ID token) or `client_id` (access token), so **it would be answered with `401` unless the new client is added to the audience list**. Identity is unaffected: `ownerId` is the `sub` claim (`src/handlers/auth.js`), which is the same user id whichever client issued the token, so a user sees the same tasks from the CLI and from the SPA.

## Goal

Add a separate public app client for the SPA, with a user pool domain and the hosted sign-in using authorization code with PKCE, configured per stage, accepted by the API's authorizer, while the existing client and `scripts/smoke.sh` keep working unchanged.

## Scope

1. **User pool domain** (`AWS::Cognito::UserPoolDomain`) with a prefix domain, classic hosted UI (`ManagedLoginVersion: 1`), named per stage and unique per deployment (Design).
2. **SPA app client** (`AWS::Cognito::UserPoolClient`, new logical id `SpaUserPoolClient`) with:
   - `GenerateSecret: false`.
   - `AllowedOAuthFlowsUserPoolClient: true`, `AllowedOAuthFlows: [code]` (no `implicit`, no `client_credentials`).
   - `AllowedOAuthScopes: [openid, email]`.
   - `SupportedIdentityProviders: [COGNITO]`.
   - `CallbackURLs` and `LogoutURLs` from per-stage parameters.
   - `ExplicitAuthFlows: [ALLOW_REFRESH_TOKEN_AUTH]` only: no password flow of any kind.
   - Token lifetimes, explicit units, revocation and rotation (Design).
   - `PreventUserExistenceErrors: ENABLED`.
3. **Authorizer audience:** add `!Ref SpaUserPoolClient` next to `!Ref UserPoolClient`. Nothing else about the authorizer changes (issuer, identity source, routes).
4. **Per-stage configuration:** `spaCallbackUrls` and `spaLogoutUrls` lists in the one existing `stages:` block of `serverless.yml` (the profile that already holds `webOrigins` and the hardening parameters), with the local development URLs in `default` and `https` placeholders in `staging` and `prod`. No second `stages:` key.
5. **Stack outputs:** `SpaClientId`, `HostedUiBaseUrl` (the domain URL). Existing outputs `UserPoolId` and `UserPoolClientId` are unchanged.
6. **Tests and checks:** a configuration test over `serverless.yml`, additions to `scripts/smoke.sh`, and an optional dependency-free script `scripts/pkce-login.mjs` for an end-to-end check with a real browser sign-in (Design, "How it is tested").
7. **Documentation:** README (Authentication section: the two clients, which is for what, how to get a token through the hosted UI, token lifetimes), `docs/openapi.yaml` description and security scheme text, `docs/ARCHITECTURE.md` (decision and F10), Spanish references.

## Out of scope

- The React sign-in code, token storage and refresh logic in the browser: the frontend. This spec states the server-side facts it relies on (lifetimes, rotation, the token endpoint).
- **Changing the existing client.** Spec 0010 already limits `USER_PASSWORD_AUTH` to `dev` through the `authFlows` parameter; this spec leaves `UserPoolClient` and that parameter untouched, and the SPA client allows no password flow in any stage.
- Scopes on API routes, a Cognito resource server or custom scopes, and requiring access tokens only (Decision 3): a later hardening spec.
- Social or SAML identity providers, MFA, a custom domain, managed-login branding (`ManagedLoginVersion: 2`), a pre-token Lambda trigger.
- Sign-up, password reset UX beyond what the hosted UI provides, and email settings (the pool's own attributes are unchanged).
- CORS: spec 0013. Redirects are top-level navigations and are not subject to CORS; the token endpoint is covered under Design.
- Deploying. The maintainer deploys.

## Design

### Two clients, two purposes

| | Existing `UserPoolClient` | New `SpaUserPoolClient` |
| --- | --- | --- |
| Used by | `scripts/smoke.sh`, local tests with the AWS CLI | The React app |
| Sign-in | `USER_PASSWORD_AUTH` (password sent to the Cognito API), SRP | Hosted UI, authorization code + PKCE |
| Secret | none | none (a browser cannot keep one) |
| OAuth settings | none | code flow, scopes, callback and logout URLs |
| Changed by this spec | no | created |

A second client rather than reconfiguring the first: changing the existing client's OAuth settings risks the smoke test, and `GenerateSecret` is a replacement property, so any mistake would recreate the client and change its id. A separate client also means a SPA token and a script token can be told apart by `aud` or `client_id` later without further work.

### PKCE and what Cognito enforces

PKCE binds the code to the browser session that started the flow, so an intercepted code is useless. Cognito's authorize endpoint accepts `code_challenge` and `code_challenge_method` as **optional** parameters and supports only `S256` (AWS documentation, "The redirect and authorization endpoint"); the token endpoint requires `code_verifier` only if a challenge was sent. **Cognito therefore does not force a public client to use PKCE**: the guarantee is that the frontend always sends `S256`, which this spec makes a documented client rule and tests with `scripts/pkce-login.mjs`. The configuration removes the other risks: no implicit flow (tokens never appear in a URL fragment), no secret, and only registered redirect URIs.

The token endpoint answers with `Access-Control-Allow-Origin: *` and Cognito does not support custom CORS policies on it (AWS documentation, "The token issuer endpoint"), so the SPA can exchange the code from the browser without any change on our side.

### The user pool domain

`AWS::Cognito::UserPoolDomain` with `Domain: <prefix>`; the endpoints are `https://<prefix>.auth.us-west-2.amazoncognito.com/{oauth2/authorize,oauth2/token,logout,login}`. The prefix pattern is `^[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?$` (1 to 63 characters) and **changing it replaces the domain** (CloudFormation resource reference). A prefix domain is unique in its region across AWS accounts (the console asks for "an available domain prefix"), so a fixed name derived from the service and stage would make a fork's deploy fail when another account already took it, and an account id would put an account id in a public URL. The design derives the prefix from the stack's own GUID:

```yaml
Domain: !Join
  - "-"
  - - tasks
    - ${sls:stage}
    - !Select [0, !Split ["-", !Select [2, !Split ["/", !Ref "AWS::StackId"]]]]
```

(`AWS::StackId` is `arn:aws:cloudformation:<region>:<account>:stack/<name>/<guid>`; the first eight hex characters of the GUID are stable for the life of the stack, unique enough in practice, and do not reveal the account.) Whether a reserved word restriction exists for prefixes (I recall one for words such as `aws` and `cognito`) is **not verified here**; the prefix starts with `tasks-`, which avoids the usual ones, and the first deploy is the proof. A stage may override the whole prefix through a parameter if the derived one collides or the maintainer wants a readable name.

Classic hosted UI (`ManagedLoginVersion: 1`) is chosen explicitly because it needs no branding resources. The newer managed login (`2`) is a separate decision with its own branding resource and may depend on the pool's feature plan (not verified).

### Callback and logout URLs per stage

Exact URLs, registered per stage, from stage parameters (same mechanism as 0013's origin list; the verification of list parameters in `serverless print` is recorded there and applies here):

```yaml
stages:        # the existing block: these keys are added next to webOrigins in each profile
  default:
    params:
      spaCallbackUrls: [http://localhost:5173/auth/callback]
      spaLogoutUrls:   [http://localhost:5173/]
  staging:
    params:
      spaCallbackUrls: [https://staging.app.example.com/auth/callback]   # placeholder
      spaLogoutUrls:   [https://staging.app.example.com/]
  prod:
    params:
      spaCallbackUrls: [https://app.example.com/auth/callback]   # placeholder
      spaLogoutUrls:   [https://app.example.com/]
```

Cognito's rules (CloudFormation reference for `CallbackURLs`): absolute URI, registered exactly (authorization requests with an unlisted `redirect_uri` are refused), no fragment, HTTPS required except `http://localhost`, `http://127.0.0.1` and `http://[::1]`, which are for testing. `LogoutURLs` are the permitted `logout_uri` targets. The path `/auth/callback` and the port `5173` are assumptions about the future frontend (Decision 2); production URLs are placeholders the maintainer fills in. Localhost entries are in `default` only, so `prod` never allows an HTTP localhost callback unless a stage lists it (the configuration test enforces that for non-default stages).

### Scopes and tokens

- **Scopes `openid` and `email`.** `openid` is what makes Cognito return an ID token (authorize endpoint documentation); `email` adds the email to the ID token for display. `aws.cognito.signin.user.admin` is **not** granted: it lets an access token call Cognito's self-service API, which the SPA does not need.
- **ID token versus access token for the API.** The ID token has `aud` equal to the client id; the access token has `client_id` and no `aud` (Cognito), and the authorizer accepts either as long as the client is in the audience list. The existing contract text says the ID token works, and `smoke.sh` sends it. The SPA should send the **access token** to the API (it carries no email or profile data and is the token intended for resource calls). The API does not enforce that: with no route scopes configured there is no way to tell an access token from an ID token, which API Gateway's own documentation points out and answers with "require authorization scopes". Doing that needs a resource server and custom scope and would also break the smoke client; it is a later spec (Decision 3).
- **Lifetimes** (CloudFormation reference: `AccessTokenValidity` and `IdTokenValidity` 1 to 86400 seconds, `RefreshTokenValidity` 1 to 315360000 seconds, units set in `TokenValidityUnits`): access and ID tokens 60 minutes (the same one hour as today, so the documented "expire after one hour" stays true for both clients), refresh token 7 days (the default is 30; a browser-held token is a bigger target than a CLI one). Units are always written explicitly.
- **Refresh.** The SPA refreshes with `grant_type=refresh_token` at the token endpoint. The endpoint returns a new refresh token only when rotation is active, otherwise only ID and access tokens. `RefreshTokenRotation: { Feature: ENABLED, RetryGracePeriodSeconds: 10 }` (properties from the CloudFormation reference; grace period 0 to 60 seconds) makes every refresh issue a new refresh token and retire the old one after a short window that allows a retried request. `EnableTokenRevocation: true` is written explicitly (it is the default when omitted) so sign-out can revoke the refresh token. Whether rotation is available on this pool's feature plan is **not verified**; if the first deploy rejects it, rotation is dropped (Decision 4) and the shorter refresh lifetime remains the mitigation.
- A `401` from the API means the access token expired: the SPA refreshes once and retries once, as the README already says for clients (a single retry after refreshing a `401`).

### Authorizer audience

```yaml
audience:
  - !Ref UserPoolClient
  - !Ref SpaUserPoolClient
```

Widening an audience list is the smallest change that accepts the new client; the issuer is the same pool, so a token from another stage's pool is still rejected (the pool is per stage). No change to routes or handlers: `getOwnerId` reads `sub`.

### How it is tested

Verification is layered because a hosted-UI login needs a browser:

1. **Configuration test (`tests/cognitoClients.test.js`, Vitest)** reads `serverless.yml` with the YAML parser that 0013 adds as a dev dependency (if 0013 is not merged first, this spec adds it; the version is whatever `npm view yaml version` returns, 2.9.1 at the time of writing). It asserts: the existing client is unchanged (same flows, no secret, no OAuth block); the SPA client has `GenerateSecret: false`, `AllowedOAuthFlows` exactly `[code]`, `ExplicitAuthFlows` containing no `USER_PASSWORD`, `ADMIN_USER_PASSWORD` or `USER_SRP` flow, scopes exactly `[openid, email]`, only `COGNITO` as provider; both clients are in the authorizer audience; callback and logout URLs in non-default stages are `https` and contain no `localhost`.
2. **Read-only post-deploy checks in `scripts/smoke.sh`** (AWS CLI is already required there): `describe-user-pool-client` for the SPA client confirms no secret, code flow only and no password flow; `describe-user-pool-client` for the existing client still lists `ALLOW_USER_PASSWORD_AUTH`; `curl` to `<HostedUiBaseUrl>/oauth2/authorize` with the SPA client id, a registered `redirect_uri`, `response_type=code`, `scope=openid+email`, `code_challenge_method=S256` and a dummy `code_challenge` answers a redirect to the hosted `/login` page; the same request with an unregistered `redirect_uri` does not redirect to `/login`. The existing smoke checks run unchanged and must still pass (proof that the old client and the authorizer still work).
3. **End-to-end with a real sign-in, `scripts/pkce-login.mjs`** (Node standard library only: `crypto`, `http`, `fetch`): generates the verifier and the S256 challenge and a `state`, prints the authorize URL, listens on the registered localhost callback, exchanges the code at `/oauth2/token`, then calls `GET /tasks` with the **access token** (expects `200`) and with the ID token (expects `200`), and refreshes once. The maintainer types the password in the browser. It is a manual tool, not part of CI; it proves the audience change, PKCE and the refresh path against a real stage. It is optional (Decision 5).
4. Contract-level: a token from the SPA client for user A and a token from the existing client for the same user list the same tasks (same `sub`); recorded in the pull request.

### Alternatives rejected

- *Reconfigure the existing client for OAuth:* risks `smoke.sh` and, through `GenerateSecret`, a replacement of the client.
- *Let the SPA use `USER_PASSWORD_AUTH` or SRP directly (Amplify-style, no hosted UI):* the SPA would handle credentials itself and the roadmap explicitly asks for authorization code with PKCE. SRP keeps the password off the wire but still needs a custom login UI to build and secure.
- *Implicit flow:* tokens in a URL fragment, no refresh token; Cognito's own documentation calls it less secure.
- *A client secret in the SPA:* anything shipped to a browser is public.
- *A custom domain now:* needs a domain, a certificate in `us-east-1` and DNS; a prefix domain costs nothing and can be replaced by a custom domain later (the client and URLs stay).
- *A fixed domain prefix:* collides across accounts in a region.
- *Per-route scopes now:* useful hardening, but it needs a resource server and breaks the existing client; a separate spec.

### Principles applied

- **Least privilege:** one flow, two scopes, no password flow, no `signin.user.admin`.
- **OCP:** a new client and an audience entry; the existing client, routes and handlers are untouched.
- **KISS and YAGNI:** prefix domain, classic hosted UI, no branding, no custom scopes, no social providers.
- **Verifiability:** every security-relevant property is asserted by a test over the configuration or by a read-only check on the deployed stage, and the facts that were not verified are named with the step that verifies them.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | No path, schema or status change; **not breaking**. The `bearerAuth` description and the `info.description` now say that tokens from either app client are accepted and that the SPA uses the access token. `info.version` follows the maintainer's release practice. |
| Client-visible behavior | New sign-in route for browsers. Tokens from the existing client are accepted exactly as before. |
| Infrastructure (`resources/auth.yml`, `serverless.yml`) | New `UserPoolDomain` and `SpaUserPoolClient` in `resources/auth.yml` with two outputs, two parameters per profile in the `stages:` block and a second entry in the authorizer `audience` of `serverless.yml`. Additive: the existing client, pool, table and functions are not replaced. The authorizer is updated in place. New CloudFormation resource type for the deploy role: `AWS::Cognito::UserPoolDomain` (`AWS::Cognito::UserPoolClient` is already used). No function is added, so the observability, per-function role and throttle alarm rules are not touched. |
| Compatibility (policy 0017) | **Non-breaking, minor:** the authorizer accepts tokens it rejected before (a new client), which is the policy's "loosening" and nothing a client written to the previous contract can trip on. Recorded under `Added` in the changelog. |
| Data model | none |
| Dependencies | `yaml` as a dev dependency (shared with 0013), if not already added |
| Cost | none expected beyond the user pool's existing pricing (a prefix domain has no extra charge; not verified for every pricing plan) |
| Documentation | README, `docs/openapi.yaml` text, `docs/ARCHITECTURE.md`, Spanish references, specs index |

## Acceptance criteria

- [ ] After deploy, `aws cognito-idp describe-user-pool-client` for the SPA client shows no `ClientSecret`, `AllowedOAuthFlows` exactly `["code"]`, `AllowedOAuthScopes` exactly `["openid","email"]`, `SupportedIdentityProviders` `["COGNITO"]`, and no `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_ADMIN_USER_PASSWORD_AUTH` or `ALLOW_USER_SRP_AUTH` in `ExplicitAuthFlows`.
- [ ] The existing client definition is unchanged (`git diff development -- resources/auth.yml` removes no line, and `tests/cognitoClients.test.js` pins its flows to the `authFlows` parameter).
- [ ] After deploy, the existing client has the same id as before and the complete existing `scripts/smoke.sh` checks still pass.
- [ ] The authorizer audience contains both client ids (`aws apigatewayv2 get-authorizers` read-only), and an ID token and an access token obtained through the SPA client both get `200` on `GET /tasks`.
- [ ] A token of user A from the SPA client and one from the existing client list the same tasks.
- [ ] Callback and logout URLs differ per stage; non-default stages contain no `http://localhost` entry and only `https` URLs (configuration test).
- [ ] The authorize request with an unregistered `redirect_uri` does not redirect to the sign-in page.
- [ ] Token lifetimes: access and ID tokens 60 minutes, refresh 7 days, units explicit; `exp - iat` of a real access token is 3600 seconds.
- [ ] A refresh through `grant_type=refresh_token` returns new ID and access tokens (and a new refresh token if rotation is on), shown with `scripts/pkce-login.mjs` or recorded in the pull request.
- [ ] The two outputs `SpaClientId` and `HostedUiBaseUrl` exist, and the existing outputs are unchanged.
- [ ] The README documents both clients and the hosted UI token flow without printing a real token or id.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
bash -n scripts/smoke.sh && node --check scripts/pkce-login.mjs
serverless print --stage dev | grep -B1 -A4 "audience"
# after the maintainer deploys to dev:
STAGE=dev ./scripts/smoke.sh                      # old checks + new read-only client checks
aws cognito-idp describe-user-pool-client --region us-west-2 \
  --user-pool-id "$USER_POOL_ID" --client-id "$SPA_CLIENT_ID" \
  --query "UserPoolClient.{secret:ClientSecret,flows:AllowedOAuthFlows,scopes:AllowedOAuthScopes,auth:ExplicitAuthFlows,idp:SupportedIdentityProviders,cb:CallbackURLs,out:LogoutURLs}"
aws apigatewayv2 get-authorizers --region us-west-2 --api-id "$API_ID" \
  --query "Items[].JwtConfiguration.Audience"
curl -si "$HOSTED_UI/oauth2/authorize?response_type=code&client_id=$SPA_CLIENT_ID&redirect_uri=http://localhost:5173/auth/callback&scope=openid+email&code_challenge_method=S256&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" | head -n 5
node scripts/pkce-login.mjs                       # manual: sign in once in the browser
```

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer), and amend it to the merged state of `development` (this amendment).
2. Add the per-stage callback and logout URL parameters to the existing `stages:` block, and the user pool domain, the SPA app client and the two outputs to `resources/auth.yml`.
3. Add the SPA client to the authorizer audience (its own commit, so it can be reverted independently).
4. Add the `yaml` dev dependency (if not already present) and `tests/cognitoClients.test.js`.
5. Add the read-only client and hosted-UI checks to `scripts/smoke.sh`.
6. Add `scripts/pkce-login.mjs`.
7. Update README, `docs/openapi.yaml` text, `docs/ARCHITECTURE.md` and the Spanish references; close this spec.

## Risks and rollback

- **Risk:** the audience change is forgotten or reverted, and every SPA token gets `401`. Mitigated by the configuration test and the acceptance check with real tokens.
- **Risk:** a stack with an existing `UserPoolClient` is touched. Mitigated by leaving it alone, the unchanged-client test and the same-id acceptance check.
- **Risk:** the derived domain prefix collides or violates a naming rule. Mitigated by the parameter override and the explicit statement that the first deploy proves it; the prefix cannot be changed later without replacing the domain.
- **Risk:** `RefreshTokenRotation` or the minimal `ExplicitAuthFlows` is not accepted or breaks refresh (flag `ALLOW_REFRESH_TOKEN_AUTH` is assumed to govern refresh at the token endpoint, **not verified**). Mitigated by `scripts/pkce-login.mjs` refreshing once; the fallback is to drop rotation, or to add `ALLOW_USER_SRP_AUTH` back, each a one-line change.
- **Risk:** PKCE is not enforced by Cognito for a public client. Mitigated by the documented client rule and the test script; the residual risk is accepted and recorded.
- **Risk:** a wrong production callback URL locks users out of sign-in. Mitigated by listing both URLs per stage in one place and the smoke check using the stage's registered callback.
- **Risk:** ID tokens remain accepted by the API, so a leaked ID token is as good as an access token. Accepted today (same as before this spec); tightening is a later spec.
- **Rollback:** revert the merge and redeploy. CloudFormation removes the SPA client and the domain and restores the single-entry audience; the existing client, users and tasks are not touched. Users signed in through the SPA lose their sessions.

## Decisions to confirm

1. **Domain prefix (recommended: `tasks-<stage>-<8 hex of the stack GUID>`)**, overridable per stage. Alternative: a fixed readable prefix chosen by the maintainer, with the risk of collisions across accounts.
2. **SPA callback and logout URLs (recommended defaults: `http://localhost:5173/auth/callback` and `http://localhost:5173/`)** for local development, with production URLs set when the frontend domain exists. Change them if the frontend uses another port or path.
3. **Token the SPA sends to the API (recommended: the access token)**, with the authorizer still accepting both for now. Enforcing access tokens through a resource server and route scopes is a separate hardening spec.
4. **Refresh policy (recommended: access and ID tokens 60 minutes, refresh token 7 days, rotation enabled with a 10 second grace period)**; drop rotation if the pool's plan does not support it.
5. **`scripts/pkce-login.mjs` (recommended: include it)** as a dependency-free manual check. Alternative: verify by hand in the browser once the frontend exists (less code, but nothing proves PKCE and refresh before then).

## Amendment 1

Written when implementation started, after the merge of development (CORS, PATCH, observability, hardening, the quality gates and the decision records). Reality differed from the draft in these points:

- **One `stages:` block, resources in `resources/auth.yml`.** Spec 0010 made `serverless.yml` a single profile block (`default`, `dev`, `staging`, `prod`) and spec 0011 moved the Cognito resources to `resources/auth.yml`. The new URL parameters go into that block, and the domain, the client and the outputs into that file. The draft's snippet with only `default` and `prod` gains a `staging` entry.
- **The existing client's flows come from `authFlows`** (spec 0010), so "the existing client" is no longer one fixed set of flows; the spec leaves it and the parameter untouched. The draft's out-of-scope paragraph about restricting `USER_PASSWORD_AUTH` is replaced: hardening did it for non-dev stages, and `scripts/smoke.sh` now signs in with the admin flow.
- **Token facts verified** (Cognito documentation, "Understanding the identity (ID) token" and "Understanding the access token"): the ID token `aud` is the app client id; the access token carries the same value in `client_id` and has an `aud` only when a resource binding was requested, which this design never does. The authorizer therefore accepts both tokens of the SPA client once its id is in the audience. Decision record 0002 (`docs/decisions/0002-frontend-repository-layout.md`) says the frontend sends the ID token, "to be verified in 0015": it is verified that both work, and the recommendation of Decision 3 stays the access token. The record's sentence is a statement to revisit, and is reported to the maintainer, not edited here.
- **Cognito documentation notes** that access and ID token lifetimes can be 5 minutes to 1 day and that managed login sets browser cookies valid for one hour regardless of shorter token lifetimes; the chosen 60 minutes matches that cookie.
- **No function is added**, so the three rules of spec 0009 and 0010 (observability wrapper, own IAM role, throttle alarm entry) do not apply.
- **The smoke test needs one more permission in the account that runs it:** the new read-only checks call `describe-user-pool-client` (`cognito-idp:DescribeUserPoolClient`). The deploy pipeline role (spec 0008, not merged) and its template are out of scope here; the permissions are listed in the pull request description for the maintainer.
- **`CHANGELOG.md`** gets an `Added` entry with its class, as spec 0017 asks.
- **Acceptance criterion about the existing client reworded.** The draft said it "still lists `ALLOW_USER_PASSWORD_AUTH`"; since spec 0010 only `dev` does, and the other stages offer SRP, refresh and the admin flow. The criterion is split into what a diff and the configuration test prove and what the deployed smoke test proves.
