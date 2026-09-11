export const SEPOLIA_CHAIN_ID = Number(import.meta.env.VITE_SEPOLIA_CHAIN_ID ?? 11155111);
export const CREDITCOIN_CHAIN_ID = Number(import.meta.env.VITE_CREDITCOIN_CHAIN_ID ?? 102031);

export const SEPOLIA_RPC_URL = import.meta.env.VITE_SEPOLIA_RPC_URL as string;
export const CREDITCOIN_RPC_URL = (import.meta.env.VITE_CREDITCOIN_RPC_URL ??
  "https://rpc.cc3-testnet.creditcoin.network") as string;

export const TERRA_SESSION_ADDRESS = import.meta.env.VITE_TERRA_SESSION_ADDRESS as string;
export const TERRA_CHAIN_GAME_ADDRESS = import.meta.env.VITE_TERRA_CHAIN_GAME_ADDRESS as string;

/// Read-side backend (see ../../indexer) — the map/wallet reads go through this instead of raw
/// RPC so the app scales past a handful of concurrent players.
export const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL ?? "http://localhost:4000") as string;

/// Mapbox GL JS public access token — required to render the map (Mapbox Standard style with
/// built-in 3D buildings/terrain). Create a free account at https://account.mapbox.com/.
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

export const SESSION_TYPE = {
  Claim: 0,
  Reinforce: 1,
} as const;

export type SessionTypeName = keyof typeof SESSION_TYPE;
