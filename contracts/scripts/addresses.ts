import * as fs from "fs";
import * as path from "path";

/// Shared deploy-output file at the repo root so the worker and frontend packages can pick up
/// freshly deployed contract addresses without copy-pasting them by hand.
export const ADDRESSES_FILE = path.join(__dirname, "..", "..", "deployed-addresses.json");

export interface DeployedAddresses {
  sepolia?: { TerraSession?: string };
  creditcoin?: { TerraToken?: string; TerraChainGame?: string };
}

export function loadAddresses(): DeployedAddresses {
  if (fs.existsSync(ADDRESSES_FILE)) {
    return JSON.parse(fs.readFileSync(ADDRESSES_FILE, "utf-8"));
  }
  return {};
}

export function saveAddresses(addresses: DeployedAddresses): void {
  fs.writeFileSync(ADDRESSES_FILE, JSON.stringify(addresses, null, 2) + "\n");
}
