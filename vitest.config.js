import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        restoreMocks: true,
        // Integration tests need DynamoDB Local and have their own configuration.
        exclude: [...configDefaults.exclude, "tests/integration/**"],
        env: {
            TABLE_NAME: "TaskTable-test",
            AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE: "1",
            // Powertools reads its configuration from the environment. Logs stay silent in tests;
            // the observability tests raise the level or spy on the output where they need it.
            POWERTOOLS_SERVICE_NAME: "tasks-api-test",
            POWERTOOLS_METRICS_NAMESPACE: "TasksApiTest",
            POWERTOOLS_LOG_LEVEL: "SILENT",
            STAGE: "test",
        },
        coverage: {
            provider: "v8",
            // Listing the sources makes files no test imports show up as uncovered instead of
            // being left out of the report.
            include: ["src/**"],
            reporter: ["text", "json-summary"],
            // A ratchet: the measured baseline (statements 97.98, branches 95.23, functions 97.77,
            // lines 97.81) rounded down to the nearest 5. Lowering it needs a spec amendment.
            thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
        },
    },
});
