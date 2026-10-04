import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";

describe("dynamoDb client", () => {
    it("is built on a low-level client that the tracer has captured", async () => {
        vi.resetModules();
        const { tracer } = await import("../src/infrastructure/observability.js");
        const capture = vi.spyOn(tracer, "captureAWSv3Client");

        await import("../src/infrastructure/dynamoClient.js");

        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls[0][0]).toBeInstanceOf(DynamoDBClient);
    });
});
