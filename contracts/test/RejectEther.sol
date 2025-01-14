// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract RejectEther {
    receive() external payable {
        revert("ETH transfers not accepted");
    }
}
