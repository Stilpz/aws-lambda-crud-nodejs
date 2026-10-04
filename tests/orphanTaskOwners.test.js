import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { migrateOrphanTasks } from "../scripts/orphanTaskOwners.js";
import { conditionalCheckFailed } from "./helpers.js";

const OWNER = "b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const NO_OWNER = "attribute_not_exists(ownerId)";

let client;
let log;

// Two scan pages: a, b then c.
const scanPages = () => {
    const pages = [
        { Items: [{ id: "a" }, { id: "b" }], LastEvaluatedKey: { id: "b" } },
        { Items: [{ id: "c" }] },
    ];

    return (command) => {
        if (command instanceof ScanCommand) {
            return Promise.resolve(pages.shift());
        }

        return Promise.resolve({});
    };
};

const sentOf = (Type) => client.send.mock.calls.map(([command]) => command).filter((command) => command instanceof Type);

const run = (options) => migrateOrphanTasks({ client, tableName: "TaskTable-dev", log, ...options });

beforeEach(() => {
    client = { send: vi.fn(scanPages()) };
    log = vi.fn();
});

describe("scanning", () => {
    it("filters on a missing owner, reads only the key and follows the pages", async () => {
        const summary = await run({ action: { type: "delete" }, apply: false });

        const scans = sentOf(ScanCommand);
        expect(scans).toHaveLength(2);
        expect(scans[0].input).toEqual({
            TableName: "TaskTable-dev",
            FilterExpression: NO_OWNER,
            ProjectionExpression: "id",
            ExclusiveStartKey: undefined,
        });
        expect(scans[1].input.ExclusiveStartKey).toEqual({ id: "b" });
        expect(summary.found).toBe(3);
    });
});

describe("dry run", () => {
    it("writes nothing and reports what it would do", async () => {
        const summary = await run({ action: { type: "assign", ownerId: OWNER }, apply: false });

        expect(sentOf(UpdateCommand)).toHaveLength(0);
        expect(sentOf(DeleteCommand)).toHaveLength(0);
        expect(summary).toEqual({ found: 3, changed: 0, skipped: 0, failed: 0 });
        expect(log).toHaveBeenCalledWith(`would assign ${OWNER} to task a`);
        expect(log).toHaveBeenCalledTimes(3);
    });

    it("says it would delete when the action is delete", async () => {
        await run({ action: { type: "delete" }, apply: false });

        expect(log).toHaveBeenCalledWith("would delete task c");
    });
});

describe("assigning an owner", () => {
    it("sets the owner on every orphan, guarded so an existing owner is never overwritten", async () => {
        const summary = await run({ action: { type: "assign", ownerId: OWNER }, apply: true });

        const updates = sentOf(UpdateCommand);
        expect(updates.map((command) => command.input.Key.id)).toEqual(["a", "b", "c"]);
        for (const { input } of updates) {
            expect(input).toMatchObject({
                TableName: "TaskTable-dev",
                UpdateExpression: "set ownerId = :ownerId",
                ConditionExpression: NO_OWNER,
                ExpressionAttributeValues: { ":ownerId": OWNER },
            });
        }
        expect(summary).toEqual({ found: 3, changed: 3, skipped: 0, failed: 0 });
    });
});

describe("deleting", () => {
    it("deletes every orphan, guarded so a task that gained an owner is never deleted", async () => {
        const summary = await run({ action: { type: "delete" }, apply: true });

        const deletes = sentOf(DeleteCommand);
        expect(deletes.map((command) => command.input.Key.id)).toEqual(["a", "b", "c"]);
        for (const { input } of deletes) {
            expect(input).toMatchObject({ TableName: "TaskTable-dev", ConditionExpression: NO_OWNER });
        }
        expect(summary).toEqual({ found: 3, changed: 3, skipped: 0, failed: 0 });
    });
});

describe("failures", () => {
    const failOn = (id, error) => {
        const scan = scanPages();
        client.send.mockImplementation((command) => {
            if (!(command instanceof ScanCommand) && command.input.Key.id === id) {
                return Promise.reject(error);
            }

            return scan(command);
        });
    };

    it("counts a task that gained an owner in the meantime as skipped and carries on", async () => {
        failOn("b", conditionalCheckFailed());

        const summary = await run({ action: { type: "delete" }, apply: true });

        expect(summary).toEqual({ found: 3, changed: 2, skipped: 1, failed: 0 });
    });

    it("counts any other failure as failed, reports it and carries on", async () => {
        failOn("a", new Error("throttled"));

        const summary = await run({ action: { type: "assign", ownerId: OWNER }, apply: true });

        expect(summary).toEqual({ found: 3, changed: 2, skipped: 0, failed: 1 });
        expect(log).toHaveBeenCalledWith("failed on task a: throttled");
    });
});

describe("an empty table", () => {
    it("finds nothing and writes nothing", async () => {
        client.send.mockResolvedValue({ Items: [] });

        const summary = await run({ action: { type: "delete" }, apply: true });

        expect(summary).toEqual({ found: 0, changed: 0, skipped: 0, failed: 0 });
        expect(client.send).toHaveBeenCalledTimes(1);
    });
});
