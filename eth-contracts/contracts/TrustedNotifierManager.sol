pragma solidity ^0.5.0;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "./Governance.sol";
import "./InitializableV2.sol";


contract TrustedNotifierManager is InitializableV2 {
    using SafeMath for uint256;

    address governanceAddress;

    /// @notice All fields - wallet, endpoint, email - are unique
    struct TrustedNotifier {
        address wallet;
        string endpoint;
        string email;
    }

    uint256 private latestID;

    mapping(uint256 => TrustedNotifier) IDToTrustedNotifierMap;

    /// @notice wallet is unique - i.e. each wallet maps to at most one ID
    mapping(address => uint256) walletToIDMap;

    /// @notice endpoint is unique - i.e. each endpoint maps to at most one ID
    mapping(bytes32 => uint256) endpointToIDMap;

    /// @notice email is unique - i.e. each email maps to at most one ID
    mapping(bytes32 => uint256) emailToIDMap;

    function initialize (
        address _governanceAddress,
        address _initialNotifierWallet,
        string memory _initialNotiferEndpoint,
        string memory _initialNotiferEmail
    ) public initializer {
        _updateGovernanceAddress(_governanceAddress);

        uint256 ID = latestID.add(1);
        latestID = ID;

        IDToTrustedNotifierMap[ID] = TrustedNotifier({
            wallet: _initialNotifierWallet,
            endpoint: _initialNotiferEndpoint,
            email: _initialNotiferEmail
        });

        walletToIDMap[_initialNotifierWallet] = ID;

        endpointToIDMap[keccak256(bytes(_initialNotiferEndpoint))] = ID;

        emailToIDMap[keccak256(bytes(_initialNotiferEmail))] = ID;

        InitializableV2.initialize();
    }

    function registerNotifier(
        address _wallet, string calldata _endpoint, string calldata _email
    ) external returns (uint256) {
        _requireIsInitialized();

        require(
            msg.sender == governanceAddress,
            "TrustedNotifierManager: Only callable by Governance contract."
        );

        // Ensure wallet isn't already registered
        require(
            walletToIDMap[_wallet] == 0,
            "TrustedNotifierManager: Wallet already registered."
        );

        // Ensure endpoint isn't already registered
        require(
            endpointToIDMap[keccak256(bytes(_endpoint))] == 0,
            "TrustedNotifierManager: Endpoint already registered."
        );

        // Ensure email isn't already registered
        require(
            emailToIDMap[keccak256(bytes(_email))] == 0,
            "TrustedNotifierManager: Email already registered."
        );

        uint256 ID = latestID.add(1);
        latestID = ID;

        IDToTrustedNotifierMap[ID] = TrustedNotifier({
            wallet: _wallet,
            endpoint: _endpoint,
            email: _email
        });

        walletToIDMap[_wallet] = ID;

        endpointToIDMap[keccak256(bytes(_endpoint))] = ID;

        emailToIDMap[keccak256(bytes(_email))] = ID;

        return ID;
    }

    function deregisterNotifier(address _wallet) external returns (uint256) {
        _requireIsInitialized();

        require(
            msg.sender == governanceAddress || msg.sender == _wallet,
            "TrustedNotifierManager: Only callable by Governance contract or _wallet."
        );

        uint256 ID = walletToIDMap[_wallet];
        TrustedNotifier memory notifier = IDToTrustedNotifierMap[ID];

        delete IDToTrustedNotifierMap[ID];
        delete walletToIDMap[_wallet];
        delete endpointToIDMap[keccak256(bytes(notifier.endpoint))];
        delete emailToIDMap[keccak256(bytes(notifier.email))];

        return ID;
    }

    function getLatestNotifierID() external view returns (uint256) {
        return latestID;
    }

    function getNotifierForID(uint256 _ID) external view
    returns (address wallet, string memory endpoint, string memory email) {
        TrustedNotifier memory notifier = IDToTrustedNotifierMap[_ID];
        return (notifier.wallet, notifier.endpoint, notifier.email);
    }

    function getNotifierForWallet(address _wallet) external view
    returns (uint256 ID, string memory endpoint, string memory email) {
        uint256 notifierID = walletToIDMap[_wallet];
        TrustedNotifier memory notifier = IDToTrustedNotifierMap[notifierID];
        return (notifierID, notifier.endpoint, notifier.email);
    }

    function getNotifierForEndpoint(string calldata _endpoint) external view
    returns (uint256 ID, address wallet, string memory email) {
        uint256 notifierID = endpointToIDMap[keccak256(bytes(_endpoint))];
        TrustedNotifier memory notifier = IDToTrustedNotifierMap[notifierID];
        return (notifierID, notifier.wallet, notifier.email);
    }

    function getNotifierForEmail(string calldata _email) external view
    returns (uint256 ID, address wallet, string memory endpoint) {
        uint256 notifierID = emailToIDMap[keccak256(bytes(_email))];
        TrustedNotifier memory notifier = IDToTrustedNotifierMap[notifierID];
        return (notifierID, notifier.wallet, notifier.endpoint);
    }

    /// @notice Get the Governance address
    function getGovernanceAddress() external view returns (address) {
        _requireIsInitialized();

        return governanceAddress;
    }

    /**
     * @notice Set the Governance address
     * @dev Only callable by Governance address
     * @param _governanceAddress - address for new Governance contract
     */
    function setGovernanceAddress(address _governanceAddress) external {
        _requireIsInitialized();

        require(
            msg.sender == governanceAddress,
            "TrustedNotifierManager: Only callable by Governance contract"
        );
        _updateGovernanceAddress(_governanceAddress);
    }

    // ========================================= Internal Functions =========================================

    /**
     * @notice Set the governance address after confirming contract identity
     * @param _governanceAddress - Incoming governance address
     */
    function _updateGovernanceAddress(address _governanceAddress) internal {
        require(
            Governance(_governanceAddress).isGovernanceAddress() == true,
            "ServiceTypeManager: _governanceAddress is not a valid governance contract"
        );
        governanceAddress = _governanceAddress;
    }
}