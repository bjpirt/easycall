import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

export const teamDomain = "team.cloudflareaccess.com";
export const audience = "app-aud-tag";

/** A local stand-in for an Access team: its key set, and a way to issue tokens. */
export async function fakeAccessTeam(): Promise<{
  keys: JWTVerifyGetKey;
  sign: (
    claims: Record<string, unknown>,
    options?: { expires?: string; key?: CryptoKey },
  ) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims, { expires = "1h", key = privateKey } = {}) =>
      new SignJWT({ iss: `https://${teamDomain}`, aud: audience, ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuedAt()
        .setExpirationTime(expires)
        .sign(key),
  };
}
