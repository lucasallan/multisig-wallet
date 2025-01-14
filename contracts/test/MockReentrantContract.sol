// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../MultiSigWallet.sol";

contract MockReentrantContract {
    MultiSigWallet public wallet;
    uint256 public attackCount;
    uint256 public targetTransactionId;

    constructor(address payable _wallet) {
        wallet = MultiSigWallet(_wallet);
    }

    receive() external payable {
        if (attackCount < 2) {
            attackCount++;
            wallet.submitTransaction(address(this), 0, "", new bytes[](0), new uint256[](0));
        }
    }

    fallback() external payable {}

    function setTargetTransactionId(uint256 _id) external {
        targetTransactionId = _id;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
