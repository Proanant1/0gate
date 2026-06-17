// Real password security analysis. No blockchain here — pure client-side math.
// This is the genuinely-real part of the game: entropy, crack-time, and weakness detection.

const COMMON = [
  "password","123456","12345678","qwerty","abc123","111111","letmein","admin",
  "welcome","monkey","dragon","football","iloveyou","123123","sunshine","princess",
  "password1","login","passw0rd","master","hello","freedom","qazwsx","trustno1",
];

const DICT = [
  "password","dragon","shadow","master","ninja","football","baseball","superman",
  "batman","trustno","welcome","summer","winter","flower","monkey","sunshine",
  "princess","letmein","access","hunter","soccer","jordan","michael","computer",
];

export interface Analysis {
  charset: number;
  entropy: number;
  effective: number;
  seconds: number;
  isCommon: boolean;
  hasDict: boolean;
  hasSeq: boolean;
  hasRep: boolean;
  onlyNum: boolean;
  onlyLet: boolean;
  len: number;
  hasLower: boolean;
  hasUpper: boolean;
  hasNum: boolean;
  hasSym: boolean;
}

export function analyze(pw: string): Analysis | null {
  if (!pw) return null;

  let charset = 0;
  if (/[a-z]/.test(pw)) charset += 26;
  if (/[A-Z]/.test(pw)) charset += 26;
  if (/[0-9]/.test(pw)) charset += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) charset += 33;

  const entropy = pw.length * Math.log2(charset || 1);
  const lo = pw.toLowerCase();

  const isCommon = COMMON.includes(lo);
  const hasDict = DICT.some((w) => lo.includes(w));
  const hasSeq = /(?:abc|bcd|cde|123|234|345|456|567|678|789|qwe|wer|asd)/i.test(pw);
  const hasRep = /(.)\1{2,}/.test(pw);
  const onlyNum = /^[0-9]+$/.test(pw);
  const onlyLet = /^[a-zA-Z]+$/.test(pw);

  let effective = entropy;
  if (isCommon) effective = Math.min(effective, 8);
  if (hasDict) effective *= 0.6;
  if (hasSeq) effective *= 0.7;
  if (hasRep) effective *= 0.75;
  if (onlyNum) effective *= 0.6;

  // Modern offline GPU ~ 1e11 guesses/sec; expected = half the keyspace
  const seconds = Math.pow(2, effective) / 1e11 / 2;

  return {
    charset,
    entropy: Math.round(entropy),
    effective: Math.round(effective),
    seconds,
    isCommon, hasDict, hasSeq, hasRep, onlyNum, onlyLet,
    len: pw.length,
    hasLower: /[a-z]/.test(pw),
    hasUpper: /[A-Z]/.test(pw),
    hasNum: /[0-9]/.test(pw),
    hasSym: /[^a-zA-Z0-9]/.test(pw),
  };
}

export function fmtTime(s: number): string {
  if (s < 0.001) return "instant";
  if (s < 1) return "<1 sec";
  if (s < 60) return Math.round(s) + " sec";
  if (s < 3600) return Math.round(s / 60) + " min";
  if (s < 86400) return Math.round(s / 3600) + " hrs";
  if (s < 31536000) return Math.round(s / 86400) + " days";
  const y = s / 31536000;
  if (y < 1e3) return Math.round(y) + " yrs";
  if (y < 1e6) return Math.round(y / 1e3) + "K yrs";
  if (y < 1e9) return Math.round(y / 1e6) + "M yrs";
  if (y < 1e12) return Math.round(y / 1e9) + "B yrs";
  return "eons";
}

export function tier(e: number): { label: string; color: string; pct: number } {
  if (e < 28) return { label: "Critical", color: "var(--danger)", pct: 15 };
  if (e < 40) return { label: "Weak", color: "#ff8a4d", pct: 35 };
  if (e < 60) return { label: "Moderate", color: "var(--gold)", pct: 58 };
  if (e < 80) return { label: "Strong", color: "var(--teal)", pct: 80 };
  return { label: "Fortress", color: "var(--acid)", pct: 100 };
}
