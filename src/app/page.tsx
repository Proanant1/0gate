"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { analyze, fmtTime, tier, type Analysis } from "@/lib/password";
import { ARENA_ADDRESS } from "@/lib/zg-config";
import { shortAddr, explorerTx } from "@/lib/chain";
import {
  deployFortress,
  recordSurvival,
  fetchLeaderboard,
  fetchActiveFortresses,
  crackFortress,
  type PlayerRow,
  type ArenaFortress,
} from "@/lib/arena";
import { storeBattleRecord } from "@/lib/storage";
import { buildCommitment } from "@/lib/crypto";

type View = "defend" | "attack" | "leaderboard";
type Mode = "standard" | "hardened" | "nightmare";
const MODES: Record<Mode, { waves: number; mult: number; name: string }> = {
  standard: { waves: 5, mult: 1, name: "STANDARD" },
  hardened: { waves: 7, mult: 1.6, name: "HARDENED" },
  nightmare: { waves: 10, mult: 2.5, name: "NIGHTMARE" },
};

interface LogLine { t: string; msg: string; cls: string; }

export default function Page() {
  const { address, balance, connecting, connect, error: walletErr } = useWallet();
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<View>("defend");
  const [mode, setMode] = useState<Mode>("standard");

  // fortress build state
  const [pw, setPw] = useState("");
  const [visible, setVisible] = useState(true);
  const [stake, setStake] = useState(0.01); // in 0G
  const a: Analysis | null = analyze(pw);

  // siege state
  const [sieging, setSieging] = useState(false);
  const [integrity, setIntegrity] = useState(100);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<null | { win: boolean; sub: string; pts: number }>(null);
  const [lastDeploy, setLastDeploy] = useState<null | { id: number | null; txHash: string }>(null);

  // data
  const [board, setBoard] = useState<PlayerRow[]>([]);
  const [targets, setTargets] = useState<ArenaFortress[]>([]);
  const [toast, setToast] = useState<null | { title: string; hash: string }>(null);

  const logRef = useRef<HTMLDivElement>(null);

  const notConfigured = !ARENA_ADDRESS;

  // ---- helpers ----
  const pushLog = useCallback((msg: string, cls = "") => {
    const now = new Date();
    const t = `[${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}]`;
    setLog((l) => [...l, { t, msg, cls }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const showToast = (title: string, hash: string) => {
    setToast({ title, hash });
    setTimeout(() => setToast(null), 4000);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ---- load leaderboard / targets when switching views ----
  useEffect(() => {
    if (!entered || notConfigured) return;
    if (view === "leaderboard") {
      fetchLeaderboard().then(setBoard).catch(() => {});
    } else if (view === "attack") {
      fetchActiveFortresses().then(setTargets).catch(() => {});
    }
  }, [view, entered, notConfigured]);

  // ---- DEPLOY (real on-chain) ----
  async function onDeploy() {
    if (!a || !address || sieging) return;
    if (notConfigured) {
      pushLog("// Contract address not set. Deploy FortressArena first.", "hit");
      return;
    }
    setSieging(true);
    setResult(null);
    setLog([]);
    setIntegrity(100);
    pushLog("// Hashing fortress (SHA-256) + computing commitment...", "info");

    try {
      // 1. Real on-chain deploy with escrowed bounty
      const res = await deployFortress(pw, a.effective, stake.toString());
      setLastDeploy({ id: res.fortressId, txHash: res.txHash });
      showToast(`Fortress deployed · ${stake} 0G staked`, res.txHash);
      pushLog(`// ✓ Committed on 0G Chain (fortress #${res.fortressId ?? "?"})`, "block");
      pushLog(`// Bounty ${stake} 0G escrowed. Incoming attacks...`, "info");

      // 2. Run the siege simulation against the REAL entropy
      const cfg = MODES[mode];
      let intg = 100;
      let waves = 0;
      const atks = buildAttacks(a, cfg);
      for (let w = 0; w < atks.length; w++) {
        if (intg <= 0) break;
        const at = atks[w];
        pushLog(`▶ WAVE ${w + 1}/${atks.length}: ${at.name}`, "crit");
        await sleep(420);
        for (const s of at.steps) { await sleep(300); pushLog("  " + s.msg, s.cls); }
        await sleep(320);
        if (at.damage > 0) { intg = Math.max(0, intg - at.damage); pushLog(`  ✗ Breached! -${at.damage}%`, "hit"); }
        else { waves++; pushLog("  ✓ Repelled.", "block"); }
        setIntegrity(intg);
        await sleep(420);
      }

      const survived = intg > 0;
      const score = Math.round(intg * a.effective * cfg.mult * (1 + waves * 0.2));

      // 3. If survived, record survival on-chain (un-fakeable score)
      if (survived) {
        pushLog(`// SIEGE REPELLED at ${intg}% — recording on-chain...`, "block");
        if (res.fortressId != null) {
          try {
            const h = await recordSurvival(res.fortressId);
            showToast("Survival recorded on 0G Chain", h);
          } catch (e: any) {
            pushLog(`// (survival record skipped: ${e?.message ?? "tx failed"})`, "info");
          }
        }
      } else {
        pushLog("// FORTRESS BREACHED — bounty now claimable by attackers", "hit");
      }

      // 4. Store the battle record on 0G Storage (decentralized log)
      try {
        const rec = await storeBattleRecord({
          fortressId: res.fortressId, owner: address, mode: cfg.name,
          entropy: a.effective, survived, integrity: intg, wavesSurvived: waves,
          score, timestamp: Date.now(),
        });
        showToast("Battle record on 0G Storage", rec.txHash);
        pushLog(`// Battle log stored on 0G Storage (${rec.rootHash.slice(0, 10)}…)`, "info");
      } catch (e: any) {
        pushLog(`// (storage skipped: ${e?.message ?? "upload failed"})`, "info");
      }

      setResult({ win: survived, sub: survived ? `Held at ${intg}% on ${cfg.name}.` : tip(a), pts: score });
      // refresh board
      fetchLeaderboard().then(setBoard).catch(() => {});
    } catch (e: any) {
      pushLog(`// Transaction failed: ${e?.message ?? e}`, "hit");
    } finally {
      setSieging(false);
    }
  }

  // ---- ATTACK (real crack attempt) ----
  async function onAttack(target: ArenaFortress, guess: string) {
    if (!address) { await connect(); return; }
    try {
      // Build the candidate commitment from the guessed password.
      // (In a real hunt you'd brute/dictionary to find this; here the UI supplies a guess.)
      const { passwordHash, salt } = await buildCommitment(guess);
      const h = await crackFortress(target.id, passwordHash, salt);
      showToast(`Cracked #${target.id} · won ${target.bountyEth} 0G`, h);
      fetchActiveFortresses().then(setTargets).catch(() => {});
      fetchLeaderboard().then(setBoard).catch(() => {});
    } catch (e: any) {
      showToast("Crack failed — wrong preimage", "");
    }
  }

  // ---- render ----
  const t = a ? tier(a.effective) : null;

  return (
    <>
      {/* Background fx */}
      <div className="vignette" />
      <div className="gridlines" />

      {/* NAV */}
      <nav>
        <div className="logo">
          <svg className="logo-mark" viewBox="0 0 38 38" fill="none">
            <rect x="6" y="14" width="26" height="20" rx="3" stroke="#c6f135" strokeWidth="2" />
            <path d="M12 14V10a7 7 0 0 1 14 0v4" stroke="#2ee6c5" strokeWidth="2" />
            <circle cx="19" cy="23" r="2.5" fill="#c6f135" />
            <path d="M19 25.5V28" stroke="#c6f135" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="logo-text">0<b>Gate</b></span>
        </div>
        <div className="nav-right">
          {entered && (
            <button className="nav-link show" onClick={() => setEntered(false)}>How it works</button>
          )}
          <div className="net"><span className="pip" />0G TESTNET</div>
          <button
            className={`btn3d ${address ? "connected" : ""}`}
            onClick={connect}
            disabled={connecting}
          >
            {address ? `⬡ ${shortAddr(address)} · ${balance} 0G` : connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      </nav>

      {!entered ? (
        <Hero onEnter={() => setEntered(true)} />
      ) : (
        <div className="app show">
          {notConfigured && (
            <div className="demo-note" style={{ marginBottom: 20 }}>
              ⚠ Contract not deployed yet — set NEXT_PUBLIC_ARENA_ADDRESS in .env.local after running
              <code style={{ margin: "0 4px" }}>npm run deploy:testnet</code>
            </div>
          )}

          <div className="section-head">
            <div>
              <h2>{view === "defend" ? "Your Fortress" : view === "attack" ? "Hunt the Arena" : "Season Ranks"}</h2>
              <p>
                {view === "defend"
                  ? "Forge a password, stake real 0G, deploy on-chain."
                  : view === "attack"
                  ? "Crack rival fortresses to claim their staked bounty."
                  : "Live rankings read from the FortressArena contract on 0G Chain."}
              </p>
            </div>
            <div className="tabs">
              <button className={`tab ${view === "defend" ? "active" : ""}`} onClick={() => setView("defend")}>🛡 Defend</button>
              <button className={`tab ${view === "attack" ? "active teal-tab" : ""}`} onClick={() => setView("attack")}>⚔ Hunt</button>
              <button className={`tab ${view === "leaderboard" ? "active" : ""}`} onClick={() => setView("leaderboard")}>🏆 Ranks</button>
            </div>
          </div>

          {/* DEFEND */}
          {view === "defend" && (
            <div className="grid2">
              <div className="card">
                <div className="card-eyebrow">Step 01 — Forge</div>
                <div className="card-title">Build your fortress</div>
                <div className="modes">
                  {(["standard", "hardened", "nightmare"] as Mode[]).map((m) => (
                    <div key={m} className={`mode ${mode === m ? "on" : ""} ${m === "nightmare" ? "nm" : ""}`} onClick={() => setMode(m)}>
                      <div className="mode-n">{m[0].toUpperCase() + m.slice(1)}</div>
                      <div className="mode-d">{MODES[m].waves} WAVES</div>
                    </div>
                  ))}
                </div>
                <div className="field">
                  <div className="pw-wrap">
                    <input
                      type={visible ? "text" : "password"}
                      className="pw-input"
                      placeholder="Type your password..."
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button className="pw-eye" onClick={() => setVisible((v) => !v)}>{visible ? "🙈" : "👁"}</button>
                  </div>
                </div>
                <div className="meter"><div className="meter-fill" style={{ width: `${t?.pct ?? 0}%`, background: t?.color ?? "transparent" }} /></div>
                <div className="meter-info">
                  <div className="meter-label" style={{ color: t?.color ?? "var(--text-3)" }}>{t?.label ?? "Awaiting input"}</div>
                  <div className="meter-crack">crack time: <b>{a ? fmtTime(a.seconds) : "—"}</b></div>
                </div>
                <div className="stats3">
                  <div className="s3"><div className="s3-v">{a?.len ?? 0}</div><div className="s3-k">Length</div></div>
                  <div className="s3"><div className="s3-v">{a?.effective ?? 0}</div><div className="s3-k">Bits</div></div>
                  <div className="s3"><div className="s3-v">{a?.charset ?? 0}</div><div className="s3-k">Charset</div></div>
                </div>
                <div className="stake">
                  <div className="stake-top">
                    <div className="stake-l">💰 Bounty stake</div>
                    <div className="stake-v">{stake} 0G</div>
                  </div>
                  <input type="range" min={0.001} max={0.1} step={0.001} value={stake} onChange={(e) => setStake(parseFloat(e.target.value))} />
                  <div className="hint">Real escrow. Faucet gives 0.1 0G/day, so stakes are small on testnet. Attackers who crack you claim this bounty.</div>
                </div>
                <button className="btn3d" style={{ width: "100%", justifyContent: "center", fontSize: 15, padding: 16 }} onClick={onDeploy} disabled={!a || !address || sieging || notConfigured}>
                  {sieging ? "⏳ Deploying…" : "🚀 Deploy to Arena"}
                </button>
                <div className="hint">{!address ? "Connect your wallet to deploy on-chain." : !a ? "Type a password to forge your fortress." : "Ready — commitment + bounty go to 0G Chain."}</div>
              </div>

              <div className="card">
                <div className="card-eyebrow">Step 02 — Defend</div>
                <div className="card-title">Live siege</div>
                <div className="stage">
                  <Fortress3D integrity={integrity} />
                  <div className="stage-tag">RENDER://fortress_3d</div>
                  <div className="stage-badge" style={{ color: integrity > 60 ? "var(--teal)" : integrity > 0 ? "var(--gold)" : "var(--danger)" }}>
                    ● {integrity > 60 ? "SECURE" : integrity > 0 ? "UNDER SIEGE" : "BREACHED"}
                  </div>
                </div>
                <div className="hp"><div className="hp-fill" style={{ width: `${integrity}%`, background: integrity < 30 ? "linear-gradient(90deg,#c2304a,var(--danger))" : integrity < 60 ? "linear-gradient(90deg,#b8870f,var(--gold))" : "linear-gradient(90deg,#16a892,var(--teal))" }} /><div className="hp-txt">INTEGRITY {integrity}%</div></div>
                <div className="log" ref={logRef}>
                  {log.length === 0 && <div className="log-line"><span className="lt">[--:--]</span><span className="lm info">// Build a fortress and deploy to begin.</span></div>}
                  {log.map((l, i) => (<div className="log-line" key={i}><span className="lt">{l.t}</span><span className={`lm ${l.cls}`}>{l.msg}</span></div>))}
                </div>
                {result && (
                  <div className={`result show ${result.win ? "win" : "lose"}`}>
                    <div className="result-t">{result.win ? "Fortress Defended" : "Fortress Breached"}</div>
                    <div className="result-s">{result.sub}</div>
                    <div className="result-pts">+{result.pts.toLocaleString()} <span>PTS</span></div>
                    {lastDeploy?.txHash && (<a href={explorerTx(lastDeploy.txHash)} target="_blank" rel="noreferrer" style={{ color: "var(--teal)", fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>View tx on 0G explorer →</a>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ATTACK */}
          {view === "attack" && (
            <>
              <div className="demo-note">Live rival fortresses from 0G Chain. Crack one by guessing its password to win the bounty.</div>
              <div className="targets">
                {targets.length === 0 && <div className="lb-empty">No active fortresses yet. Deploy one in Defend, or check back soon.</div>}
                {targets.map((tg) => (<AttackCard key={tg.id} target={tg} onAttack={onAttack} disabled={tg.owner.toLowerCase() === address?.toLowerCase()} />))}
              </div>
            </>
          )}

          {/* LEADERBOARD */}
          {view === "leaderboard" && (
            <>
              <div className="demo-note">Rankings read live from the FortressArena contract — scores can&apos;t be faked.</div>
              {board.length === 0 && <div className="lb-empty">No players yet. Be the first to deploy a fortress and claim the board.</div>}
              {board.length > 0 && (
                <>
                  <div className="lbrow head"><span>RANK</span><span>DEFENDER</span><span>SCORE</span><span>RECORD</span></div>
                  {board.map((p, i) => {
                    const me = p.address.toLowerCase() === address?.toLowerCase();
                    const md = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
                    return (
                      <div className={`lbrow row ${me ? "you" : ""}`} key={p.address}>
                        <span className="lb-rank">{md ? <span style={{ fontSize: 24 }}>{md}</span> : i + 1}</span>
                        <span className="lb-name"><span className="e">🛡️</span><div>{me ? "You" : shortAddr(p.address)}{me && <span style={{ color: "var(--acid)", fontSize: 12 }}> ← YOU</span>}<br /><span className="lb-sub">{shortAddr(p.address)}</span></div></span>
                        <span className="lb-score">{p.score.toLocaleString()}</span>
                        <span className="lb-prize">🛡 {p.defended} · ⚔ {p.cracked}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* TX toast */}
      {toast && (
        <div className="tx-toast show">
          <div className="tx-ic">✓</div>
          <div>
            <div className="tx-t">{toast.title}</div>
            {toast.hash && <a className="tx-h" href={explorerTx(toast.hash)} target="_blank" rel="noreferrer">tx {toast.hash.slice(0, 10)}… · 0G Chain</a>}
          </div>
        </div>
      )}

      {walletErr && <div className="tx-toast show" style={{ borderColor: "var(--danger)" }}><div className="tx-ic" style={{ background: "rgba(255,77,109,0.15)", color: "var(--danger)" }}>!</div><div><div className="tx-t">{walletErr}</div></div></div>}
    </>
  );
}

// ───────── siege logic (real entropy → attack outcomes) ─────────
interface Atk { name: string; damage: number; steps: { msg: string; cls?: string }[]; }
function buildAttacks(a: Analysis, cfg: { waves: number; mult: number }): Atk[] {
  const A: Atk[] = [];
  if (a.isCommon) return [{ name: "LEAKED DB", damage: 100, steps: [{ msg: "Querying 10B leaked creds..." }, { msg: "MATCH in rockyou.txt", cls: "hit" }] }];
  A.push({ name: "LEAKED DB", damage: 0, steps: [{ msg: "Querying 10B leaked creds..." }, { msg: "No breach match", cls: "block" }] });
  A.push(a.hasDict
    ? { name: "DICTIONARY", damage: 35, steps: [{ msg: "Loading 500K words..." }, { msg: "Word fragment found", cls: "hit" }] }
    : { name: "DICTIONARY", damage: 0, steps: [{ msg: "Testing 500K words..." }, { msg: "No dictionary words", cls: "block" }] });
  if (cfg.mult >= 1.6) {
    A.push(a.hasSeq || a.hasRep
      ? { name: "PATTERN", damage: 25, steps: [{ msg: "Scanning sequences..." }, { msg: "Pattern exploited", cls: "hit" }] }
      : { name: "PATTERN", damage: 0, steps: [{ msg: "Scanning sequences..." }, { msg: "No patterns", cls: "block" }] });
  }
  if (a.onlyNum || a.onlyLet) A.push({ name: "MASK", damage: 30, steps: [{ msg: "Charset limits detected..." }, { msg: "Space collapsed", cls: "hit" }] });
  const bw = Math.max(2, cfg.waves - A.length);
  for (let i = 0; i < bw; i++) {
    const th = 35 + i * 7;
    const s = a.effective >= th;
    A.push({ name: `BRUTE-FORCE x${Math.pow(10, i + 1).toLocaleString()}`, damage: s ? 0 : Math.min(40, Math.round((th - a.effective) * 2 + 10)), steps: [{ msg: `Computing ${Math.pow(2, th).toExponential(1)} combos...` }, { msg: s ? "Timed out — space too large" : "Space exhausted", cls: s ? "block" : "hit" }] });
  }
  return A;
}
function tip(a: Analysis): string {
  if (a.isCommon) return "Top-leaked password — never reuse.";
  if (a.hasDict) return "Dictionary words crack fast.";
  if (a.onlyNum) return "Numbers-only = tiny space.";
  if (a.hasSeq) return "Sequences are tried first.";
  if (a.len < 12) return "Too short — aim 16+.";
  return "Add length & entropy.";
}

// ───────── small components ─────────
function AttackCard({ target, onAttack, disabled }: { target: ArenaFortress; onAttack: (t: ArenaFortress, g: string) => void; disabled: boolean }) {
  const [guess, setGuess] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="tcard" style={{ ["--accent" as any]: "var(--teal)" }}>
      <div className="tc-top">
        <span className="tc-emoji">🏰</span>
        <div><div className="tc-name">Fortress #{target.id}</div><div className="tc-addr">{shortAddr(target.owner)}</div></div>
      </div>
      <div className="tc-meta">
        <div className="tc-m"><div className="tc-mv tc-bounty">{target.bountyEth}</div><div className="tc-mk">BOUNTY 0G</div></div>
        <div className="tc-m"><div className="tc-mv">{target.entropy}</div><div className="tc-mk">BITS</div></div>
        <div className="tc-m"><div className="tc-mv tc-def">#{target.id}</div><div className="tc-mk">ID</div></div>
      </div>
      {!disabled && (
        <input className="pw-input" style={{ fontSize: 14, padding: "12px 14px", marginBottom: 10 }} placeholder="Guess the password…" value={guess} onChange={(e) => setGuess(e.target.value)} />
      )}
      <button className="btn3d danger" style={{ width: "100%", justifyContent: "center" }} disabled={disabled || busy || !guess}
        onClick={async () => { setBusy(true); await onAttack(target, guess); setBusy(false); }}>
        {disabled ? "Your fortress" : busy ? "🧠 Cracking…" : "⚔ Attempt Crack"}
      </button>
    </div>
  );
}

// ───────── 3D fortress (Three.js, loaded client-side) ─────────
function Fortress3D({ integrity }: { integrity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const integRef = useRef(integrity);
  integRef.current = integrity;

  useEffect(() => {
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x07080d, 0.028);
      const cam = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
      cam.position.set(0, 6, 16); cam.lookAt(0, 3, 0);
      const ren = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      ren.setSize(canvas.clientWidth, canvas.clientHeight); ren.setPixelRatio(Math.min(devicePixelRatio, 2));
      scene.add(new THREE.AmbientLight(0x556688, 0.6));
      const key = new THREE.DirectionalLight(0xc6f135, 1.2); key.position.set(6, 12, 8); scene.add(key);
      const fill = new THREE.PointLight(0x2ee6c5, 1, 40); fill.position.set(-8, 6, 6); scene.add(fill);
      const fort = new THREE.Group(); scene.add(fort);
      const blocks: any[] = [];
      const blk = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.3, flatShading: true }));
        m.position.set(x, y, z); (m as any).userData = { home: m.position.clone(), intact: true, base: col }; fort.add(m); blocks.push(m);
      };
      blk(0, 2, 0, 4, 4, 4, 0x1a1f30);
      for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) blk(i * 1.4, 4.3, j * 1.4, 0.8, 1, 0.8, 0x222840);
      [[-4, 0, 0], [4, 0, 0], [0, 0, -4]].forEach(([x, , z]) => { blk(x, 1.6, z, 2.2, 5, 2.2, 0x161b2a); blk(x, 4.4, z, 2.6, 0.6, 2.6, 0x222840); });
      blk(0, 1, 2.1, 1.6, 2.4, 0.4, 0x0e1018);
      const sg = new THREE.SphereGeometry(7, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      const shield = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x2ee6c5, transparent: true, opacity: 0.08, side: THREE.DoubleSide })); shield.position.y = 0.1; scene.add(shield);

      let raf = 0, t = 0, lastInteg = 100;
      const animate = () => {
        raf = requestAnimationFrame(animate); t += 0.01;
        fort.rotation.y = Math.sin(t * 0.3) * 0.3 + 0.4;
        const cur = integRef.current;
        if (cur < lastInteg) {
          const intact = blocks.filter((b) => b.userData.intact);
          const n = Math.min(intact.length, Math.ceil((lastInteg - cur) / 15));
          for (let i = 0; i < n; i++) { const b = intact[Math.floor(Math.random() * intact.length)]; if (b?.userData.intact) { b.userData.intact = false; b.material.color.setHex(0x6b2d3a); } }
          lastInteg = cur;
        }
        if (cur >= 100 && lastInteg < 100) lastInteg = 100;
        blocks.forEach((b) => { if (!b.userData.intact) { b.position.y -= 0.04; b.rotation.x += 0.04; b.material.transparent = true; b.material.opacity = Math.max(0, b.material.opacity - 0.01); } else if (cur >= 100) { b.position.copy(b.userData.home); b.rotation.set(0, 0, 0); b.material.opacity = 1; b.material.transparent = false; b.material.color.setHex(b.userData.base); } });
        shield.material.opacity = (cur / 100) * 0.1 * (0.7 + 0.3 * Math.sin(t * 2));
        ren.render(scene, cam);
      };
      animate();
      const onResize = () => { cam.aspect = canvas.clientWidth / canvas.clientHeight; cam.updateProjectionMatrix(); ren.setSize(canvas.clientWidth, canvas.clientHeight); };
      window.addEventListener("resize", onResize);
      cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); ren.dispose(); };
    })();
    return () => cleanup();
  }, []);

  return <canvas ref={canvasRef} id="fortCanvas" style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ───────── hero (landing) ─────────
function Hero({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="hero" id="hero">
      <div className="hero-eyebrow">Decentralized Security Arena · Built on 0G</div>
      <h1>Forge a fortress.<br />Outsmart the <span className="acid">AI siege</span>.</h1>
      <p>Build an unbreakable password, stake real 0G on-chain, and watch AI hackers lay siege. Hunt rival fortresses. Climb a leaderboard that can&apos;t be faked.</p>
      <div className="hero-cta">
        <button className="btn3d" onClick={onEnter}>Enter the Arena →</button>
        <a className="btn3d ghost" href="#howRef" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>How it works</a>
      </div>
      <div className="hero-stats">
        <div className="hstat"><div className="hstat-v"><span className="acid">SHA</span>-256</div><div className="hstat-k">Hashed On-Chain</div></div>
        <div className="hstat"><div className="hstat-v">11K<span className="acid">TPS</span></div><div className="hstat-k">0G Chain Speed</div></div>
        <div className="hstat"><div className="hstat-v">100<span className="acid">%</span></div><div className="hstat-k">On-Chain Scores</div></div>
      </div>
      <HowItWorks onEnter={onEnter} />
    </section>
  );
}

function HowItWorks({ onEnter }: { onEnter: () => void }) {
  const steps = [
    { n: "01", h: "Forge & stake", p: "Build a password fortress. Its SHA-256 hash + commitment go to 0G Chain. Stake real 0G as the bounty." },
    { n: "02", h: "Hunt rivals", p: "Send your AI hacker against other fortresses. Crack one by revealing its preimage and claim the staked bounty." },
    { n: "03", h: "Survive the siege", p: "Your fortress is live on-chain. Survive sieges to earn defense points written by the contract." },
    { n: "04", h: "Climb & earn", p: "The leaderboard reads straight from the contract — scores are un-fakeable. Battle logs live on 0G Storage." },
  ];
  return (
    <section className="how" id="howRef" style={{ marginTop: 64 }}>
      <div className="how-head"><div className="eb">The Loop</div><h2>How 0Gate works</h2></div>
      <div className="how-grid">
        {steps.map((s) => (
          <div className="how-step" key={s.n}>
            <div className="how-num"><span className="bar" />{s.n}</div>
            <h3>{s.h}</h3>
            <p>{s.p}</p>
          </div>
        ))}
      </div>
      <div className="stack-row">
        <div className="stack-pill"><span className="sq" style={{ background: "var(--teal)" }} />Powered by <b>0G Storage</b></div>
        <div className="stack-pill"><span className="sq" style={{ background: "var(--acid)" }} />AI on <b>0G Compute</b></div>
        <div className="stack-pill"><span className="sq" style={{ background: "var(--gold)" }} />Settled on <b>0G Chain</b></div>
      </div>
      <div style={{ textAlign: "center", marginTop: 48 }}>
        <button className="btn3d" onClick={onEnter}>Enter the Arena →</button>
      </div>
    </section>
  );
}
