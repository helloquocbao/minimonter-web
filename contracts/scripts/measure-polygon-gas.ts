import { ethers } from "hardhat";

/**
 * Measures the gas cost of a Claim as polygon vertex count grows, with neighbouring chunks
 * present so the polygon-vs-polygon intersection work is actually exercised (that's the part
 * that scales as O(nA * nB), i.e. quadratically in vertex count).
 *
 * Run: npx hardhat run scripts/measure-polygon-gas.ts
 */

const M = 1_000_000;

/** Circle-ish polygon with `n` vertices, radius `radiusMicroDeg`, centred on (lat, lng). Mimics
 *  the shape a real GPS walk simplifies down to far better than a square does. */
function ring(latMicro: number, lngMicro: number, radiusMicroDeg: number, n: number) {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    lats.push(Math.round(latMicro + radiusMicroDeg * Math.sin(angle)));
    lngs.push(Math.round(lngMicro + radiusMicroDeg * Math.cos(angle)));
  }
  return { lats, lngs };
}

async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();
  const Harness = await ethers.getContractFactory("TerraChainGameHarness");
  const game = await Harness.deploy();

  console.log("vertices | neighbours | gas used | notes");
  console.log("---------|------------|----------|------");

  for (const vertexCount of [4, 8, 16, 24, 32, 48]) {
    // Fresh contract per measurement so neighbour counts are controlled.
    const g = await (await ethers.getContractFactory("TerraChainGameHarness")).deploy();

    // Plant 4 neighbouring bases owned by someone else, close enough to land in the same 3x3
    // cell neighbourhood (so every one of them gets an exact intersection test against the
    // incoming polygon) but far enough not to overlap it.
    const NEIGHBOURS = 4;
    for (let i = 0; i < NEIGHBOURS; i++) {
      const offset = 6000 + i * 6000;
      const poly = ring(offset, 0, 1200, vertexCount);
      await g.exposeHandleClaim(bob.address, 1000 + i, poly.lats, poly.lngs, 900);
    }

    const target = ring(0, 0, 1200, vertexCount);
    const tx = await g.exposeHandleClaim(alice.address, 9999, target.lats, target.lngs, 900);
    const receipt = await tx.wait();

    const base = await g.bases(NEIGHBOURS + 1);
    const landed = base.owner === alice.address;
    console.log(
      `${String(vertexCount).padStart(8)} | ${String(NEIGHBOURS).padStart(10)} | ` +
        `${receipt!.gasUsed.toString().padStart(8)} | ${landed ? "claimed ok" : "REJECTED"}`
    );
  }

  console.log(
    "\nFor reference: a typical EVM block gas limit is 30M, and this is only the game-logic\n" +
      "portion — the real transaction also pays for Attestcoin proof verification on top."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
