// Pre-token radar model: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board ranks every protocol the snapshot records with no token of its own
// (no CoinGecko id, no symbol, no market cap) and at least $10M of TVL: the
// house watchlist of 40 is the floor, and the other rows are the early finds
// below that floor. One eligibility rule is applied at every size, the same
// one the house's watchlist rule states: a wrapped, staked or bridged product
// of a token that already trades is not a launch that has not happened yet,
// and neither is an exchange's balance sheet. So out go the categories
// Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC
// and CEX, names carrying a whole word wrapped, staked or staking, names
// beginning with an exchange's name, and names ending in a version marker.
// Protocols whose token already trades are never ranked either; they are the
// evidence base the multiples are learned from, shown apart as "already live".
//
// Implied value is derived only from the snapshot's own figures:
//
//   multiple  = the category's market multiple, learned from the snapshot:
//               for each category, the median mcap/TVL of its token-bearing
//               protocols, shrunk toward the global median by sample size
//               (weight n/(n+6)) and clamped to [0.03, 2.0]. A category with
//               no token-bearing protocol takes the global median.
//   momentum  = 1 + clamp(change_7d, -40, +40) / 100 * 0.45   (unreported: 1)
//   maturity  = 0.82 + 0.36 * (1 - exp(-age_days / 620))      (age from
//               listed_at to the snapshot's as_of; unknown age scores as 365d)
//   breadth   = 1 + min(chains - 1, 5) * 0.02
//   implied   = round(tvl_usd * multiple * momentum * maturity * breadth)
//
// No protocol name is ever special-cased: one function scores every row, and
// the dashboard prints the formula and each row's factors, so a reader can
// recompute any implied value from the snapshot by hand.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  readiness: number;
  on_watchlist: boolean;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  rows: BoardRow[];
  live: { name: string; symbol: string | null; category: string | null; tvl_usd: number; mcap_usd: number }[];
  early_size: number;
  live_size: number;
  model: {
    summary: string;
    global_median: number;
    min_tvl_usd: number;
    categories: { category: string; n: number; median: number; used: number }[];
  };
}

const MIN_TVL_USD = 10_000_000;
const SHRINK_K = 6;
const MULT_MIN = 0.03;
const MULT_MAX = 2.0;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: missing protocols or watchlist');
  }
  return raw;
}

/** A protocol is pre-token when the snapshot records no token for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The launch-eligibility rule, the house's watchlist rule applied at any size:
 * a product of a token that already trades, or an exchange balance sheet, is
 * not a protocol still waiting on a launch of its own.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(V2|v2|2\.0)$/.test(p.name)) return false;
  return true;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Category multiples learned from the snapshot's own token-bearing protocols. */
function learnMultiples(snapshot: Snapshot): { globalMedian: number; perCategory: Map<string, { n: number; median: number; used: number }> } {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    ratios.push(r);
    if (p.category !== null) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(r);
      byCat.set(p.category, arr);
    }
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const perCategory = new Map<string, { n: number; median: number; used: number }>();
  for (const [cat, arr] of byCat) {
    const med = median(arr);
    const used = clamp((arr.length * med + SHRINK_K * globalMedian) / (arr.length + SHRINK_K), MULT_MIN, MULT_MAX);
    perCategory.set(cat, { n: arr.length, median: med, used });
  }
  return { globalMedian, perCategory };
}

function scoreFactors(p: SnapshotProtocol, asOf: string, multiple: number): { momentum: number; maturity: number; breadth: number; age: number | null } {
  const momentum = p.change_7d === null ? 1 : 1 + (clamp(p.change_7d, -40, 40) / 100) * 0.45;
  const age = ageDays(asOf, p.listed_at);
  const effectiveAge = age ?? 365;
  const maturity = 0.82 + 0.36 * (1 - Math.exp(-effectiveAge / 620));
  const breadth = 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.02;
  return { momentum, maturity, breadth, age };
}

/** 0-100 display score: size, momentum and track record, for the dashboard's bars. */
function readiness(p: SnapshotProtocol, momentum: number, age: number | null): number {
  const size = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - 7) / 2.5, 0, 1) * 55;
  const mom = clamp(((momentum - 0.82) / 0.36), 0, 1) * 25;
  const track = clamp((age ?? 365) / 900, 0, 1) * 20;
  return Math.round(size + mom + track);
}

