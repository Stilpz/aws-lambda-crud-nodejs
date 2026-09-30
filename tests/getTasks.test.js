import { describe, expect, it } from "vitest";
import { getTasks } from "../src/getTasks.js";
import { mockDynamo, silenceErrorLogs } from "./helpers.js";

describe("getTasks", () => {
    it("returns every task with 200", async () => {
        const items = [{ id: "1" }, { id: "2" }];
        const scan = mockDynamo("scan", { result: { Items: items } });

        const response = await getTasks({});

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual(items);
        expect(scan).toHaveBeenCalledWith({ TableName: "TaskTable-test" });
    });

    it("returns an empty list when there are no tasks", async () => {
        mockDynamo("scan", { result: { Items: [] } });

        const response = await getTasks({});

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual([]);
    });

    it("returns 500 when DynamoDB fails", async () => {
        mockDynamo("scan", { error: new Error("boom") });
        silenceErrorLogs();

        const response = await getTasks({});

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not retrieve tasks" });
    });
});
