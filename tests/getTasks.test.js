import { describe, expect, it } from "vitest";
import { getTasks } from "../src/getTasks.js";
import { mockDynamo, silenceErrorLogs } from "./helpers.js";

const tokenFor = (key) => Buffer.from(JSON.stringify(key)).toString("base64url");

const invoke = (queryStringParameters) => getTasks({ queryStringParameters });

describe("getTasks", () => {
    it("returns the first page of tasks with 200", async () => {
        const items = [{ id: "1" }, { id: "2" }];
        const scan = mockDynamo("scan", { result: { Items: items } });

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ items, nextToken: null });
        expect(scan).toHaveBeenCalledWith({ TableName: "TaskTable-test", Limit: 50 });
    });

    it("returns an empty list when there are no tasks", async () => {
        mockDynamo("scan", { result: { Items: [] } });

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ items: [], nextToken: null });
    });

    it("passes the limit and the start key to DynamoDB", async () => {
        const scan = mockDynamo("scan", { result: { Items: [] } });

        await invoke({ limit: "5", nextToken: tokenFor({ id: "task-1" }) });

        expect(scan).toHaveBeenCalledWith({
            TableName: "TaskTable-test",
            Limit: 5,
            ExclusiveStartKey: { id: "task-1" },
        });
    });

    it("returns a nextToken that continues after the last evaluated key", async () => {
        mockDynamo("scan", { result: { Items: [{ id: "1" }], LastEvaluatedKey: { id: "1" } } });

        const { nextToken } = JSON.parse((await invoke({ limit: "1" })).body);

        expect(JSON.parse(Buffer.from(nextToken, "base64url").toString())).toEqual({ id: "1" });
    });

    it.each([
        ["a limit of zero", { limit: "0" }],
        ["a limit above the maximum", { limit: "101" }],
        ["a non-numeric limit", { limit: "abc" }],
        ["a malformed token", { nextToken: "%%%" }],
    ])("rejects %s with 400 and does not scan", async (_name, query) => {
        const scan = mockDynamo("scan");

        const response = await invoke(query);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBeTypeOf("string");
        expect(scan).not.toHaveBeenCalled();
    });

    it("returns 500 when DynamoDB fails", async () => {
        mockDynamo("scan", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not retrieve tasks" });
    });
});
