import type { Card } from "./deck";
import { freshDeck, shuffle } from "./deck";
import type { HandScore } from "./hand";
import { compareHands, evaluateHand } from "./hand";

export type Side = "you" | "opponent";

export interface PlayerState {
  deck: Card[];
  hand: Card[];
  wins: number;
}

export type Phase = "playing" | "matchOver";

export const ACT_TIMEOUT_MS = 60_000;

export interface GameState {
  winsNeeded: number;
  handNumber: number;
  you: PlayerState;
  opponent: PlayerState;
  phase: Phase;
  matchWinner: Side | "draw" | null;
  lastEvent: string;
  /** Epoch ms by which whoever must act needs to draw or concede, else the host auto-draws for them. Null once the match is over. */
  actDeadline: number | null;
}

export interface Action {
  type: "draw" | "concede";
  side: Side;
}

function other(side: Side): Side {
  return side === "you" ? "opponent" : "you";
}

function freshPlayer(): PlayerState {
  return { deck: shuffle(freshDeck()), hand: [], wins: 0 };
}

function dealOpeningCard(state: GameState, side: Side): boolean {
  const player = state[side];
  const card = player.deck.pop();
  if (!card) return false;
  player.hand.push(card);
  return true;
}

export function newGame(winsNeeded = 6): GameState {
  const state: GameState = {
    winsNeeded,
    handNumber: 1,
    you: freshPlayer(),
    opponent: freshPlayer(),
    phase: "playing",
    matchWinner: null,
    lastEvent: "New match started.",
    actDeadline: null,
  };
  dealOpeningCard(state, "you");
  dealOpeningCard(state, "opponent");
  resolveTies(state);
  state.actDeadline = state.phase === "playing" ? Date.now() + ACT_TIMEOUT_MS : null;
  return state;
}

export function handScore(state: GameState, side: Side): HandScore {
  return evaluateHand(state[side].hand);
}

/** Which side is currently behind and must act. Null once the match is over — ties never persist here, resolveTies() clears them before control returns to the caller. */
export function whoMustAct(state: GameState): Side | null {
  if (state.phase !== "playing") return null;
  const cmp = compareHands(handScore(state, "you"), handScore(state, "opponent"));
  if (cmp === 0) return null;
  return cmp < 0 ? "you" : "opponent";
}

/** Rule 6: once the opponent of `side` reaches winsNeeded - 1 wins (match point against `side`), `side` may not voluntarily concede. */
export function canConcede(state: GameState, side: Side): boolean {
  return state[other(side)].wins < state.winsNeeded - 1;
}

function endMatchDraw(state: GameState) {
  state.you.hand = [];
  state.opponent.hand = [];
  state.phase = "matchOver";
  state.matchWinner = "draw";
  state.lastEvent = "Both decks ran out at once — the match ends in a draw.";
}

function endHand(state: GameState, winner: Side) {
  state.you.hand = [];
  state.opponent.hand = [];
  state[winner].wins += 1;
  state.lastEvent = winner === "you" ? "You won the hand." : "The house won the hand.";

  if (state[winner].wins >= state.winsNeeded) {
    state.phase = "matchOver";
    state.matchWinner = winner;
    return;
  }

  state.handNumber += 1;
  const youDealt = dealOpeningCard(state, "you");
  const oppDealt = dealOpeningCard(state, "opponent");
  if (!youDealt || !oppDealt) {
    state.phase = "matchOver";
    state.matchWinner = youDealt ? "you" : oppDealt ? "opponent" : "draw";
    state.lastEvent = "A deck ran out before the next hand could be dealt.";
    return;
  }
  resolveTies(state);
}

/** `side` has no legal draw left. Rule 5: normally this forces a concede of just this hand — unless rule 6 has already locked `side` out of conceding, in which case there's no legal move at all and the match ends immediately. */
function forceConcede(state: GameState, side: Side) {
  if (!canConcede(state, side)) {
    state.phase = "matchOver";
    state.matchWinner = other(side);
    state.lastEvent = "Ran out of deck at match point — the match is over.";
    return;
  }
  endHand(state, other(side));
}

/** Rule 4: a tie forces both sides to draw, repeating until broken or a side runs out of deck. */
function resolveTies(state: GameState) {
  while (
    state.phase === "playing" &&
    compareHands(handScore(state, "you"), handScore(state, "opponent")) === 0
  ) {
    const youCard = state.you.deck.pop();
    const oppCard = state.opponent.deck.pop();
    if (youCard) state.you.hand.push(youCard);
    if (oppCard) state.opponent.hand.push(oppCard);

    if (!youCard && !oppCard) return endMatchDraw(state);
    if (!youCard) return forceConcede(state, "you");
    if (!oppCard) return forceConcede(state, "opponent");
    state.lastEvent = "Tied — both sides draw.";
  }
}

/** Pure reducer: returns a new state, ignoring illegal/stale actions (wrong side's turn, concede while locked) rather than throwing — callers (local UI, multiplayer host) don't need to pre-validate every action themselves. The act-deadline only refreshes on a real mutation, not on a rejected no-op, so spamming an illegal action can't stall the clock. */
export function applyAction(state: GameState, action: Action): GameState {
  const next: GameState = structuredClone(state);
  const actingSide = whoMustAct(next);
  if (actingSide !== action.side) return next;

  if (action.type === "concede") {
    if (!canConcede(next, action.side)) return next;
    endHand(next, other(action.side));
  } else {
    const player = next[action.side];
    const card = player.deck.pop();
    if (!card) {
      forceConcede(next, action.side);
    } else {
      player.hand.push(card);
      next.lastEvent = action.side === "you" ? "You drew a card." : "The house drew a card.";
      resolveTies(next);
    }
  }

  next.actDeadline = next.phase === "playing" ? Date.now() + ACT_TIMEOUT_MS : null;
  return next;
}
