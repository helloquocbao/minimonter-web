/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SEPOLIA_CHAIN_ID?: string;
  readonly VITE_CREDITCOIN_CHAIN_ID?: string;
  readonly VITE_SEPOLIA_RPC_URL: string;
  readonly VITE_CREDITCOIN_RPC_URL?: string;
  readonly VITE_TERRA_SESSION_ADDRESS: string;
  readonly VITE_TERRA_TOKEN_ADDRESS: string;
  readonly VITE_TERRA_CHAIN_GAME_ADDRESS: string;
  readonly VITE_INDEXER_URL?: string;
  // DEV / PROD / MODE / SSR are declared by vite/client's own ImportMetaEnv — this interface
  // merges with it (TS interface declaration merging), it does NOT replace it, so they're
  // still available even though they're not re-listed here explicitly.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
