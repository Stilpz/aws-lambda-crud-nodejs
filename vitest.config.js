import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        restoreMocks: true,
        env: {
            TABLE_NAME: "TaskTable-test",
            AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE: "1",
        },
    },
});
