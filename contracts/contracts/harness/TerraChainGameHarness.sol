// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TerraChainGame} from "../TerraChainGame.sol";

/// @dev Test-only harness exposing internal game logic so it can be unit tested without a live
///      Attestcoin precompile (which only exists on real Creditcoin networks, not local Hardhat).
contract TerraChainGameHarness is TerraChainGame {
    function exposeHandleClaim(
        address player,
        uint256 sessionId,
        int32[] calldata lats,
        int32[] calldata lngs,
        uint32 walkedMeters
    ) external {
        _handleClaim(player, sessionId, lats, lngs, walkedMeters);
    }

    function exposeHandleReinforce(
        address player,
        uint256 sessionId,
        int32[] calldata lats,
        int32[] calldata lngs,
        uint32 walkedMeters
    ) external {
        _handleReinforce(player, sessionId, lats, lngs, walkedMeters);
    }
}
