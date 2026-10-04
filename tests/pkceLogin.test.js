import { describe, expect, it } from "vitest";
import { createChallenge, createVerifier } from "../scripts/pkce-login.mjs";

describe("PKCE helpers of scripts/pkce-login.mjs", () => {
    it("derives the S256 challenge of RFC 7636, appendix B", () => {
        expect(createChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });

    it("creates a verifier of the length and alphabet the RFC allows, different every time", () => {
        const first = createVerifier();

        expect(first).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        expect(createVerifier()).not.toBe(first);
    });
});
