import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessConfig {
  /** e.g. "myteam.cloudflareaccess.com" */
  teamDomain: string;
  /** The Access application's Audience (AUD) tag. */
  audience: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

/** The team's signing keys, fetched (and cached by jose) per isolate. */
function teamKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/**
 * Verifies the `Cf-Access-Jwt-Assertion` JWT that Cloudflare Access adds to
 * requests it has let through, returning the signed-in email, or `undefined` if
 * the token is missing, forged, expired, or for another application.
 */
export async function verifyAccess(
  token: string | null,
  { teamDomain, audience }: AccessConfig,
  keys: JWTVerifyGetKey = teamKeys(teamDomain),
): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${teamDomain}`,
      audience,
      algorithms: ["RS256"],
    });
    return typeof payload.email === "string" && payload.email ? payload.email : undefined;
  } catch {
    return undefined;
  }
}
