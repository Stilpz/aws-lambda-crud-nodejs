import { describe, expect, it } from "vitest";
import { getTask } from "../src/getTask.js";
import { authContext, OWNER_ID, mockDynamo, silenceErrorLogs } from "./helpers.js";

const invoke = (id = "task-1") => getTask({ requestContext: authContext(), pathParameters: { id } });

describe("getTask", () => {
    it("returns the task with 200", async () => {
        const task = { id: "task-1", ownerId: OWNER_ID, title: "t", description: "d", done: false };
        const get = mockDynamo("get", { result: { Item: task } });

        const response = await invoke();

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual(task);
        expect(get).toHaveBeenCalledWith({ TableName: "TaskTable-test", Key: { id: "task-1" } });
    });

    it("returns 404 when the task does not exist", async () => {
        mockDynamo("get", { result: {} });

        const response = await invoke("missing");

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ message: "Task not found" });
    });

    it("returns 404 when the task belongs to another user", async () => {
        mockDynamo("get", { result: { Item: { id: "task-1", ownerId: "someone-else", title: "secret" } } });

        const response = await invoke();

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ message: "Task not found" });
    });

    it("returns 500 when DynamoDB fails", async () => {
        mockDynamo("get", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke();

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not retrieve task" });
    });
});
