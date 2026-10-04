import { describe, expect, it, vi } from "vitest";
import { withDeprecation } from "../src/handlers/deprecation.js";

const options = {
    deprecatedAt: new Date("2026-10-03T00:00:00Z"),
    sunsetAt: new Date("2027-04-03T00:00:00Z"),
    noticeUrl: "https://example.com/changelog",
};

describe("withDeprecation", () => {
    it("adds the Deprecation, Sunset and Link headers to the response", async () => {
        const handler = withDeprecation(async () => ({ statusCode: 200, body: "{}" }), options);

        const response = await handler({}, {});

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe("{}");
        expect(response.headers).toEqual({
            Deprecation: "@1790985600",
            Sunset: "Sat, 03 Apr 2027 00:00:00 GMT",
            Link: '<https://example.com/changelog>; rel="deprecation"',
        });
    });

    it("keeps the headers the handler already set", async () => {
        const handler = withDeprecation(async () => ({ statusCode: 400, headers: { "Content-Type": "application/json" } }), options);

        const { headers } = await handler({}, {});

        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers.Deprecation).toBe("@1790985600");
    });

    it("forwards the event and the context and leaves a thrown error alone", async () => {
        const inner = vi.fn().mockRejectedValue(new Error("boom"));
        const event = { id: 1 };
        const context = { awsRequestId: "abc" };

        await expect(withDeprecation(inner, options)(event, context)).rejects.toThrow("boom");
        expect(inner).toHaveBeenCalledWith(event, context);
    });
});
