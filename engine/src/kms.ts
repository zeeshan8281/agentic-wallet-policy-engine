import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Path where EigenCompute mounts the TEE KMS signing public key inside the enclave.
const KMS_PUBKEY_PATH = "/usr/local/bin/kms-signing-public-key.pem";

export interface SignedTx {
  txHash: string;
  signedRawTx: string;
  attestation: Attestation;
}

export interface Attestation {
  // Proof that the policy check + sign happened inside the TEE. In production
  // this is a hardware quote; for the demo we anchor to the KMS public key and
  // the policy hash so the response is self-describing.
  enclave: boolean;
  kmsKeyFingerprint: string | null;
  policyHash: string;
  signedAt: string;
}

/**
 * KMS abstraction. EigenCompute's deterministic KMS derives a persistent
 * keypair from the app ID inside the TEE; the policy engine is the only path
 * to it. We hide the wire protocol behind this interface so the real KMS call
 * can be swapped in without touching policy logic. When no KMS endpoint is
 * configured (local dev / demo) we deterministically mock signing.
 */
export class KmsClient {
  private readonly endpoint: string | null;
  private readonly address: string;
  private readonly kmsKeyFingerprint: string | null;

  constructor(endpoint?: string) {
    this.endpoint = endpoint && endpoint.length ? endpoint : null;
    this.kmsKeyFingerprint = readKmsFingerprint();
    // Derive a stable demo address from the KMS key (or a per-process seed).
    const seed = this.kmsKeyFingerprint ?? randomBytes(32).toString("hex");
    this.address = "0x" + createHash("sha256").update("addr:" + seed).digest("hex").slice(0, 40);
  }

  getAddress(): string {
    return this.address;
  }

  inEnclave(): boolean {
    return this.kmsKeyFingerprint !== null;
  }

  async sign(
    tx: { to: string; value: string; data?: string },
    policyHash: string
  ): Promise<SignedTx> {
    if (this.endpoint) {
      return this.signViaKms(tx, policyHash);
    }
    return this.signMock(tx, policyHash);
  }

  private async signViaKms(
    tx: { to: string; value: string; data?: string },
    policyHash: string
  ): Promise<SignedTx> {
    const res = await fetch(`${this.endpoint}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tx),
    });
    if (!res.ok) {
      throw new Error(`KMS sign failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { txHash: string; signedRawTx: string };
    return {
      txHash: body.txHash,
      signedRawTx: body.signedRawTx,
      attestation: this.attest(policyHash),
    };
  }

  private signMock(
    tx: { to: string; value: string; data?: string },
    policyHash: string
  ): SignedTx {
    const payload = JSON.stringify({ ...tx, nonce: randomBytes(8).toString("hex") });
    const txHash = "0x" + createHash("sha256").update(payload).digest("hex");
    return {
      txHash,
      signedRawTx: "0x02" + createHash("sha256").update("raw:" + payload).digest("hex"),
      attestation: this.attest(policyHash),
    };
  }

  private attest(policyHash: string): Attestation {
    return {
      enclave: this.inEnclave(),
      kmsKeyFingerprint: this.kmsKeyFingerprint,
      policyHash,
      signedAt: new Date().toISOString(),
    };
  }
}

function readKmsFingerprint(): string | null {
  try {
    if (!existsSync(KMS_PUBKEY_PATH)) return null;
    const pem = readFileSync(KMS_PUBKEY_PATH);
    return "0x" + createHash("sha256").update(pem).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}
