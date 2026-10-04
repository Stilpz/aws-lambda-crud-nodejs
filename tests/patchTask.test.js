import { describe, expect, it } from "vitest";
import { patchTask } from "../src/handlers/patchTask.js";
import { authContext, conditionalCheckFailed, jsonEvent, mockDynamo, silenceErrorLogs } from "./helpers.js";

const stored = {
    id: "task-1",
    ownerId: "user-1",
    title: "New",
    description: "keep",
    createdAt: "2026-01-01T00:00:00.000Z",
    done: true,
};

const invoke = (body, id = "task-1", sub) => patchTask(jsonEvent(body, { id }, sub), {});

describe("patchTask", () => {
    it("updates only the fields that were sent and answers with the updated task", async () => {
        const update = mockDynamo("update", { result: { Attributes: stored } });

        const response = await invoke({ done: true });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual(stored);
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                Key: { ownerId: "user-1", id: "task-1" },
                UpdateExpression: "set #done = :done",
                ExpressionAttributeValues: { ":done": true },
                ConditionExpression: "attribute_exists(id)",
            }),
        );
    });

    it("ignores the id, the owner and the creation date in the body", async () => {
        const update = mockDynamo("update", { result: { Attributes: stored } });

        await invoke({ title: "New", id: "hacked", ownerId: "victim", createdAt: "x" });

        const params = update.mock.calls[0][0];
        expect(params.UpdateExpression).toBe("set #title = :title");
        expect(params.ExpressionAttributeValues).toEqual({ ":title": "New" });
        expect(params.Key).toEqual({ ownerId: "user-1", id: "task-1" });
    });

    it("scopes the update to the owner in the token", async () => {
        const update = mockDynamo("update", { result: { Attributes: stored } });

        await invoke({ done: true }, "task-1", "user-2");

        expect(update.mock.calls[0][0].Key).toEqual({ ownerId: "user-2", id: "task-1" });
    });

    it("accepts an empty description", async () => {
        mockDynamo("update", { result: { Attributes: { ...stored, description: "" } } });

        expect((await invoke({ description: "" })).statusCode).toBe(200);
    });

    it.each([
        ["no updatable field", {}],
        ["only unknown fields", { foo: 1 }],
        ["a non-boolean done", { done: "true" }],
        ["a blank title", { title: " " }],
        ["a null title", { title: null }],
        ["a non-string description", { description: 1 }],
        ["a body that is not an object", null],
    ])("rejects %s with 400 and does not write", async (_name, body) => {
        const update = mockDynamo("update");

        const response = await invoke(body);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({ message: "Event object failed validation", errors: expect.any(Array) });
        expect(update).not.toHaveBeenCalled();
    });

    it("rejects a non-JSON content type with 415", async () => {
        silenceErrorLogs();
        const event = { requestContext: authContext(), headers: { "content-type": "text/plain" }, body: "x", pathParameters: { id: "1" } };

        expect((await patchTask(event, {})).statusCode).toBe(415);
    });

    it("rejects malformed JSON with 422", async () => {
        silenceErrorLogs();
        const event = { requestContext: authContext(), headers: { "content-type": "application/json" }, body: "{bad", pathParameters: { id: "1" } };

        expect((await patchTask(event, {})).statusCode).toBe(422);
    });

    it("returns 404 when the task does not exist or belongs to someone else", async () => {
        mockDynamo("update", { error: conditionalCheckFailed() });

        const response = await invoke({ done: true });

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ message: "Task not found" });
    });

    it("returns 500 on any other DynamoDB failure", async () => {
        mockDynamo("update", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke({ done: true });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not update task" });
    });

    it("does not announce a deprecation", async () => {
        mockDynamo("update", { result: { Attributes: stored } });

        const { headers } = await invoke({ done: true });

        expect(headers ?? {}).not.toHaveProperty("Deprecation");
        expect(headers ?? {}).not.toHaveProperty("Sunset");
    });
});
