import { parseEther, formatEther } from "ethers";
import { getArenaWrite, getArenaRead } from "./chain";
import { buildCommitment } from "./crypto";

export interface DeployResult {
  txHash: string;
  fortressId: number | null;
  salt: string;        // KEEP THIS — needed to prove survival / for the owner's records
  passwordHash: string;
  commit: string;
}

/**
 * Deploy a fortress on-chain with a staked bounty.
 * @param password   raw password (never sent on-chain — only its commitment is)
 * @param entropyBits declared strength
 * @param bountyEth  bounty to escrow, as a string in 0G (e.g. "0.05")
 */
export async function deployFortress(
  password: string,
  entropyBits: number,
  bountyEth: string
): Promise<DeployResult> {
  const { passwordHash, salt, commit } = await buildCommitment(password);
  const arena = await getArenaWrite();

  const tx = await arena.deployFortress(commit, entropyBits, {
    value: parseEther(bountyEth),
  });
  const receipt = await tx.wait();

  // Pull fortressId from the FortressDeployed event
  let fortressId: number | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = arena.interface.parseLog(log);
      if (parsed?.name === "FortressDeployed") {
        fortressId = Number(parsed.args[0]);
        break;
      }
    } catch {
      /* not our event */
    }
  }

  return { txHash: tx.hash, fortressId, salt, passwordHash, commit };
}

/** Record a survived siege on-chain (owner only). Returns tx hash. */
export async function recordSurvival(fortressId: number): Promise<string> {
  const arena = await getArenaWrite();
  const tx = await arena.recordSurvival(fortressId);
  await tx.wait();
  return tx.hash;
}

/**
 * Attempt to crack a rival fortress by revealing the preimage.
 * In a real attack you'd derive these from a cracked password; here the UI
 * supplies a candidate (passwordHash, salt) pair.
 */
export async function crackFortress(
  fortressId: number,
  passwordHashHex: string,
  saltHex: string
): Promise<string> {
  const arena = await getArenaWrite();
  const tx = await arena.crackFortress(fortressId, passwordHashHex, saltHex);
  await tx.wait();
  return tx.hash;
}

export interface PlayerRow {
  address: string;
  score: number;
  defended: number;
  cracked: number;
}

/** Read the leaderboard from chain (returns unsorted; caller sorts by score). */
export async function fetchLeaderboard(limit = 50): Promise<PlayerRow[]> {
  const arena = getArenaRead();
  const [addrs, scores, defended, cracked] = await arena.getPlayers(0, limit);
  const rows: PlayerRow[] = addrs.map((a: string, i: number) => ({
    address: a,
    score: Number(scores[i]),
    defended: Number(defended[i]),
    cracked: Number(cracked[i]),
  }));
  rows.sort((x, y) => y.score - x.score);
  return rows;
}

export interface ArenaFortress {
  id: number;
  owner: string;
  bountyEth: string;
  entropy: number;
}

/** Read active rival fortresses for the Hunt arena. */
export async function fetchActiveFortresses(limit = 24): Promise<ArenaFortress[]> {
  const arena = getArenaRead();
  const [ids, owners, bounties, entropy] = await arena.getActiveFortresses(0, limit);
  return ids.map((id: bigint, i: number) => ({
    id: Number(id),
    owner: owners[i],
    bountyEth: formatEther(bounties[i]),
    entropy: Number(entropy[i]),
  }));
}
