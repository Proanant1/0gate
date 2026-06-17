import { BrowserProvider, Contract, JsonRpcProvider, formatEther } from "ethers";
import { ZG_TESTNET, ZG_ADD_CHAIN_PARAMS, ARENA_ADDRESS } from "./zg-config";
import { FORTRESS_ARENA_ABI } from "../abi/FortressArena";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/** Connect MetaMask and ensure we're on the 0G Galileo testnet. Returns the address. */
export async function connectWallet(): Promise<string> {
  if (!hasWallet()) {
    throw new Error("No wallet found. Install MetaMask to play on-chain.");
  }
  const accounts: string[] = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  await ensureCorrectChain();
  return accounts[0];
}

/** Add the 0G testnet to the wallet if missing, then switch to it. */
export async function ensureCorrectChain(): Promise<void> {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === ZG_TESTNET.chainIdHex.toLowerCase()) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ZG_TESTNET.chainIdHex }],
    });
  } catch (err: any) {
    // 4902 = chain not added yet
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [ZG_ADD_CHAIN_PARAMS],
      });
    } else {
      throw err;
    }
  }
}

/** Browser provider/signer for write transactions (uses the connected wallet). */
export async function getSigner() {
  const provider = new BrowserProvider(window.ethereum);
  return provider.getSigner();
}

/** Read-only provider for views (no wallet popups). */
export function getReadProvider() {
  return new JsonRpcProvider(ZG_TESTNET.rpcUrl, ZG_TESTNET.chainId);
}

/** Contract instance bound to the signer (for writes). */
export async function getArenaWrite(): Promise<Contract> {
  if (!ARENA_ADDRESS) throw new Error("Arena contract address not set. Deploy first.");
  const signer = await getSigner();
  return new Contract(ARENA_ADDRESS, FORTRESS_ARENA_ABI, signer);
}

/** Contract instance bound to a read provider (for views). */
export function getArenaRead(): Contract {
  if (!ARENA_ADDRESS) throw new Error("Arena contract address not set. Deploy first.");
  return new Contract(ARENA_ADDRESS, FORTRESS_ARENA_ABI, getReadProvider());
}

/** Native 0G balance of an address, formatted. */
export async function getBalance(address: string): Promise<string> {
  const provider = getReadProvider();
  const bal = await provider.getBalance(address);
  return formatEther(bal);
}

export function shortAddr(a: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function explorerTx(hash: string): string {
  return `${ZG_TESTNET.explorer}/tx/${hash}`;
}
