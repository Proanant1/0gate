import { keccak256, solidityPacked, hexlify, randomBytes } from "ethers";

// We never put the raw password on-chain. The flow is:
//   passwordHash = sha256(password)              (browser SubtleCrypto)
//   commit       = keccak256(passwordHash, salt) (matches the Solidity contract)
// The commit goes on-chain. To "crack", an attacker must reproduce (passwordHash, salt).

/** SHA-256 of the raw password, returned as a 0x-prefixed 32-byte hex string. */
export async function sha256Hex(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hexlify(new Uint8Array(digest));
}

/** Generate a random 32-byte salt as hex. */
export function makeSalt(): string {
  return hexlify(randomBytes(32));
}

/**
 * Compute the on-chain commitment exactly as the contract does:
 * keccak256(abi.encodePacked(passwordHash, salt)).
 * Both args must be 0x-prefixed 32-byte hex (bytes32).
 */
export function computeCommit(passwordHashHex: string, saltHex: string): string {
  return keccak256(solidityPacked(["bytes32", "bytes32"], [passwordHashHex, saltHex]));
}

/** Convenience: from a raw password produce { passwordHash, salt, commit }. */
export async function buildCommitment(password: string, salt?: string) {
  const passwordHash = await sha256Hex(password);
  const s = salt ?? makeSalt();
  const commit = computeCommit(passwordHash, s);
  return { passwordHash, salt: s, commit };
}
