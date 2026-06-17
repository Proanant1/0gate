// Deploys FortressArena to 0G Galileo testnet.
// Usage: npm run deploy:testnet  (requires DEPLOYER_PRIVATE_KEY in .env)
const hre = require("hardhat");

async function main() {
  console.log("Deploying FortressArena to", hre.network.name, "...");

  const Arena = await hre.ethers.getContractFactory("FortressArena");
  const arena = await Arena.deploy();
  await arena.waitForDeployment();

  const address = await arena.getAddress();
  console.log("\n✓ FortressArena deployed to:", address);
  console.log("\nNext steps:");
  console.log("  1. Copy this address into .env.local as NEXT_PUBLIC_ARENA_ADDRESS");
  console.log("  2. View it on explorer: https://chainscan-galileo.0g.ai/address/" + address);
  console.log("  3. (optional) verify: npx hardhat verify --network testnet " + address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
