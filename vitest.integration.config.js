import { defineConfig } from "vitest/config";

// Integration tests talk to a DynamoDB Local endpoint (see tests/integration/setup.js). They are
// kept out of the default configuration so `npm test` needs no Docker, network or AWS.
export default defineConfig({
    test: {
        include: ["tests/integration/**/*.test.js"],
        setupFiles: ["tests/integration/setup.js"],
        testTimeout: 30_000,
        hookTimeout: 30_000,
        env: {
            AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE: "1",
        },
    },
});
