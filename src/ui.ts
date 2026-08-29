import type { Card } from "./deck";
import { rankLabel } from "./deck";
import type { GameState, Side } from "./game";
import { canConcede, handScore, whoMustAct } from "./game";

export type AppState =
  | { screen: "home" }
  | { screen: "hosting"; link: string }
  | { screen: "joining" }
  | { screen: "game"; state: GameState; mySide: Side };

export interface UiFlags {
  rulesOpen: boolean;
  /** Guest is waiting on the host's broadcast after requesting a rematch (host restarts instantly and never sets this). */
  rematchPending: boolean;
}

export interface Handlers {
  onPlayHouse: () => void;
  onInviteFriend: () => void;
  onCopyLink: (link: string) => void;
  onDraw: () => void;
  onConcede: () => void;
  onPlayAgain: () => void;
  onHome: () => void;
  onOpenRules: () => void;
  onCloseRules: () => void;
}

const RULES = [
  { n: "01", t: "Two decks, no wilds", d: "Each player plays from their own full 52-card deck. Nothing is shared." },
  { n: "02", t: "Reveal one card", d: "Every hand opens with a single card face-up on each side. Both players always see everything." },
  { n: "03", t: "Best poker hand wins", d: "Compare the two hands. Cards you don't hold count as worthless, so a lone ace really is just an ace." },
  { n: "04", t: "The weaker side acts", d: "Draw another card to strengthen the hand, or concede it. A tie means both sides draw." },
  { n: "05", t: "Six hands takes the match", d: "Won hands are discarded — those cards never come back. Run out of deck and you concede." },
  { n: "06", t: "No concede at five", d: "Once your opponent reaches five wins, conceding is off the table. Play it out." },
  { n: "07", t: "60 seconds to act", d: "Sit on a decision too long and the game draws for you automatically." },
];

// Render-history state, tracked across calls so we only animate cards that are genuinely new
// this render (not every card, every time — a full re-render also happens on each timer tick).
let lastHandNumber = -1;
let lastMeCount = 0;
let lastFoeCount = 0;
let toastEvent = "";
let toastExpiresAt = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderNav(handlers: Handlers, onHome: boolean): HTMLElement {
  const nav = el("div", "nav mono");
  const brand = el("span", "brand", "OCEAN'S ELEVEN");
  nav.append(brand);
  const links = el("div", "links");
  const rules = el("a", undefined, "RULES");
  rules.onclick = handlers.onOpenRules;
  links.append(rules);
  if (onHome) {
    const home = el("a", undefined, "HOME");
    home.onclick = handlers.onHome;
    links.append(home);
  }
  nav.append(links);
  return nav;
}

const RED_SUITS = new Set(["♥", "♦"]);

function renderCard(card: Card, isNew: boolean): HTMLElement {
  const node = el("div", isNew ? "card dealing" : "card");
  const suitClass = RED_SUITS.has(card.suit) ? "suit red" : "suit";
  node.append(el("div", "rank", rankLabel(card.rank)), el("div", suitClass, card.suit));
  return node;
}

function renderPips(wins: number, winsNeeded: number): HTMLElement {
  const wrap = el("div", "pips");
  for (let i = 0; i < winsNeeded; i++) {
    const pip = el("div", "pip");
    pip.style.background = i < wins ? "#fafafa" : "transparent";
    wrap.append(pip);
  }
  return wrap;
}

function renderStatBlock(label: string, wins: number, deckLeft: number, deckStart: number, winsNeeded: number): HTMLElement {
  const block = el("div", "block");
  block.append(
    el("div", "label", label),
    renderPips(wins, winsNeeded),
    el("div", "win-count", String(wins)),
  );
  const meter = el("div", "deck-meter");
  const row = el("div", "row");
  row.append(el("span", undefined, "DECK"), el("span", "value", String(deckLeft)));
  const bar = el("div", "bar");
  const fill = el("div", "fill");
  fill.style.width = `${Math.round((deckLeft / deckStart) * 100)}%`;
  bar.append(fill);
  meter.append(row, bar);
  block.append(meter);
  return block;
}

