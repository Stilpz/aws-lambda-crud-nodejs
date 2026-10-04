// Manual end-to-end check of the browser sign-in against a deployed stage (spec 0015). It does what
// the single-page app will do: sends the user to the hosted sign-in with a PKCE challenge, catches
// the redirect on a local port, exchanges the code, calls the API with the access token and with the
// ID token, then refreshes the tokens and calls the API again. You type the password in the browser.
//
//   HOSTED_UI=https://<prefix>.auth.us-west-2.amazoncognito.com \
//   SPA_CLIENT_ID=<SpaClientId> API_URL=https://<id>.execute-api.us-west-2.amazonaws.com \
//   node scripts/pkce-login.mjs
//
// The values are the stack outputs HostedUiBaseUrl and SpaClientId. REDIRECT_URI defaults to the local
// development callback registered in the default stage; it must be one of the client's callback URLs
// and an http://localhost URL, because the script listens on it. Tokens are never printed.
// Needs Node 22 or later and no packages.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const base64Url = (buffer) => buffer.toString("base64url");

export const createVerifier = () => base64Url(randomBytes(32));

// RFC 7636, method S256: the only method Cognito supports.
export const createChallenge = (verifier) => base64Url(createHash("sha256").update(verifier).digest());

const requireEnv = (name) => {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} (see the comment at the top of this file)`);
    }

    return value;
};

const waitForCode = (redirectUri, state) =>
    new Promise((resolve, reject) => {
        const { port, pathname } = new URL(redirectUri);
        const timer = setTimeout(() => reject(new Error("No sign-in within 5 minutes")), 5 * 60 * 1000);

        const server = createServer((request, response) => {
            const url = new URL(request.url, redirectUri);

            if (url.pathname !== pathname) {
                response.writeHead(404).end();
                return;
            }

            response.end("Signed in. You can close this tab.");
            clearTimeout(timer);
            server.close();

            if (url.searchParams.get("state") !== state) {
                reject(new Error("The state in the redirect does not match: the response was not for this request"));
            } else if (url.searchParams.get("error")) {
                reject(new Error(`Cognito answered with ${url.searchParams.get("error")}`));
            } else {
                resolve(url.searchParams.get("code"));
            }
        });

        server.listen(Number(port));
    });

const postToken = async (hostedUi, parameters) => {
    const response = await fetch(`${hostedUi}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(parameters),
    });

    if (!response.ok) {
        throw new Error(`The token endpoint answered ${response.status}: ${await response.text()}`);
    }

    return response.json();
};

const main = async () => {
    const hostedUi = requireEnv("HOSTED_UI");
    const clientId = requireEnv("SPA_CLIENT_ID");
    const apiUrl = requireEnv("API_URL");
    const redirectUri = process.env.REDIRECT_URI ?? "http://localhost:5173/auth/callback";

    const verifier = createVerifier();
    const state = base64Url(randomBytes(16));
    const authorizeUrl = `${hostedUi}/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid email",
        state,
        code_challenge_method: "S256",
        code_challenge: createChallenge(verifier),
    })}`;

    console.log(`Open this address in a browser and sign in:\n\n${authorizeUrl}\n`);

    const code = await waitForCode(redirectUri, state);
    let tokens = await postToken(hostedUi, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
    });

    let failures = 0;
    const expectStatus = async (description, expected, token) => {
        const response = await fetch(`${apiUrl}/tasks`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

        if (response.status === expected) {
            console.log(`ok   ${description} (${response.status})`);
        } else {
            console.log(`FAIL ${description}: expected ${expected}, got ${response.status}`);
            failures += 1;
        }
    };

    await expectStatus("GET /tasks without a token", 401);
    await expectStatus("GET /tasks with the access token", 200, tokens.access_token);
    await expectStatus("GET /tasks with the ID token", 200, tokens.id_token);

    const refreshed = await postToken(hostedUi, {
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
    });
    console.log(`ok   the refresh token was exchanged for new tokens (a new refresh token was ${refreshed.refresh_token ? "" : "not "}issued)`);
    tokens = { ...tokens, ...refreshed };

    await expectStatus("GET /tasks with the refreshed access token", 200, tokens.access_token);

    if (failures > 0) {
        throw new Error(`${failures} check(s) failed`);
    }

    console.log("All checks passed");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
