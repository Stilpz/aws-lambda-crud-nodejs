import { vi } from "vitest";
import { dynamoDb } from "../src/db.js";

export const OWNER_ID = "user-1";

// Request context API Gateway builds after the Cognito JWT authorizer accepts a token.
export const authContext = (sub = OWNER_ID) => ({
    authorizer: { jwt: { claims: { sub } } },
});

export const jsonEvent = (body, pathParameters, sub) => ({
    requestContext: authContext(sub),
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
