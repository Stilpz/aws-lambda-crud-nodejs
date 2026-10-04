import { describe, expect, it } from "vitest";
import { updateTask } from "../src/handlers/updateTask.js";
import { authContext, conditionalCheckFailed, jsonEvent, mockDynamo, silenceErrorLogs } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const invoke = (body) => updateTask(jsonEvent(body, { id: "task-1" }), {});

const expectDeprecated = (response) => {
    expect(response.headers.Deprecation).toMatch(/^@\d+$/);
    expect(response.headers.Sunset).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    expect(response.headers.Link).toMatch(/^<https:\/\/[^>]+>; rel="deprecation"$/);
};

describe("updateTask (PUT) deprecation headers", () => {
    it("announces the deprecation on a successful update, whose body is unchanged", async () => {
        mockDynamo("update");

        const response = await invoke({ done: true });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ message: "Task updated successfully" });
        expectDeprecated(response);
    });

    it("announces it on a validation error", async () => {
        const response = await invoke({});

        expect(response.statusCode).toBe(400);
        expectDeprecated(response);
    });

    it("announces it on 415 and 422", async () => {
        silenceErrorLogs();
        const base = { requestContext: authContext(), pathParameters: { id: "1" } };

        const unsupported = await updateTask({ ...base, headers: { "content-type": "text/plain" }, body: "x" }, {});
        const malformed = await updateTask({ ...base, headers: { "content-type": "application/json" }, body: "{bad" }, {});

        expect(unsupported.statusCode).toBe(415);
        expectDeprecated(unsupported);
        expect(malformed.statusCode).toBe(422);
        expectDeprecated(malformed);
    });

    it("announces it on 404 and 500", async () => {
        mockDynamo("update", { error: conditionalCheckFailed() });
        const notFound = await invoke({ done: true });

        mockDynamo("update", { error: new Error("boom") });
        silenceErrorLogs();
        const failure = await invoke({ done: true });

        expect(notFound.statusCode).toBe(404);
        expectDeprecated(notFound);
        expect(failure.statusCode).toBe(500);
        expectDeprecated(failure);
    });

    it("sets a sunset date at least 90 days after the deprecation date", async () => {
        mockDynamo("update");

        const { headers } = await invoke({ done: true });

        const deprecatedAt = Number(headers.Deprecation.slice(1)) * 1000;
        const sunsetAt = Date.parse(headers.Sunset);
        expect(sunsetAt - deprecatedAt).toBeGreaterThanOrEqual(90 * DAY_MS);
    });
});
