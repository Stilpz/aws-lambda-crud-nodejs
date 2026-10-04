// Announces a deprecated operation on every response it produces, as the deprecation process in
// docs/API_VERSIONING.md requires: Deprecation is a structured-field date (RFC 9745), Sunset an
// HTTP-date (RFC 8594) and Link points at the migration notes.
//
// It wraps the finished handler instead of being a middy middleware because the 400, 415 and 422
// responses are built by middy's error handler, and only code outside the middleware chain sees
// them all.
export const withDeprecation = (handler, { deprecatedAt, sunsetAt, noticeUrl }) => {
    const headers = {
        Deprecation: `@${Math.floor(deprecatedAt.getTime() / 1000)}`,
        Sunset: sunsetAt.toUTCString(),
        Link: `<${noticeUrl}>; rel="deprecation"`,
    };

    return async (event, context) => {
        const response = await handler(event, context);

        return { ...response, headers: { ...response.headers, ...headers } };
    };
};
