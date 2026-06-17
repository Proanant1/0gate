// 0G Storage integration. Stores battle records (siege logs, fortress metadata)
// on decentralized storage. Uses the browser pattern from the official TS SDK docs:
//   - Blob (aliased to ZgBlob) for in-browser File/data upload
//   - BrowserProvider + MetaMask signer
//   - Turbo indexer endpoint
//
// NOTE: The SDK imports node builtins (fs, crypto) at load time, so we import it
// dynamically (only in the browser, only when needed) to keep SSR happy.

import { ZG_TESTNET } from "./zg-config";

export interface BattleRecord {
  fortressId: number | null;
  owner: string;
  mode: string;
  entropy: number;
  survived: boolean;
  integrity: number;
  wavesSurvived: number;
  score: number;
  timestamp: number;
}

/**
 * Upload a battle record to 0G Storage. Returns the root hash (content address).
 * The raw password is NEVER included — only public battle metadata.
 */
export async function storeBattleRecord(
  record: BattleRecord
): Promise<{ rootHash: string; txHash: string }> {
  if (typeof window === "undefined") {
    throw new Error("0G Storage upload runs in the browser only.");
  }

  // Dynamic imports keep these node-flavored modules out of the SSR bundle.
  const { Blob: ZgBlob, Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const { BrowserProvider } = await import("ethers");

  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();

  // Serialize the record to a File-like object the SDK can ingest.
  const json = JSON.stringify(record, null, 2);
  const file = new File([json], `battle-${record.timestamp}.json`, {
    type: "application/json",
  });

  const zgBlob = new ZgBlob(file);
  const [tree, treeErr] = await zgBlob.merkleTree();
  if (treeErr !== null) throw new Error(`Merkle tree error: ${treeErr}`);
  const rootHash = tree?.rootHash() ?? "";

  const indexer = new Indexer(ZG_TESTNET.indexerRpc);
  const [tx, uploadErr] = await indexer.upload(zgBlob, ZG_TESTNET.rpcUrl, signer);
  if (uploadErr !== null) throw new Error(`0G Storage upload error: ${uploadErr}`);

  const txHash = typeof tx === "object" && tx && "txHash" in tx ? (tx as any).txHash : String(tx);
  return { rootHash, txHash };
}

/** Build the storagescan URL for a stored record's root hash. */
export function storageExplorerUrl(rootHash: string): string {
  return `${ZG_TESTNET.storageExplorer}/tx/${rootHash}`;
}
