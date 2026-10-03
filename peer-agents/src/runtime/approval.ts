import { KeyObject, verify } from 'node:crypto';
import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { canonical } from './identity.js';

const instant = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const approvalGrantSchema = z.object({
  schemaVersion: z.literal(1), approvalId: z.string().uuid(),
  issuer: z.string().trim().min(1).max(200), actor: z.string().trim().min(1).max(200),
  operationDigest: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: instant, expiresAt: instant,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();
export type ApprovalGrant = z.infer<typeof approvalGrantSchema>;

/** Verifies a receipt from an explicitly trusted host, not human presence itself.
 * The embedding host owns key provisioning and an isolated human approval UI.
 * Neither provider credentials nor signing keys are accepted by this runtime.
 */
export class ApprovalVerifier {
  readonly #issuer: string;
  readonly #publicKey: KeyObject;
  constructor(issuer: string, publicKey: KeyObject) {
    if (!issuer.trim() || publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('An explicit host issuer and Ed25519 public key are required');
    }
    this.#issuer = issuer;
    this.#publicKey = publicKey;
  }
  verify(value: unknown, operationDigest: string): ApprovalGrant {
    assertNonSecret(value);
    const grant = approvalGrantSchema.parse(value);
    if (grant.issuer !== this.#issuer || grant.operationDigest !== operationDigest) throw new Error('Approval issuer or operation mismatch');
    const now = Date.now();
    if (grant.issuedAt > now || grant.expiresAt <= now || grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > 300_000) {
      throw new Error('Approval expired or outside allowed time bounds');
    }
    const { signature, ...payload } = grant;
    const bytes = Buffer.from(signature, 'base64url');
    if (bytes.toString('base64url') !== signature || !verify(null,
      Buffer.from('peer-capabilities/approval/v1\n' + canonical(payload)), this.#publicKey, bytes)) {
      throw new Error('Invalid host approval signature');
    }
    return grant;
  }
}
