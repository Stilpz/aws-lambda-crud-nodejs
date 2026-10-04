# API versioning and deprecation policy

This policy says what a client of the Tasks API can rely on, what counts as a breaking change, how changes are announced and removed, and how the version numbers relate. It is governed by [spec 0017](../specs/0017-define-api-versioning-policy.md). The contract itself is [`openapi.yaml`](openapi.yaml), the single source of truth; the history of changes is [`CHANGELOG.md`](../CHANGELOG.md).

## 1. Compatibility promise

Within one major version, a client written against `openapi.yaml` can rely on:

- The set of routes, methods and operation ids; the request and response schemas, field names, types and required fields; the status codes of each operation.
- The error body: `{ "message": string }` for every error, plus `errors: string[]` on `400` validation failures.
- Each task is addressed by `id`, a UUID. It is opaque: do not parse it.
- `GET /tasks` returns the caller's tasks oldest first, `limit` from 1 to 100 (default 50), and `nextToken` is `null` when there are no more pages. A page can be empty while a token is still returned.
- Ownership: another user's task is a `404`, identical to a missing one.
- A task is readable and listed immediately after it is created or updated (consistent reads).

A client must **not** assume:

- That a `nextToken` survives a deployment. Tokens are opaque and valid only for the user they were issued to. A `400` for a stored token means "start the listing again", and a client treats it that way.
- That ids are version 4, version 7, sortable by value, or unique across users. The listing order is the contract, not the id order.
- That responses carry no fields it does not know. Clients ignore unknown fields.
- That no other status code will appear. A client handles any `4xx` and `5xx` generically through `message` (for example `429` from throttling, or a platform `5xx`).
- That the order of tasks created by one user within the same millisecond is defined.
- The wording of `message`. It is for people, not for branching on.

## 2. Breaking, non-breaking and operational changes

| Class | Rule | Version bump | Examples |
| --- | --- | --- | --- |
| **Breaking** | A client written to the previous contract can fail or misbehave | major | Removing or renaming a route, field or operation id; making an optional request field required; tightening validation (a stricter pattern, a lower `limit` maximum); changing a status code or the shape of the error body (for example moving to RFC 9457 problem details, deferred by [spec 0004](../specs/0004-standardize-error-responses.md)); changing the type or meaning of a field; changing the authentication scheme or the token the API accepts; returning a different set of items for the same call |
| **Non-breaking** | Old clients keep working unchanged | minor | A new route (such as `PATCH /tasks/{id}`); a new optional request field; a new response field; a new status code that clients handle generically; loosening validation; a new optional query parameter |
| **Fix or clarification** | Behavior was wrong against the documented contract, or the text was | patch | The consistent read of `GET /tasks/{id}` (finding F8); correcting a description or an example |
| **Operational** | The contract is unchanged, but a deployed stage or state a client stored is affected | minor, with a mandatory **Upgrade notes** entry | The table key change of [spec 0006](../specs/0006-redesign-task-table-keys.md) |

How this repository's own changes are classified:

- **The error shape.** `{ message }` with `errors` on validation failures is part of the contract. Keeping it was the decision of spec 0004. Replacing it is **breaking** and needs a major version, or a `/v2` path for the affected routes (section 3), and its own spec.
- **The table key change (spec 0006).** **Operational.** Routes, schemas and status codes did not change, and "tokens are opaque and not valid across deployments" is part of the promise, so a `nextToken` issued before the deploy answering `400` is allowed. The table was replaced and its data deleted, which is why this class demands an announcement and a stated recovery path. If a change instead removed data or behavior a client can legitimately depend on, it would be breaking.
- **UUID version 7 ids.** **Non-breaking.** The contract says `format: uuid` and treats ids as opaque; a version 7 UUID is a valid UUID. Clients must not rely on the version or on id ordering (section 1).

A spec that touches the contract adds a **Compatibility** row to its Contract impact table naming one of these classes. A reviewer compares the class with the diff of `openapi.yaml`.

## 3. Versioning scheme

