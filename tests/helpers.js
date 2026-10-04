import { vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDb } from "../src/infrastructure/dynamoClient.js";

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

const COMMANDS = {
    put: PutCommand,
    get: GetCommand,
    query: QueryCommand,
    update: UpdateCommand,
    delete: DeleteCommand,
};

// Replaces the document client's send() so no request reaches AWS. Returns a spy that is
// called with the input of every command of the given kind ("put", "get", ...) it receives.
export const mockDynamo = (method, { result = {}, error } = {}) => {
    const spy = vi.fn();

    vi.spyOn(dynamoDb, "send").mockImplementation(async (command) => {
        if (!(command instanceof COMMANDS[method])) {
            throw new Error(`Unexpected ${command.constructor.name}`);
        }

        spy(command.input);

        if (error) {
            throw error;
        }

        return result;
    });

    return spy;
};

export const conditionalCheckFailed = () =>
    Object.assign(new Error("The conditional request failed"), {
        name: "ConditionalCheckFailedException",
    });

export const silenceErrorLogs = () => vi.spyOn(console, "error").mockImplementation(() => {});
