import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The CloudFormation short forms (!Ref, !Join) are tags this test does not need to resolve.
const readYaml = (path) => parse(readFileSync(path, "utf8"), { logLevel: "error" });

const service = readYaml("serverless.yml");
const { cors } = service.provider.httpApi;
// Only the stages that set their own origins: a stage without webOrigins (dev) inherits the default list.
const stageOrigins = Object.entries(service.stages)
    .filter(([, { params }]) => params.webOrigins)
    .map(([stage, { params }]) => [stage, params.webOrigins]);

const httpMethodsOfFunctions = () =>
    readdirSync("functions")
        .flatMap((file) => Object.values(readYaml(`functions/${file}`)))
        .flatMap(({ events }) => events)
        .map(({ httpApi }) => httpApi.method.toUpperCase());

const isLocalDevelopmentOrigin = (origin) => /^http:\/\/localhost(:\d+)?$/.test(origin);

describe("CORS configuration in serverless.yml", () => {
    it("takes the allowed origins from the per-stage parameter", () => {
        expect(cors.allowedOrigins).toBe("${param:webOrigins}");
    });

    it("lists explicit origins for the default stage and for staging and prod", () => {
        expect(stageOrigins.map(([stage]) => stage)).toEqual(expect.arrayContaining(["default", "staging", "prod"]));

        for (const [, origins] of stageOrigins) {
            expect(origins.length).toBeGreaterThan(0);
        }
    });

    it("never uses a wildcard for origins, headers, methods or exposed headers", () => {
        const lists = [
            ...stageOrigins.map(([, origins]) => origins),
            cors.allowedHeaders,
            cors.allowedMethods,
            cors.exposedResponseHeaders,
        ];

        for (const list of lists) {
            expect(list.filter((value) => value.includes("*"))).toEqual([]);
        }
    });

    it("does not allow credentials", () => {
        expect(cors.allowCredentials).not.toBe(true);
    });

    it("allows only https origins, and http only for local development in the default stage", () => {
        for (const [stage, origins] of stageOrigins) {
            for (const origin of origins) {
                const allowed = origin.startsWith("https://") || (stage === "default" && isLocalDevelopmentOrigin(origin));

                expect(allowed, `${stage}: ${origin}`).toBe(true);
            }
        }
    });

    it("allows the headers the contract sends", () => {
        expect(cors.allowedHeaders).toEqual(expect.arrayContaining(["Authorization", "Content-Type"]));
    });

    it("allows every method a function is routed on, and PATCH", () => {
        expect(cors.allowedMethods).toEqual(expect.arrayContaining([...httpMethodsOfFunctions(), "PATCH"]));
    });

    it("exposes the deprecation headers", () => {
        expect(cors.exposedResponseHeaders).toEqual(expect.arrayContaining(["Deprecation", "Sunset"]));
    });

    it("caches the preflight for a finite number of seconds", () => {
        expect(Number.isInteger(cors.maxAge)).toBe(true);
        expect(cors.maxAge).toBeGreaterThan(0);
    });
});
