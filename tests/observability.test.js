import { afterEach, describe, expect, it, vi } from "vitest";

const loadObservability = async () => {
    vi.resetModules();
    return import("../src/infrastructure/observability.js");
};

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("observability module", () => {
    it("takes the log level from POWERTOOLS_LOG_LEVEL", async () => {
        vi.stubEnv("POWERTOOLS_LOG_LEVEL", "DEBUG");

        const { logger } = await loadObservability();

        expect(logger.getLevelName()).toBe("DEBUG");
    });

    it("emits metrics in the configured namespace with the stage as a default dimension", async () => {
        vi.stubEnv("POWERTOOLS_METRICS_NAMESPACE", "TasksApi");
        vi.stubEnv("STAGE", "staging");
        const { metrics } = await loadObservability();

        metrics.addMetric("Probe", "Count", 1);
        const emitted = metrics.serializeMetrics();
        metrics.clearMetrics();

        expect(emitted._aws.CloudWatchMetrics[0].Namespace).toBe("TasksApi");
        expect(emitted.stage).toBe("staging");
    });

    it("does not trace outside Lambda, so tests never talk to X-Ray", async () => {
        const { tracer } = await loadObservability();

        expect(tracer.isTracingEnabled()).toBe(false);
    });
});
