import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const service = parse(readFileSync("serverless.yml", "utf8"), { logLevel: "error" });

describe("Lambda packaging in serverless.yml", () => {
    it("keeps the generated API client out of the function packages", () => {
        expect(service.package.patterns).toContain("!api-client/**");
    });
});
