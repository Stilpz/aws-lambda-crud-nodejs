import { describe, expect, it, vi } from "vitest";
import { InvalidCursorError, TaskNotFoundError } from "../src/domain/errors.js";
import { withErrorMapping } from "../src/handlers/errorBoundary.js";
import { InvalidPaginationError } from "../src/handlers/pagination.js";
import { silenceErrorLogs } from "./helpers.js";

const options = { logLabel: "Error doing it:", failureMessage: "Could not do it" };

const failingWith = (error) => withErrorMapping(async () => { throw error; }, options);

describe("withErrorMapping", () => {
    it("returns the response of a handler that succeeds, untouched", async () => {
        const response = { statusCode: 201, body: "{}" };
        const handler = withErrorMapping(async () => response, options);

        expect(await handler({})).toBe(response);
    });

    it("forwards the event and the context to the handler", async () => {
        const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
        const event = { id: 1 };
        const context = { awsRequestId: "abc" };

        await withErrorMapping(inner, options)(event, context);

        expect(inner).toHaveBeenCalledWith(event, context);
    });

    it("maps TaskNotFoundError to 404", async () => {
        const response = await failingWith(new TaskNotFoundError())({});

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ message: "Task not found" });
    });

    it.each([
        ["InvalidCursorError", new InvalidCursorError(), "nextToken is invalid"],
        ["InvalidPaginationError", new InvalidPaginationError("limit must be an integer between 1 and 100"), "limit must be an integer between 1 and 100"],
    ])("maps %s to 400 with its message", async (_name, error, message) => {
        const response = await failingWith(error)({});

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({ message });
    });

    it("logs an unknown error once and answers 500 with the fixed message", async () => {
        const log = silenceErrorLogs();
        const error = new Error("boom");

        const response = await failingWith(error)({});

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({ message: "Could not do it" });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Error doing it:", error);
    });

    it("never sends the details of an unknown error to the client", async () => {
        silenceErrorLogs();

        const response = await failingWith(new Error("secret table name"))({});

        expect(response.body).not.toContain("secret");
    });

    it("does not log the errors it knows how to answer", async () => {
        const log = silenceErrorLogs();

        await failingWith(new TaskNotFoundError())({});

        expect(log).not.toHaveBeenCalled();
    });
});