interface CategoryPlay {
  open: string;
  loop: string;
  asset: string;
}

const PLAYS: Record<string, CategoryPlay> = {
  'Lending': { open: 'Supply USDC or ETH as collateral', loop: 'Borrow 20-30% against the supply for 2-3 days, repay, and repeat the cycle once a month', asset: 'USDC' },
  'CDP': { open: 'Mint the stablecoin against an ETH or LST deposit', loop: 'Hold the minted stablecoin in the protocol vault and roll the position monthly', asset: 'ETH' },
  'Dexs': { open: 'Add two-sided liquidity to the busiest pair', loop: 'Make 3-5 small swaps a week from the same wallet to build real trader history', asset: 'USDC and ETH' },
  'Yield': { open: 'Deposit into the flagship vault', loop: 'Claim and re-deposit rewards every week so the position compounds', asset: 'USDC' },
  'Yield Aggregator': { open: 'Deposit into the highest-TVL auto-compounding vault', loop: 'Move a small top-up in monthly and claim rewards from the same wallet', asset: 'USDC' },
  'Onchain Capital Allocator': { open: 'Deposit into a flagship curated vault', loop: 'Rebalance between two of its vaults once a month to show ongoing use', asset: 'USDC' },
  'Risk Curators': { open: 'Supply into one of the curator\'s large lending vaults', loop: 'Keep the supply open and add a small top-up every month', asset: 'USDC' },
  'Liquid Staking': { open: 'Stake through the protocol and hold the receipt token', loop: 'Use the receipt token in one partner money market so it stays active', asset: 'ETH' },
  'Restaking': { open: 'Restake an LST through the protocol', loop: 'Keep the restaked position untouched and claim any points or rewards weekly', asset: 'stETH' },
  'Liquid Restaking': { open: 'Restake an LST through the protocol', loop: 'Keep the restaked position untouched and claim any points or rewards weekly', asset: 'stETH' },
  'Staking Pool': { open: 'Delegate a stake to the pool from your own wallet', loop: 'Claim staking rewards monthly and re-stake them from the same address', asset: 'the native token' },
  'Bridge': { open: 'Bridge funds to the far chain through the protocol', loop: 'Bridge a small amount back and forth twice a month instead of using a rival bridge', asset: 'USDC' },
  'Canonical Bridge': { open: 'Bridge funds to the chain through its canonical bridge', loop: 'Transact on the far chain weekly so the bridged balance stays active', asset: 'ETH' },
  'RWA': { open: 'Complete onboarding, then mint or buy the smallest RWA position offered', loop: 'Hold the position and take part in one redemption or roll cycle', asset: 'USDC' },
  'Chain': { open: 'Bridge a starter balance onto the chain and make your first transactions', loop: 'Use two or three native dApps weekly so the wallet builds organic history', asset: 'the chain\'s gas token' },
  'Payments': { open: 'Route one real payment through the network', loop: 'Keep a small working balance and route a payment or two every month', asset: 'the payment asset' },
  'Basis Trading': { open: 'Deposit collateral into the basis vault', loop: 'Hold the delta-neutral position and claim funding distributions as they land', asset: 'USDC' },
  'CeDeFi': { open: 'Deposit into the main earn product', loop: 'Roll the deposit into the next term instead of withdrawing at maturity', asset: 'USDC' },
  'Collateral Markets': { open: 'Deposit collateral into the main market', loop: 'Keep the collateral supplied and claim rewards from the same wallet weekly', asset: 'ETH' },
  'Governance Incentives': { open: 'Deposit into the main incentivised market', loop: 'Claim the incentive rewards weekly and keep the deposit open', asset: 'USDC' },
  'Stablecoin Wrapper': { open: 'Mint or buy the wrapped stablecoin and deposit it in its vault', loop: 'Hold the vault share and add a small top-up monthly', asset: 'USDC' },
  'Insurance': { open: 'Buy a small cover policy or stake into the cover pool', loop: 'Renew the cover at expiry so coverage history has no gaps', asset: 'USDC' },
};

