export const SEPOLIA_CHAIN_ID = Number(import.meta.env.VITE_SEPOLIA_CHAIN_ID ?? 11155111);
export const CREDITCOIN_CHAIN_ID = Number(import.meta.env.VITE_CREDITCOIN_CHAIN_ID ?? 102031);

export const SEPOLIA_RPC_URL = import.meta.env.VITE_SEPOLIA_RPC_URL as string;
export const CREDITCOIN_RPC_URL = (import.meta.env.VITE_CREDITCOIN_RPC_URL ??
  "https://rpc.cc3-testnet.creditcoin.network") as string;

export const TERRA_SESSION_ADDRESS = import.meta.env.VITE_TERRA_SESSION_ADDRESS as string;
export const TERRA_TOKEN_ADDRESS = import.meta.env.VITE_TERRA_TOKEN_ADDRESS as string;
export const TERRA_CHAIN_GAME_ADDRESS = import.meta.env.VITE_TERRA_CHAIN_GAME_ADDRESS as string;

/// Read-side backend (see ../../indexer) — the map/wallet reads go through this instead of raw
/// RPC so the app scales past a handful of concurrent players.
export const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL ?? "http://localhost:4000") as string;

export const SESSION_TYPE = {
  Bank: 0,
  Claim: 1,
  Attack: 2,
} as const;

export type SessionTypeName = keyof typeof SESSION_TYPE;
