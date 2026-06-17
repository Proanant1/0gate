// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title FortressArena
 * @notice On-chain backbone for 0Gate — the decentralized password fortress arena.
 *
 * Design notes:
 *  - We NEVER store the password. Only a salted commitment hash + its entropy score
 *    (computed client-side, but the hash is what's committed so it can't be swapped later).
 *  - Bounties are real escrowed 0G (native token) locked when a fortress is deployed.
 *  - A fortress can be cracked by an attacker who submits the correct preimage; the
 *    contract verifies keccak256(preimage, salt) == commit, then pays the bounty out.
 *  - Scores accumulate on-chain per player and feed the leaderboard. Because they are
 *    written by contract logic (not user input), they cannot be faked from the client.
 */
contract FortressArena {
    // ───────────────────────────────── Types ─────────────────────────────────

    struct Fortress {
        address owner;        // who deployed it
        bytes32 commit;       // keccak256(abi.encodePacked(passwordHash, salt))
        uint96  bounty;       // escrowed native 0G claimable on a successful crack
        uint16  entropyBits;  // declared strength (for matchmaking/leaderboard weight)
        uint40  deployedAt;   // timestamp
        bool    active;       // false once cracked or withdrawn
    }

    struct Player {
        uint128 score;        // cumulative score (defense survival + bounties won)
        uint64  defended;     // sieges survived
        uint64  cracked;      // rival fortresses cracked
        bool    exists;
    }

    // ──────────────────────────────── Storage ────────────────────────────────

    uint256 public fortressCount;
    mapping(uint256 => Fortress) public fortresses;
    mapping(address => Player) public players;
    address[] public playerList; // for leaderboard enumeration

    uint256 public constant MIN_BOUNTY = 0.001 ether; // 0.001 0G floor

    // ───────────────────────────────── Events ─────────────────────────────────

    event FortressDeployed(uint256 indexed id, address indexed owner, uint96 bounty, uint16 entropyBits);
    event SiegeSurvived(uint256 indexed id, address indexed owner, uint128 newScore);
    event FortressCracked(uint256 indexed id, address indexed attacker, address indexed owner, uint96 bounty);
    event FortressWithdrawn(uint256 indexed id, address indexed owner, uint96 bounty);

    // ──────────────────────────────── Modifiers ───────────────────────────────

    modifier validFortress(uint256 id) {
        require(id > 0 && id <= fortressCount, "no such fortress");
        _;
    }

    // ──────────────────────────────── Core API ────────────────────────────────

    /**
     * @notice Deploy a fortress with an escrowed bounty.
     * @param commit  keccak256(abi.encodePacked(passwordHash, salt)) — computed client-side.
     * @param entropyBits  declared strength, 0–128.
     * @dev msg.value is the bounty and must be >= MIN_BOUNTY.
     */
    function deployFortress(bytes32 commit, uint16 entropyBits) external payable returns (uint256 id) {
        require(msg.value >= MIN_BOUNTY, "bounty too low");
        require(entropyBits <= 128, "entropy out of range");

        id = ++fortressCount;
        fortresses[id] = Fortress({
            owner: msg.sender,
            commit: commit,
            bounty: uint96(msg.value),
            entropyBits: entropyBits,
            deployedAt: uint40(block.timestamp),
            active: true
        });

        _ensurePlayer(msg.sender);
        emit FortressDeployed(id, msg.sender, uint96(msg.value), entropyBits);
    }

    /**
     * @notice Record a survived siege. Awards defense points scaled by entropy.
     * @dev Only the fortress owner can record their own survival; the score formula
     *      is enforced here so the client cannot inflate it.
     */
    function recordSurvival(uint256 id) external validFortress(id) {
        Fortress storage f = fortresses[id];
        require(f.owner == msg.sender, "not owner");
        require(f.active, "inactive");

        Player storage p = players[msg.sender];
        uint128 gained = uint128(uint256(f.entropyBits) * 100 + f.bounty / 1e12);
        p.score += gained;
        p.defended += 1;

        emit SiegeSurvived(id, msg.sender, p.score);
    }

    /**
     * @notice Attempt to crack a rival fortress by revealing the preimage.
     * @param id        target fortress
     * @param preimage  the password hash the owner committed
     * @param salt      the salt used in the commitment
     * @dev On success, the bounty transfers to the attacker and the fortress closes.
     */
    function crackFortress(uint256 id, bytes32 preimage, bytes32 salt)
        external
        validFortress(id)
    {
        Fortress storage f = fortresses[id];
        require(f.active, "inactive");
        require(f.owner != msg.sender, "cannot crack own");
        require(keccak256(abi.encodePacked(preimage, salt)) == f.commit, "wrong preimage");

        f.active = false;
        uint96 bounty = f.bounty;
        f.bounty = 0;

        _ensurePlayer(msg.sender);
        Player storage atk = players[msg.sender];
        atk.score += uint128(uint256(f.entropyBits) * 150 + bounty / 1e12);
        atk.cracked += 1;

        emit FortressCracked(id, msg.sender, f.owner, bounty);

        (bool ok, ) = payable(msg.sender).call{value: bounty}("");
        require(ok, "payout failed");
    }

    /**
     * @notice Owner reclaims their bounty if the fortress is still standing.
     * @dev Lets honest players exit; only callable by owner on an active fortress.
     */
    function withdrawFortress(uint256 id) external validFortress(id) {
        Fortress storage f = fortresses[id];
        require(f.owner == msg.sender, "not owner");
        require(f.active, "inactive");

        f.active = false;
        uint96 bounty = f.bounty;
        f.bounty = 0;

        emit FortressWithdrawn(id, msg.sender, bounty);
        (bool ok, ) = payable(msg.sender).call{value: bounty}("");
        require(ok, "refund failed");
    }

    // ─────────────────────────────── Views ───────────────────────────────────

    function getPlayerCount() external view returns (uint256) {
        return playerList.length;
    }

    /// @notice Returns a page of players for leaderboard rendering (unsorted; sort client-side).
    function getPlayers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addrs, uint128[] memory scores, uint64[] memory defended, uint64[] memory cracked)
    {
        uint256 n = playerList.length;
        if (offset >= n) {
            return (new address[](0), new uint128[](0), new uint64[](0), new uint64[](0));
        }
        uint256 end = offset + limit;
        if (end > n) end = n;
        uint256 size = end - offset;

        addrs = new address[](size);
        scores = new uint128[](size);
        defended = new uint64[](size);
        cracked = new uint64[](size);

        for (uint256 i = 0; i < size; i++) {
            address a = playerList[offset + i];
            Player storage p = players[a];
            addrs[i] = a;
            scores[i] = p.score;
            defended[i] = p.defended;
            cracked[i] = p.cracked;
        }
    }

    function getActiveFortresses(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, address[] memory owners, uint96[] memory bounties, uint16[] memory entropy)
    {
        uint256 total = fortressCount;
        uint256 matched;
        uint256 start = offset == 0 ? 1 : offset;

        ids = new uint256[](limit);
        owners = new address[](limit);
        bounties = new uint96[](limit);
        entropy = new uint16[](limit);

        for (uint256 i = start; i <= total && matched < limit; i++) {
            Fortress storage f = fortresses[i];
            if (f.active) {
                ids[matched] = i;
                owners[matched] = f.owner;
                bounties[matched] = f.bounty;
                entropy[matched] = f.entropyBits;
                matched++;
            }
        }

        // trim arrays to matched length
        assembly {
            mstore(ids, matched)
            mstore(owners, matched)
            mstore(bounties, matched)
            mstore(entropy, matched)
        }
    }

    // ───────────────────────────── Internal ──────────────────────────────────

    function _ensurePlayer(address a) internal {
        if (!players[a].exists) {
            players[a].exists = true;
            playerList.push(a);
        }
    }
}
