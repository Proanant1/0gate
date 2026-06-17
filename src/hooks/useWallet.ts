"use client";

import { useState, useEffect, useCallback } from "react";
import { connectWallet as doConnect, getBalance, hasWallet } from "../lib/chain";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const b = await getBalance(addr);
      setBalance(Number(b).toFixed(4));
    } catch {
      /* ignore */
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const addr = await doConnect();
      setAddress(addr);
      await refreshBalance(addr);
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance]);

  // React to account / chain changes
  useEffect(() => {
    if (!hasWallet()) return;
    const onAccounts = (accs: string[]) => {
      if (accs.length === 0) {
        setAddress(null);
        setBalance("0");
      } else {
        setAddress(accs[0]);
        refreshBalance(accs[0]);
      }
    };
    const onChain = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [refreshBalance]);

  return { address, balance, connecting, error, connect, refreshBalance };
}
