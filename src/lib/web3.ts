import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import {
  CREDITCOIN_CHAIN_ID,
  CREDITCOIN_RPC_URL,
  SEPOLIA_CHAIN_ID,
  TERRA_CHAIN_GAME_ADDRESS,
  TERRA_SESSION_ADDRESS,
  TERRA_TOKEN_ADDRESS,
} from "../config";
import terraSessionAbi from "../abi/TerraSession.json";
import terraChainGameAbi from "../abi/TerraChainGame.json";
import terraTokenAbi from "../abi/TerraToken.json";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const NETWORK_PARAMS: Record<number, object> = {
  [SEPOLIA_CHAIN_ID]: {
    chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
    chainName: "Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
  [CREDITCOIN_CHAIN_ID]: {
    chainId: `0x${CREDITCOIN_CHAIN_ID.toString(16)}`,
    chainName: "Creditcoin CC3 Testnet",
    nativeCurrency: { name: "testnet Creditcoin", symbol: "tCTC", decimals: 18 },
    rpcUrls: [CREDITCOIN_RPC_URL],
    blockExplorerUrls: ["https://creditcoin-testnet.blockscout.com"],
  },
};

export function getEthereum() {
  if (!window.ethereum) throw new Error("Không tìm thấy wallet (MetaMask). Vui lòng cài đặt extension.");
  return window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const ethereum = getEthereum();
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  return accounts[0];
}

export async function switchToChain(chainId: number): Promise<void> {
  const ethereum = getEthereum();
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 4902 && NETWORK_PARAMS[chainId]) {
      await ethereum.request({ method: "wallet_addEthereumChain", params: [NETWORK_PARAMS[chainId]] });
    } else {
      throw error;
    }
  }
}

export async function getBrowserProvider(): Promise<BrowserProvider> {
  return new BrowserProvider(getEthereum());
}

export function getCreditcoinReadProvider(): JsonRpcProvider {
  return new JsonRpcProvider(CREDITCOIN_RPC_URL);
}

export async function getTerraSessionWriteContract(): Promise<Contract> {
  const provider = await getBrowserProvider();
  const signer = await provider.getSigner();
  return new Contract(TERRA_SESSION_ADDRESS, terraSessionAbi, signer);
}

export async function getTerraChainGameWriteContract(): Promise<Contract> {
  const provider = await getBrowserProvider();
  const signer = await provider.getSigner();
  return new Contract(TERRA_CHAIN_GAME_ADDRESS, terraChainGameAbi, signer);
}

export async function getTerraTokenWriteContract(): Promise<Contract> {
  const provider = await getBrowserProvider();
  const signer = await provider.getSigner();
  return new Contract(TERRA_TOKEN_ADDRESS, terraTokenAbi, signer);
}

export function getTerraChainGameReadContract(): Contract {
  return new Contract(TERRA_CHAIN_GAME_ADDRESS, terraChainGameAbi, getCreditcoinReadProvider());
}
