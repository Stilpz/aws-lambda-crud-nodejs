import { Logger } from "@aws-lambda-powertools/logger";
import { search } from "@aws-lambda-powertools/logger/correlationId";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

// The only module that configures Powertools. Service name, metrics namespace, log level and the
// tracing switch come from environment variables set in serverless.yml (POWERTOOLS_*), so the code
// has no per-stage logic. Created once per Lambda container and reused by every invocation.
export const logger = new Logger({ correlationIdSearchFn: search });

export const metrics = new Metrics({ defaultDimensions: { stage: process.env.STAGE } });

export const tracer = new Tracer();
