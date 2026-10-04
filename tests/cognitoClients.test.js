import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The CloudFormation short forms (!Ref, !Join) are tags this test does not need to resolve: a !Ref
// reads as the logical id it names.
const readYaml = (path) => parse(readFileSync(path, "utf8"), { logLevel: "error" });

const service = readYaml("serverless.yml");
const auth = readYaml("resources/auth.yml");
const { UserPoolClient: scriptClient, SpaUserPoolClient: spa } = Object.fromEntries(
    Object.entries(auth.Resources).map(([id, resource]) => [id, resource.Properties]),
);

const STAGES = ["default", "dev", "staging", "prod"];

// A stage that does not set a parameter gets the default profile's value.
const stageParam = (stage, name) => service.stages[stage]?.params?.[name] ?? service.stages.default.params[name];

const isLocalhost = (url) => /^http:\/\/localhost(:\d+)?(\/|$)/.test(url);

describe("the existing app client", () => {
    it("is left as it was: no secret, no OAuth settings, flows from the stage profile", () => {
        expect(scriptClient.GenerateSecret).toBe(false);
        expect(scriptClient.ExplicitAuthFlows).toBe("${param:authFlows}");
        expect(scriptClient).not.toHaveProperty("AllowedOAuthFlows");
        expect(scriptClient).not.toHaveProperty("CallbackURLs");
    });
});

describe("the SPA app client", () => {
    it("is public: it has no secret", () => {
        expect(spa.GenerateSecret).toBe(false);
    });

    it("signs in only with the authorization code flow", () => {
        expect(spa.AllowedOAuthFlowsUserPoolClient).toBe(true);
        expect(spa.AllowedOAuthFlows).toEqual(["code"]);
    });

    it("allows no password or SRP sign-in through the Cognito API, in any stage", () => {
        expect(spa.ExplicitAuthFlows).toEqual(["ALLOW_REFRESH_TOKEN_AUTH"]);
    });

    it("asks for the identity and email scopes only, from Cognito's own user directory", () => {
        expect(spa.AllowedOAuthScopes).toEqual(["openid", "email"]);
        expect(spa.SupportedIdentityProviders).toEqual(["COGNITO"]);
    });

    it("hides whether a user exists and keeps token revocation on", () => {
        expect(spa.PreventUserExistenceErrors).toBe("ENABLED");
        expect(spa.EnableTokenRevocation).toBe(true);
    });

    it("sets its token lifetimes and their units explicitly", () => {
        expect(spa).toMatchObject({ AccessTokenValidity: 60, IdTokenValidity: 60, RefreshTokenValidity: 7 });
        expect(spa.TokenValidityUnits).toEqual({ AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days" });
    });

    it("rotates the refresh token", () => {
        expect(spa.RefreshTokenRotation.Feature).toBe("ENABLED");
    });

    it("takes its redirect URLs from the stage parameters", () => {
        expect(spa.CallbackURLs).toBe("${param:spaCallbackUrls}");
        expect(spa.LogoutURLs).toBe("${param:spaLogoutUrls}");
    });
});

describe("the authorizer", () => {
    it("accepts the tokens of both app clients", () => {
        expect(service.provider.httpApi.authorizers.cognitoAuthorizer.audience).toEqual(["UserPoolClient", "SpaUserPoolClient"]);
    });
});

describe("the redirect URLs of every stage", () => {
    it.each(STAGES)("%s lists callback and logout URLs that are absolute and carry no fragment", (stage) => {
        for (const url of [...stageParam(stage, "spaCallbackUrls"), ...stageParam(stage, "spaLogoutUrls")]) {
            expect(() => new URL(url), url).not.toThrow();
            expect(url, url).not.toContain("#");
        }
    });

    it.each(STAGES)("%s sends the callback to one of its allowed web origins", (stage) => {
        const origins = stageParam(stage, "webOrigins");

        for (const url of stageParam(stage, "spaCallbackUrls")) {
            expect(origins, url).toContain(new URL(url).origin);
        }
    });

    it.each(["staging", "prod"])("%s allows https only, with no localhost entry", (stage) => {
        for (const url of [...stageParam(stage, "spaCallbackUrls"), ...stageParam(stage, "spaLogoutUrls")]) {
            expect(url.startsWith("https://"), url).toBe(true);
            expect(isLocalhost(url), url).toBe(false);
        }
    });

    it.each(["default", "dev"])("%s may use http only for localhost", (stage) => {
        for (const url of [...stageParam(stage, "spaCallbackUrls"), ...stageParam(stage, "spaLogoutUrls")]) {
            expect(url.startsWith("https://") || isLocalhost(url), url).toBe(true);
        }
    });
});

describe("the stack outputs", () => {
    it("keep the ones the smoke test reads and add the SPA ones", () => {
        expect(Object.keys(auth.Outputs)).toEqual(["UserPoolId", "UserPoolClientId", "SpaClientId", "HostedUiBaseUrl"]);
    });
});
