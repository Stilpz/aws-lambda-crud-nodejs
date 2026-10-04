import middy from "@middy/core";
import { correlationPaths } from "@aws-lambda-powertools/logger/correlationId";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import { logger, metrics, tracer } from "../infrastructure/observability.js";

// logMetrics is not used because, with no application metric, it logs a warning on every warm
// invocation. captureColdStartMetric publishes its own metric, and only on a container's first call.
const coldStartMetric = () => ({
    before: () => metrics.captureColdStartMetric(),
});

// Outermost wrapper of every handler: puts the Lambda context and the API Gateway request id on
// each log line, traces the invocation and records cold starts, whatever the handler inside does.
// resetKeys keeps one request's log keys from leaking into the next invocation of the same container.
export const withObservability = (handler) =>
    middy(handler)
        .use(injectLambdaContext(logger, { correlationIdPath: correlationPaths.API_GATEWAY_HTTP, resetKeys: true }))
        .use(captureLambdaHandler(tracer))
        .use(coldStartMetric());
