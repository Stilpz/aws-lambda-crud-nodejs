import { describe, expect, it } from "vitest";
import { deleteTask } from "../src/deleteTask.js";
import { conditionalCheckFailed, mockDynamo, silenceErrorLogs } from "./helpers.js";

const invoke = (id = "task-1") => deleteTask({ pathParameters: { id } });

describe("deleteTask", () => {
    it("deletes an existing task with 200", async () => {
        const del = mockDynamo("delete");

        const response = await invoke();

        expect(response.statusCode).toBe(200);
        expect(del).toHaveBeenCalledWith({
            TableName: "TaskTable-test",
            Key: { id: "task-1" },
            ConditionExpression: "attribute_exists(id)",
        });
    });

    it("returns 404 when the task does not exist", async () => {
        mockDynamo("delete", { error: conditionalCheckFailed() });

        const response = await invoke("missing");

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ message: "Task not found" });
    });

    it("returns 500 on any other DynamoDB failure", async () => {
        mockDynamo("delete", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await invoke();

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not delete task" });
    });
});
