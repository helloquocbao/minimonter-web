// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TerraSession
/// @notice Deployed on Sepolia (the source chain). Players submit the result of a real-world
///         walking session here as a closed polygon loop. The Attestcoin Protocol later proves
///         this event happened to TerraChainGame on Creditcoin, which is where the actual game
///         state lives.
/// @dev This contract does not know or care about game rules — it just timestamps a claim by a
///      player about the shape they walked, and lets the Creditcoin side decide what to do with
///      it. The polygon is NOT required to be a circle or any particular shape — any real-world
///      walking loop works, as long as it closes (last point connects back to the first).
contract TerraSession {
    /// @dev Matches the game's session types: 0 = Claim (walk a closed loop around unclaimed
    ///      ground to paint it as your territory, or attach it to one of your own Bases if it
    ///      touches one), 1 = Reinforce (walk a closed loop around your own Base to fully
    ///      restore its territory after bot damage).
    enum SessionType {
        Claim,
        Reinforce
    }

    /// @dev Polygon points are capped so gas on the Creditcoin side (Shoelace area, point-in-
    ///      polygon, polygon-polygon overlap) stays bounded — the frontend simplifies a raw GPS
    ///      path (which can have hundreds of points) down to at most this many before submitting.
    uint8 public constant MAX_POLYGON_POINTS = 32;
    uint8 public constant MIN_POLYGON_POINTS = 3;

    event SessionRecorded(
        address indexed player,
        uint8 sessionType,
        int32[] lats,
        int32[] lngs,
        uint32 distanceMeters,
        uint32 durationSeconds,
        uint256 sessionId
    );

    uint256 public nextSessionId = 1;

    /// @param sessionType Claim / Reinforce — see {SessionType}.
    /// @param lats Latitude in micro-degrees (degrees * 1e6) for each polygon vertex, in walking
    ///        order. The loop is implicitly closed (last vertex connects back to the first) —
    ///        do not repeat the first point at the end.
    /// @param lngs Longitude in micro-degrees (degrees * 1e6), parallel to `lats`.
    /// @param distanceMeters Total real-world distance walked during this session, in meters.
    ///        Used by the game contract as a basic anti-spoofing check (average speed cap).
    /// @param durationSeconds Wall-clock duration of the session, in seconds.
    function recordSession(
        uint8 sessionType,
        int32[] calldata lats,
        int32[] calldata lngs,
        uint32 distanceMeters,
        uint32 durationSeconds
    ) external returns (uint256 sessionId) {
        require(sessionType <= uint8(SessionType.Reinforce), "TerraSession: invalid session type");
        require(lats.length == lngs.length, "TerraSession: lats/lngs length mismatch");
        require(lats.length >= MIN_POLYGON_POINTS, "TerraSession: polygon needs at least 3 points");
        require(lats.length <= MAX_POLYGON_POINTS, "TerraSession: polygon has too many points");
        require(distanceMeters > 0, "TerraSession: distance must be > 0");
        require(durationSeconds > 0, "TerraSession: duration must be > 0");

        sessionId = nextSessionId++;

        emit SessionRecorded(msg.sender, sessionType, lats, lngs, distanceMeters, durationSeconds, sessionId);
    }
}
