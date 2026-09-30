import { describe, expect, it } from "vitest";
import { encodeNextToken, InvalidPaginationError, parsePagination } from "../src/pagination.js";

const tokenFor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("parsePagination", () => {
    it("uses a default limit and no start key when nothing is sent", () => {
        expect(parsePagination(undefined)).toEqual({ limit: 50, exclusiveStartKey: undefined });
        expect(parsePagination({})).toEqual({ limit: 50, exclusiveStartKey: undefined });
    });

    it("parses the limit", () => {
        expect(parsePagination({ limit: "10" }).limit).toBe(10);
        expect(parsePagination({ limit: "100" }).limit).toBe(100);
    });

    it.each(["0", "101", "-1", "1.5", "abc", "", "1e2"])("rejects the limit %j", (limit) => {
        expect(() => parsePagination({ limit })).toThrow(InvalidPaginationError);
    });

    it("decodes a token into the start key", () => {
        expect(parsePagination({ nextToken: tokenFor({ id: "task-1" }) }).exclusiveStartKey).toEqual({
            id: "task-1",
        });
    });

    it("keeps only the id from a token that carries extra attributes", () => {
        const token = tokenFor({ id: "task-1", other: "x" });

        expect(parsePagination({ nextToken: token }).exclusiveStartKey).toEqual({ id: "task-1" });
    });

    it.each([
        ["not base64 JSON", "%%%"],
        ["JSON null", tokenFor(null)],
        ["an object without id", tokenFor({ foo: "bar" })],
        ["a non-string id", tokenFor({ id: 5 })],
        ["an empty id", tokenFor({ id: "" })],
        ["an empty token", ""],
    ])("rejects a token that is %s", (_name, nextToken) => {
        expect(() => parsePagination({ nextToken })).toThrow(InvalidPaginationError);
    });
});

describe("encodeNextToken", () => {
    it("returns null when there are no more pages", () => {
        expect(encodeNextToken(undefined)).toBeNull();
    });

    it("produces a token that parsePagination reads back", () => {
        const token = encodeNextToken({ id: "task-9" });

        expect(parsePagination({ nextToken: token }).exclusiveStartKey).toEqual({ id: "task-9" });
    });
});
