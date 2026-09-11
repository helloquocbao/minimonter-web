import { ethers } from "hardhat";
import { loadAddresses, saveAddresses, ADDRESSES_FILE } from "./addresses";

async function main() {
  const addresses = loadAddresses();
  const sourceSessionAddress = addresses.sepolia?.TerraSession;
  if (!sourceSessionAddress) {
    throw new Error(
      "TerraSession address not found. Run `npm run deploy:sepolia` first, or fill it in manually in deployed-addresses.json."
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying to Creditcoin CC3 Testnet with account:", deployer.address);

  const TerraChainGame = await ethers.getContractFactory("TerraChainGame");
  const game = await TerraChainGame.deploy();
  await game.waitForDeployment();
  const gameAddress = await game.getAddress();
  console.log("TerraChainGame deployed at:", gameAddress);

  console.log("Registering source session contract:", sourceSessionAddress);
  const tx = await game.registerSourceSessionContract(sourceSessionAddress);
  await tx.wait();
  console.log("Registered.");

  addresses.creditcoin = {
    ...addresses.creditcoin,
    TerraChainGame: gameAddress,
  };
  saveAddresses(addresses);

  console.log("Saved to", ADDRESSES_FILE);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
