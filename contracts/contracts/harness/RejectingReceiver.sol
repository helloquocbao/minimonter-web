// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Test-only: a contract that always rejects incoming native transfers. Used to prove that
///      a hostile (or simply broken) payout recipient can never lock funds or block duel
///      settlement / zone payouts — the game credits them via pendingPayouts instead.
contract RejectingReceiver {
    /// @dev Lets this contract call arbitrary functions on the game (e.g. acceptDuel with a
    ///      stake) while still refusing to accept anything back.
    function callWithValue(address target, bytes calldata data, uint256 value) external payable {
        (bool ok, ) = target.call{value: value}(data);
        require(ok, "RejectingReceiver: inner call failed");
    }

    receive() external payable {
        revert("RejectingReceiver: I never accept ETH");
    }
}
