import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { licenseIsCurrent, verifyLicense } from '../apps/editor/src/license-token';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const trusted = { fixture: pem };
const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: 'splash-licensing', aud: 'splash-animator', software_key: 'splash-animator',
  jti: 'fixture-license', email: 'fixture@example.com', name: 'Fixture User', company_name: 'Fixture Co',
  edition: 'single', can_save: true, commercial_use: true, revenue_limit_usd: 100000,
  license_version: 1, iat: now - 5, nbf: now - 5, exp: now + 3600,
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims = {}, header = {}) {
  const data = `${encode({ alg: 'ES256', typ: 'JWT', kid: 'fixture', ...header })}.${encode({ ...payload, ...claims })}`;
  const signature = sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${signature.toString('base64url')}`;
}

describe('signed license verification', () => {
  it('returns authenticated claims with the pinned key or configured key ID', async () => {
    await expect(verifyLicense(token(), trusted)).resolves.toEqual(payload);
    await expect(verifyLicense(token({}, { kid: 'issuer-key' }), pem)).resolves.toEqual(payload);
    expect(licenseIsCurrent(payload as Awaited<ReturnType<typeof verifyLicense>>, payload.exp)).toBe(false);
  });
  it('rejects tampering, untrusted keys and substituted algorithms', async () => {
    const [head, , signature] = token().split('.');
    await expect(verifyLicense(`${head}.${encode({ ...payload, name: 'Modified' })}.${signature}`, trusted)).rejects.toThrow('signature');
    await expect(verifyLicense(token({}, { kid: 'unknown' }), trusted)).rejects.toThrow('untrusted');
    await expect(verifyLicense(token({}, { alg: 'HS256' }), trusted)).rejects.toThrow('untrusted');
  });
  it.each([
    { aud: 'different-product' }, { software_key: 'different-product' }, { iss: 'different-issuer' },
    { license_version: 2 }, { exp: now - 1 }, { iat: now + 60, nbf: now + 60, exp: now + 100 },
    { edition: 'trial' }, { company_name: ' padded ' },
  ])('rejects ineligible signed claims %j', async invalid => {
    await expect(verifyLicense(token(invalid), trusted)).rejects.toThrow();
  });
  it('accepts a perpetual trial while retaining its output restrictions', async () => {
    await expect(verifyLicense(token({ edition: 'trial', can_save: false, commercial_use: false, exp: undefined,
      revenue_limit_usd: undefined }), trusted)).resolves.toMatchObject({ edition: 'trial', can_save: false });
  });
});
