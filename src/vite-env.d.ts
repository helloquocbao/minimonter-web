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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
