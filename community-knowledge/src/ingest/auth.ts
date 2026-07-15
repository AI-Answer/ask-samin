export function getIngestApiKey(): string | undefined {
  return process.env.INGEST_API_KEY?.trim();
}

export function isIngestAuthorized(request: Request): boolean {
  const expected = getIngestApiKey();
  if (!expected) return false;

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return false;

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 && token === expected;
}
