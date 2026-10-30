// The part of the HTTP request that the auth layer reads and writes. Declared here
// instead of importing a framework type so that nothing in auth depends on which
// HTTP adapter Nest runs on.
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  // Set by JwtAuthGuard after the token is verified. The user id exists nowhere
  // else on the request: never from the body, query or a header (SECURITY.md).
  auth?: { userId: string };
}
