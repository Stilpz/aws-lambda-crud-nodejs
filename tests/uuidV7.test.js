import { describe, expect, it } from "vitest";
import { generateUuidV7 } from "../src/infrastructure/uuidV7.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const timestampOf = (uuid) => Number.parseInt(uuid.replaceAll("-", "").slice(0, 12), 16);

describe("generateUuidV7", () => {
    it("produces a valid UUID of version 7 with the RFC variant", () => {
        expect(generateUuidV7()).toMatch(UUID_V7);
    });

    it("embeds the millisecond timestamp it is given", () => {
        const time = Date.parse("2026-10-03T12:34:56.789Z");

        expect(timestampOf(generateUuidV7(() => time))).toBe(time);
    });

    it("uses the current time by default", () => {
        const before = Date.now();
        const embedded = timestampOf(generateUuidV7());
        const after = Date.now();

        expect(embedded).toBeGreaterThanOrEqual(before);
        expect(embedded).toBeLessThanOrEqual(after);
    });

    it("sorts ids from a later millisecond after ids from an earlier one", () => {
        const ids = [5, 1, 4, 2, 3].map((offset) => generateUuidV7(() => 1_700_000_000_000 + offset * 1000));

        const sorted = [...ids].sort();

        expect(sorted.map(timestampOf)).toEqual([1, 2, 3, 4, 5].map((offset) => 1_700_000_000_000 + offset * 1000));
    });

    it("keeps sorting correctly across a carry in the timestamp bytes", () => {
        const low = generateUuidV7(() => 0xffffffff);
        const high = generateUuidV7(() => 0x100000000);

        expect(low < high).toBe(true);
    });

    it("does not repeat an id, even within the same millisecond", () => {
        const ids = new Set(Array.from({ length: 1000 }, () => generateUuidV7(() => 1_700_000_000_000)));

        expect(ids.size).toBe(1000);
    });
});
