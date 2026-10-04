import { describe, expect, it } from "vitest";
import { InvalidPaginationError, parsePagination } from "../src/handlers/pagination.js";

describe("parsePagination", () => {
    it("uses a default limit and no cursor when nothing is sent", () => {
        expect(parsePagination(undefined)).toEqual({ limit: 50, cursor: undefined });
        expect(parsePagination({})).toEqual({ limit: 50, cursor: undefined });
    });

    it("parses the limit", () => {
        expect(parsePagination({ limit: "10" }).limit).toBe(10);
        expect(parsePagination({ limit: "100" }).limit).toBe(100);
    });

    it.each(["0", "101", "-1", "1.5", "abc", "", "1e2"])("rejects the limit %j", (limit) => {
        expect(() => parsePagination({ limit })).toThrow(InvalidPaginationError);
    });

    it("hands nextToken on untouched as the cursor", () => {
        expect(parsePagination({ nextToken: "opaque-token" }).cursor).toBe("opaque-token");
        expect(parsePagination({ nextToken: "" }).cursor).toBe("");
    });
});