const DEFAULT_PLAY: CategoryPlay = {
  open: 'Deposit into the protocol\'s main product',
  loop: 'Repeat one small genuine transaction every week from the same wallet',
  asset: 'USDC',
};

function money(x: number): string {
  return `$${Math.round(x).toLocaleString('en-US')}`;
}

/** Five concrete steps per protocol: what to do, what it costs, how long it takes. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const play = (p.category !== null && PLAYS[p.category]) || DEFAULT_PLAY;
  const chain = p.chains[0] ?? 'its main chain';
  const minDeposit = p.tvl_usd >= 500_000_000 ? 250 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const gasNote = chain === 'Ethereum' ? 'about $2-6 in gas on Ethereum' : `about $0.05-1 in gas on ${chain}`;
  return [
    `Set up one wallet on ${chain} and fund it with ${play.asset} plus gas money. Cost: ${gasNote} to top up. Time: 10 minutes, once.`,
    `${play.open} on ${p.name}: start with ${money(minDeposit)} so the position is real but capped. Cost: one transaction, ${gasNote}. Time: about 15 minutes.`,
    `${play.loop}. Cost: gas only, ${gasNote} per touch. Time: 10 minutes a week, every week, from the same wallet.`,
    `Stay eligible: never split funds across sybil wallets, keep the position open through snapshot rumours, and check ${p.name}'s official channels every Monday. Cost: $0. Time: 5 minutes a week.`,
    `Review monthly against this board: if ${p.name}'s TVL falls 30% or a token is announced, follow the official claim or exit in one withdrawal. Cost: one exit transaction, ${gasNote}. Time: 15 minutes.`,
  ];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { globalMedian, perCategory } = learnMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => isPreToken(p) && isLaunchCandidate(p) && p.tvl_usd >= MIN_TVL_USD);
  const scored = candidates.map((p) => {
    const cat = p.category !== null ? perCategory.get(p.category) : undefined;
    const multiple = cat ? cat.used : clamp(globalMedian, MULT_MIN, MULT_MAX);
    const f = scoreFactors(p, snapshot.as_of, multiple);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * f.momentum * f.maturity * f.breadth));
    return { p, multiple, ...f, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    multiple: Math.round(s.multiple * 1000) / 1000,
    momentum: Math.round(s.momentum * 1000) / 1000,
    maturity: Math.round(s.maturity * 1000) / 1000,
    breadth: Math.round(s.breadth * 1000) / 1000,
    readiness: readiness(s.p, s.momentum, s.age),
    on_watchlist: watch.has(s.p.slug),
  }));
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({ name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd ?? 0 }));
  const categories = [...perCategory.entries()]
    .map(([category, v]) => ({ category, n: v.n, median: Math.round(v.median * 1000) / 1000, used: Math.round(v.used * 1000) / 1000 }))
    .sort((a, b) => b.n - a.n);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    rows: board,
    live,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    model: {
      summary:
        'Implied value = TVL x category multiple x momentum x maturity x breadth. The category multiple is the median market-cap/TVL of that category\'s already-listed protocols in this same snapshot, shrunk toward the global median; momentum reads the 7-day TVL change, maturity the time tracked with no token, breadth the chain count. One eligibility rule runs at every size: wrapped, staked or bridged products of a token that already trades, and exchange balance sheets, are not launches still to come, so they are never ranked.',
      global_median: Math.round(globalMedian * 1000) / 1000,
      min_tvl_usd: MIN_TVL_USD,
      categories,
    },
  };
  return { board, radar };
}

/** The gate's own checks, run locally so a bad board never leaves the machine. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!slugs.has(r.slug)) return `row slug not in snapshot: ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug: ${r.slug}`;
    seen.add(r.slug);
    if (!r.name) return `row ${r.slug}: empty name`;
    if (!(r.implied_value_usd > 0)) return `row ${r.slug}: implied value not positive`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug}: farm step of ${t.length} chars`;
    }
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug missing: ${slug}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1..N at position ${i + 1}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `implied value rises at rank ${i + 1}`;
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'all implied values equal';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
