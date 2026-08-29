import type { Card } from "./deck";
import { rankLabel } from "./deck";
import type { GameState, Side } from "./game";
import { canConcede, handScore, whoMustAct } from "./game";

export type AppState =
  | { screen: "home" }
  | { screen: "hosting"; link: string }
  | { screen: "joining" }
  | { screen: "game"; state: GameState; mySide: Side };

export interface Handlers {
  onPlayHouse: () => void;
  onInviteFriend: () => void;
  onCopyLink: (link: string) => void;
  onDraw: () => void;
  onConcede: () => void;
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
];

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

function renderCard(card: Card): HTMLElement {
  const node = el("div", "card");
  node.append(el("div", "rank", rankLabel(card.rank)), el("div", "suit", card.suit));
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

function renderGame(state: GameState, mySide: Side, handlers: Handlers): HTMLElement {
  const foeSide: Side = mySide === "you" ? "opponent" : "you";
  const me = state[mySide];
  const foe = state[foeSide];
  const meScore = handScore(state, mySide);
  const foeScore = handScore(state, foeSide);
  const acting = whoMustAct(state);

  const root = el("div", "board");
  const sidePanel = el("div", "side-panel mono");
  sidePanel.append(
    renderStatBlock("OPPONENT", foe.wins, foe.deck.length, 52, state.winsNeeded),
    renderStatBlock("YOU", me.wins, me.deck.length, 52, state.winsNeeded),
  );
  root.append(sidePanel);

  const handsArea = el("div", "hands-area");

  const foeBlock = el("div", "hand-block");
  const foeCards = el("div", "cards");
  foe.hand.forEach((c) => foeCards.append(renderCard(c)));
  foeBlock.append(foeCards);
  const foeNameRow = el("div", "hand-name");
  foeNameRow.append(el("div", undefined, foeScore.label));
  handsArea.append(foeBlock);

  const divider = el("div", "showdown-divider mono");
  divider.append(el("div", "line"), el("div", "label", "SHOWDOWN"), el("div", "line"));
  handsArea.append(divider);

  const meBlock = el("div", "hand-block");
  const statusTag = el("div", "status-tag mono");
  if (state.phase === "playing") {
    statusTag.textContent = acting === mySide ? "YOU MUST ACT" : acting === foeSide ? "OPPONENT MUST ACT" : "";
  }
  const meNameRow = el("div", "hand-name");
  meNameRow.append(el("div", undefined, meScore.label), statusTag);
  meBlock.append(meNameRow);
  const meCards = el("div", "cards");
  me.hand.forEach((c) => meCards.append(renderCard(c)));
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
  return root;
}

function renderMatchEnd(state: GameState, mySide: Side, handlers: Handlers): HTMLElement {
  const overlay = el("div", "overlay");
  const card = el("div", "overlay-card match-end");
  let headline: string;
  if (state.matchWinner === "draw") headline = "Match drawn";
  else if (state.matchWinner === mySide) headline = "You won the match";
  else headline = "You lost the match";
  card.append(el("h2", undefined, headline));
  const actions = el("div", "actions");
  const home = el("button", "btn-secondary", "HOME");
  home.onclick = handlers.onHome;
  actions.append(home);
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

  return overlay;
}

export function render(root: HTMLElement, app: AppState, rulesOpen: boolean, handlers: Handlers) {
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
      root.append(renderMatchEnd(app.state, app.mySide, handlers));
    }
  }

  if (rulesOpen) {
    root.append(renderRulesOverlay(handlers));
  }
}
