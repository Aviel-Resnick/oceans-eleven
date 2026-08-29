import type { Card, Rank, Suit } from "./deck";

export const HandRank = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;
export type HandRank = (typeof HandRank)[keyof typeof HandRank];

export interface HandScore {
  rank: HandRank;
  /** Ranks driving this score's strength, most significant first — used for kicker comparisons ("leftovers break ties"). */
  tiebreak: Rank[];
  label: string;
}

const RANK_NAMES: Record<Rank, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "jack",
  12: "queen",
  13: "king",
  14: "ace",
};

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function plural(name: string): string {
  return name === "six" ? "sixes" : `${name}s`;
}

/** Highest card of a run of >=5 consecutive ranks, treating ace as low too (the wheel: A-2-3-4-5). Null if no straight exists. */
function longestStraightHigh(uniqueDesc: number[]): number | null {
  const withWheel = uniqueDesc.includes(14) ? [...uniqueDesc, 1] : uniqueDesc;
  let run = 1;
  for (let i = 1; i < withWheel.length; i++) {
    if (withWheel[i] === withWheel[i - 1] - 1) {
      run++;
      if (run >= 5) return withWheel[i - 4];
    } else {
      run = 1;
    }
  }
  return null;
}

/**
 * Best hand a set of cards makes (up to a full 5-card poker hand). Handles any number of
 * revealed cards directly — via rank/suit frequency counting rather than enumerating every
 * 5-card subset, since hands can grow past 5 cards through chained ties (rule 4) and a
 * combinatorial C(n,5) search over a large hand is a real perf cliff.
 */
function scoreCards(cards: Card[]): HandScore {
  const rankCounts = new Map<Rank, number>();
  for (const c of cards) rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupSizes = groups.map(([, n]) => n);
  const countTiebreak = groups.map(([r]) => r);

  const suitGroups = new Map<Suit, Rank[]>();
  for (const c of cards) {
    const arr = suitGroups.get(c.suit) ?? [];
    arr.push(c.rank);
    suitGroups.set(c.suit, arr);
  }

  let bestFlush: { top: Rank; ranks: Rank[] } | null = null;
  let bestStraightFlushHigh: number | null = null;
  for (const ranks of suitGroups.values()) {
    if (ranks.length < 5) continue;
    const uniqueDesc = [...new Set(ranks)].sort((a, b) => b - a);
    if (!bestFlush || uniqueDesc[0] > bestFlush.top) {
      bestFlush = { top: uniqueDesc[0], ranks: uniqueDesc.slice(0, 5) };
    }
    const sfHigh = longestStraightHigh(uniqueDesc);
    if (sfHigh !== null && (bestStraightFlushHigh === null || sfHigh > bestStraightFlushHigh)) {
      bestStraightFlushHigh = sfHigh;
    }
  }

  const allUniqueDesc = [...rankCounts.keys()].sort((a, b) => b - a);
  const straightHigh = longestStraightHigh(allUniqueDesc);

  if (bestStraightFlushHigh !== null) {
    const high = bestStraightFlushHigh as Rank;
    return { rank: HandRank.StraightFlush, tiebreak: [high], label: `${cap(RANK_NAMES[high])}-high straight flush` };
  }
  if (groupSizes[0] === 4) {
    return {
      rank: HandRank.FourOfAKind,
      tiebreak: countTiebreak,
      label: `Four of a kind, ${plural(RANK_NAMES[groups[0][0]])}`,
    };
  }
  if (groupSizes[0] === 3 && groupSizes[1] === 2) {
    return {
      rank: HandRank.FullHouse,
      tiebreak: countTiebreak,
      label: `Full house, ${plural(RANK_NAMES[groups[0][0]])} over ${plural(RANK_NAMES[groups[1][0]])}`,
    };
  }
  if (bestFlush) {
    return { rank: HandRank.Flush, tiebreak: bestFlush.ranks, label: `${cap(RANK_NAMES[bestFlush.top])}-high flush` };
  }
  if (straightHigh !== null) {
    const high = straightHigh as Rank;
    return { rank: HandRank.Straight, tiebreak: [high], label: `${cap(RANK_NAMES[high])}-high straight` };
  }
  if (groupSizes[0] === 3) {
    return {
      rank: HandRank.ThreeOfAKind,
      tiebreak: countTiebreak,
      label: `Three of a kind, ${plural(RANK_NAMES[groups[0][0]])}`,
    };
  }
  if (groupSizes[0] === 2 && groupSizes[1] === 2) {
    return {
      rank: HandRank.TwoPair,
      tiebreak: countTiebreak,
      label: `Two pair, ${plural(RANK_NAMES[groups[0][0]])} and ${plural(RANK_NAMES[groups[1][0]])}`,
    };
  }
  if (groupSizes[0] === 2) {
    return { rank: HandRank.Pair, tiebreak: countTiebreak, label: `Pair of ${plural(RANK_NAMES[groups[0][0]])}` };
  }
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  return { rank: HandRank.HighCard, tiebreak: ranksDesc, label: `${cap(RANK_NAMES[ranksDesc[0]])} high` };
}

/** Best hand the given cards make. Missing cards simply aren't evaluated — "a lone ace really is just an ace." */
export function evaluateHand(cards: Card[]): HandScore {
  if (cards.length === 0) return { rank: HandRank.HighCard, tiebreak: [], label: "No cards" };
  return scoreCards(cards);
}

/** Positive if a beats b, negative if b beats a, 0 for a true tie. */
export function compareHands(a: HandScore, b: HandScore): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