function renderHome(handlers: Handlers): HTMLElement {
  const root = el("div", "home");
  root.append(el("h1", undefined, "Ocean's Eleven"));
  root.append(el("p", "tagline", "Two decks. One card at a time. First to six hands."));
  const actions = el("div", "actions");
  const playHouse = el("button", "btn-primary", "PLAY THE HOUSE");
  playHouse.onclick = handlers.onPlayHouse;
  const inviteFriend = el("button", "btn-secondary", "INVITE A FRIEND — CREATE LINK");
  inviteFriend.onclick = handlers.onInviteFriend;
  actions.append(playHouse, inviteFriend);
  root.append(actions);
  root.append(el("div", "note mono", "PLAY THE HOUSE IS COMING SOON — TRY INVITE A FRIEND."));

  const links = el("div", "home-links mono");
  const rules = el("a", undefined, "RULES");
  rules.onclick = handlers.onOpenRules;
  links.append(rules);
  root.append(links);

  return root;
}

function renderHosting(link: string, handlers: Handlers): HTMLElement {
  const root = el("div", "status-screen");
  root.append(el("h2", undefined, "Waiting for your friend…"));
  root.append(el("p", undefined, "Send them this link. The match starts the moment they open it."));
  const box = el("div", "link-box mono");
  const text = el("span", undefined, link);
  const copy = el("button", undefined, "COPY");
  copy.onclick = () => handlers.onCopyLink(link);
  box.append(text, copy);
  root.append(box);
  return root;
}

function renderJoining(): HTMLElement {
  const root = el("div", "status-screen");
  root.append(el("h2", undefined, "Joining game…"));
  return root;
}

function renderToast(state: GameState): HTMLElement | null {
  if (state.lastEvent !== toastEvent) {
    toastEvent = state.lastEvent;
    toastExpiresAt = Date.now() + 1600;
  }
  const remaining = toastExpiresAt - Date.now();
  if (remaining <= 0) return null;

  const elapsed = 1600 - remaining;
  const progress = elapsed / 1600;
  let opacity = 1;
  if (progress < 0.15) opacity = progress / 0.15;
  else if (progress > 0.7) opacity = Math.max(0, (1 - progress) / 0.3);

  const toast = el("div", "toast mono", toastEvent);
  toast.style.opacity = String(opacity);
  toast.style.transform = `translateX(-50%) translateY(${(1 - opacity) * -6}px)`;
  return toast;
}

function renderGame(state: GameState, mySide: Side, handlers: Handlers): HTMLElement {
  const foeSide: Side = mySide === "you" ? "opponent" : "you";
  const me = state[mySide];
  const foe = state[foeSide];
  const meScore = handScore(state, mySide);
  const foeScore = handScore(state, foeSide);
  const acting = whoMustAct(state);

  const isNewHand = state.handNumber !== lastHandNumber;
  const newMeCount = isNewHand ? me.hand.length : Math.max(0, me.hand.length - lastMeCount);
  const newFoeCount = isNewHand ? foe.hand.length : Math.max(0, foe.hand.length - lastFoeCount);

  const root = el("div", "board");

  const toast = renderToast(state);
  if (toast) root.append(toast);

  const sidePanel = el("div", "side-panel mono");
  sidePanel.append(
    renderStatBlock("OPPONENT", foe.wins, foe.deck.length, 52, state.winsNeeded),
    renderStatBlock("YOU", me.wins, me.deck.length, 52, state.winsNeeded),
  );
  root.append(sidePanel);

  const handsArea = el("div", "hands-area");

  const foeBlock = el("div", "hand-block");
  const foeCards = el("div", "cards");
  foe.hand.forEach((c, i) => foeCards.append(renderCard(c, i >= foe.hand.length - newFoeCount)));
  foeBlock.append(foeCards);
  const foeNameRow = el("div", "hand-name");
  foeNameRow.append(el("div", undefined, foeScore.label));
  handsArea.append(foeBlock);

  const divider = el("div", "showdown-divider mono");
  divider.append(el("div", "line"), el("div", "label", "SHOWDOWN"), el("div", "line"));
  handsArea.append(divider);

  const meBlock = el("div", "hand-block");
  const statusTag = el("div", "status-tag mono");
  if (state.phase === "playing" && acting !== null && state.actDeadline !== null) {
    const who = acting === mySide ? "YOU MUST ACT" : "OPPONENT MUST ACT";
    statusTag.textContent = `${who} · ${formatCountdown(state.actDeadline - Date.now())}`;
  }
  const meNameRow = el("div", "hand-name");
  meNameRow.append(el("div", undefined, meScore.label), statusTag);
  meBlock.append(meNameRow);
  const meCards = el("div", "cards");
  me.hand.forEach((c, i) => meCards.append(renderCard(c, i >= me.hand.length - newMeCount)));
  meBlock.append(meCards);

  if (state.phase === "playing" && acting === mySide) {
    const concedeAllowed = canConcede(state, mySide);
    const actions = el("div", "actions-row");
    const draw = el("button", "btn-primary", "DRAW");
    draw.onclick = handlers.onDraw;
    const concede = el("button", "btn-secondary", "CONCEDE HAND");
    concede.disabled = !concedeAllowed;
    concede.onclick = handlers.onConcede;
    actions.append(draw, concede);
    meBlock.append(actions);
    if (!concedeAllowed) {
      meBlock.append(el("div", "lock-note mono", "OPPONENT IS AT MATCH POINT — YOU CANNOT CONCEDE. DRAW OR LOSE THE MATCH."));
    }
  }
  handsArea.append(meBlock);

  root.append(handsArea);

  lastHandNumber = state.handNumber;
  lastMeCount = me.hand.length;
  lastFoeCount = foe.hand.length;

  return root;
}

