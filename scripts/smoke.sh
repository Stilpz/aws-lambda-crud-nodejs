#!/usr/bin/env bash
# Post-deploy smoke test: authentication and per-user isolation against a deployed stage.
#
# Creates two throwaway Cognito users, runs the checks, then deletes the users and the task it
# created. Needs the AWS CLI (with credentials allowed to create users and sign them in through the
# admin API and to describe user pool clients), curl and node on the PATH. Works in every stage.
#
#   STAGE=dev REGION=us-west-2 ./scripts/smoke.sh
#
# Optional overrides: SERVICE, STACK, API_URL, CORS_ORIGIN (an origin allowed on the stage; the
# default is the local development origin of the default stage).
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-west-2}"
SERVICE="${SERVICE:-aws-lambda-crud-nodejs}"
STACK="${STACK:-$SERVICE-$STAGE}"
CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:5173}"
PASSWORD="Smoke$RANDOM$RANDOM"
RUN_ID="$RANDOM$RANDOM"
USER_A="smoke-a-$RUN_ID@example.com"
USER_B="smoke-b-$RUN_ID@example.com"

failures=0
task_id=""
token_a=""

stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

CLIENT_ID="$(stack_output UserPoolClientId)"
USER_POOL_ID="$(stack_output UserPoolId)"
API_URL="${API_URL:-$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='$STAGE-$SERVICE'].ApiEndpoint | [0]" --output text)}"

if [[ -z "$CLIENT_ID" || -z "$USER_POOL_ID" || -z "$API_URL" || "$API_URL" == "None" ]]; then
  echo "Could not resolve the stack outputs or the API URL. Check STAGE, REGION and STACK." >&2
  exit 2
fi

cleanup() {
  if [[ -n "$task_id" && -n "$token_a" ]]; then
    curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $token_a" "$API_URL/tasks/$task_id" || true
  fi
  for user in "$USER_A" "$USER_B"; do
    aws cognito-idp admin-delete-user --region "$REGION" --user-pool-id "$USER_POOL_ID" \
      --username "$user" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

create_user() {
  aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$1" --message-action SUPPRESS \
    --user-attributes "Name=email,Value=$1" Name=email_verified,Value=true >/dev/null
  aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --username "$1" --password "$PASSWORD" --permanent >/dev/null
}

# The admin flow works in every stage: it needs AWS credentials, so an app or a browser cannot use it,
# and the client allows the public password flow only in dev. The ID token is the same one the
# JWT authorizer validates.
get_token() {
  aws cognito-idp admin-initiate-auth --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --auth-flow ADMIN_USER_PASSWORD_AUTH --client-id "$CLIENT_ID" \
    --auth-parameters "USERNAME=$1,PASSWORD=$PASSWORD" \
    --query AuthenticationResult.IdToken --output text
}

# status <expected> <description> <curl args...>: prints the response body to $BODY_FILE
BODY_FILE="$(mktemp)"
status() {
  local expected="$1" description="$2" actual
  shift 2
  actual="$(curl -s -o "$BODY_FILE" -w '%{http_code}' "$@")"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   $description ($actual)"
  else
    echo "FAIL $description: expected $expected, got $actual: $(cat "$BODY_FILE")"
    failures=$((failures + 1))
  fi
}

json_field() {
  node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o[process.argv[1]])' "$1"
}

echo "Stack $STACK, API $API_URL"
create_user "$USER_A"
create_user "$USER_B"
token_a="$(get_token "$USER_A")"
token_b="$(get_token "$USER_B")"
auth_a=(-H "Authorization: Bearer $token_a")
auth_b=(-H "Authorization: Bearer $token_b")
json=(-H "Content-Type: application/json")

status 200 "GET / is public" "$API_URL/"
status 401 "GET /tasks without a token is rejected" "$API_URL/tasks"
status 401 "GET /tasks with a garbage token is rejected" -H "Authorization: Bearer not-a-token" "$API_URL/tasks"

# Browser sign-in (read-only): the SPA client must be public, use the authorization code flow only and
# allow no password flow, and the hosted sign-in must accept its registered callback and refuse others.
SPA_CLIENT_ID="$(stack_output SpaClientId)"
HOSTED_UI="$(stack_output HostedUiBaseUrl)"
if [[ -z "$SPA_CLIENT_ID" || "$SPA_CLIENT_ID" == "None" || -z "$HOSTED_UI" || "$HOSTED_UI" == "None" ]]; then
  echo "FAIL the stack has no SpaClientId or HostedUiBaseUrl output"
  failures=$((failures + 1))
