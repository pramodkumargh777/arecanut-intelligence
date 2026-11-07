const encoder = new TextEncoder();

/**
 * Checks an Authorization header against a bearer token. Every byte is always compared, so response time does not reveal
 * how much of a guessed token was right, as an early-exit string comparison can. A missing token never matches, so an
 * unconfigured secret keeps its routes closed.
 */
export function bearerMatches(header: string | null | undefined, token: string | null | undefined): boolean {
  if (!token) return false;
  const given = encoder.encode(header ?? "");
  const expected = encoder.encode(`Bearer ${token}`);
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ (given[index] ?? 0);
  return difference === 0;
}
