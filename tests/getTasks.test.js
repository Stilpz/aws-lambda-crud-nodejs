import { describe, expect, it } from "vitest";
import { getTasks } from "../src/handlers/getTasks.js";
import { authContext, mockDynamo, silenceErrorLogs } from "./helpers.js";

const tokenFor = (key) => Buffer.from(JSON.stringify(key)).toString("base64url");

const invoke = (queryStringParameters, sub) =>
    getTasks({ requestContext: authContext(sub), queryStringParameters });

const ownerQuery = {
    TableName: "TaskTable-test",
    KeyConditionExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: { ":ownerId": "user-1" },
    ConsistentRead: true,
};

describe("getTasks", () => {
    it("returns the first page of the caller's tasks with 200", async () => {
        const items = [{ id: "1" }, { id: "2" }];
        const query = mockDynamo("query", { result: { Items: items } });

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ items, nextToken: null });
        expect(query).toHaveBeenCalledWith({ ...ownerQuery, Limit: 50 });
    });

    it("only queries the tasks of the authenticated user", async () => {
        const query = mockDynamo("query", { result: { Items: [] } });

        await invoke(undefined, "user-2");

        expect(query.mock.calls[0][0].ExpressionAttributeValues).toEqual({ ":ownerId": "user-2" });
    });

    it("returns an empty list when there are no tasks", async () => {
        mockDynamo("query", { result: { Items: [] } });

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ items: [], nextToken: null });
    });

    it("passes the limit and the start key to DynamoDB", async () => {
        const query = mockDynamo("query", { result: { Items: [] } });

        await invoke({ limit: "5", nextToken: tokenFor({ id: "task-1" }) });

        expect(query).toHaveBeenCalledWith({
            ...ownerQuery,
            Limit: 5,
            ExclusiveStartKey: { ownerId: "user-1", id: "task-1" },
        });
    });

    it("rejects a token that tries to smuggle in an owner, without querying", async () => {
        const query = mockDynamo("query", { result: { Items: [] } });

        const response = await invoke({ nextToken: tokenFor({ id: "t", ownerId: "victim" }) });

        expect(response.statusCode).toBe(400);
        expect(query).not.toHaveBeenCalled();
    });

    it("returns a nextToken that continues after the last evaluated key", async () => {
        mockDynamo("query", {
            result: {
                Items: [{ id: "1" }],
                LastEvaluatedKey: { ownerId: "user-1", id: "1" },
            },
        });

        const { nextToken } = JSON.parse((await invoke({ limit: "1" })).body);

        expect(JSON.parse(Buffer.from(nextToken, "base64url").toString())).toEqual({ id: "1" });
    });

    it.each([
        ["a limit of zero", { limit: "0" }],
        ["a limit above the maximum", { limit: "101" }],
        ["a non-numeric limit", { limit: "abc" }],
        ["a malformed token", { nextToken: "%%%" }],
    ])("rejects %s with 400 and does not query", async (_name, query) => {
        const dbQuery = mockDynamo("query");

        const response = await invoke(query);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBeTypeOf("string");
        expect(dbQuery).not.toHaveBeenCalled();
    });

    it("returns 500 when DynamoDB fails", async () => {
        mockDynamo("query", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke(undefined);

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not retrieve tasks" });
    });
});