else
  spa_client="$(aws cognito-idp describe-user-pool-client --region "$REGION" --user-pool-id "$USER_POOL_ID" \
    --client-id "$SPA_CLIENT_ID" --query UserPoolClient --output json)"
  spa_problems="$(node -e '
    const client = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const problems = [];
    if (client.ClientSecret) problems.push("has a client secret");
    if (JSON.stringify(client.AllowedOAuthFlows) !== JSON.stringify(["code"])) problems.push("OAuth flows are not exactly code");
    if (JSON.stringify([...client.AllowedOAuthScopes].sort()) !== JSON.stringify(["email", "openid"])) problems.push("scopes are not exactly openid and email");
    if ((client.ExplicitAuthFlows ?? []).some((flow) => /PASSWORD|SRP/.test(flow))) problems.push("allows a password or SRP flow");
    console.log(problems.join("; "));
  ' <<< "$spa_client")"
  if [[ -z "$spa_problems" ]]; then
    echo "ok   the SPA client is public, code flow only, openid and email scopes, no password flow"
  else
    echo "FAIL the SPA client $spa_problems"
    failures=$((failures + 1))
  fi

  spa_callback="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).CallbackURLs[0])' <<< "$spa_client")"
  authorize_url="$HOSTED_UI/oauth2/authorize?response_type=code&client_id=$SPA_CLIENT_ID&scope=openid+email&code_challenge_method=S256&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  registered_redirect="$(curl -s -o /dev/null -w '%{redirect_url}' --get --data-urlencode "redirect_uri=$spa_callback" "$authorize_url")"
  if [[ "$registered_redirect" == *"/login"* ]]; then
    echo "ok   the hosted sign-in accepts the registered callback and redirects to its login page"
  else
    echo "FAIL the hosted sign-in did not redirect to /login for the registered callback ($spa_callback): '$registered_redirect'"
    failures=$((failures + 1))
  fi
  foreign_redirect="$(curl -s -o /dev/null -w '%{redirect_url}' --get --data-urlencode "redirect_uri=https://evil.example/callback" "$authorize_url")"
  if [[ "$foreign_redirect" == *"/login"* ]]; then
    echo "FAIL the hosted sign-in accepted an unregistered redirect_uri"
    failures=$((failures + 1))
  else
    echo "ok   the hosted sign-in refuses an unregistered redirect_uri"
  fi
fi

# CORS: the preflight is answered by API Gateway, so it needs no token. The allowed origin must be
# echoed back exactly (never "*") and an unknown origin must get no CORS header at all.
preflight_headers() {
  curl -s -D - -o /dev/null -X OPTIONS "$API_URL/tasks" -H "Origin: $1" \
    -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" | tr -d '\r'
}
header_value() {
  grep -i "^$1:" | head -n 1 | cut -d: -f2- | sed 's/^ *//' || true
}

allowed_preflight="$(preflight_headers "$CORS_ORIGIN")"
if [[ "$(header_value access-control-allow-origin <<< "$allowed_preflight")" == "$CORS_ORIGIN" ]]; then
  echo "ok   preflight from $CORS_ORIGIN is allowed and echoes the origin"
else
  echo "FAIL preflight from $CORS_ORIGIN did not return Access-Control-Allow-Origin: $CORS_ORIGIN"
  failures=$((failures + 1))
fi
for name in access-control-allow-methods access-control-allow-headers access-control-max-age; do
  if [[ -n "$(header_value "$name" <<< "$allowed_preflight")" ]]; then
    echo "ok   preflight returns $name"
  else
    echo "FAIL preflight is missing $name"
    failures=$((failures + 1))
  fi
