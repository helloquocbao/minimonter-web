import { ethers } from "hardhat";
import { loadAddresses, saveAddresses, ADDRESSES_FILE } from "./addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying TerraSession to Sepolia with account:", deployer.address);

  const TerraSession = await ethers.getContractFactory("TerraSession");
  const session = await TerraSession.deploy();
  await session.waitForDeployment();

  const address = await session.getAddress();
  console.log("TerraSession deployed at:", address);

  const addresses = loadAddresses();
  addresses.sepolia = { ...addresses.sepolia, TerraSession: address };
  saveAddresses(addresses);

  console.log("Saved to", ADDRESSES_FILE);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
