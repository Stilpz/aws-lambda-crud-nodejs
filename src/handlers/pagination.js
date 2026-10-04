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

// The page size is an HTTP concern and is validated here. nextToken is handed on as an opaque
// cursor: only the repository knows what it contains.
export const parsePagination = (queryStringParameters) => {
    const { limit, nextToken } = queryStringParameters ?? {};

    return {
        limit: parseLimit(limit),
        cursor: nextToken,
    };
};
