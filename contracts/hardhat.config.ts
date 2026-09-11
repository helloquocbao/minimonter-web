import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.CREDITCOIN_WALLET_PRIVATE_KEY || "0x" + "11".repeat(32);
const SEPOLIA_RPC_URL = process.env.SOURCE_CHAIN_RPC_URL || "";
const CREDITCOIN_RPC_URL =
  process.env.CREDITCOIN_RPC_URL || "https://rpc.cc3-testnet.creditcoin.network";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Required: ASCBase + EvmV1Decoder hit "stack too deep" without via_ir.
      viaIR: true,
      evmVersion: "shanghai",
    },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
    },
    creditcoin: {
      url: CREDITCOIN_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 102031,
    },
  },
};

export default config;
