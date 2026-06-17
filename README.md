# 0Gate — Decentralized Password Fortress Arena

Built on **0G** (Galileo testnet). Forge a password fortress, stake real 0G as a bounty, and survive an AI siege. Hunt rival fortresses to claim their bounty. Scores live on-chain and can't be faked.

## How 0G powers it (the qualification requirement)

| Layer | What it does here |
|-------|-------------------|
| **0G Chain** | `FortressArena` smart contract holds fortress commitments, escrowed bounties, and the leaderboard. Scores are written by contract logic, so they're un-fakeable. |
| **0G Storage** | Battle records (siege logs, fortress metadata) are stored on decentralized storage via the TS SDK. |
| **0G Compute** | (Roadmap) The AI hacker's strategy + commentary will run on the 0G Compute network. |

Remove 0G and the game can't exist — the chain *is* the anti-cheat.

## Prerequisites

- Node.js 18+
- MetaMask
- Testnet 0G from the faucet: https://faucet.0g.ai (0.1 0G/day)

## Setup

```bash
npm install
cp .env.example .env        # for contract deploy
cp .env.example .env.local  # for the frontend
```

### 1. Deploy the contract to 0G testnet

Put your deployer wallet key in `.env`:

```
DEPLOYER_PRIVATE_KEY=0xyourkey
```

Then:

```bash
npm run compile
npm run deploy:testnet
```

Copy the printed contract address into `.env.local`:

```
NEXT_PUBLIC_ARENA_ADDRESS=0xDeployedAddress
```

### 2. Run the app

```bash
npm run dev
```

Open http://localhost:3000, connect MetaMask (it'll prompt to add 0G Galileo testnet), and play.

## Network details (0G Galileo Testnet)

- Chain ID: `16602`
- RPC: `https://evmrpc-testnet.0g.ai`
- Explorer: `https://chainscan-galileo.0g.ai`
- Storage indexer (turbo): `https://indexer-storage-testnet-turbo.0g.ai`

## Project structure

```
contracts/FortressArena.sol   — on-chain arena (bounties, scores, cracks)
scripts/deploy.js             — deploy script
src/lib/zg-config.ts          — 0G network config (single source of truth)
src/lib/password.ts           — real entropy / strength analysis
src/lib/crypto.ts             — SHA-256 + keccak256 commitment scheme
src/lib/chain.ts              — wallet connect, provider, contract wiring
src/lib/arena.ts              — typed contract calls (deploy/survive/crack/leaderboard)
src/lib/storage.ts            — 0G Storage battle-record uploads
src/hooks/useWallet.ts        — wallet state hook
src/app/page.tsx              — full UI (defend / hunt / leaderboard + 3D fortress)
src/app/globals.css           — the 0Gate design system
```

## Security notes

- The raw password is **never** sent on-chain or to storage. Only `keccak256(sha256(password), salt)` is committed.
- The salt is kept client-side; the owner needs it only for their own records.
- `recordSurvival` and `crackFortress` enforce scoring in the contract — the client can't inflate scores.

## Honesty

This is a hackathon build for The Zero Cup. The siege visualization is dramatized timing over **real** security analysis (entropy, dictionary, leaked-password, brute-force thresholds). On-chain actions (deploy, stake, survive, crack, leaderboard) are real transactions on 0G testnet.
