import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

export function fixtureAuthority() {
  const keys = generateKeyPairSync('ed25519');
  return { publicKey: keys.publicKey, grant(operationDigest, overrides = {}) {
    const now = Date.now();
    const body = { schemaVersion: 1, approvalId: randomUUID(), issuer: 'fixture-host', actor: 'test-harness',
      operationDigest, issuedAt: now, expiresAt: now + 60000, ...overrides };
    const bytes = Buffer.from('peer-capabilities/approval/v1\n' + JSON.stringify(body, Object.keys(body).sort()));
    return { ...body, signature: sign(null, bytes, keys.privateKey).toString('base64url') };
  } };
}
