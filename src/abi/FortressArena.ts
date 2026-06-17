// ABI for FortressArena.sol — keep in sync if you change the contract.
export const FORTRESS_ARENA_ABI = [
  "function deployFortress(bytes32 commit, uint16 entropyBits) external payable returns (uint256 id)",
  "function recordSurvival(uint256 id) external",
  "function crackFortress(uint256 id, bytes32 preimage, bytes32 salt) external",
  "function withdrawFortress(uint256 id) external",
  "function fortressCount() external view returns (uint256)",
  "function getPlayerCount() external view returns (uint256)",
  "function players(address) external view returns (uint128 score, uint64 defended, uint64 cracked, bool exists)",
  "function getPlayers(uint256 offset, uint256 limit) external view returns (address[] addrs, uint128[] scores, uint64[] defended, uint64[] cracked)",
  "function getActiveFortresses(uint256 offset, uint256 limit) external view returns (uint256[] ids, address[] owners, uint96[] bounties, uint16[] entropy)",
  "event FortressDeployed(uint256 indexed id, address indexed owner, uint96 bounty, uint16 entropyBits)",
  "event SiegeSurvived(uint256 indexed id, address indexed owner, uint128 newScore)",
  "event FortressCracked(uint256 indexed id, address indexed attacker, address indexed owner, uint96 bounty)",
  "event FortressWithdrawn(uint256 indexed id, address indexed owner, uint96 bounty)",
] as const;