- **No version in the URL.** Routes stay as they are (`/tasks`, `/tasks/{id}`).
  - A `/v1` prefix buys nothing while one version exists, costs a gateway route per function (`serverless.yml` declares one `httpApi` event per Lambda), changes every documented URL and client call, and invites a second copy of every handler. The right to break is created by this policy, not by a prefix.
  - Header or media-type versioning (`Accept: application/vnd...`, `API-Version`) is hard to try with `curl` or an address bar, and a custom request header makes a cross-origin browser call non-simple, adding a CORS preflight and an allowed-header entry on every request.
- **The contract version is `info.version`** in `openapi.yaml`, semantic versioning: major for breaking changes, minor for non-breaking and operational ones, patch for fixes.
- **Additive first.** The default way to change anything is to add the new thing, deprecate the old one and remove it after the notice period. `PATCH /tasks/{id}` next to `PUT /tasks/{id}` is the model.
- **A `/v2` prefix** is used only when a breaking change cannot be made additively. It applies to the affected routes only, the old routes follow the deprecation process, and the decision needs its own spec.

## 4. Deprecation and removal

1. **Announce.** Add a `Deprecated` entry under `Unreleased` in the changelog; mark the operation or field `deprecated: true` in `openapi.yaml` with a description naming the replacement and the removal date; mention it in the README.
2. **Signal at runtime.** While an operation is deprecated, every response from it carries:
   - `Deprecation: @<unix seconds>` ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745), a structured-field date),
   - `Sunset: <HTTP-date>` ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594), never earlier than the deprecation date),
   - `Link: <url of the migration notes>; rel="deprecation"`.

   The headers are documented in the OpenAPI responses of that operation. A browser client can read them only if the CORS configuration lists them as exposed response headers; that setting belongs to the CORS work (`add-explicit-cors-origins`) and is a requirement of this policy.
3. **Notice period.** At least 90 days between the release that deprecates and the `Sunset` date, and never less than one minor release. Removal ships in a major version, or earlier only if the notice has elapsed and the changelog says so.
4. **Remove.** Delete the route and its function; afterwards the gateway answers `404`. Record it under `Removed` in the changelog. Clients are warned by the `Sunset` date, not by a tombstone response.
5. **Security exceptions.** A vulnerability can force removal without notice. The changelog states that and why.

Emitting the headers from code and marking `PUT /tasks/{id}` as deprecated is done by the `add-patch-task-route` step, the first use of this process.

## 5. Version numbers, tags and the changelog

- **One number.** The git tag `vX.Y.Z` of a release, `info.version` in `openapi.yaml` and the changelog heading `## [X.Y.Z] - date` are always equal.
- **The highest class decides the bump.** A release with no contract change (like `v1.1.0`: documentation, process and refactoring) is a minor or patch bump chosen by the maintainer, and `info.version` follows it. The changelog says "no API change".
- **Why one number and not two.** A client developer and an operator ask the same question, "what is deployed and what changed?". Two numbers need a mapping table, and the repository already drifted with one: `info.version` stayed `1.0.0` at `v1.1.0`. The accepted cost is that an internal-only release moves the API number.
- **The changelog is the human record; `openapi.yaml` is the machine record.** GitHub release notes link to the changelog section instead of repeating it.
- **Changelog format.** Keep a Changelog headings (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`) plus `Upgrade notes`, maintained by hand. Each pull request that changes the contract or its behavior adds its entry under `Unreleased`.

### Release checklist

Done by the maintainer in the release pull request (`staging` to `production`), not by tooling:

1. Decide the version from the highest class in `Unreleased`.
2. Set `info.version` in `openapi.yaml` to that version.
3. Rename `Unreleased` to `## [X.Y.Z] - <date>` in `CHANGELOG.md` and add a new empty `Unreleased` section.
4. After the merge to `production`, tag that commit `vX.Y.Z` and publish the release notes with a link to the changelog section.
5. If an entry is **Operational**, check that its Upgrade notes say what to do before deploying.

## 6. Responsibilities

- **Spec authors** state the compatibility class of any contract change in the spec's Contract impact table.
- **Reviewers** compare that class with the diff of `openapi.yaml` and check the changelog entry.
- **The maintainer** performs the release checklist and decides version numbers and notice periods that this policy leaves open.
- **Clients** follow the rules of section 1 about what not to assume.
