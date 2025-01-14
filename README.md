# MultiSig Wallet

A secure and efficient k-of-n multisignature wallet implementation using EIP-712 typed signatures. This contract allows multiple parties to jointly control funds and execute transactions through a consensus mechanism.

## Architecture

### Core Components

1. **Transaction Management**
   - Single-step transaction submission and execution
   - Nonce-based replay protection per signer
   - Custom error handling for better gas efficiency
   - OpenZeppelin's ReentrancyGuard for secure execution

2. **Signer Management**
   - Single-step signer updates with required signatures
   - K-of-N threshold configuration
   - Ordered signer array validation
   - Zero-address and duplicate prevention

3. **Signature Verification**
   - EIP-712 compliant typed signatures
   - Secure signature recovery using OpenZeppelin's ECDSA
   - Chain-specific nonce and chainId for replay protection
   - Per-signer nonces for transaction ordering

### Custom Errors

```solidity
error InvalidSigner();
error DuplicateSigner();
error NotEnoughSignatures();
error InvalidThreshold();
error NotEnoughSigners();
error SignerZeroAddress();
error SignerArrayNotOrdered();
error TransactionDoesNotExist();
error SignatureAlreadyUsed();
error EmptyTransaction();
error InvalidNonce();
```

### EIP-712 Types

```solidity
Transaction(uint256 id,address to,uint256 value,bytes data,uint256 chainId,uint256 chainNonce)
SignerUpdate(uint256 id,address[] signers,uint256 minNumberOfSigners,uint256 chainId,uint256 chainNonce)
```

## Installation

```bash
# Clone the repository
git clone https://github.com/lucasallan/multisig-wallet.git
cd multisig-wallet

# Install dependencies
npm install
```

## Usage Examples

### Deploying the Contract

```javascript
const signers = [
    "0x1234...", // First signer address
    "0x5678...", // Second signer address
    "0x9abc..."  // Third signer address
].sort(); // Addresses must be sorted in ascending order

const threshold = 2; // Number of required signatures

const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
const wallet = await MultiSigWallet.deploy(signers, threshold);
await wallet.deployed();
```

### Submitting a Transaction

```javascript
// Transaction details
const to = "0xdest...";
const value = ethers.utils.parseEther("1.0");
const data = "0x"; // For simple ETH transfers

// Get the transaction hash and sign it
const id = await wallet.transactionCount();
const domain = {
    name: "MultiSigWallet",
    version: "1",
    chainId: await wallet.chainId(),
    verifyingContract: wallet.address
};

const types = {
    Transaction: [
        { name: "id", type: "uint256" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "chainId", type: "uint256" },
        { name: "chainNonce", type: "uint256" }
    ]
};

const value = {
    id: id,
    to: to,
    value: value,
    data: data,
    chainId: await wallet.chainId(),
    chainNonce: await wallet.chainNonce()
};

// Collect signatures from signers
const signatures = [];
const signersNonces = [];
for (const signer of signers.slice(0, threshold)) {
    const signerWallet = new ethers.Wallet(signerPrivateKey);
    signatures.push(await signerWallet._signTypedData(domain, types, value));
    signersNonces.push(await wallet.getSignerNonce(signer));
}

// Submit and execute the transaction
await wallet.submitTransaction(to, value, data, signatures, signersNonces);
```

## Testing

The contract includes a comprehensive test suite. To run the tests:

```bash
# Run all tests
npx hardhat test

```

## License

MIT
