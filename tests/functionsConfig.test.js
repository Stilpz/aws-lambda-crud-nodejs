import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The CloudFormation short forms (!Ref, !GetAtt) are tags this test does not need to resolve.
const readYaml = (path) => parse(readFileSync(path, "utf8"), { logLevel: "error" });

const functions = readdirSync("functions").flatMap((file) =>
    Object.entries(readYaml(`functions/${file}`)).map(([name, definition]) => ({ file, name, definition })),
);

// A function with no business with the table has no statements and a role for logging only.
const WITHOUT_TABLE_ACCESS = ["hello"];

const throttleAlarmMetricIds = () =>
    readYaml("resources/observability.yml").Resources.LambdaThrottlesAlarm.Properties.Metrics
        .map(({ Id }) => Id)
        .filter((id) => id !== "total");

describe("function files", () => {
    it("declare one function each, named after the file", () => {
        for (const { file, name } of functions) {
            expect(file).toBe(`${name}.yml`);
        }
    });

    it("give every function that uses the table its own role with a single DynamoDB action", () => {
        for (const { name, definition } of functions.filter(({ name }) => !WITHOUT_TABLE_ACCESS.includes(name))) {
            const statements = definition.iam?.role?.statements;

            expect(statements, `${name} needs iam.role.statements`).toHaveLength(1);
            expect(statements[0].Action, `${name} must use exactly one action`).toHaveLength(1);
            expect(statements[0].Action[0]).toMatch(/^dynamodb:[A-Za-z]+$/);
        }
    });

    it("give no table access to the functions that do not use the table", () => {
        for (const { name, definition } of functions.filter(({ name }) => WITHOUT_TABLE_ACCESS.includes(name))) {
            expect(definition.iam, `${name} must not declare statements`).toBeUndefined();
        }
    });

    it("are all covered by the Lambda throttle alarm", () => {
        expect(throttleAlarmMetricIds().sort()).toEqual(functions.map(({ name }) => name).sort());
    });
});
