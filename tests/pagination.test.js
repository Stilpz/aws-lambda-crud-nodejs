import { describe, expect, it } from "vitest";
import { encodeNextToken, InvalidPaginationError, parsePagination } from "../src/pagination.js";

const tokenFor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const OWNER = "user-1";
const validKey = { id: "task-1", createdAt: "2026-01-01T00:00:00.000Z" };

describe("parsePagination", () => {
    it("uses a default limit and no start key when nothing is sent", () => {
        expect(parsePagination(undefined, OWNER)).toEqual({ limit: 50, exclusiveStartKey: undefined });
        expect(parsePagination({}, OWNER)).toEqual({ limit: 50, exclusiveStartKey: undefined });
    });

    it("parses the limit", () => {
        expect(parsePagination({ limit: "10" }, OWNER).limit).toBe(10);
        expect(parsePagination({ limit: "100" }, OWNER).limit).toBe(100);
    });

    it.each(["0", "101", "-1", "1.5", "abc", "", "1e2"])("rejects the limit %j", (limit) => {
        expect(() => parsePagination({ limit }, OWNER)).toThrow(InvalidPaginationError);
    });

    it("decodes a token into the start key and adds the caller as owner", () => {
        expect(parsePagination({ nextToken: tokenFor(validKey) }, OWNER).exclusiveStartKey).toEqual({
            ...validKey,
            ownerId: OWNER,
        });
    });

    it("takes the owner from the caller, not from the token", () => {
        const token = tokenFor({ ...validKey, ownerId: "victim", other: "x" });

        expect(parsePagination({ nextToken: token }, OWNER).exclusiveStartKey).toEqual({
            ...validKey,
            ownerId: OWNER,
        });
    });

    it.each([
        ["not base64 JSON", "%%%"],
        ["JSON null", tokenFor(null)],
        ["an object without id", tokenFor({ createdAt: "c" })],
        ["an object without createdAt", tokenFor({ id: "1" })],
        ["a non-string id", tokenFor({ ...validKey, id: 5 })],
        ["a non-string createdAt", tokenFor({ ...validKey, createdAt: 5 })],
        ["an empty id", tokenFor({ ...validKey, id: "" })],
        ["an empty token", ""],
    ])("rejects a token that is %s", (_name, nextToken) => {
        expect(() => parsePagination({ nextToken }, OWNER)).toThrow(InvalidPaginationError);
    });
});

describe("encodeNextToken", () => {
    it("returns null when there are no more pages", () => {
        expect(encodeNextToken(undefined)).toBeNull();
    });

    it("leaves the owner out of the token", () => {
        const token = encodeNextToken({ ...validKey, ownerId: OWNER });

        expect(JSON.parse(Buffer.from(token, "base64url").toString())).toEqual(validKey);
    });

    it("produces a token that parsePagination reads back", () => {
        const token = encodeNextToken({ ...validKey, ownerId: OWNER });

        expect(parsePagination({ nextToken: token }, OWNER).exclusiveStartKey).toEqual({
            ...validKey,
            ownerId: OWNER,
        });
    });
});
