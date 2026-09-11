// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title TerraChainGame
/// @notice Deployed on Creditcoin CC3 Testnet. Holds all game state. Every state change is
///         triggered either by a proven `SessionRecorded` event from the {TerraSession}
///         contract on Sepolia (verified trustlessly through the Attestcoin Protocol via
///         {ASCBase}), or by {botAttack}, a permissionless call anyone can trigger once enough
///         on-chain activity has accumulated.
///
/// Game rules (Phase 1 — territory painting, no player-vs-player combat):
///  - Claim:     walk a closed loop (any shape, not just a circle) around ground that isn't
///               already someone else's. If the loop touches/overlaps one of YOUR OWN existing
///               Bases, it's attached to that Base as an extra chunk (the Base's territory
///               grows by the new chunk's area). Otherwise it plants a brand-new Base. Rejected
///               if the loop overlaps any Base belonging to someone else.
///  - Reinforce: walk a closed loop that encloses (the center of) at least one chunk of your OWN
///               Base; on success it fully restores that Base's territory back to 100% of its
///               current total (initialAreaMeters), undoing any bot damage.
///  - Km cap:    every player has a per-session walking cap that only ever grows, based on
///               CUMULATIVE distance walked across all their sessions (no purchases, no wallet
///               to manage — it's a permanent, one-way progression).
///  - Bots:      there are no other players to fight. Instead, once the contract has processed
///               BOT_ATTACK_TX_INTERVAL successful sessions since the last bot attack, anyone
///               can call {botAttack} to trigger one: it picks a pseudo-random existing Base
///               (seeded by recent block data) and destroys a pseudo-random fraction of its
///               current territory. A Base whose territory is fully destroyed loses the ground
///               entirely (freed back to unclaimed, all its chunks removed) until someone
///               claims it again.
///
/// Each walked loop is a real polygon (up to MAX_POLYGON_POINTS vertices, simplified from the
/// raw GPS path client-side) rather than a circle approximation — area is computed with the
/// Shoelace formula and overlap/containment with proper polygon geometry (segment intersection +
/// point-in-polygon), so oddly-shaped real walking loops are represented faithfully.
///
/// A Base's territory can be made of multiple chunks (one per Claim that extended it) instead of
/// a single merged shape — computing an exact polygon union on-chain is prohibitively complex,
/// so a Base's displayed/total area is simply the sum of its chunks' areas (chunks belonging to
/// the same Base are expected not to self-overlap significantly; a player has no incentive to
/// walk back over their own ground since it doesn't add territory).
///
/// Bases are bucketed into a lat/lng grid by each chunk's bounding-box center (see
/// _nearbyChunkIds) so overlap checks only ever scan a 3x3 cell neighborhood instead of every
/// chunk ever claimed — this is what keeps gas cost roughly constant as the world fills up with
/// players instead of growing linearly with total chunk count.
///
/// Sponsored Zones — local monetization layer (DePIN incentive/settlement):
/// Anyone (typically a local business) can pay native CTC to sponsor a circular zone for a
/// fixed duration. Every successful Claim/Reinforce whose location falls inside an active zone
/// automatically pays out a share of that zone's pool, split evenly across the zone's declared
/// `expectedSessions` — turning real foot traffic (the same walking sessions that power the
/// game) into a source of real payouts, and turning the underlying GPS "sensor network" into
/// something a business will actually pay to tap into. A PLATFORM_FEE_BPS cut of each payout
/// goes to `feeRecipient` (defaults to the contract owner) as the protocol's revenue.
///
/// Sybil resistance (see _payoutSponsoredZones): the classic DePIN "one real person pretending
/// to be many claimants" problem is handled with a geometric decay on repeat payouts to the
/// SAME address in the SAME zone, plus a cooldown — no KYC/identity oracle needed, farming a
/// single zone with one address just stops being worth it long before it drains the pool.
///
/// Bot attack randomness (see commitBotAttack/revealBotAttack): rather than resolving in one
/// transaction off `blockhash(block.number - 1)` (a value already knowable — and, for a block
/// producer, fully controllable — at the moment the triggering transaction is chosen to land),
/// this uses a two-step commit-reveal so the entropy source doesn't exist yet at commit time
/// and can no longer be un-mined by the time it's revealed.
contract TerraChainGame is ASCBase {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @dev Only one action type is ever proven through this ASC: a session from TerraSession.
    uint8 public constant ACTION_PROCESS_SESSION = 0;

    /// @dev Mirrors TerraSession.SessionType.
    uint8 public constant SESSION_CLAIM = 0;
    uint8 public constant SESSION_REINFORCE = 1;

    /// @dev Mirrors TerraSession.{MAX,MIN}_POLYGON_POINTS.
    uint8 public constant MAX_POLYGON_POINTS = 32;
    uint8 public constant MIN_POLYGON_POINTS = 3;

    bytes32 public constant SESSION_EVENT_SIGNATURE =
        keccak256("SessionRecorded(address,uint8,int32[],int32[],uint32,uint32,uint256)");

    /// @dev Basic anti-spoofing: reject sessions faster than ~21.6 km/h sustained average.
    uint32 public constant MAX_SPEED_METERS_PER_SECOND = 6;

    uint32 public constant MIN_CLAIM_METERS = 200; // must walk >=200m to plant/extend a base

    /// @dev Flat-earth approximation for converting a lat/lng difference (in micro-degrees) to
    ///      meters, ignoring the cos(latitude) longitude correction. Good enough for city-scale
    ///      geometry in a hackathon MVP — not survey-grade geodesy.
    int256 public constant METERS_PER_DEGREE = 111_320;

    /// @dev Claim/Reinforce loops are capped so a chunk's bounding box can never span more than
    ///      roughly one grid cell — that's what keeps the 3x3-neighborhood spatial index below
    ///      from missing a real overlap (see {_nearbyChunkIds}). ~6km is already far beyond a
    ///      realistic single walk.
    uint32 public constant MAX_LOOP_METERS = 6_000;

    /// @dev Spatial index bucket size, in micro-degrees (~2003m, via the same flat-earth
    ///      approximation as {METERS_PER_DEGREE}).
    int32 public constant CELL_SIZE_MICRO_DEGREES = 17_966; // = 2_000 * 1_000_000 / METERS_PER_DEGREE

    /// @notice Km-cap progression: free per-session cap, plus how much it grows per level, plus
    ///         how much CUMULATIVE distance (across all of a player's sessions) is needed to
    ///         reach the next level. Growth is permanent and automatic — nothing to buy.
    uint32 public constant BASE_LOOP_CAP_METERS = 1_000; // level 0: up to 1km per session
    uint32 public constant LOOP_CAP_GROWTH_PER_LEVEL = 500; // +500m per level
    uint32 public constant METERS_PER_LEVEL = 5_000; // every 5km walked (cumulative) = +1 level
    uint32 public constant MAX_LOOP_CAP_LEVELS = 10; // caps growth at +5000m (i.e. 6000m total)

    /// @notice How many successful sessions (Claim/Reinforce) must be processed, counted since
    ///         the last bot attack, before {botAttack} is allowed to fire again.
    uint256 public constant BOT_ATTACK_TX_INTERVAL = 20;

    /// @notice Bot destroys somewhere between MIN and MAX percent of a Base's CURRENT territory
    ///         per attack, chosen pseudo-randomly from on-chain entropy.
    uint256 public constant BOT_MIN_DAMAGE_PERCENT = 10;
    uint256 public constant BOT_MAX_DAMAGE_PERCENT = 40;

    /// @notice Sponsored Zones — local monetization layer.
    uint256 public constant PLATFORM_FEE_BPS = 500; // 5% of every payout, in basis points (1/100 of 1%)
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @dev Capped at one grid cell's size so the zone spatial index only ever has to scan a
    ///      3x3 cell neighborhood (see {_nearbyZoneIds}) — same bound, same reasoning as
    ///      MAX_LOOP_METERS does for chunks. 2km is already a generous catchment area for a
    ///      local business (~12.5 km²).
    uint32 public constant MAX_ZONE_RADIUS_METERS = 2_000;
    uint32 public constant MIN_ZONE_DURATION_DAYS = 1;
    uint32 public constant MAX_ZONE_DURATION_DAYS = 365;
    uint32 public constant MIN_ZONE_EXPECTED_SESSIONS = 1;
    uint32 public constant MAX_ZONE_EXPECTED_SESSIONS = 100_000;
    /// @notice Minimum pool a sponsor must fund a zone with. Set high enough that a zone is a
    ///         meaningful commitment rather than dust: it keeps per-session rewards worth walking
    ///         for, and stops the zone list from filling up with throwaway 1-wei entries.
    ///         (`ether` here is just the 1e18 unit suffix — the value is native CTC.)
    uint256 public constant MIN_ZONE_POOL = 200 ether;
    /// @notice Max length of a zone's sponsor-supplied display name, in bytes. A zone exists to
    ///         market a business, so the name is what players actually read off the map — but it
    ///         is emitted on-chain and rendered in other players' clients, so it's capped to
    ///         keep creation gas bounded and to stop a sponsor from pushing a wall of text into
    ///         everyone's UI. 32 bytes fits any real shop name; note it's *bytes*, so non-ASCII
    ///         names (Vietnamese, Korean) get fewer visible characters.
    uint256 public constant MAX_ZONE_NAME_BYTES = 32;

    /// @dev Valid coordinate bounds in micro-degrees. Enforced everywhere untrusted coordinates
    ///      enter the contract, so downstream integer math (bounding-box midpoints, Shoelace
    ///      area, squared distances) can never overflow int32/int256 on absurd input.
    int32 public constant MAX_ABS_LAT_MICRO_DEGREES = 90_000_000;
    int32 public constant MAX_ABS_LNG_MICRO_DEGREES = 180_000_000;

    /// @notice Sybil resistance for Sponsored Zone payouts. A single address farming the same
    ///         zone over and over (the classic DePIN "one real person, many fake claims"
    ///         problem) gets diminishing rewards instead of a flat payout every time: the Nth
    ///         payout to the same address in the same zone is scaled by
    ///         SYBIL_DECAY_BPS^(N-1), floored at SYBIL_MIN_PAYOUT_BPS. This doesn't require any
    ///         identity/KYC provider — it just makes recruiting genuinely new walkers strictly
    ///         more profitable than re-running the same address, without ever blocking a
    ///         legitimate repeat visitor outright.
    uint256 public constant SYBIL_DECAY_BPS = 6_000; // each repeat payout to the same address is 60% of the previous
    uint256 public constant SYBIL_MIN_PAYOUT_BPS = 1_000; // decay floors at 10% of the base reward, never hits zero
    /// @dev Minimum time between two payouts to the same address in the same zone — blocks
    ///      rapid-fire automated farming even before the decay curve bites hard.
    uint256 public constant SYBIL_COOLDOWN_SECONDS = 30 minutes;

    /// @notice Commit-reveal window for {commitBotAttack}/{revealBotAttack} — the entropy
    ///         source (blockhash of the commit block) must be revealed within this many blocks,
    ///         mirroring the EVM's own 256-block blockhash lookback limit; a stale commit can be
    ///         cleared and retried via {commitBotAttack} again rather than getting stuck forever.
    uint256 public constant REVEAL_WINDOW_BLOCKS = 256;

    /// @notice Duels — simple, opt-in PvP: two players wager native CTC on who walks further
    ///         (across their normal Claim/Reinforce sessions) within a time window. No combat,
    ///         no territory at risk — just a friendly race that both sides had to explicitly
    ///         agree to. See {challengeDuel}/{acceptDuel}/{settleDuel}.
    uint256 public constant MIN_DUEL_DURATION_HOURS = 1;
    uint256 public constant MAX_DUEL_DURATION_HOURS = 168; // 1 week
    /// @dev How long a challenge stays open for the opponent to accept before it can be
    ///      cancelled and the stake refunded to the challenger.
    uint256 public constant DUEL_ACCEPT_WINDOW_HOURS = 48;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Player {
        uint32 cumulativeMeters; // total distance ever walked across all sessions, in meters
    }

    /// @notice One walked polygon that belongs to a Base. A Base is the sum of one or more
    ///         chunks — each successful Claim that extends an existing Base (by touching it)
    ///         adds one more chunk instead of trying to compute an exact polygon union.
    struct Chunk {
        uint256 baseId;
        int32[] lats;
        int32[] lngs;
        uint32 areaMeters;
        // Bounding box, precomputed at write time — used both for the spatial index and as a
        // cheap broad-phase rejection before the exact polygon intersection test.
        int32 minLat;
        int32 maxLat;
        int32 minLng;
        int32 maxLng;
    }

    struct Base {
        address owner;
        uint32 initialAreaMeters; // sum of chunk areas at the moment of the last full restore
        uint32 currentAreaMeters; // territory area right now — reduced by bot damage
        uint256[] chunkIds;
        uint256 lastActionAt;
    }

    /// @notice A local business (or anyone) pays native CTC to sponsor a circular zone for a
    ///         fixed window. Every successful Claim/Reinforce inside the zone while it's active
    ///         pays out `rewardPerSession` (pool split evenly across `expectedSessions`) to the
    ///         player, minus the platform fee. Overlapping zones pay out independently — a
    ///         single session can trigger payouts from every active zone it falls inside.
    struct SponsoredZone {
        address sponsor;
        int32 lat;
        int32 lng;
        uint32 radiusMeters;
        uint256 rewardPerSession; // pool / expectedSessions, precomputed at creation
        uint256 remainingPool; // decreases by rewardPerSession (gross, before fee) per payout
        uint32 sessionsPaid;
        uint32 expectedSessions;
        uint256 endsAt; // unix timestamp
        bool withdrawn; // true once the sponsor has reclaimed any unused pool after expiry
        // NOTE: the sponsor's display name is deliberately NOT stored here — see
        // `createSponsoredZone`. It's emitted in SponsoredZoneCreated instead.
    }

    enum DuelStatus {
        Pending, // challenged, waiting for the opponent to accept
        Active, // accepted, race is on until endsAt
        Settled, // resolved — a winner was paid (or it was a tie, split evenly)
        Cancelled // challenger cancelled an unaccepted challenge, or it expired unaccepted
    }

    /// @notice A friendly, opt-in wager between two players on who walks further (via normal
    ///         Claim/Reinforce sessions) within a fixed time window. No territory or Base is
    ///         ever at risk — this only moves a CTC stake between the two participants. See
    ///         {challengeDuel}/{acceptDuel}/{settleDuel}.
    struct Duel {
        address challenger;
        address opponent;
        uint256 stake; // wagered by EACH side — total pool is stake * 2
        uint256 durationSeconds;
        uint256 challengedAt; // set at creation — used for the accept-window deadline
        uint256 startedAt; // set when accepted; 0 while still Pending
        uint32 challengerStartMeters; // challenger's cumulativeMeters snapshotted at accept time
        uint32 opponentStartMeters; // opponent's cumulativeMeters snapshotted at accept time
        DuelStatus status;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The only TerraSession contract (on Sepolia) whose events this ASC will accept.
    address public sourceSessionContract;
    address public owner;
    /// @notice Recipient of the PLATFORM_FEE_BPS cut of every Sponsored Zone payout. Defaults
    ///         to `owner` but can be redirected (e.g. to a treasury contract) via
    ///         {setFeeRecipient}.
    address public feeRecipient;

    mapping(address => Player) public players;
    mapping(uint256 => Base) public bases;
    uint256 public nextBaseId = 1;

    mapping(uint256 => Chunk) public chunks;
    uint256 public nextChunkId = 1;

    mapping(uint256 => SponsoredZone) public sponsoredZones;
    uint256 public nextZoneId = 1;
    /// @dev Spatial index for zones, bucketed by the zone centre's grid cell — the exact same
    ///      trick the chunk index uses. Without this, {_payoutSponsoredZones} would have to scan
    ///      EVERY zone ever created on every single Claim/Reinforce, which anyone could weaponise
    ///      into a permanent denial of service by cheaply spamming thousands of tiny zones (zone
    ///      creation is permissionless by design). MAX_ZONE_RADIUS_METERS <= one cell width is
    ///      what guarantees a 3x3 neighbourhood scan can never miss a zone that contains the
    ///      session's location.
    mapping(int32 => mapping(int32 => uint256[])) private _zoneIdsByCell;

    /// @notice Payouts that couldn't be pushed to their recipient (a contract that rejects ETH,
    ///         runs out of gas in its receive hook, etc.) are credited here instead of either
    ///         being lost or blocking the surrounding call. The recipient claims them later via
    ///         {withdrawPendingPayout}. This is what keeps duel settlement and zone payouts from
    ///         ever being able to lock funds or be griefed into permanent failure.
    mapping(address => uint256) public pendingPayouts;
    /// @dev All zone ids, kept around purely so {_payoutSponsoredZones} can iterate them without
    ///      needing its own spatial index — the expected total zone count (a handful of local
    ///      businesses, not thousands of Bases) makes an O(n) scan over zones acceptable, unlike
    ///      the O(n) chunk scan the spatial grid was built to avoid.
    uint256[] private _allZoneIds;

    /// @notice Total successful sessions (Claim + Reinforce) ever processed by this contract.
    uint256 public totalSuccessfulSessions;

    /// @notice totalSuccessfulSessions value the last time {botAttack} fired (0 = never).
    uint256 public lastBotAttackAtSessionCount;

    /// @notice How many times {botAttack} has fired — also used as part of the entropy seed so
    ///         two attacks unlocked in nearby blocks don't pick the same Base/damage.
    uint256 public botAttackCount;

    /// @dev Spatial index: bucket every chunk by its bounding-box center's (latCell, lngCell). A
    ///      chunk's position never changes after it's created — Reinforce/bot damage only ever
    ///      change area/ownership state, never geometry — so nothing needs to move between
    ///      buckets afterward. A fully-destroyed Base's chunks are removed from their Base but
    ///      intentionally left indexed with owner == address(0) looked up via `bases[chunk.
    ///      baseId].owner`, so Claim treats them as not-overlapping and the ground is
    ///      reclaimable.
    mapping(int32 => mapping(int32 => uint256[])) private _chunkIdsByCell;

    /// @dev Replay guard, keyed by (source player, source sessionId) — a session can only ever
    ///      be applied to the game once, even if someone re-submits the same proof.
    mapping(bytes32 => bool) public processedSessions;

    /// @dev Sybil resistance bookkeeping for Sponsored Zone payouts — how many times, and when
    ///      last, each address was paid by each zone. Keyed by (zoneId, address).
    mapping(uint256 => mapping(address => uint32)) public zonePayoutCountOf;
    mapping(uint256 => mapping(address => uint256)) public zoneLastPayoutAtOf;

    /// @notice Commit-reveal state for {commitBotAttack}/{revealBotAttack} — see the doc
    ///         comment on {commitBotAttack} for why this replaces the old single-transaction
    ///         blockhash-based randomness.
    uint256 public botAttackCommitBlock; // 0 = no pending commit
    uint256 public botAttackCommitSessionCount; // totalSuccessfulSessions snapshotted at commit time

    mapping(uint256 => Duel) public duels;
    uint256 public nextDuelId = 1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    // NOTE: every outcome event below carries the same `sessionId` the player got back from
    // TerraSession.recordSession() on Sepolia, so the frontend can correlate "the session I just
    // submitted" with exactly what happened to it on Creditcoin — success or failure alike.

    event SourceSessionContractRegistered(address indexed sourceSessionContract);
    /// @notice A brand-new Base was planted (the walked loop didn't touch any of the player's
    ///         existing Bases).
    event BaseClaimed(
        uint256 indexed baseId,
        address indexed owner,
        uint256 indexed sessionId,
        uint256 chunkId,
        uint32 areaMeters
    );
    /// @notice An existing Base of the player's was extended by one more chunk.
    event BaseExtended(
        uint256 indexed baseId,
        address indexed owner,
        uint256 indexed sessionId,
        uint256 chunkId,
        uint32 addedAreaMeters,
        uint32 newTotalAreaMeters
    );
    event BaseReinforced(
        uint256 indexed baseId,
        address indexed owner,
        uint256 indexed sessionId,
        uint32 restoredAreaMeters
    );
    event BaseDamaged(
        uint256 indexed baseId,
        address indexed owner,
        uint32 areaLost,
        uint32 areaRemaining,
        bool destroyed
    );
    event BotAttackTriggered(uint256 indexed baseId, uint256 attackIndex, uint256 damagePercent);
    /// @notice Fires instead of a Base pick when a bot attack unlocks but there are no Bases to
    ///         hit yet — the counter is still consumed so it doesn't fire again next session.
    event BotAttackFizzled(uint256 attackIndex);
    event LoopCapIncreased(address indexed player, uint32 newCumulativeMeters, uint32 newLoopCapMeters);
    /// @notice A Claim session executed on-chain but had no effect — surfaced as an event
    ///         (instead of a revert) so the frontend can show the player exactly why, keyed by
    ///         the same sessionId they got back from TerraSession on Sepolia.
    event ClaimRejected(address indexed player, uint256 indexed sessionId, string reason);
    /// @notice A Reinforce session was rejected (e.g. loop too long, not the owner, base gone).
    event ReinforceRejected(address indexed player, uint256 indexed sessionId, string reason);

    event SponsoredZoneCreated(
        uint256 indexed zoneId,
        address indexed sponsor,
        int32 lat,
        int32 lng,
        uint32 radiusMeters,
        uint256 totalPool,
        uint32 expectedSessions,
        uint256 endsAt,
        string name
    );
    event SponsoredZonePayout(
        uint256 indexed zoneId,
        address indexed player,
        uint256 indexed sessionId,
        uint256 amountToPlayer,
        uint256 platformFee
    );
    event SponsoredZoneWithdrawn(uint256 indexed zoneId, address indexed sponsor, uint256 amountReturned);
    event FeeRecipientUpdated(address indexed newFeeRecipient);

    /// @notice A payout couldn't be delivered directly and was credited for later withdrawal.
    event PayoutCredited(address indexed recipient, uint256 amount, uint256 newPendingTotal);
    /// @notice A recipient claimed their previously-credited payouts.
    event PendingPayoutWithdrawn(address indexed recipient, uint256 amount);

    /// @notice A Sponsored Zone payout was reduced (or skipped) by the Sybil-resistance decay
    ///         curve because this address has already been paid by this zone before.
    event SponsoredZonePayoutDecayed(
        uint256 indexed zoneId, address indexed player, uint32 payoutNumber, uint256 decayBps
    );

    event BotAttackCommitted(uint256 commitBlock, uint256 sessionCountAtCommit);
    event BotAttackCommitExpired(uint256 commitBlock);

    /// @notice Player A challenges Player B to a friendly walking duel. Purely opt-in — B must
    ///         explicitly {acceptDuel} for anything to actually start.
    event DuelChallenged(
        uint256 indexed duelId,
        address indexed challenger,
        address indexed opponent,
        uint256 stake,
        uint256 durationSeconds
    );
    /// @notice B accepted — the race is live from this block's timestamp for durationSeconds.
    event DuelAccepted(uint256 indexed duelId, uint256 startedAt, uint256 endsAt);
    /// @notice An unaccepted challenge was cancelled (by the challenger, or because nobody
    ///         accepted within DUEL_ACCEPT_WINDOW_HOURS) — the challenger's stake is refunded.
    event DuelCancelled(uint256 indexed duelId, address indexed by);
    /// @notice The duel's time window elapsed and it was settled: whoever's cumulativeMeters
    ///         grew more during the duel wins the full pool (minus the platform fee). A tie
    ///         splits the pool evenly between both, no fee taken (nobody "won" anything to tax).
    event DuelSettled(
        uint256 indexed duelId,
        address indexed winner, // address(0) for a tie
        uint32 challengerMetersWalked,
        uint32 opponentMetersWalked,
        uint256 payout,
        uint256 platformFee
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidAction(uint8 action);
    error NotOwner();
    error BotAttackNotReady(uint256 sessionsSinceLastAttack, uint256 required);
    error InvalidZoneParameters(string reason);
    error NotZoneSponsor();
    error ZoneStillActive(uint256 endsAt);
    error ZoneAlreadyWithdrawn();
    error NoBotAttackCommitPending();
    error BotAttackCommitPending(uint256 commitBlock);
    error RevealTooEarly(uint256 revealableAtBlock);
    error InvalidDuelParameters(string reason);
    error NotDuelOpponent();
    error NotDuelChallenger();
    error DuelNotPending();
    error DuelNotActive();
    error DuelStillActive(uint256 endsAt);
    error DuelAcceptWindowExpired();
    error DuelAcceptWindowStillOpen(uint256 cancellableAt);
    error WrongStakeAmount(uint256 expected, uint256 provided);
    error NothingToWithdraw();
    error InvalidCoordinates();

    constructor() {
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice One-time wiring of the Sepolia TerraSession contract this ASC will trust.
    function registerSourceSessionContract(address _source) external onlyOwner {
        require(sourceSessionContract == address(0), "TerraChainGame: source already set");
        require(_source != address(0), "TerraChainGame: source cannot be zero address");
        sourceSessionContract = _source;
        emit SourceSessionContractRegistered(_source);
    }

    /// @notice Redirects where the platform's cut of Sponsored Zone payouts goes (e.g. to a
    ///         treasury contract instead of the deployer wallet).
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "TerraChainGame: fee recipient cannot be zero address");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    // ---------------------------------------------------------------------
    // Sponsored Zones — local monetization (DePIN incentive/settlement layer)
    // ---------------------------------------------------------------------

    /// @notice Pay native CTC (msg.value, at least {MIN_ZONE_POOL}) to sponsor a circular zone
    ///         for `durationDays`. Every successful Claim/Reinforce that lands inside the zone
    ///         while it's active pays out `msg.value / expectedSessions` (minus the platform fee)
    ///         to the player, until either `expectedSessions` payouts have been made or the zone
    ///         expires — whichever comes first. Anyone can sponsor a zone, including on ground
    ///         they don't own; the zone only ever pays players, it never grants territory or
    ///         special claim rights.
    /// @param lat Latitude in micro-degrees (degrees * 1e6) of the zone's center.
    /// @param lng Longitude in micro-degrees (degrees * 1e6) of the zone's center.
    /// @param radiusMeters How far from the center a Base's location can be to qualify.
    /// @param durationDays How many days the zone stays active from now.
    /// @param expectedSessions The pool is split evenly across this many payouts — set this to
    ///        roughly how much real-world activity you expect/want to fund; a smaller number
    ///        means bigger individual rewards but the pool runs out sooner.
    function createSponsoredZone(
        int32 lat,
        int32 lng,
        uint32 radiusMeters,
        uint32 durationDays,
        uint32 expectedSessions,
        string calldata name
    ) external payable returns (uint256 zoneId) {
        if (msg.value < MIN_ZONE_POOL) revert InvalidZoneParameters("pool below minimum");
        if (!_validCoordinates(lat, lng)) revert InvalidCoordinates();
        if (radiusMeters == 0 || radiusMeters > MAX_ZONE_RADIUS_METERS) {
            revert InvalidZoneParameters("radius out of range");
        }
        if (durationDays < MIN_ZONE_DURATION_DAYS || durationDays > MAX_ZONE_DURATION_DAYS) {
            revert InvalidZoneParameters("duration out of range");
        }
        if (expectedSessions < MIN_ZONE_EXPECTED_SESSIONS || expectedSessions > MAX_ZONE_EXPECTED_SESSIONS) {
            revert InvalidZoneParameters("expectedSessions out of range");
        }
        // `name` is display-only metadata: it's emitted in SponsoredZoneCreated and read back by
        // the indexer (which replays events anyway), never by contract logic. Keeping it out of
        // contract storage saves the sponsor an SSTORE per zone and keeps this contract inside
        // the 24576-byte EIP-170 deployment limit, which it sits close to. Event logs are just
        // as permanent and just as public, so nothing about the name's availability is weaker.
        if (bytes(name).length == 0 || bytes(name).length > MAX_ZONE_NAME_BYTES) {
            revert InvalidZoneParameters("name length out of range");
        }

        uint256 rewardPerSession = msg.value / expectedSessions;
        if (rewardPerSession == 0) revert InvalidZoneParameters("pool too small for expectedSessions");

        zoneId = nextZoneId++;
        uint256 endsAt = block.timestamp + uint256(durationDays) * 1 days;

        sponsoredZones[zoneId] = SponsoredZone({
            sponsor: msg.sender,
            lat: lat,
            lng: lng,
            radiusMeters: radiusMeters,
            rewardPerSession: rewardPerSession,
            remainingPool: msg.value,
            sessionsPaid: 0,
            expectedSessions: expectedSessions,
            endsAt: endsAt,
            withdrawn: false
        });
        _allZoneIds.push(zoneId);
        _zoneIdsByCell[_cellIndex(lat)][_cellIndex(lng)].push(zoneId);

        emit SponsoredZoneCreated(
            zoneId,
            msg.sender,
            lat,
            lng,
            radiusMeters,
            msg.value,
            expectedSessions,
            endsAt,
            name
        );
    }

    /// @notice After a zone has expired, its sponsor can reclaim whatever's left in the pool
    ///         (leftover from rounding, or because fewer than `expectedSessions` payouts ever
    ///         happened). Can only be called once per zone, and only by the sponsor.
    function withdrawUnusedPool(uint256 zoneId) external {
        SponsoredZone storage zone = sponsoredZones[zoneId];
        if (zone.sponsor != msg.sender) revert NotZoneSponsor();
        if (block.timestamp < zone.endsAt) revert ZoneStillActive(zone.endsAt);
        if (zone.withdrawn) revert ZoneAlreadyWithdrawn();

        zone.withdrawn = true;
        uint256 amount = zone.remainingPool;
        zone.remainingPool = 0;

        // Uses the same never-lock delivery path as every other payout: a sponsor whose address
        // can't accept a direct transfer gets credited instead of losing the refund.
        _deliverPayout(msg.sender, amount);

        emit SponsoredZoneWithdrawn(zoneId, msg.sender, amount);
    }

    /// @dev Pays out every currently-active Sponsored Zone whose circle contains (lat, lng) —
    ///      the location of the Base a Claim/Reinforce just touched. Only zones bucketed in the
    ///      3x3 grid neighbourhood around that point are even considered (see {_nearbyZoneIds}),
    ///      so this stays O(1)-ish no matter how many zones exist globally. A session can trigger
    ///      payouts from multiple overlapping zones in the same transaction.
    ///
    ///      Payout delivery can never revert the surrounding Claim/Reinforce: if a direct
    ///      transfer fails, the amount is credited via {_deliverPayout} for the recipient to
    ///      withdraw later instead.
    ///
    ///      Sybil resistance: repeat payouts to the SAME address within the SAME zone decay
    ///      geometrically (see SYBIL_DECAY_BPS) and are subject to a cooldown
    ///      (SYBIL_COOLDOWN_SECONDS) — a single walker farming one zone over and over earns
    ///      rapidly less, while a sponsor's pool still rewards genuinely new foot traffic at
    ///      full rate. This is enforced entirely by economics, without any identity/KYC
    ///      dependency, which is the whole point: DePIN rewards should be expensive to fake at
    ///      scale, not impossible to earn without surveillance. Crucially, a decayed payout only
    ///      debits the pool by what was actually paid out — the un-paid remainder stays in the
    ///      pool for genuine new visitors (and is reclaimable by the sponsor after expiry),
    ///      rather than being silently burned.
    function _payoutSponsoredZones(address player, uint256 sessionId, int32 lat, int32 lng) internal {
        uint256[] memory candidates = _nearbyZoneIds(lat, lng);
        for (uint256 i = 0; i < candidates.length; i++) {
            uint256 zoneId = candidates[i];
            SponsoredZone storage zone = sponsoredZones[zoneId];

            if (block.timestamp >= zone.endsAt) continue;
            if (zone.sessionsPaid >= zone.expectedSessions) continue;

            uint256 lastPayoutAt = zoneLastPayoutAtOf[zoneId][player];
            if (lastPayoutAt != 0 && block.timestamp < lastPayoutAt + SYBIL_COOLDOWN_SECONDS) continue;

            int256 dLatMeters = (int256(lat) - int256(zone.lat)) * METERS_PER_DEGREE / 1_000_000;
            int256 dLngMeters = (int256(lng) - int256(zone.lng)) * METERS_PER_DEGREE / 1_000_000;
            uint256 distanceSquared = uint256(dLatMeters * dLatMeters + dLngMeters * dLngMeters);
            if (distanceSquared > uint256(zone.radiusMeters) * uint256(zone.radiusMeters)) continue;

            uint32 payoutNumber = zonePayoutCountOf[zoneId][player] + 1;
            uint256 decayBps = _sybilDecayBps(payoutNumber);
            uint256 reward = (zone.rewardPerSession * decayBps) / BPS_DENOMINATOR;
            if (reward == 0 || reward > zone.remainingPool) continue;

            zone.remainingPool -= reward;
            zone.sessionsPaid += 1;
            zonePayoutCountOf[zoneId][player] = payoutNumber;
            zoneLastPayoutAtOf[zoneId][player] = block.timestamp;

            uint256 fee = (reward * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
            uint256 toPlayer = reward - fee;

            _deliverPayout(player, toPlayer);
            if (fee > 0) _deliverPayout(feeRecipient, fee);

            emit SponsoredZonePayout(zoneId, player, sessionId, toPlayer, fee);
            if (decayBps < BPS_DENOMINATOR) {
                emit SponsoredZonePayoutDecayed(zoneId, player, payoutNumber, decayBps);
            }
        }
    }

    /// @dev Sends `amount` to `to`, falling back to crediting {pendingPayouts} if the direct
    ///      transfer fails for any reason. Never reverts, so a hostile or simply badly-written
    ///      recipient contract can't block whatever call is delivering the payout — that's what
    ///      would otherwise let someone permanently freeze duel stakes or brick every Claim that
    ///      lands in a sponsored zone. Capped gas isn't used: the fallback makes a failed send
    ///      harmless, so there's no need to guess how much gas a legitimate recipient needs.
    function _deliverPayout(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) {
            uint256 newTotal = pendingPayouts[to] + amount;
            pendingPayouts[to] = newTotal;
            emit PayoutCredited(to, amount, newTotal);
        }
    }

    /// @notice Claim any payouts (zone rewards, duel winnings, platform fees, duel refunds) that
    ///         couldn't be delivered directly. Uses the standard withdraw pattern: state is
    ///         zeroed before the transfer, and a failed transfer reverts the whole call so the
    ///         balance stays claimable rather than vanishing.
    function withdrawPendingPayout() external {
        uint256 amount = pendingPayouts[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingPayouts[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "TerraChainGame: withdraw failed");

        emit PendingPayoutWithdrawn(msg.sender, amount);
    }

    /// @dev Geometric decay in basis points for the Nth payout to the same address in the same
    ///      zone: 100% for N=1, then SYBIL_DECAY_BPS of the previous payout's rate for each
    ///      subsequent one, floored at SYBIL_MIN_PAYOUT_BPS so a repeat visitor never earns
    ///      literally zero (which would be indistinguishable from a ban).
    function _sybilDecayBps(uint32 payoutNumber) internal pure returns (uint256) {
        uint256 bps = BPS_DENOMINATOR;
        for (uint32 i = 1; i < payoutNumber; i++) {
            bps = (bps * SYBIL_DECAY_BPS) / BPS_DENOMINATOR;
            if (bps <= SYBIL_MIN_PAYOUT_BPS) return SYBIL_MIN_PAYOUT_BPS;
        }
        return bps;
    }

    // ---------------------------------------------------------------------
    // Duels — simple, opt-in PvP: a friendly wager on who walks further
    // ---------------------------------------------------------------------
    //
    // No combat, no territory ever at risk. Two players agree (challenge + accept) to wager
    // equal CTC stakes on who accumulates more walked distance — via their completely normal
    // Claim/Reinforce sessions — within a fixed time window. Whoever's cumulativeMeters grew
    // more between accept and settle wins the pool; a tie splits it evenly. This reuses the
    // Player.cumulativeMeters counter that already exists for the km-cap system — no new
    // tracking needed elsewhere in the contract, and no session is "wasted" if a player isn't
    // in a duel (every walk always counts toward cumulativeMeters regardless).

    /// @notice Challenge another player to a walking duel, staking `msg.value` CTC (can be 0
    ///         for a stakes-free friendly race). The opponent must {acceptDuel} with a matching
    ///         stake before the race actually starts — nothing happens to either player until
    ///         then.
    function challengeDuel(address opponent, uint256 durationHours) external payable returns (uint256 duelId) {
        if (opponent == msg.sender) revert InvalidDuelParameters("cannot duel yourself");
        if (opponent == address(0)) revert InvalidDuelParameters("opponent cannot be zero address");
        if (durationHours < MIN_DUEL_DURATION_HOURS || durationHours > MAX_DUEL_DURATION_HOURS) {
            revert InvalidDuelParameters("duration out of range");
        }

        duelId = nextDuelId++;
        duels[duelId] = Duel({
            challenger: msg.sender,
            opponent: opponent,
            stake: msg.value,
            durationSeconds: durationHours * 1 hours,
            challengedAt: block.timestamp,
            startedAt: 0,
            challengerStartMeters: 0,
            opponentStartMeters: 0,
            status: DuelStatus.Pending
        });

        emit DuelChallenged(duelId, msg.sender, opponent, msg.value, durationHours * 1 hours);
    }

    /// @notice The challenged opponent accepts, matching the challenger's stake exactly. The
    ///         race starts immediately (both players' current cumulativeMeters are snapshotted
    ///         as the baseline) and runs for the challenge's declared duration.
    function acceptDuel(uint256 duelId) external payable {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Pending) revert DuelNotPending();
        if (msg.sender != duel.opponent) revert NotDuelOpponent();
        if (msg.value != duel.stake) revert WrongStakeAmount(duel.stake, msg.value);
        if (block.timestamp > duel.challengedAt + DUEL_ACCEPT_WINDOW_HOURS * 1 hours) {
            revert DuelAcceptWindowExpired();
        }

        duel.status = DuelStatus.Active;
        duel.startedAt = block.timestamp;
        duel.challengerStartMeters = players[duel.challenger].cumulativeMeters;
        duel.opponentStartMeters = players[duel.opponent].cumulativeMeters;

        emit DuelAccepted(duelId, block.timestamp, block.timestamp + duel.durationSeconds);
    }

    /// @notice The challenger can cancel their own still-unaccepted challenge at any time (get
    ///         their stake back immediately), or ANYONE can trigger the cancellation once the
    ///         accept window has lapsed without a response — either way the stake returns to
    ///         the challenger, who is the only one who ever deposited anything at this stage.
    function cancelDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Pending) revert DuelNotPending();

        bool challengerCancelling = msg.sender == duel.challenger;
        bool windowExpired = block.timestamp > duel.challengedAt + DUEL_ACCEPT_WINDOW_HOURS * 1 hours;
        if (!challengerCancelling && !windowExpired) {
            revert DuelAcceptWindowStillOpen(duel.challengedAt + DUEL_ACCEPT_WINDOW_HOURS * 1 hours);
        }

        duel.status = DuelStatus.Cancelled;
        uint256 refund = duel.stake;
        if (refund > 0) _deliverPayout(duel.challenger, refund);

        emit DuelCancelled(duelId, msg.sender);
    }

    /// @notice Settles an Active duel once its time window has elapsed. Permissionless —
    ///         either participant or any third party can trigger settlement; the outcome is
    ///         fully determined by on-chain state (cumulativeMeters deltas), nobody can
    ///         influence it by choosing who calls this or when.
    function settleDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Active) revert DuelNotActive();
        uint256 endsAt = duel.startedAt + duel.durationSeconds;
        if (block.timestamp < endsAt) revert DuelStillActive(endsAt);

        duel.status = DuelStatus.Settled;

        uint32 challengerWalked = players[duel.challenger].cumulativeMeters - duel.challengerStartMeters;
        uint32 opponentWalked = players[duel.opponent].cumulativeMeters - duel.opponentStartMeters;

        uint256 pool = duel.stake * 2;
        if (challengerWalked == opponentWalked) {
            // Tie — nobody "won", so no platform fee is taken; each side just gets their own
            // stake back.
            emit DuelSettled(duelId, address(0), challengerWalked, opponentWalked, duel.stake, 0);
            if (duel.stake > 0) {
                _deliverPayout(duel.challenger, duel.stake);
                _deliverPayout(duel.opponent, duel.stake);
            }
            return;
        }

        address winner = challengerWalked > opponentWalked ? duel.challenger : duel.opponent;
        uint256 fee = pool > 0 ? (pool * PLATFORM_FEE_BPS) / BPS_DENOMINATOR : 0;
        uint256 payout = pool - fee;

        emit DuelSettled(duelId, winner, challengerWalked, opponentWalked, payout, fee);

        if (pool > 0) {
            _deliverPayout(winner, payout);
            if (fee > 0) _deliverPayout(feeRecipient, fee);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Per-session walking cap for `player`, derived from their cumulative distance —
    ///         grows automatically and permanently, nothing to buy or manage.
    function loopCapOf(address player) public view returns (uint32) {
        return _loopCapForCumulative(players[player].cumulativeMeters);
    }

    function cumulativeMetersOf(address player) external view returns (uint32) {
        return players[player].cumulativeMeters;
    }

    function chunkIdsOfBase(uint256 baseId) external view returns (uint256[] memory) {
        return bases[baseId].chunkIds;
    }

    function chunkPolygon(uint256 chunkId) external view returns (int32[] memory lats, int32[] memory lngs) {
        Chunk storage c = chunks[chunkId];
        return (c.lats, c.lngs);
    }

    /// @notice Every zone id ever created (including expired/withdrawn ones) — the indexer
    ///         uses this once at startup to discover zones, then just replays
    ///         SponsoredZoneCreated/SponsoredZonePayout/SponsoredZoneWithdrawn events like
    ///         everywhere else.
    function allZoneIds() external view returns (uint256[] memory) {
        return _allZoneIds;
    }

    function isZoneActive(uint256 zoneId) external view returns (bool) {
        SponsoredZone storage zone = sponsoredZones[zoneId];
        return block.timestamp < zone.endsAt && zone.sessionsPaid < zone.expectedSessions
            && zone.remainingPool >= zone.rewardPerSession;
    }

    /// @notice Whether a NEW commit could be started right now (enough sessions accumulated
    ///         AND no commit already pending). See {commitBotAttack}.
    function botAttackReady() public view returns (bool) {
        return totalSuccessfulSessions - lastBotAttackAtSessionCount >= BOT_ATTACK_TX_INTERVAL
            && botAttackCommitBlock == 0;
    }

    /// @notice Whether a pending commit can be revealed right now. See {revealBotAttack}.
    function botAttackRevealReady() public view returns (bool) {
        return botAttackCommitBlock != 0 && block.number > botAttackCommitBlock
            && block.number <= botAttackCommitBlock + REVEAL_WINDOW_BLOCKS;
    }

    function _loopCapForCumulative(uint32 cumulativeMeters) internal pure returns (uint32) {
        uint256 level = uint256(cumulativeMeters) / METERS_PER_LEVEL;
        if (level > MAX_LOOP_CAP_LEVELS) level = MAX_LOOP_CAP_LEVELS;
        return BASE_LOOP_CAP_METERS + uint32(level) * LOOP_CAP_GROWTH_PER_LEVEL;
    }

    // ---------------------------------------------------------------------
    // Bot attack — permissionless, unlocked by on-chain activity, commit-reveal randomness
    // ---------------------------------------------------------------------
    //
    // The OLD design (single transaction, entropy = blockhash(block.number - 1) + timestamp)
    // has a real weakness: the caller chooses WHICH block their transaction lands in (by
    // choosing when to submit, and via gas price / resubmission if it doesn't land where they
    // want), and `block.number - 1` is already known the moment they decide to call — so a
    // sufficiently motivated actor (especially a block-producing validator, who fully controls
    // block.timestamp and can choose whether to include the tx at all) could bias the outcome
    // toward not attacking their OWN base, or toward attacking a rival's, simply by controlling
    // *when* the call executes relative to already-known entropy. This is the exact class of
    // "on-chain randomness" problem most naive `blockhash`-based designs suffer from.
    //
    // The FIX is a two-transaction commit-reveal:
    //   1. {commitBotAttack} records `block.number` as the commit block. At this instant,
    //      blockhash(commitBlock) DOES NOT EXIST YET — it's only determined once that block is
    //      mined, which happens strictly AFTER this transaction is already included. Nobody,
    //      not even the block's own producer, can know it in advance at commit time.
    //   2. {revealBotAttack}, callable only once `block.number > commitBlock`, uses
    //      blockhash(commitBlock) as entropy. By now the entropy source is permanently fixed on
    //      -chain and can't be un-mined or altered by anyone, including whoever produced it.
    //
    // This doesn't require a VRF oracle or any off-chain dependency, and remains fully
    // permissionless — anyone can commit, and anyone (not necessarily the same caller) can
    // reveal once the window opens.

    /// @notice Step 1/2: opens a commit once BOT_ATTACK_TX_INTERVAL successful sessions have
    ///         accumulated. Must be followed by {revealBotAttack} in a LATER block (not the
    ///         same one) to actually resolve the attack.
    function commitBotAttack() external {
        if (botAttackCommitBlock != 0) revert BotAttackCommitPending(botAttackCommitBlock);

        uint256 sessionsSince = totalSuccessfulSessions - lastBotAttackAtSessionCount;
        if (sessionsSince < BOT_ATTACK_TX_INTERVAL) {
            revert BotAttackNotReady(sessionsSince, BOT_ATTACK_TX_INTERVAL);
        }

        botAttackCommitBlock = block.number;
        botAttackCommitSessionCount = totalSuccessfulSessions;
        emit BotAttackCommitted(block.number, totalSuccessfulSessions);
    }

    /// @notice Step 2/2: resolves a pending commit using the now-immutable blockhash of the
    ///         commit block as entropy. Reverts if called too early (same block as the commit —
    ///         impossible anyway since blockhash(block.number) is always 0). If called too late
    ///         (more than REVEAL_WINDOW_BLOCKS after the commit, past the EVM's own blockhash
    ///         lookback limit), this does NOT revert — it clears the stale commit and emits
    ///         {BotAttackCommitExpired} so a fresh {commitBotAttack} can start immediately
    ///         (reverting here would also roll back that same event, silently losing the
    ///         "why nothing happened" signal for anyone watching).
    function revealBotAttack() external {
        uint256 commitBlock = botAttackCommitBlock;
        if (commitBlock == 0) revert NoBotAttackCommitPending();
        if (block.number <= commitBlock) revert RevealTooEarly(commitBlock + 1);

        if (block.number > commitBlock + REVEAL_WINDOW_BLOCKS) {
            // Commit expired (nobody revealed within the window) — clear it so a fresh commit
            // can start rather than leaving the game permanently stuck. This is a normal,
            // successful outcome, not an error: the caller did nothing wrong by trying to
            // reveal a commit that simply sat unrevealed too long.
            botAttackCommitBlock = 0;
            emit BotAttackCommitExpired(commitBlock);
            return;
        }

        botAttackCommitBlock = 0;
        lastBotAttackAtSessionCount = botAttackCommitSessionCount;
        uint256 attackIndex = ++botAttackCount;

        uint256 totalBases = nextBaseId - 1;
        if (totalBases == 0) {
            emit BotAttackFizzled(attackIndex);
            return;
        }

        // blockhash(commitBlock) is now permanently fixed — it was unknowable to anyone at the
        // moment commitBotAttack() ran, and cannot change no matter who calls reveal or when
        // (within the window).
        uint256 seed = uint256(keccak256(abi.encodePacked(blockhash(commitBlock), commitBlock, attackIndex)));

        // Pick a 1-indexed base id; skip forward (wrapping) past any already-empty (owner==0)
        // slots so a fully-destroyed Base doesn't get "attacked" again while empty.
        uint256 startId = (seed % totalBases) + 1;
        uint256 targetId = 0;
        for (uint256 i = 0; i < totalBases; i++) {
            uint256 candidate = ((startId - 1 + i) % totalBases) + 1;
            if (bases[candidate].owner != address(0)) {
                targetId = candidate;
                break;
            }
        }

        if (targetId == 0) {
            emit BotAttackFizzled(attackIndex);
            return;
        }

        uint256 damagePercent =
            BOT_MIN_DAMAGE_PERCENT + (seed / totalBases) % (BOT_MAX_DAMAGE_PERCENT - BOT_MIN_DAMAGE_PERCENT + 1);

        emit BotAttackTriggered(targetId, attackIndex, damagePercent);
        _applyBotDamage(targetId, damagePercent);
    }

    function _applyBotDamage(uint256 baseId, uint256 damagePercent) internal {
        Base storage base = bases[baseId];
        uint32 areaLost = uint32((uint256(base.currentAreaMeters) * damagePercent) / 100);
        if (areaLost == 0) areaLost = 1; // any hit always does at least a token amount of damage

        bool destroyed = areaLost >= base.currentAreaMeters;
        address previousOwner = base.owner;

        if (destroyed) {
            base.currentAreaMeters = 0;
            base.owner = address(0); // ground freed — reclaimable via Claim again
            emit BaseDamaged(baseId, previousOwner, base.initialAreaMeters, 0, true);
        } else {
            base.currentAreaMeters -= areaLost;
            emit BaseDamaged(baseId, previousOwner, areaLost, base.currentAreaMeters, false);
        }
    }

    // ---------------------------------------------------------------------
    // ASCBase hook — entry point for every proven cross-chain session
    // ---------------------------------------------------------------------

    function _processAndEmitEvent(uint8 action, bytes32 /* queryId */, bytes memory encodedTransaction)
        internal
        override
    {
        if (action != ACTION_PROCESS_SESSION) revert InvalidAction(action);
        _processSession(encodedTransaction);
    }

    function _processSession(bytes memory encodedTransaction) internal {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "TerraChainGame: unsupported tx type");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "TerraChainGame: source tx did not succeed");

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, SESSION_EVENT_SIGNATURE);
        require(logs.length > 0, "TerraChainGame: no SessionRecorded event found");

        EvmV1Decoder.LogEntry memory log = logs[0];

        require(sourceSessionContract != address(0), "TerraChainGame: source not registered");
        require(log.address_ == sourceSessionContract, "TerraChainGame: event not from registered source");
        require(log.topics.length == 2, "TerraChainGame: unexpected topic count");
        require(log.topics[0] == SESSION_EVENT_SIGNATURE, "TerraChainGame: unexpected event signature");

        address player = address(uint160(uint256(log.topics[1])));

        (
            uint8 sessionType,
            int32[] memory lats,
            int32[] memory lngs,
            uint32 distanceMeters,
            uint32 durationSeconds,
            uint256 sessionId
        ) = abi.decode(log.data, (uint8, int32[], int32[], uint32, uint32, uint256));

        bytes32 replayKey = keccak256(abi.encodePacked(player, sessionId));
        require(!processedSessions[replayKey], "TerraChainGame: session already processed");
        processedSessions[replayKey] = true;

        require(
            distanceMeters / durationSeconds <= MAX_SPEED_METERS_PER_SECOND,
            "TerraChainGame: session rejected, average speed too high"
        );

        if (sessionType == SESSION_CLAIM) {
            _handleClaim(player, sessionId, lats, lngs, distanceMeters);
        } else if (sessionType == SESSION_REINFORCE) {
            _handleReinforce(player, sessionId, lats, lngs, distanceMeters);
        } else {
            revert("TerraChainGame: unknown session type");
        }
    }

    // ---------------------------------------------------------------------
    // Game logic
    // ---------------------------------------------------------------------

    /// @dev Every successful Claim/Reinforce grows the player's cumulative distance (and thus
    ///      their loop cap) and counts toward unlocking the next bot attack.
    function _recordProgress(address player, uint32 distanceMeters) internal {
        uint32 newCumulative = players[player].cumulativeMeters + distanceMeters;
        players[player].cumulativeMeters = newCumulative;
        totalSuccessfulSessions += 1;
        emit LoopCapIncreased(player, newCumulative, _loopCapForCumulative(newCumulative));
    }

    function _handleClaim(
        address player,
        uint256 sessionId,
        int32[] memory lats,
        int32[] memory lngs,
        uint32 walkedMeters
    ) internal {
        if (walkedMeters < MIN_CLAIM_METERS) {
            emit ClaimRejected(player, sessionId, "loop too short to claim");
            return;
        }
        uint32 cap = loopCapOf(player);
        if (walkedMeters > cap) {
            emit ClaimRejected(player, sessionId, "loop exceeds your current km cap");
            return;
        }
        if (walkedMeters > MAX_LOOP_METERS) {
            emit ClaimRejected(player, sessionId, "loop too long to claim");
            return;
        }
        if (lats.length < MIN_POLYGON_POINTS || lats.length > MAX_POLYGON_POINTS) {
            emit ClaimRejected(player, sessionId, "invalid polygon point count");
            return;
        }
        if (!_validPolygonCoordinates(lats, lngs)) {
            emit ClaimRejected(player, sessionId, "coordinates out of real-world bounds");
            return;
        }

        (int32 minLat, int32 maxLat, int32 minLng, int32 maxLng) = _boundingBox(lats, lngs);
        uint32 area = _polygonArea(lats, lngs);
        if (area == 0) {
            emit ClaimRejected(player, sessionId, "polygon has no area");
            return;
        }

        uint256[] memory nearby = _nearbyChunkIds(minLat, maxLat, minLng, maxLng);

        // First pass: reject outright if the new loop overlaps any chunk belonging to someone
        // else's still-alive Base. Also remember the first chunk (if any) belonging to one of
        // the PLAYER'S OWN Bases that this loop touches, so we can extend that Base instead of
        // planting a new one.
        uint256 attachToBaseId = 0;
        for (uint256 i = 0; i < nearby.length; i++) {
            Chunk storage existing = chunks[nearby[i]];
            Base storage existingBase = bases[existing.baseId];
            if (existingBase.owner == address(0)) continue; // freed ground — not an overlap

            if (!_boundingBoxesOverlap(minLat, maxLat, minLng, maxLng, existing.minLat, existing.maxLat, existing.minLng, existing.maxLng)) {
                continue;
            }

            if (_polygonsIntersect(lats, lngs, existing.lats, existing.lngs)) {
                if (existingBase.owner == player) {
                    if (attachToBaseId == 0) attachToBaseId = existing.baseId;
                    // Keep scanning — a different chunk further in `nearby` could belong to
                    // someone else and must still be rejected.
                } else {
                    // Most likely cause: someone else's Claim/territory got there first — see
                    // the README's note on concurrent claims racing each other through
                    // cross-chain attestation.
                    emit ClaimRejected(player, sessionId, "overlaps an existing territory");
                    return;
                }
            }
        }

        uint256 chunkId = nextChunkId++;
        chunks[chunkId] =
            Chunk({baseId: 0, lats: lats, lngs: lngs, areaMeters: area, minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng});

        if (attachToBaseId != 0) {
            Base storage base = bases[attachToBaseId];
            chunks[chunkId].baseId = attachToBaseId;
            base.chunkIds.push(chunkId);
            uint32 newInitial = base.initialAreaMeters + area;
            base.initialAreaMeters = newInitial;
            base.currentAreaMeters = newInitial; // extending counts as fresh, undamaged ground
            base.lastActionAt = block.timestamp;
            _indexChunk(chunkId, minLat, minLng, maxLat, maxLng);

            _recordProgress(player, walkedMeters);
            emit BaseExtended(attachToBaseId, player, sessionId, chunkId, area, newInitial);
            (int32 extendCentroidLat, int32 extendCentroidLng) = _centroid(lats, lngs);
            _payoutSponsoredZones(player, sessionId, extendCentroidLat, extendCentroidLng);
            return;
        }

        uint256 baseId = nextBaseId++;
        chunks[chunkId].baseId = baseId;

        uint256[] memory chunkIds = new uint256[](1);
        chunkIds[0] = chunkId;
        bases[baseId] = Base({
            owner: player,
            initialAreaMeters: area,
            currentAreaMeters: area,
            chunkIds: chunkIds,
            lastActionAt: block.timestamp
        });
        _indexChunk(chunkId, minLat, minLng, maxLat, maxLng);

        _recordProgress(player, walkedMeters);
        emit BaseClaimed(baseId, player, sessionId, chunkId, area);
        (int32 claimCentroidLat, int32 claimCentroidLng) = _centroid(lats, lngs);
        _payoutSponsoredZones(player, sessionId, claimCentroidLat, claimCentroidLng);
    }

    /// @dev Walking a valid loop that encloses the center of at least one of your own Base's
    ///      chunks fully restores that Base's territory to 100% of its current total area —
    ///      undoes any accumulated bot damage in one go.
    function _handleReinforce(
        address player,
        uint256 sessionId,
        int32[] memory lats,
        int32[] memory lngs,
        uint32 walkedMeters
    ) internal {
        if (walkedMeters > MAX_LOOP_METERS) {
            emit ReinforceRejected(player, sessionId, "loop too long to reinforce");
            return;
        }
        if (lats.length < MIN_POLYGON_POINTS || lats.length > MAX_POLYGON_POINTS) {
            emit ReinforceRejected(player, sessionId, "invalid polygon point count");
            return;
        }
        if (!_validPolygonCoordinates(lats, lngs)) {
            emit ReinforceRejected(player, sessionId, "coordinates out of real-world bounds");
            return;
        }

        (int32 minLat, int32 maxLat, int32 minLng, int32 maxLng) = _boundingBox(lats, lngs);
        uint256 baseId = _findOwnedBaseEnclosedBy(player, lats, lngs, minLat, maxLat, minLng, maxLng);
        if (baseId == 0) {
            emit ReinforceRejected(player, sessionId, "no base of yours found inside that loop");
            return;
        }

        Base storage base = bases[baseId];
        base.currentAreaMeters = base.initialAreaMeters;
        base.lastActionAt = block.timestamp;

        _recordProgress(player, walkedMeters);

        emit BaseReinforced(baseId, player, sessionId, base.initialAreaMeters);
        (int32 reinforceCentroidLat, int32 reinforceCentroidLng) = _centroid(lats, lngs);
        _payoutSponsoredZones(player, sessionId, reinforceCentroidLat, reinforceCentroidLng);
    }

    /// @dev Finds a Base owned by `player` with at least one chunk whose centroid falls inside
    ///      the loop just walked.
    function _findOwnedBaseEnclosedBy(
        address player,
        int32[] memory lats,
        int32[] memory lngs,
        int32 minLat,
        int32 maxLat,
        int32 minLng,
        int32 maxLng
    ) internal view returns (uint256) {
        uint256[] memory nearby = _nearbyChunkIds(minLat, maxLat, minLng, maxLng);
        for (uint256 i = 0; i < nearby.length; i++) {
            Chunk storage candidate = chunks[nearby[i]];
            Base storage candidateBase = bases[candidate.baseId];
            if (candidateBase.owner != player) continue;

            (int32 cLat, int32 cLng) = _centroid(candidate.lats, candidate.lngs);
            if (_pointInPolygon(cLat, cLng, lats, lngs)) {
                return candidate.baseId;
            }
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Geometry — polygon area, containment, intersection
    // ---------------------------------------------------------------------

    /// @dev Shoelace formula, in raw micro-degree units squared, then converted to square
    ///      meters via the flat-earth METERS_PER_DEGREE approximation. Works for any simple
    ///      polygon (convex or concave), which is what a real walking loop usually is.
    function _polygonArea(int32[] memory lats, int32[] memory lngs) internal pure returns (uint32) {
        uint256 n = lats.length;
        int256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 j = (i + 1) % n;
            sum += int256(lats[i]) * int256(lngs[j]) - int256(lats[j]) * int256(lngs[i]);
        }
        if (sum < 0) sum = -sum;

        // sum is in micro-degrees^2 * 2. Convert to meters^2: each micro-degree axis scales by
        // METERS_PER_DEGREE / 1_000_000, so area scales by that factor squared.
        uint256 areaMicroDegSq = uint256(sum) / 2;
        uint256 areaMeters2 = (areaMicroDegSq * uint256(METERS_PER_DEGREE) * uint256(METERS_PER_DEGREE))
            / (1_000_000 * 1_000_000);
        return uint32(areaMeters2);
    }

    function _centroid(int32[] memory lats, int32[] memory lngs) internal pure returns (int32, int32) {
        int256 sumLat = 0;
        int256 sumLng = 0;
        for (uint256 i = 0; i < lats.length; i++) {
            sumLat += int256(lats[i]);
            sumLng += int256(lngs[i]);
        }
        return (int32(sumLat / int256(lats.length)), int32(sumLng / int256(lngs.length)));
    }

    function _boundingBox(int32[] memory lats, int32[] memory lngs)
        internal
        pure
        returns (int32 minLat, int32 maxLat, int32 minLng, int32 maxLng)
    {
        minLat = lats[0];
        maxLat = lats[0];
        minLng = lngs[0];
        maxLng = lngs[0];
        for (uint256 i = 1; i < lats.length; i++) {
            if (lats[i] < minLat) minLat = lats[i];
            if (lats[i] > maxLat) maxLat = lats[i];
            if (lngs[i] < minLng) minLng = lngs[i];
            if (lngs[i] > maxLng) maxLng = lngs[i];
        }
    }

    function _boundingBoxesOverlap(
        int32 aMinLat,
        int32 aMaxLat,
        int32 aMinLng,
        int32 aMaxLng,
        int32 bMinLat,
        int32 bMaxLat,
        int32 bMinLng,
        int32 bMaxLng
    ) internal pure returns (bool) {
        return aMinLat <= bMaxLat && aMaxLat >= bMinLat && aMinLng <= bMaxLng && aMaxLng >= bMinLng;
    }

    /// @dev Ray-casting point-in-polygon test (even-odd rule) — works for convex or concave
    ///      simple polygons. Coordinates are in micro-degrees; treated as (x=lng, y=lat).
    function _pointInPolygon(int32 pLat, int32 pLng, int32[] memory lats, int32[] memory lngs)
        internal
        pure
        returns (bool)
    {
        uint256 n = lats.length;
        bool inside = false;
        for (uint256 i = 0; i < n; i++) {
            uint256 j = (i + n - 1) % n;
            int256 yi = int256(lats[i]);
            int256 yj = int256(lats[j]);
            int256 xi = int256(lngs[i]);
            int256 xj = int256(lngs[j]);
            int256 py = int256(pLat);
            int256 px = int256(pLng);

            bool crosses = (yi > py) != (yj > py);
            if (crosses) {
                // x-coordinate where the edge (i,j) crosses the horizontal line y = py.
                int256 xIntersect = xi + ((xj - xi) * (py - yi)) / (yj - yi);
                if (px < xIntersect) {
                    inside = !inside;
                }
            }
        }
        return inside;
    }

    /// @dev Two simple polygons intersect if any edge of one crosses any edge of the other, OR
    ///      one polygon has a vertex inside the other, OR one is entirely contained inside the
    ///      other with no vertex/edge touching at all (e.g. two loops that coincide, or a small
    ///      loop fully inside a big one — checking each polygon's centroid against the other
    ///      catches this last case). Checking actual vertices (not just the centroid) is what
    ///      catches partial overlaps between two axis-aligned rectangles that overlap in a
    ///      narrow strip without any of their edges properly "crossing" each other.
    function _polygonsIntersect(int32[] memory latsA, int32[] memory lngsA, int32[] memory latsB, int32[] memory lngsB)
        internal
        pure
        returns (bool)
    {
        uint256 nA = latsA.length;
        uint256 nB = latsB.length;

        for (uint256 i = 0; i < nA; i++) {
            uint256 i2 = (i + 1) % nA;
            for (uint256 j = 0; j < nB; j++) {
                uint256 j2 = (j + 1) % nB;
                if (
                    _segmentsIntersect(
                        latsA[i], lngsA[i], latsA[i2], lngsA[i2], latsB[j], lngsB[j], latsB[j2], lngsB[j2]
                    )
                ) {
                    return true;
                }
            }
        }

        for (uint256 i = 0; i < nA; i++) {
            if (_pointInPolygon(latsA[i], lngsA[i], latsB, lngsB)) return true;
        }
        for (uint256 j = 0; j < nB; j++) {
            if (_pointInPolygon(latsB[j], lngsB[j], latsA, lngsA)) return true;
        }

        (int32 centroidALat, int32 centroidALng) = _centroid(latsA, lngsA);
        if (_pointInPolygon(centroidALat, centroidALng, latsB, lngsB)) return true;

        (int32 centroidBLat, int32 centroidBLng) = _centroid(latsB, lngsB);
        if (_pointInPolygon(centroidBLat, centroidBLng, latsA, lngsA)) return true;

        return false;
    }

    /// @dev Standard orientation-based segment intersection test (handles proper crossings;
    ///      collinear/touching edge cases are rare for real GPS loops and, if missed, only
    ///      affect the rare situation where two loops touch exactly at a boundary — the
    ///      point-in-polygon fallback above still catches full containment either way).
    function _segmentsIntersect(
        int32 aLat1,
        int32 aLng1,
        int32 aLat2,
        int32 aLng2,
        int32 bLat1,
        int32 bLng1,
        int32 bLat2,
        int32 bLng2
    ) internal pure returns (bool) {
        int256 d1 = _cross(aLat1, aLng1, aLat2, aLng2, bLat1, bLng1);
        int256 d2 = _cross(aLat1, aLng1, aLat2, aLng2, bLat2, bLng2);
        int256 d3 = _cross(bLat1, bLng1, bLat2, bLng2, aLat1, aLng1);
        int256 d4 = _cross(bLat1, bLng1, bLat2, bLng2, aLat2, aLng2);

        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }
        return false;
    }

    /// @dev Cross product of (p2-p1) x (p3-p1), used to determine turn direction. Treats
    ///      (x=lng, y=lat).
    function _cross(int32 lat1, int32 lng1, int32 lat2, int32 lng2, int32 lat3, int32 lng3)
        internal
        pure
        returns (int256)
    {
        int256 x1 = int256(lng2) - int256(lng1);
        int256 y1 = int256(lat2) - int256(lat1);
        int256 x2 = int256(lng3) - int256(lng1);
        int256 y2 = int256(lat3) - int256(lat1);
        return x1 * y2 - y1 * x2;
    }

    // ---------------------------------------------------------------------
    // Spatial index
    // ---------------------------------------------------------------------

    /// @dev Whether a coordinate pair is within real-world lat/lng bounds. Rejecting anything
    ///      outside this is what stops absurd (or maliciously extreme) values from overflowing
    ///      the int32 midpoint arithmetic in {_indexChunk}/{_nearbyChunkIds} — an overflow there
    ///      would revert the whole cross-chain execute() call, leaving the relayer retrying a
    ///      session that can never succeed.
    function _validCoordinates(int32 lat, int32 lng) internal pure returns (bool) {
        return lat >= -MAX_ABS_LAT_MICRO_DEGREES && lat <= MAX_ABS_LAT_MICRO_DEGREES
            && lng >= -MAX_ABS_LNG_MICRO_DEGREES && lng <= MAX_ABS_LNG_MICRO_DEGREES;
    }

    /// @dev Every coordinate in a submitted polygon must be within real-world bounds.
    function _validPolygonCoordinates(int32[] memory lats, int32[] memory lngs) internal pure returns (bool) {
        for (uint256 i = 0; i < lats.length; i++) {
            if (!_validCoordinates(lats[i], lngs[i])) return false;
        }
        return true;
    }

    /// @dev Truncating division bucket index — see {CELL_SIZE_MICRO_DEGREES}.
    function _cellIndex(int32 coordMicroDegrees) internal pure returns (int32) {
        return coordMicroDegrees / CELL_SIZE_MICRO_DEGREES;
    }

    /// @dev Collects zone ids bucketed in the 3x3 grid neighbourhood around (lat, lng) — the only
    ///      zones that could possibly contain that point, given MAX_ZONE_RADIUS_METERS never
    ///      exceeds one cell's width. Replaces what used to be a scan over every zone ever
    ///      created (a cheap, permissionless denial-of-service vector against every Claim).
    function _nearbyZoneIds(int32 lat, int32 lng) internal view returns (uint256[] memory) {
        int32 latCell = _cellIndex(lat);
        int32 lngCell = _cellIndex(lng);

        uint256 total;
        for (int32 dLat = -1; dLat <= 1; dLat++) {
            for (int32 dLng = -1; dLng <= 1; dLng++) {
                total += _zoneIdsByCell[latCell + dLat][lngCell + dLng].length;
            }
        }

        uint256[] memory result = new uint256[](total);
        uint256 k;
        for (int32 dLat = -1; dLat <= 1; dLat++) {
            for (int32 dLng = -1; dLng <= 1; dLng++) {
                uint256[] storage bucket = _zoneIdsByCell[latCell + dLat][lngCell + dLng];
                for (uint256 i = 0; i < bucket.length; i++) {
                    result[k++] = bucket[i];
                }
            }
        }
        return result;
    }

    function _indexChunk(uint256 chunkId, int32 minLat, int32 minLng, int32 maxLat, int32 maxLng) internal {
        int32 centerLat = (minLat + maxLat) / 2;
        int32 centerLng = (minLng + maxLng) / 2;
        _chunkIdsByCell[_cellIndex(centerLat)][_cellIndex(centerLng)].push(chunkId);
    }

    /// @dev Collects every chunk id bucketed in the 3x3 grid neighborhood around the given
    ///      bounding box's center — the only candidates that could possibly overlap/contain a
    ///      MAX_LOOP_METERS-bounded loop centered there. Replaces an O(n) scan over every chunk
    ///      ever claimed.
    function _nearbyChunkIds(int32 minLat, int32 maxLat, int32 minLng, int32 maxLng)
        internal
        view
        returns (uint256[] memory)
    {
        int32 centerLat = (minLat + maxLat) / 2;
        int32 centerLng = (minLng + maxLng) / 2;
        int32 latCell = _cellIndex(centerLat);
        int32 lngCell = _cellIndex(centerLng);

        uint256 total;
        for (int32 dLat = -1; dLat <= 1; dLat++) {
            for (int32 dLng = -1; dLng <= 1; dLng++) {
                total += _chunkIdsByCell[latCell + dLat][lngCell + dLng].length;
            }
        }

        uint256[] memory result = new uint256[](total);
        uint256 k;
        for (int32 dLat = -1; dLat <= 1; dLat++) {
            for (int32 dLng = -1; dLng <= 1; dLng++) {
                uint256[] storage bucket = _chunkIdsByCell[latCell + dLat][lngCell + dLng];
                for (uint256 i = 0; i < bucket.length; i++) {
                    result[k++] = bucket[i];
                }
            }
        }
        return result;
    }
}
