// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TerraToken ($TERRA)
/// @notice Testnet-only ERC20 used to buy km-wallet capacity (Slots) in TerraChainGame.
/// @dev Public `faucet()` mint so playtesters don't need a separate token faucet during the
///      hackathon. Remove/guard this before any real deployment.
contract TerraToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 1e18;

    constructor() ERC20("TerraChain Token", "TERRA") {}

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
