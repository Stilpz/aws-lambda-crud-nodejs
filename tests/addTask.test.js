import { describe, expect, it } from "vitest";
import { addTask } from "../src/handlers/addTask.js";
import { authContext, jsonEvent, OWNER_ID, mockDynamo, silenceErrorLogs } from "./helpers.js";

const invoke = (event) => addTask(event, {});

describe("addTask", () => {
    it("creates a task and returns 201", async () => {
        const put = mockDynamo("put");

        const response = await invoke(jsonEvent({ title: "Write tests", description: "With Vitest" }));

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toMatchObject({
            title: "Write tests",
            description: "With Vitest",
            done: false,
            ownerId: OWNER_ID,
        });
        expect(put).toHaveBeenCalledWith(
            expect.objectContaining({
                TableName: "TaskTable-test",
                ConditionExpression: "attribute_not_exists(id)",
            }),
        );
    });

    it("generates an id and a creation date", async () => {
        mockDynamo("put");

        const task = JSON.parse((await invoke(jsonEvent({ title: "t" }))).body);

        expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
    });

    it("defaults a missing description to an empty string", async () => {
        mockDynamo("put");

        const task = JSON.parse((await invoke(jsonEvent({ title: "t" }))).body);

        expect(task.description).toBe("");
    });

    it.each([
        ["a missing title", {}],
        ["a blank title", { title: "  " }],
        ["a non-string title", { title: 5 }],
        ["a non-string description", { title: "t", description: 1 }],
        ["a body that is not an object", null],
    ])("rejects %s with 400 and does not write", async (_name, body) => {
        const put = mockDynamo("put");

        const response = await invoke(jsonEvent(body));

        expect(response.statusCode).toBe(400);
        expect(put).not.toHaveBeenCalled();
    });

    it("rejects a non-JSON content type with 415", async () => {
        const put = mockDynamo("put");
        silenceErrorLogs();

        const response = await invoke({ requestContext: authContext(), headers: { "content-type": "text/plain" }, body: "x" });

        expect(response.statusCode).toBe(415);
        expect(put).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON with 422", async () => {
        silenceErrorLogs();

        const response = await invoke({ requestContext: authContext(), headers: { "content-type": "application/json" }, body: "{bad" });

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body).message).toBeTypeOf("string");
    });

    it("returns 500 when DynamoDB fails", async () => {
        mockDynamo("put", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke(jsonEvent({ title: "t" }));

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not create task" });
    });
});
