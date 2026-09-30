import { describe, expect, it } from "vitest";
import { updateTask } from "../src/updateTask.js";
import { conditionalCheckFailed, jsonEvent, mockDynamo, silenceErrorLogs } from "./helpers.js";

const invoke = (body, id = "task-1") => updateTask(jsonEvent(body, { id }), {});

describe("updateTask", () => {
    it("updates only the fields that were sent", async () => {
        const update = mockDynamo("update");

        const response = await invoke({ done: true });

        expect(response.statusCode).toBe(200);
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                TableName: "TaskTable-test",
                Key: { id: "task-1" },
                UpdateExpression: "set #done = :done",
                ExpressionAttributeNames: { "#done": "done" },
                ExpressionAttributeValues: { ":done": true },
                ConditionExpression: "attribute_exists(id)",
            }),
        );
    });

    it("builds one expression for several fields and ignores unknown ones", async () => {
        const update = mockDynamo("update");

        await invoke({ title: "New", done: false, id: "hacked", createdAt: "x" });

        const params = update.mock.calls[0][0];
        expect(params.UpdateExpression).toBe("set #done = :done, #title = :title");
        expect(params.ExpressionAttributeValues).toEqual({ ":done": false, ":title": "New" });
    });

    it("accepts an empty description", async () => {
        mockDynamo("update");

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
        expect(update).not.toHaveBeenCalled();
    });

    it("rejects a non-JSON content type with 415", async () => {
        silenceErrorLogs();
        const event = { headers: { "content-type": "text/plain" }, body: "x", pathParameters: { id: "1" } };

        expect((await updateTask(event, {})).statusCode).toBe(415);
    });

    it("rejects malformed JSON with 422", async () => {
        silenceErrorLogs();
        const event = { headers: { "content-type": "application/json" }, body: "{bad", pathParameters: { id: "1" } };

        expect((await updateTask(event, {})).statusCode).toBe(422);
    });

    it("returns 404 when the task does not exist", async () => {
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
});
