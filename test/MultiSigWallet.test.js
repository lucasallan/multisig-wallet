const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let multiSigWallet;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let addr4;
  let addrs;

  async function signTransaction(signer, transactionId, to, value, data) {
    const chainId = await multiSigWallet.chainId();
    const domain = {
      name: 'MultiSigWallet',
      version: '1',
      chainId: chainId,
      verifyingContract: await multiSigWallet.getAddress()
    };

    const types = {
      Transaction: [
        { name: 'id', type: 'uint256' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'signersNonce', type: 'uint256' },
        { name: 'chainId', type: 'uint256' }
      ]
    };

    const signersNonce = await multiSigWallet.getSignerNonce(signer.address);
    const message = {
      id: transactionId,
      to: to,
      value: value,
      data: data,
      signersNonce: signersNonce,
      chainId: chainId
    };

    return await signer.signTypedData(domain, types, message);
  }

  async function signSignerUpdate(signer, id, signersNonce, newSigners, minSigners) {
    const chainId = await multiSigWallet.chainId();
    const domain = {
      name: "MultiSigWallet",
      version: "1",
      chainId: chainId,
      verifyingContract: await multiSigWallet.getAddress()
    };

    const types = {
      SignerUpdate: [
        { name: "id", type: "uint256" },
        { name: "signersNonce", type: "uint256" },
        { name: "signers", type: "address[]" },
        { name: "minNumberOfSigners", type: "uint256" },
        { name: "chainId", type: "uint256" }
      ]
    };

    const message = {
      id: id,
      signersNonce: signersNonce,
      signers: newSigners,
      minNumberOfSigners: minSigners,
      chainId: chainId
    };

    return await signer.signTypedData(domain, types, message);
  }

  beforeEach(async function () {
    [owner, addr1, addr2, addr3, addr4,...addrs] = await ethers.getSigners();

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    const orderedSigners = [owner, addr1, addr2].map(s => s.address).sort();
    multiSigWallet = await MultiSigWallet.deploy(orderedSigners, 2);
    await multiSigWallet.waitForDeployment();
  });

  describe("Constructor", function () {
    it("Should set the correct signers and threshold", async function () {
      expect(await multiSigWallet.isSigner(owner.address)).to.be.true;
      expect(await multiSigWallet.isSigner(addr1.address)).to.be.true;
      expect(await multiSigWallet.isSigner(addr2.address)).to.be.true;
      expect(await multiSigWallet.threshold()).to.equal(2);
    });

    it("Should revert if trying to deploy with invalid parameters", async function () {
      const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
      
      await expect(
        MultiSigWallet.deploy([owner.address, owner.address, addr1.address], 1)
      ).to.be.revertedWithCustomError(MultiSigWallet, "SignerArrayNotOrdered");

      await expect(
        MultiSigWallet.deploy([owner.address, ethers.ZeroAddress], 1)
      ).to.be.revertedWithCustomError(MultiSigWallet, "SignerZeroAddress");

      await expect(
        MultiSigWallet.deploy([owner.address, addr1.address], 0)
      ).to.be.revertedWithCustomError(MultiSigWallet, "InvalidThreshold");

      await expect(
        MultiSigWallet.deploy([owner.address, addr1.address], 1)
      ).to.be.revertedWithCustomError(MultiSigWallet, "SignerArrayNotOrdered");
    });
  });

  describe("Transaction Submission and Execution", function () {
    it("Should submit and execute a valid transaction", async function () {
      const to = addr3.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";
      const transactionId = 0;

      await owner.sendTransaction({
        to: await multiSigWallet.getAddress(),
        value: value
      });

      const sig1 = await signTransaction(owner, transactionId, to, value, data);
      const sig2 = await signTransaction(addr1, transactionId, to, value, data);

      const initialBalance = await ethers.provider.getBalance(to);

      const sig1Nonce = await multiSigWallet.getSignerNonce(owner.address);
      const sig2Nonce = await multiSigWallet.getSignerNonce(addr1.address);

      await multiSigWallet.submitTransaction(to, value, data, [sig1, sig2], [sig1Nonce, sig2Nonce]);

      const finalBalance = await ethers.provider.getBalance(to);
      expect(finalBalance - initialBalance).to.equal(value);
    });

    it("Should revert with invalid signatures", async function () {
      const to = addr3.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";
      const transactionId = 0;
      const nonce = 0;

      const sig1 = await signTransaction(owner, transactionId, to, value, data);
      const sig2 = await signTransaction(addr3, transactionId, to, value, data);

      await expect(
        multiSigWallet.submitTransaction(to, value, data, [sig1, sig2], [nonce, nonce])
      ).to.be.revertedWithCustomError(multiSigWallet, "InvalidSigner");
    });

    it("Should revert with not enough signatures", async function () {
      const to = addr3.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";
      const transactionId = 0;
      const nonce = 0;

      // Get only one signature
      const sig = await signTransaction(owner, transactionId, to, value, data);

      await expect(
        multiSigWallet.submitTransaction(to, value, data, [sig], [nonce])
      ).to.be.revertedWithCustomError(multiSigWallet, "NotEnoughSignatures");
    });
  });

  describe("Transaction submission", function () {
    it("Should revert when invalid nonce is provided", async function () {
      const to = addr1.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";
      const validNonce = 0;
      const invalidNonce = 999; // Using an incorrect nonce
      
      const sig1 = await signTransaction(
        owner,
        0, // transactionId
        to,
        value,
        data
      );
      
      const sig2 = await signTransaction(
        addr1,
        0, // transactionId
        to,
        value,
        data
      );

      await expect(
        multiSigWallet.submitTransaction(
          to,
          value,
          data,
          [sig1, sig2],
          [invalidNonce, validNonce] // First signer has invalid nonce
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "InvalidNonce");
    });
  });

  describe("Signer Update", function () {
    it("Should update the signer set", async function () {
      // Get current signers from contract deployment
      const currentSigners = [owner.address, addr1.address, addr2.address].sort();
      const newSigners = [addr1.address, addr2.address, addr3.address].sort();
      const minSigners = 2;
      
      // Create map of addresses to signers for the current signers
      const signerMap = {};
      for (let addr of currentSigners) {
        if (addr === owner.address) signerMap[addr] = owner;
        if (addr === addr1.address) signerMap[addr] = addr1;
        if (addr === addr2.address) signerMap[addr] = addr2;
      }
      
      // Get nonces for the first two signers (meeting threshold)
      const signer1 = signerMap[currentSigners[0]];
      const signer2 = signerMap[currentSigners[1]];
      const sig1Nonce = await multiSigWallet.getSignerNonce(signer1.address);
      const sig2Nonce = await multiSigWallet.getSignerNonce(signer2.address);

      // Get the next proposal ID
      const proposalId = await multiSigWallet.getSignerUpdateProposalCount();

      // Generate signatures in order
      const sig1 = await signSignerUpdate(signer1, proposalId, sig1Nonce, newSigners, minSigners);
      const sig2 = await signSignerUpdate(signer2, proposalId, sig2Nonce, newSigners, minSigners);

      // Submit signatures in the same order as the nonces
      await multiSigWallet.newSigners(
        newSigners,
        minSigners,
        [sig1, sig2],
        [sig1Nonce, sig2Nonce]
      );

      // Verify new signers
      for (let signer of newSigners) {
        expect(await multiSigWallet.isSigner(signer)).to.be.true;
      }
      expect(await multiSigWallet.isSigner(owner.address)).to.be.false;
      expect(await multiSigWallet.threshold()).to.equal(minSigners);
    });

    it("Should revert with not enough signatures", async function () {
      const newSigners = [addr1.address, addr2.address, addr3.address].sort();
      const minSigners = 2;

      // Empty signatures array should revert with NotEnoughSignatures
      await expect(
        multiSigWallet.newSigners(
          newSigners,
          minSigners,
          [],
          []
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "NotEnoughSignatures");
    });

    it("Should revert with invalid signature length", async function () {
      const newSigners = [addr1.address, addr2.address, addr3.address].sort();
      const minSigners = 2;
      const proposalId = await multiSigWallet.getSignerUpdateProposalCount();
      const nonce = await multiSigWallet.getSignerNonce(owner.address);

      const sig1 = await signSignerUpdate(owner, proposalId, nonce, newSigners, minSigners);

      // Mismatched lengths between signatures and nonces should revert with InvalidSigner
      await expect(
        multiSigWallet.newSigners(
          newSigners,
          minSigners,
          [sig1],
          [nonce, nonce] // Two nonces but one signature
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "InvalidSigner");
    });

    it("Should revert with invalid nonce", async function () {
      const currentSigners = [owner.address, addr1.address, addr2.address].sort();
      const newSigners = [addr1.address, addr2.address, addr3.address].sort();
      const minSigners = 2;
      const proposalId = await multiSigWallet.getSignerUpdateProposalCount();

      // Get valid nonces for both signers
      const ownerNonce = await multiSigWallet.getSignerNonce(owner.address);
      const addr1Nonce = await multiSigWallet.getSignerNonce(addr1.address);
      const invalidNonce = Number(ownerNonce) + 1; // Convert to number before adding

      // Use two valid signers (owner and addr1) but with an invalid nonce for owner
      const sig1 = await signSignerUpdate(owner, proposalId, invalidNonce, newSigners, minSigners);
      const sig2 = await signSignerUpdate(addr1, proposalId, addr1Nonce, newSigners, minSigners);

      // Submit with invalid nonce for owner (who is a valid signer)
      await expect(
        multiSigWallet.newSigners(
          newSigners,
          minSigners,
          [sig1, sig2],
          [invalidNonce, addr1Nonce] // First nonce is invalid
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "InvalidNonce");
    });

    it("Should revert with invalid signatures", async function () {
      const currentSigners = [owner.address, addr1.address, addr2.address].sort();
      const newSigners = [addr1.address, addr2.address, addr3.address].sort();
      const minSigners = 2;
      const proposalId = await multiSigWallet.getSignerUpdateProposalCount();
      const nonce = await multiSigWallet.getSignerNonce(owner.address);

      // Use owner (valid signer) and addr3 (invalid signer)
      const sig1 = await signSignerUpdate(owner, proposalId, nonce, newSigners, minSigners);
      const sig2 = await signSignerUpdate(addr3, proposalId, nonce, newSigners, minSigners); // addr3 is not a current signer

      await expect(
        multiSigWallet.newSigners(
          newSigners,
          minSigners,
          [sig1, sig2],
          [nonce, nonce]
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "InvalidSigner");
    });

    it("Should revert if signers are not in ascending order", async function () {
      const unorderedSigners = [owner.address, addr2.address, addr1.address]; // Not sorted
      const minSigners = 2;
      const id = 0;
      const nonce = 0;

      const sig1 = await signSignerUpdate(owner, id, nonce, unorderedSigners, minSigners);
      const sig2 = await signSignerUpdate(addr1, id, nonce, unorderedSigners, minSigners);

      await expect(
        multiSigWallet.newSigners(
          unorderedSigners,
          minSigners,
          [sig1, sig2],
          [nonce, nonce]
        )
      ).to.be.revertedWithCustomError(multiSigWallet, "SignerArrayNotOrdered");
    });
  });

  describe("Receive Function", function () {
    it("Should accept ETH transfers", async function () {
      const amount = ethers.parseEther("1.0");
      const contractAddress = await multiSigWallet.getAddress();
      
      await owner.sendTransaction({
        to: contractAddress,
        value: amount
      });

      expect(await ethers.provider.getBalance(contractAddress)).to.equal(amount);
    });
  });
});
