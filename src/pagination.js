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

const isNonEmptyString = (value) => typeof value === "string" && value !== "";

// The token comes from the client, so only plain strings are accepted for the key
// attributes, and the owner always comes from the caller's identity (never the token)
// so a forged token cannot page through another user's tasks.
const parseExclusiveStartKey = (token, ownerId) => {
    if (token === undefined) {
        return undefined;
    }

    const key = decodeKey(token);

    if (!isNonEmptyString(key?.id) || !isNonEmptyString(key?.createdAt)) {
        throw new InvalidPaginationError("nextToken is invalid");
    }

    return { id: key.id, createdAt: key.createdAt, ownerId };
};

export const parsePagination = (queryStringParameters, ownerId) => {
    const { limit, nextToken } = queryStringParameters ?? {};

    return {
        limit: parseLimit(limit),
        exclusiveStartKey: parseExclusiveStartKey(nextToken, ownerId),
    };
};

// ownerId is left out: it is re-derived from the caller's identity when the token is read.
export const encodeNextToken = (lastEvaluatedKey) =>
    lastEvaluatedKey
        ? Buffer.from(JSON.stringify({ id: lastEvaluatedKey.id, createdAt: lastEvaluatedKey.createdAt })).toString("base64url")
        : null;
