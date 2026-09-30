const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export class InvalidPaginationError extends Error {}

const parseLimit = (value) => {
    if (value === undefined) {
        return DEFAULT_LIMIT;
    }

    const limit = Number(value);

    if (!/^\d+$/.test(value) || limit < 1 || limit > MAX_LIMIT) {
        throw new InvalidPaginationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }

    return limit;
};

const decodeKey = (token) => {
    try {
        return JSON.parse(Buffer.from(token, "base64url").toString());
    } catch {
        return undefined;
    }
};

// The token comes from the client, so only a plain string id is accepted as the
// DynamoDB start key instead of passing along whatever the token decodes to.
const parseExclusiveStartKey = (token) => {
    if (token === undefined) {
        return undefined;
    }

    const key = decodeKey(token);

    if (typeof key?.id !== "string" || key.id === "") {
        throw new InvalidPaginationError("nextToken is invalid");
    }

    return { id: key.id };
};

export const parsePagination = (queryStringParameters) => {
    const { limit, nextToken } = queryStringParameters ?? {};

    return {
        limit: parseLimit(limit),
        exclusiveStartKey: parseExclusiveStartKey(nextToken),
    };
};

export const encodeNextToken = (lastEvaluatedKey) =>
    lastEvaluatedKey ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64url") : null;
