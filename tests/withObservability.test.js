import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withJsonBody } from "../src/handlers/middleware.js";

// A fresh module graph per test, so each test starts with a "cold" container.
let withObservability;
let logger;
let metrics;

const loadModules = async () => {
    vi.resetModules();
    ({ withObservability } = await import("../src/handlers/withObservability.js"));
    ({ logger, metrics } = await import("../src/infrastructure/observability.js"));
};

beforeEach(loadModules);

afterEach(() => {
    vi.unstubAllEnvs();
});

const apiEvent =(requestId, body) => ({
    requestContext: { requestId },
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
});

const coldStartMetrics = () => {
    const addMetric = vi.fn();
    vi.spyOn(metrics, "singleMetric").mockReturnValue({ addDimension: vi.fn(), addMetric });

    return addMetric;
};

describe("withObservability", () => {
    it("returns what the wrapped handler returns, called without a Lambda context", async () => {
        const response = { statusCode: 200, body: "{}" };

        expect(await withObservability(async () => response)({})).toBe(response);
    });

    it("exposes the API Gateway request id as the correlation id while the handler runs", async () => {
        let seen;
        const handler = withObservability(async () => {
            seen = logger.getCorrelationId();
            return { statusCode: 200 };
        });

        await handler({ requestContext: { requestId: "abc" } });

        expect(seen).toBe("abc");
    });

    it("does not leak a request's correlation id into the next invocation", async () => {
        const seen = [];
        const handler = withObservability(async (event) => {
            seen.push(logger.getCorrelationId());
            return { statusCode: 200, requestId: event.requestContext.requestId };
        });

        await handler({ requestContext: { requestId: "first" } });
        await handler({ requestContext: { requestId: "second" } });

        expect(seen).toEqual(["first", "second"]);
        expect(logger.getCorrelationId()).toBeUndefined();
    });

    it("wraps a handler that already runs through middy", async () => {
        let seen;
        const inner = withJsonBody(async (event) => {
            seen = logger.getCorrelationId();
            return { statusCode: 201, body: event.body.title };
        });

        const response = await withObservability(inner)(apiEvent("req-7", { title: "write tests" }));

        expect(response).toEqual({ statusCode: 201, body: "write tests" });
        expect(seen).toBe("req-7");
    });

    it("records a ColdStart metric on the first invocation only", async () => {
        // Lambda sets this variable; Powertools only reports cold starts when it is "on-demand".
        vi.stubEnv("AWS_LAMBDA_INITIALIZATION_TYPE", "on-demand");
        await loadModules();
        const addMetric = coldStartMetrics();
        const handler = withObservability(async () => ({ statusCode: 200 }));

        await handler({});
        await handler({});

        expect(addMetric).toHaveBeenCalledTimes(1);
        expect(addMetric).toHaveBeenCalledWith("ColdStart", "Count", 1);
    });
});
