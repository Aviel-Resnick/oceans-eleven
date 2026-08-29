import { joinRoom } from "trystero/nostr";
import type { DataPayload } from "trystero/nostr";
import type { Action, GameState } from "./game";

const APP_ID = "oceans-eleven-avielresnick";

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function shareLink(roomId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", roomId);
  return url.toString();
}

export function roomIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("room");
}

export interface NetHost {
  role: "host";
  roomId: string;
  link: string;
  onPeerJoined: (cb: () => void) => void;
  onGuestAction: (cb: (action: Action) => void) => void;
  broadcastState: (state: GameState) => void;
  leave: () => void;
}

/**
 * The room creator ("INVITE A FRIEND") owns the canonical game.ts state — the guest only ever
 * sends actions and receives broadcasts, so the two peers never run independent simulations
 * that could drift out of sync. GameState/Action are sent as DataPayload (Trystero's JSON wire
 * type) and cast back at the boundary since neither type is exported for direct generic use.
 */
export function hostGame(): NetHost {
  const roomId = randomRoomId();
  const room = joinRoom({ appId: APP_ID }, roomId);
  const stateChannel = room.makeAction<DataPayload>("state");
  const actionChannel = room.makeAction<DataPayload>("action");

  return {
    role: "host",
    roomId,
    link: shareLink(roomId),
    onPeerJoined: (cb) => {
      room.onPeerJoin = () => cb();
    },
    onGuestAction: (cb) => {
      actionChannel.onMessage = (data) => cb(data as unknown as Action);
    },
    broadcastState: (state) => {
      void stateChannel.send(state as unknown as DataPayload);
    },
    leave: () => {
      void room.leave();
    },
  };
}

export interface NetGuest {
  role: "guest";
  roomId: string;
  onState: (cb: (state: GameState) => void) => void;
  sendAction: (action: Action) => void;
  leave: () => void;
}

export function joinGame(roomId: string): NetGuest {
  const room = joinRoom({ appId: APP_ID }, roomId);
  const stateChannel = room.makeAction<DataPayload>("state");
  const actionChannel = room.makeAction<DataPayload>("action");

  return {
    role: "guest",
    roomId,
    onState: (cb) => {
      stateChannel.onMessage = (data) => cb(data as unknown as GameState);
    },
    sendAction: (action) => {
      void actionChannel.send(action as unknown as DataPayload);
    },
    leave: () => {
      void room.leave();
    },
  };
}
