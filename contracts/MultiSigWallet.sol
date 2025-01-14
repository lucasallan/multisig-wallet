// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigWallet
 * @dev Implements a k-of-n multisig wallet with EIP-712 typed signatures
 */
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

error InvalidSigner();
error DuplicateSigner();
error NotEnoughSignatures();
error InvalidThreshold();
error NotEnoughSigners();
error SignerZeroAddress();
error SignerArrayNotOrdered();
error SignatureAlreadyUsed();
error EmptyTransaction();
error InvalidNonce();

contract MultiSigWallet is ReentrancyGuard {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    
    bytes32 private constant TRANSACTION_TYPEHASH = keccak256(
        "Transaction(uint256 id,address to,uint256 value,bytes data,uint256 chainId,uint256 chainNonce)"
    );
    
    bytes32 private constant SIGNER_UPDATE_TYPEHASH = keccak256(
        "SignerUpdate(uint256 id,address[] signers,uint256 minNumberOfSigners,uint256 chainId,uint256 chainNonce)"
    );

    event SignersUpdated(uint256 id, address indexed submitter);
    event TransactionExecuted(uint256 indexed id, address indexed executor, bool success);

    struct Transaction {
        uint256 id;
        address to;
        uint256 value;
        bytes data;
        mapping(address => bool) hasSignedMap;
        uint256 signatureCount;
    }

    struct SignerUpdateProposal {
        uint256 id;
        address[] signers;
        uint256 minNumberOfSigners;
        mapping(address => bool) hasSignedMap;
        uint256 signatureCount;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => SignerUpdateProposal) public signerUpdateProposals;
    mapping(bytes32 => bool) public seenSignatures;
    mapping(address => uint256) public signersNonces;

    address[] public signers;
    uint256 public threshold;
    uint256 public immutable chainNonce;
    uint256 public immutable chainId;

    bytes32 private immutable DOMAIN_SEPARATOR;
    uint256 private signerUpdateProposalCount;
    uint256 private transactionCount;

    using ECDSA for bytes32;

    constructor(address[] memory _signers, uint256 _threshold) {
        _validateSigners(_signers, _threshold);

        for (uint256 i = 0; i < _signers.length; i++) {
            signers.push(_signers[i]);
        }

        threshold = _threshold;
        chainNonce = block.timestamp; // Use deployment time as unique chain nonce
        string memory version = "1";
        chainId = block.chainid;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("MultiSigWallet")),
                keccak256(bytes(version)),
                chainId,
                address(this)
            )
        );
    }

    // External functions

    /**
     * @notice Submit and execute a new transaction with the required signatures
     * @param _to The destination address for the transaction
     * @param _value The amount of ETH to send with the transaction
     * @param _data The calldata to send with the transaction
     * @param _signatures Array of signatures authorizing the transaction
     * @param _signersNonces Array of nonces corresponding to each signer
     * @return The ID of the submitted transaction
     */
    function submitTransaction(
        address _to,
        uint256 _value,
        bytes memory _data,
        bytes[] memory _signatures,
        uint256[] memory _signersNonces
    ) external nonReentrant returns (uint256) {
        if (_to == address(0)) revert EmptyTransaction();
        if (_signatures.length < threshold) revert NotEnoughSignatures();
        if (_signersNonces.length != _signatures.length) revert InvalidNonce();

        uint256 _id = transactionCount++;
        Transaction storage transaction = transactions[_id];
        transaction.id = _id;
        transaction.to = _to;
        transaction.value = _value;
        transaction.data = _data;
        
        bytes32 transactionHash = _hashTransaction(_id, _to, _value, _data);

        for (uint256 i = 0; i < _signatures.length; i++) {
            address signer = _recoverSigner(transactionHash, _signatures[i]);
            if (signersNonces[signer] != _signersNonces[i]) revert InvalidNonce();
            
            if (!isSigner(signer)) revert InvalidSigner();
            if (transaction.hasSignedMap[signer]) revert SignatureAlreadyUsed();
            
            transaction.hasSignedMap[signer] = true;
            signersNonces[signer]++;
            transaction.signatureCount++;
        }

        if (transaction.signatureCount < threshold) revert NotEnoughSignatures();

        (bool success, ) = _to.call{value: _value}(_data);
        emit TransactionExecuted(_id, msg.sender, success);
        return _id;
    }

    /**
     * @notice Update the set of signers and threshold for the multisig wallet
     * @param _signers New array of signer addresses (must be sorted)
     * @param _minNumberOfSigners New threshold of required signatures
     * @param _signatures Array of current signers' signatures approving the change
     * @param _signersNonce Array of nonces corresponding to each signer
     * @return The ID of the signer update proposal
     */
    function newSigners(
        address[] memory _signers,
        uint256 _minNumberOfSigners,
        bytes[] memory _signatures,
        uint256[] memory _signersNonce
    ) external nonReentrant returns (uint256) {
        if (_signatures.length == 0) revert NotEnoughSignatures();
        if (_signersNonce.length != _signatures.length) revert InvalidSigner();

        _validateSigners(_signers, _minNumberOfSigners);

        uint256 _id = signerUpdateProposalCount++;
        SignerUpdateProposal storage proposal = signerUpdateProposals[_id];
        proposal.id = _id;
        proposal.signers = _signers;
        proposal.minNumberOfSigners = _minNumberOfSigners;

        uint256 _signatureCount = _signatures.length;
        bytes32 updateHash = _hashSignerUpdate(_id, _signers, _minNumberOfSigners);

        for (uint256 i = 0; i < _signatureCount; i++) {
            address signer = _recoverSigner(updateHash, _signatures[i]);
            if (!isSigner(signer)) revert InvalidSigner();
            if (signersNonces[signer] != _signersNonce[i]) revert InvalidNonce();
            if (proposal.hasSignedMap[signer]) revert DuplicateSigner();
            
            proposal.hasSignedMap[signer] = true;
            proposal.signatureCount++;
            signersNonces[signer]++;
        }

        if (proposal.signatureCount < threshold) revert NotEnoughSignatures();

        delete signers;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers.push(_signers[i]);
        }
        threshold = _minNumberOfSigners;
        emit SignersUpdated(_id, msg.sender);
        return _id;
    }

    // Public functions

    /**
     * @notice Checks if an address is one of the authorized signers of the wallet
     * @param _signer The address to check
     * @return bool True if the address is a signer, false otherwise
     */
    function isSigner(address _signer) public view returns (bool) {
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == _signer) {
                return true;
            } else if (signers[i] > _signer) {
                return false;
            }
        }
        return false;
    }

    /**
     * @notice Returns the current nonce for a given signer address
     * @param _signer The address of the signer to query
     * @return The current nonce value for the signer
     */
    function getSignerNonce(address _signer) public view returns (uint256) {
        return signersNonces[_signer];
    }

    /**
     * @notice Returns the domain separator used in EIP-712 structured data hashing
     * @return The domain separator value
     */
    function getDomainSeparator() public view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    // Internal functions

    /**
     * @notice Creates a hash of the transaction data according to EIP-712
     * @param _id Transaction ID
     * @param _to Destination address
     * @param _value ETH value to send
     * @param _data Transaction calldata
     * @return The EIP-712 compatible hash of the transaction
     */
    function _hashTransaction(
        uint256 _id,
        address _to,
        uint256 _value,
        bytes memory _data
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSACTION_TYPEHASH,
                _id,
                _to,
                _value,
                keccak256(_data),
                chainId,
                chainNonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /**
     * @notice Creates a hash of the signer update data according to EIP-712
     * @param _id Proposal ID
     * @param _signers New signer addresses
     * @param _minNumberOfSigners New threshold
     * @return The EIP-712 compatible hash of the signer update
     */
    function _hashSignerUpdate(
        uint256 _id,
        address[] memory _signers,
        uint256 _minNumberOfSigners
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SIGNER_UPDATE_TYPEHASH,
                _id,
                keccak256(abi.encodePacked(_signers)),
                _minNumberOfSigners,
                chainId,
                chainNonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // Private functions

    /**
     * @notice Recovers the signer address from a signature
     * @param hash The hash that was signed
     * @param signature The signature to verify
     * @return The address that created the signature
     */
    function _recoverSigner(bytes32 hash, bytes memory signature) private pure returns (address) {
        return hash.recover(signature);
    }

    /**
     * @notice Validates the new signers array and threshold
     * @param _signers Array of new signer addresses
     * @param _minNumberOfSigners New threshold value
     */
    function _validateSigners(address[] memory _signers, uint256 _minNumberOfSigners) private pure {
        if (_minNumberOfSigners == 0) revert InvalidThreshold();
        if (_signers.length == 0) revert NotEnoughSigners();
        if (_signers.length < _minNumberOfSigners) revert InvalidThreshold();

        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == address(0)) revert SignerZeroAddress();
            
            if (i > 0 && _signers[i] <= _signers[i - 1]) revert SignerArrayNotOrdered();
        }
    }

    // Special functions

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}
