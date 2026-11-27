export type LicenseClaims = Readonly<{
  iss: 'splash-licensing'; aud: 'splash-animator'; software_key: 'splash-animator';
  jti: string; email: string; name?: string; company_name?: string;
  edition: 'trial' | 'single' | 'commercial'; can_save: boolean; commercial_use: boolean;
  revenue_limit_usd?: number; iat: number; nbf: number; exp?: number; license_version: 1;
}>;

export const MAX_LICENSE_LENGTH = 16384;
const algorithm = { name: 'ECDSA', hash: 'SHA-256' };

function bytes(encoded: string) {
  const data = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return data;
}

function object(encoded: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(encoded)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid license code.');
  return value as Record<string, unknown>;
}

const identity = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 &&
  value.length <= max && value === value.trim() && !/[\p{Cc}]/u.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) &&
  value >= 0 && value <= 253402300799;

export function licenseIsCurrent(claims: LicenseClaims, now = Math.floor(Date.now() / 1000)) {
  return claims.nbf <= now && (claims.exp === undefined || now < claims.exp);
}

export async function verifyLicense(code: string, trustedKeys: string | Readonly<Record<string, string>>): Promise<LicenseClaims> {
  if (code.length > MAX_LICENSE_LENGTH || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(code))
    throw Error('Paste a valid signed license code.');
  const [protectedHeader, payload, signature] = code.split('.');
  const header = object(protectedHeader);
  if (header.alg !== 'ES256' || header.typ !== 'JWT' || typeof header.kid !== 'string' ||
      !identity(header.kid, 128) || Object.keys(header).some(field => !['alg', 'typ', 'kid'].includes(field)))
    throw Error('This license uses an untrusted signing key.');
  // A single pinned key needs no routing. A multi-key deployment selects only among configured keys.
  const publicKey = typeof trustedKeys === 'string' ? trustedKeys
    : Object.hasOwn(trustedKeys, header.kid) ? trustedKeys[header.kid] : undefined;
  if (!publicKey) throw Error('This license uses an untrusted signing key.');
  const pem = /^-----BEGIN PUBLIC KEY-----\s*([\sA-Za-z0-9+/=]+)\s*-----END PUBLIC KEY-----$/.exec(publicKey.trim());
  if (!pem) throw Error('The license verification key is misconfigured.');
  const key = await crypto.subtle.importKey('spki', bytes(pem[1].replace(/\s/g, '')),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const proof = bytes(signature);
  if (proof.length !== 64 || !await crypto.subtle.verify(algorithm, key, proof,
    new TextEncoder().encode(`${protectedHeader}.${payload}`))) throw Error('The license signature is invalid.');

  const p = object(payload);
  if (p.iss !== 'splash-licensing' || p.aud !== 'splash-animator' || p.software_key !== 'splash-animator' ||
      p.license_version !== 1 || !identity(p.jti, 200) || !identity(p.email, 320) ||
      (p.name !== undefined && !identity(p.name, 200)) ||
      (p.company_name !== undefined && !identity(p.company_name, 200)) ||
      !timestamp(p.iat) || p.iat !== p.nbf ||
      (p.exp !== undefined && (!timestamp(p.exp) || p.exp <= p.iat))) throw Error('The license claims are invalid.');
  const validPermissions =
    (p.edition === 'trial' && p.can_save === false && p.commercial_use === false && p.revenue_limit_usd === undefined) ||
    (p.edition === 'single' && p.can_save === true && p.commercial_use === true && p.revenue_limit_usd === 100000) ||
    (p.edition === 'commercial' && p.can_save === true && p.commercial_use === true && p.revenue_limit_usd === undefined);
  if (!validPermissions) throw Error('The license permissions are invalid.');
  const claims = Object.freeze(p) as LicenseClaims;
  if (!licenseIsCurrent(claims)) throw Error('This license is expired or is not active yet.');
  return claims;
}
