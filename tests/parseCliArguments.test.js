import { describe, expect, it } from "vitest";
import { parseCliArguments, UsageError } from "../scripts/orphanTaskOwners.js";

const OWNER = "b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d";

describe("parseCliArguments", () => {
    it("resolves a stage to its table and defaults to a dry run", () => {
        expect(parseCliArguments(["--stage", "dev", "--delete"])).toEqual({
            help: false,
            tableName: "TaskTable-dev",
            region: "us-west-2",
            action: { type: "delete" },
            apply: false,
        });
    });

    it("accepts an explicit table instead of a stage", () => {
        expect(parseCliArguments(["--table", "MyTable", "--delete"]).tableName).toBe("MyTable");
    });

    it("assigns the owner when --owner is given", () => {
        expect(parseCliArguments(["--stage", "dev", "--owner", OWNER]).action).toEqual({ type: "assign", ownerId: OWNER });
    });

    it("applies the changes only when --apply is given", () => {
        expect(parseCliArguments(["--stage", "dev", "--delete", "--apply"]).apply).toBe(true);
    });

    it("takes the region from the flag, then from AWS_REGION, then the default", () => {
        const args = ["--stage", "dev", "--delete"];

        expect(parseCliArguments([...args, "--region", "eu-west-1"], { AWS_REGION: "us-east-1" }).region).toBe("eu-west-1");
        expect(parseCliArguments(args, { AWS_REGION: "us-east-1" }).region).toBe("us-east-1");
        expect(parseCliArguments(args, {}).region).toBe("us-west-2");
    });

    it("returns help without validating anything else", () => {
        expect(parseCliArguments(["--help"])).toEqual({ help: true });
    });

    it.each([
        ["no arguments", []],
        ["neither a stage nor a table", ["--delete"]],
        ["both a stage and a table", ["--stage", "dev", "--table", "T", "--delete"]],
        ["neither an owner nor --delete", ["--stage", "dev"]],
        ["both an owner and --delete", ["--stage", "dev", "--owner", OWNER, "--delete"]],
        ["an owner that is not a UUID", ["--stage", "dev", "--owner", "ana@example.com"]],
        ["an unknown flag", ["--stage", "dev", "--delete", "--force"]],
        ["a stray positional argument", ["--stage", "dev", "--delete", "oops"]],
    ])("rejects %s", (_name, args) => {
        expect(() => parseCliArguments(args)).toThrow(UsageError);
    });
});