function renderMatchEnd(state: GameState, mySide: Side, rematchPending: boolean, handlers: Handlers): HTMLElement {
  const overlay = el("div", "overlay");
  const card = el("div", "overlay-card match-end");
  let headline: string;
  if (state.matchWinner === "draw") headline = "Match drawn";
  else if (state.matchWinner === mySide) headline = "You won the match";
  else headline = "You lost the match";
  card.append(el("h2", undefined, headline));

  const actions = el("div", "actions");
  const again = el("button", "btn-primary", rematchPending ? "WAITING FOR REMATCH…" : "PLAY AGAIN");
  again.disabled = rematchPending;
  again.onclick = handlers.onPlayAgain;
  const home = el("button", "btn-secondary", "HOME");
  home.onclick = handlers.onHome;
  actions.append(again, home);
  card.append(actions);
  overlay.append(card);
  return overlay;
}

function renderRulesOverlay(handlers: Handlers): HTMLElement {
  const overlay = el("div", "overlay");
  const card = el("div", "overlay-card");
  const header = el("div", "overlay-header");
  header.append(el("h3", undefined, "How it plays"));
  const close = el("button", "overlay-close", "✕");
  close.onclick = handlers.onCloseRules;
  header.append(close);
  card.append(header);

  const grid = el("div", "rules-grid");
  for (const r of RULES) {
    const rule = el("div", "rule");
    rule.append(el("div", "n mono", r.n));
    const body = el("div");
    body.append(el("div", "t", r.t), el("div", "d", r.d));
    rule.append(body);
    grid.append(rule);
  }
  card.append(grid);

  const footer = el("div", "overlay-footer");
  const gotIt = el("button", "btn-primary", "GOT IT");
  gotIt.style.width = "auto";
  gotIt.style.padding = "0 28px";
  gotIt.onclick = handlers.onCloseRules;
  footer.append(gotIt);
  card.append(footer);
  overlay.append(card);

  return overlay;
}

export function render(root: HTMLElement, app: AppState, flags: UiFlags, handlers: Handlers) {
  root.innerHTML = "";
  const onHomeVisible = app.screen !== "home";

  if (app.screen === "home") {
    root.append(renderHome(handlers));
  } else if (app.screen === "hosting") {
    root.append(renderNav(handlers, onHomeVisible), renderHosting(app.link, handlers));
  } else if (app.screen === "joining") {
    root.append(renderNav(handlers, onHomeVisible), renderJoining());
  } else {
    root.append(renderNav(handlers, onHomeVisible), renderGame(app.state, app.mySide, handlers));
    if (app.state.phase === "matchOver") {
      root.append(renderMatchEnd(app.state, app.mySide, flags.rematchPending, handlers));
    }
  }

  if (flags.rulesOpen) {
    root.append(renderRulesOverlay(handlers));
  }
}
