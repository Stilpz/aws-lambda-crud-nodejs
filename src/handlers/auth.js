// Cognito's JWT authorizer has already verified the token; "sub" is the stable, unique user id.
export const getOwnerId = (event) => event.requestContext.authorizer.jwt.claims.sub;
