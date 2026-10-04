import { randomBytes } from "crypto";

const TIMESTAMP_BYTES = 6;

// A UUID version 7 (RFC 9562): a 48-bit millisecond timestamp followed by random bits. Ids made
// at a later millisecond sort after earlier ones, which is what lets the task id double as the
// table's sort key. Two ids from the same millisecond have no defined order.
export const generateUuidV7 = (now = Date.now) => {
    const bytes = randomBytes(16);
    const timestamp = now();

    for (let index = 0; index < TIMESTAMP_BYTES; index++) {
        bytes[TIMESTAMP_BYTES - 1 - index] = Math.floor(timestamp / 2 ** (8 * index)) % 256;
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString("hex");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
