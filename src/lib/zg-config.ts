// Central config for 0G Galileo testnet.
// Values sourced from https://docs.0g.ai/developer-hub/testnet/testnet-overview

export const ZG_TESTNET = {
  chainId: 16602,
  chainIdHex: "0x40DA", // 16602 in hex, for wallet_addEthereumChain
  name: "0G Galileo Testnet",
  symbol: "0G",
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  storageExplorer: "https://storagescan-galileo.0g.ai",
  faucet: "https://faucet.0g.ai",
  // Turbo indexer (recommended). Standard indexer is slower/cheaper.
  indexerRpc: "https://indexer-storage-testnet-turbo.0g.ai",
} as const;

// FortressArena contract address — set after you run `npm run deploy:testnet`
export const ARENA_ADDRESS =
  process.env.NEXT_PUBLIC_ARENA_ADDRESS || "0x113b200dD42B50fAde039aF2C5BCD12D1F43D3fc";

// MetaMask network params for wallet_addEthereumChain
export const ZG_ADD_CHAIN_PARAMS = {
  chainId: ZG_TESTNET.chainIdHex,
  chainName: ZG_TESTNET.name,
  nativeCurrency: { name: "0G", symbol: ZG_TESTNET.symbol, decimals: 18 },
  rpcUrls: [ZG_TESTNET.rpcUrl],
  blockExplorerUrls: [ZG_TESTNET.explorer],
};
