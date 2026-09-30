import { vi } from "vitest";
import { dynamoDb } from "../src/db.js";

export const jsonEvent = (body, pathParameters) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    pathParameters,
});

// Replaces a DocumentClient method so no request reaches AWS.
export const mockDynamo = (method, { result, error } = {}) =>
    vi.spyOn(dynamoDb, method).mockReturnValue({
        promise: () => (error ? Promise.reject(error) : Promise.resolve(result)),
    });

export const conditionalCheckFailed = () =>
    Object.assign(new Error("The conditional request failed"), {
        code: "ConditionalCheckFailedException",
    });

export const silenceErrorLogs = () => vi.spyOn(console, "error").mockImplementation(() => {});