done
if [[ -z "$(header_value access-control-allow-origin <<< "$(preflight_headers https://evil.example)")" ]]; then
  echo "ok   preflight from an unknown origin gets no Access-Control-Allow-Origin"
else
  echo "FAIL preflight from an unknown origin was allowed"
  failures=$((failures + 1))
fi

status 201 "A creates a task" -X POST "${auth_a[@]}" "${json[@]}" -d '{"title":"smoke test"}' "$API_URL/tasks"
task_id="$(json_field id < "$BODY_FILE")"
status 400 "POST without a title is rejected" -X POST "${auth_a[@]}" "${json[@]}" -d '{}' "$API_URL/tasks"
status 415 "POST with a non-JSON content type is rejected" -X POST "${auth_a[@]}" -H "Content-Type: text/plain" -d 'x' "$API_URL/tasks"

actual_origin="$(curl -s -D - -o /dev/null "${auth_a[@]}" -H "Origin: $CORS_ORIGIN" "$API_URL/tasks/$task_id" | tr -d '\r' | header_value access-control-allow-origin)"
if [[ "$actual_origin" == "$CORS_ORIGIN" ]]; then
  echo "ok   a real request from $CORS_ORIGIN gets Access-Control-Allow-Origin"
else
  echo "FAIL a real request from $CORS_ORIGIN got Access-Control-Allow-Origin: '$actual_origin'"
  failures=$((failures + 1))
fi
# Informational: whether API Gateway adds CORS headers to the authorizer's 401 decides how a browser
# reports an expired token (a 401, or an opaque network error).
unauthorized_origin="$(curl -s -D - -o /dev/null -H "Origin: $CORS_ORIGIN" "$API_URL/tasks" | tr -d '\r' | header_value access-control-allow-origin)"
echo "info 401 without a token, Access-Control-Allow-Origin: '${unauthorized_origin}'"

status 200 "A reads own task""${auth_a[@]}" "$API_URL/tasks/$task_id"
status 200 "A lists tasks right after creating one" "${auth_a[@]}" "$API_URL/tasks"
if [[ "$(node -e 'const id = process.argv[1]; console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).items.some((task) => task.id === id))' "$task_id" < "$BODY_FILE")" == "true" ]]; then
  echo "ok   A's new task is in the listing immediately (consistent read)"
else
  echo "FAIL A's new task is missing from the listing right after it was created"
  failures=$((failures + 1))
fi
status 404 "B cannot read A's task" "${auth_b[@]}" "$API_URL/tasks/$task_id"
status 404 "B cannot patch A's task" -X PATCH "${auth_b[@]}" "${json[@]}" -d '{"done":true}' "$API_URL/tasks/$task_id"
status 404 "B cannot update A's task (PUT, deprecated)" -X PUT"${auth_b[@]}" "${json[@]}" -d '{"done":true}' "$API_URL/tasks/$task_id"
status 404 "B cannot delete A's task" -X DELETE "${auth_b[@]}" "$API_URL/tasks/$task_id"

status 200 "B lists tasks" "${auth_b[@]}" "$API_URL/tasks"
if [[ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).items.length)' < "$BODY_FILE")" == "0" ]]; then
  echo "ok   B's list is empty"
else
  echo "FAIL B's list contains tasks it does not own"
  failures=$((failures + 1))
fi

status 200 "A patches own task" -X PATCH "${auth_a[@]}" "${json[@]}" -d '{"done":true}' "$API_URL/tasks/$task_id"
if [[ "$(json_field done < "$BODY_FILE")" == "true" && "$(json_field id < "$BODY_FILE")" == "$task_id" ]]; then
  echo "ok   PATCH answers with the updated task"
else
  echo "FAIL PATCH did not answer with the updated task: $(cat "$BODY_FILE")"
  failures=$((failures + 1))
fi
status 200 "A updates own task (PUT, deprecated)" -X PUT "${auth_a[@]}" "${json[@]}" -d '{"done":false}' "$API_URL/tasks/$task_id"

put_headers="$(curl -s -D - -o /dev/null -X PUT "${auth_a[@]}" "${json[@]}" -d '{"done":false}' "$API_URL/tasks/$task_id" | tr -d '\r')"
for name in deprecation sunset link; do
  if grep -qi "^$name:" <<< "$put_headers"; then
    echo "ok   PUT announces its deprecation with the $name header"
  else
    echo "FAIL PUT response is missing the $name header"
    failures=$((failures + 1))
  fi
done
patch_headers="$(curl -s -D - -o /dev/null -X PATCH "${auth_a[@]}" "${json[@]}" -d '{"done":true}' "$API_URL/tasks/$task_id" | tr -d '\r')"
if grep -qi "^deprecation:" <<< "$patch_headers"; then
  echo "FAIL PATCH must not announce a deprecation"
  failures=$((failures + 1))
else
  echo "ok   PATCH carries no deprecation header"
fi
status 200 "A deletes own task" -X DELETE "${auth_a[@]}" "$API_URL/tasks/$task_id"
task_id=""

rm -f "$BODY_FILE"
if [[ "$failures" -gt 0 ]]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "All checks passed"
