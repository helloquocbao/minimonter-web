import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Contract, EventLog, JsonRpcProvider, Wallet, keccak256, AbiCoder, Result } from "ethers";
import { proofProvider, chainInfo } from "@gluwa/usc-sdk";

import terraSessionAbi from "./abi/TerraSession.json";
import terraChainGameAbi from "./abi/TerraChainGame.json";

dotenv.config();

/// Relays proven `SessionRecorded` events from TerraSession (Sepolia) into TerraChainGame
/// (Creditcoin CC3 Testnet) via the Attestcoin Protocol. This process is permissionless by
/// design: anyone can run it, because the on-chain `execute()` call independently re-verifies
/// the cross-chain proof — a malicious or buggy relayer cannot forge game state, it can only
/// fail to relay real sessions promptly.
///
/// Sessions are processed CONCURRENTLY (bounded by MAX_CONCURRENT_SESSIONS), not one at a time.
/// Waiting for attestation is the slow part (minutes) but is independent per session — only the
/// final on-chain `execute()` submission needs to be serialized (a single wallet can't send two
/// transactions with the same nonce), which is handled by a small nonce queue below.

const POLLING_INTERVAL_MS = 15_000;
const ERROR_BACKOFF_MS = 15_000;
const MAX_LOG_BLOCK_RANGE = 500;
/// How many times an empty log query has to come back empty before it is believed. See
/// `queryLogsTrustingOnlyConfirmedEmpties`.
const EMPTY_RESULT_CONFIRMATIONS = 3;
const EMPTY_RESULT_RETRY_MS = 400;
const ACTION_PROCESS_SESSION = 0;
const DEFAULT_MAX_CONCURRENT_SESSIONS = 20;
/// How many times a session is re-attempted before giving up. Attestation waits and proof
/// generation both talk to external services, so a transient failure must not silently cost a
/// player the walk they actually did.
const MAX_SESSION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 30_000;
/// Where the last fully-scanned source-chain block is persisted. Without this, a restart would
/// resume from the CURRENT block and permanently skip every session recorded while the relayer
/// was down — the player paid gas and did the walk, but their territory would never appear.
const CHECKPOINT_FILE = path.join(__dirname, "..", ".relayer-checkpoint.json");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not configured`);
  return value;
}

function loadCheckpoint(): number | undefined {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    const block = Number(parsed?.lastScannedBlock);
    return Number.isFinite(block) && block > 0 ? block : undefined;
  } catch {
    return undefined;
  }
}

function saveCheckpoint(lastScannedBlock: number): void {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastScannedBlock }, null, 2));
  } catch (error: any) {
    // Non-fatal: losing the checkpoint only costs a re-scan, never correctness (execute() is
    // idempotent thanks to the on-chain replay guard).
    console.warn(`[checkpoint] could not persist progress: ${error.message}`);
  }
}

function loadDeployedAddress(chain: "sepolia" | "creditcoin", contractName: string): string | undefined {
  const file = path.join(__dirname, "..", "..", "deployed-addresses.json");
  if (!fs.existsSync(file)) return undefined;
  const addresses = JSON.parse(fs.readFileSync(file, "utf-8"));
  return addresses?.[chain]?.[contractName];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounds how many sessions have an in-flight attestation wait / proof fetch at once, so a burst
 *  of many players doesn't open hundreds of simultaneous long-polls against the proof builder. */
function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** Serializes only the final tx-send step across concurrent sessions, handing out sequential
 *  nonces in call order — everything before this (proof generation, attestation wait) stays
 *  fully parallel. A failed send doesn't block nonces for sessions queued behind it. */
function createNonceQueue(startNonce: number) {
  let nonce = startNonce;
  let tail: Promise<unknown> = Promise.resolve();

  return function withNonce<T>(fn: (nonce: number) => Promise<T>): Promise<T> {
    const reserved = nonce++;
    const result = tail.then(() => fn(reserved));
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

async function collectNewEvents(
  contract: Contract,
  eventName: string,
  fromBlock: number
): Promise<{ events: EventLog[]; nextFromBlock: number }> {
  const currentBlock = await contract.runner?.provider?.getBlockNumber();
  if (currentBlock === undefined || currentBlock < fromBlock) return { events: [], nextFromBlock: fromBlock };

  const events: EventLog[] = [];
  let start = fromBlock;
  while (start <= currentBlock) {
    const end = Math.min(start + MAX_LOG_BLOCK_RANGE - 1, currentBlock);
    const batch = await queryLogsTrustingOnlyConfirmedEmpties(contract, eventName, start, end);
    for (const event of batch) {
      if (event instanceof EventLog) events.push(event);
    }
    start = end + 1;
  }

  return { events, nextFromBlock: currentBlock + 1 };
}

/// Reads one block range, and refuses to believe an empty answer the first time.
///
/// Public RPC endpoints sit behind a load balancer, and not every node behind it keeps full
/// history. A pruned one answers a query for an old range with an empty list rather than an
/// error — measured on ethereum-sepolia-rpc.publicnode.com, 2 in 5 identical queries for a range
/// containing 11 known events came back with 0.
///
/// That is worse than an error, because the caller advances and persists the scan checkpoint past
/// the range, so those sessions are skipped permanently: the player walked, paid gas on Sepolia,
/// and their territory would never appear. It is the same failure the checkpoint was introduced to
/// prevent, arriving through a different door.
///
/// A node cannot invent events, so a non-empty answer is trusted immediately. Only an empty one is
/// re-read, and it has to come back empty every time before it is accepted.
///
/// This is mitigation, not a cure — the real fix is a reliable archive RPC (or several, behind
/// ethers' FallbackProvider with a quorum, once more than one endpoint is configured).
async function queryLogsTrustingOnlyConfirmedEmpties(
  contract: Contract,
  eventName: string,
  start: number,
  end: number
): Promise<Awaited<ReturnType<Contract["queryFilter"]>>> {
  for (let attempt = 1; attempt <= EMPTY_RESULT_CONFIRMATIONS; attempt++) {
    const batch = await contract.queryFilter(eventName, start, end);
    if (batch.length > 0) {
      if (attempt > 1) {
        console.warn(
          `[rpc] blocks ${start}-${end} first read as empty, then returned ${batch.length} log(s) — ` +
            `the endpoint is serving incomplete history. Using the non-empty result.`
        );
      }
      return batch;
    }
    if (attempt < EMPTY_RESULT_CONFIRMATIONS) await sleep(EMPTY_RESULT_RETRY_MS);
  }
  return [];
}

async function generateProofFor(
  txHash: string,
  chainKey: number,
  proofBuilderUrl: string,
  creditcoinRpc: JsonRpcProvider,
  sourceChainRpc: JsonRpcProvider
): Promise<proofProvider.ProofResult> {
  const receipt = await sourceChainRpc.waitForTransaction(txHash, 1, 120_000);
  if (!receipt || receipt.blockNumber == null) {
    throw new Error(`Transaction ${txHash} is not yet mined on source chain`);
  }

  const blockNumber = receipt.blockNumber;
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoinRpc);

  const latestAttested = await info.getLatestAttestedHeightAndHash(chainKey);
  console.log(
    `[proof] tx ${txHash} in block ${blockNumber}. Latest attested height for chain key ${chainKey}: ${latestAttested.height}. Waiting for attestation (can take several minutes)...`
  );

  // Attestation on Creditcoin lands roughly every ~8 minutes in practice; we wait generously.
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber, 15_000, 1_200_000);

  console.log(`[proof] Block ${blockNumber} attested. Generating proof for ${txHash}...`);
  return proofBuilder.getProof(txHash);
}

async function computeGasLimit(
  provider: JsonRpcProvider,
  contract: Contract,
  data: string,
  from: string,
  continuityLength: number
): Promise<bigint> {
  try {
    const estimatedGas = await provider.estimateGas({ to: await contract.getAddress(), data, from });
    return (estimatedGas * 135n) / 100n;
  } catch (error: any) {
    // Gas estimation on the precompile path can fail even when the real call would succeed —
    // fall back to a size-based estimate (mirrors the reference worker implementation).
    console.warn(`[gas] estimation failed (${error.shortMessage ?? error.message}); using fallback estimate`);
    return BigInt(21_000 + continuityLength * 5_000 + 20_000);
  }
}

async function submitSessionProof(
  gameContract: Contract,
  gameProvider: JsonRpcProvider,
  fromAddress: string,
  proofData: proofProvider.ContinuityResponse,
  nonce: number
) {
  const iface = gameContract.interface;
  const funcFragment = iface.getFunction(
    "execute(uint8,uint64,uint64,bytes,bytes32,tuple(bytes32,bool)[],bytes32,bytes32[])"
  );

  const params = [
    ACTION_PROCESS_SESSION,
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof.root,
    proofData.merkleProof.siblings,
    proofData.continuityProof.lowerEndpointDigest,
    proofData.continuityProof.roots,
  ];

  const data = iface.encodeFunctionData(funcFragment!, params);
  const continuityBlocks = proofData.continuityProof.roots?.length || 1;
  const gasLimit = await computeGasLimit(gameProvider, gameContract, data, fromAddress, continuityBlocks);

  return gameContract.execute(...params, { gasLimit, nonce });
}

/// Bot attacks are permissionless and unlock purely from on-chain activity (see
/// TerraChainGame's commitBotAttack/revealBotAttack) — this relayer just happens to be a
/// convenient, always-on process to drive the two-step commit-reveal promptly. Anyone else
/// could call either function; nothing here is special or trusted beyond what the contract
/// itself enforces. Each polling tick either opens a new commit (if none is pending and enough
/// sessions have accumulated) or resolves one that's ready to reveal — never both in the same
/// tick, since committing and revealing in the same transaction would defeat the whole point.
async function maybeTriggerBotAttack(ctx: SessionContext): Promise<void> {
  try {
    const revealReady: boolean = await ctx.gameContract.botAttackRevealReady();
    if (revealReady) {
      console.log("[bot] pending commit is revealable — calling revealBotAttack()...");
      const response = await ctx.withNonce((nonce) => ctx.gameContract.revealBotAttack({ nonce }));
      const receipt = await response.wait();
      console.log(`[bot] revealBotAttack() landed -> Creditcoin tx ${receipt?.hash}`);
      return;
    }

    const commitReady: boolean = await ctx.gameContract.botAttackReady();
    if (!commitReady) return;

    console.log("[bot] enough sessions accumulated — calling commitBotAttack()...");
    const response = await ctx.withNonce((nonce) => ctx.gameContract.commitBotAttack({ nonce }));
    const receipt = await response.wait();
    console.log(`[bot] commitBotAttack() landed -> Creditcoin tx ${receipt?.hash} (will reveal next tick)`);
  } catch (error: any) {
    console.error(`[bot] commit/reveal step failed: ${error.shortMessage ?? error.message}`);
  }
}

interface SessionContext {
  sessionContract: Contract;
  gameContract: Contract;
  creditcoinProvider: JsonRpcProvider;
  sourceProvider: JsonRpcProvider;
  creditcoinWalletAddress: string;
  proofBuilderUrl: string;
  sourceChainKey: number;
  withNonce: ReturnType<typeof createNonceQueue>;
}

async function processSession(event: EventLog, ctx: SessionContext): Promise<void> {
  const txHash = event.transactionHash;
  const args = event.args as unknown as Result;
  const player = args.player as string;
  const sessionId = args.sessionId as bigint;

  const replayKey = keccak256(AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [player, sessionId]));
  const alreadyProcessed = await ctx.gameContract.processedSessions(replayKey);
  if (alreadyProcessed) {
    console.log(`[skip] session ${sessionId} for ${player} already processed on Creditcoin`);
    return;
  }

  console.log(`[detect] SessionRecorded: player=${player} sessionId=${sessionId} tx=${txHash}`);

  const proofResult = await generateProofFor(
    txHash,
    ctx.sourceChainKey,
    ctx.proofBuilderUrl,
    ctx.creditcoinProvider,
    ctx.sourceProvider
  );

  if (!proofResult.success || !proofResult.data) {
    // Thrown (not just logged) so the retry wrapper gets a chance — proof generation failing is
    // very often transient (attestation not landed yet, proof builder hiccup).
    throw new Error(`proof generation failed: ${proofResult.error}`);
  }

  const response = await ctx.withNonce((nonce) =>
    submitSessionProof(ctx.gameContract, ctx.creditcoinProvider, ctx.creditcoinWalletAddress, proofResult.data!, nonce)
  );
  const receipt = await response.wait();
  console.log(`[relayed] tx ${txHash} -> Creditcoin tx ${receipt?.hash}`);
}

/// Retries a session a bounded number of times with exponential backoff. Every step in
/// {processSession} is safe to repeat: the on-chain replay guard makes execute() idempotent, and
/// the first thing processSession does is re-check whether the session already landed. Without
/// this, one transient RPC/proof-builder blip would permanently cost a player a walk they
/// actually did — which is the worst possible failure mode for a move-to-earn game.
async function processSessionWithRetries(event: EventLog, ctx: SessionContext): Promise<void> {
  const txHash = event.transactionHash;

  for (let attempt = 1; attempt <= MAX_SESSION_ATTEMPTS; attempt++) {
    try {
      await processSession(event, ctx);
      return;
    } catch (error: any) {
      const message = error.shortMessage ?? error.message;
      if (attempt === MAX_SESSION_ATTEMPTS) {
        console.error(`[give-up] tx ${txHash} failed after ${attempt} attempts: ${message}`);
        return;
      }
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[retry ${attempt}/${MAX_SESSION_ATTEMPTS}] tx ${txHash}: ${message} — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

async function main() {
  const proofBuilderUrl = requireEnv("PROOF_BUILDER_URL");
  const sourceChainRpcUrl = requireEnv("SOURCE_CHAIN_RPC_URL");
  const creditcoinRpcUrl = requireEnv("CREDITCOIN_RPC_URL");
  const privateKey = requireEnv("CREDITCOIN_WALLET_PRIVATE_KEY");
  const sourceChainKey = Number(requireEnv("SOURCE_CHAIN_KEY"));
  const maxConcurrentSessions = Number(process.env.MAX_CONCURRENT_SESSIONS) || DEFAULT_MAX_CONCURRENT_SESSIONS;

  const sessionContractAddress =
    process.env.TERRA_SESSION_CONTRACT_ADDRESS || loadDeployedAddress("sepolia", "TerraSession");
  const gameContractAddress =
    process.env.TERRA_CHAIN_GAME_CONTRACT_ADDRESS || loadDeployedAddress("creditcoin", "TerraChainGame");

  if (!sessionContractAddress) throw new Error("TerraSession address not found (env or deployed-addresses.json)");
  if (!gameContractAddress) throw new Error("TerraChainGame address not found (env or deployed-addresses.json)");

  const sourceProvider = new JsonRpcProvider(sourceChainRpcUrl);
  const creditcoinProvider = new JsonRpcProvider(creditcoinRpcUrl);
  const creditcoinWallet = new Wallet(privateKey, creditcoinProvider);

  const sessionContract = new Contract(sessionContractAddress, terraSessionAbi, sourceProvider);
  const gameContract = new Contract(gameContractAddress, terraChainGameAbi, creditcoinWallet);

  console.log("TerraChain relayer starting...");
  console.log(`  Source (Sepolia)    TerraSession    @ ${sessionContractAddress}`);
  console.log(`  Target (Creditcoin) TerraChainGame  @ ${gameContractAddress}`);
  console.log(`  Relayer address: ${creditcoinWallet.address}`);
  console.log(`  Max concurrent sessions: ${maxConcurrentSessions}`);

  const startNonce = await creditcoinProvider.getTransactionCount(creditcoinWallet.address, "pending");
  const withNonce = createNonceQueue(startNonce);
  const limiter = createLimiter(maxConcurrentSessions);
  const ctx: SessionContext = {
    sessionContract,
    gameContract,
    creditcoinProvider,
    sourceProvider,
    creditcoinWalletAddress: creditcoinWallet.address,
    proofBuilderUrl,
    sourceChainKey,
    withNonce,
  };

  // Resume exactly where the previous run left off. Falling back to WORKER_START_BLOCK (then to
  // the current head) only matters on a genuinely fresh install — after that the checkpoint is
  // authoritative, so no session recorded during downtime is ever skipped.
  const checkpoint = loadCheckpoint();
  const configuredStart = Number(process.env.WORKER_START_BLOCK);
  let fromBlock =
    checkpoint ??
    (Number.isFinite(configuredStart) && configuredStart > 0
      ? configuredStart
      : await sourceProvider.getBlockNumber());
  console.log(
    `  Resuming source-chain scan from block ${fromBlock}` +
      (checkpoint ? " (restored from checkpoint)" : " (no checkpoint yet)")
  );

  const inFlight = new Set<string>();

  while (true) {
    try {
      const { events, nextFromBlock } = await collectNewEvents(sessionContract, "SessionRecorded", fromBlock);

      for (const event of events) {
        const txHash = event.transactionHash;
        if (inFlight.has(txHash)) continue;
        inFlight.add(txHash);

        // Fire and forget: the outer loop keeps polling for new events immediately instead of
        // waiting minutes for this session's attestation. Errors are handled inside (with
        // retries) so nothing here can produce an unhandled rejection.
        void limiter(() => processSessionWithRetries(event, ctx)).finally(() => inFlight.delete(txHash));
      }

      // Only advance (and persist) the scan window once the events in it have been handed off to
      // the limiter, so a crash mid-batch replays that batch rather than losing it.
      fromBlock = nextFromBlock;
      saveCheckpoint(fromBlock);

      // Cheap on-chain read (no waiting on attestation) — safe to check every polling tick.
      await maybeTriggerBotAttack(ctx);
    } catch (error: any) {
      console.error(`[error] polling loop: ${error.shortMessage ?? error.message}`);
      await sleep(ERROR_BACKOFF_MS);
    }

    await sleep(POLLING_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
