// ── Card Types ──────────────────────────────────────────────────────────────

export type CardCategory =
  | 'infection'
  | 'action'
  | 'defense'
  | 'obstacle'
  | 'panic'
  | 'promo';

export type CardBack = 'event' | 'panic';

export interface CardDef {
  id: string;
  name: string;
  nameRu: string;
  category: CardCategory;
  back: CardBack;
  description: string;
  descriptionRu: string;
  copies: number;
  minPlayers: number;
  /** Per-player-count copy counts: index 0 = 4 players, index 7 = 11 players */
  copiesByPlayerCount?: number[];
}

export interface CardInstance {
  uid: string;       // unique per physical card
  defId: string;     // references CardDef.id
}

// ── Roles ───────────────────────────────────────────────────────────────────

export type Role = 'human' | 'thing' | 'infected';

// ── Player ──────────────────────────────────────────────────────────────────

export interface Player {
  id: number;
  name: string;
  role: Role;
  avatarId: string;
  hand: CardInstance[];
  handCount?: number;
  isAlive: boolean;
  inQuarantine: boolean;
  quarantineTurnsLeft: number;
  position: number; // seat index in the circle
}

// ── Obstacles ───────────────────────────────────────────────────────────────

export interface LockedDoor {
  between: [number, number]; // position pairs (seat positions)
}

// ── Game Step ───────────────────────────────────────────────────────────────

export type GameStep =
  | 'draw'          // Step 1: draw a card
  | 'play_or_discard' // Step 1b: play or discard after drawing event
  | 'trade'         // Step 2: trade with neighbor
  | 'trade_response' // Step 2b: waiting for neighbor's defense/response
  | 'end_turn';     // Step 3: pass turn

// ── Game Phase ──────────────────────────────────────────────────────────────

export type GamePhase =
  | 'lobby'
  | 'role_reveal'
  | 'playing'
  | 'game_over';

// ── Log Entry ───────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  text: string;
  textRu: string;
  timestamp: number;
  /** defId of the card that was played — set only for PLAY_CARD log entries, used by animation */
  cardDefId?: string;
}

// ── Pending Action (for modals) ─────────────────────────────────────────────

export type PendingAction =
  | { type: 'choose_target'; cardUid: string; cardDefId: string; targets: number[] }
  | {
      type: 'view_hand';
      targetPlayerId: number;
      cards: CardInstance[];
      viewerPlayerId: number;
      public?: boolean;
    }
  | {
      type: 'view_card';
      targetPlayerId: number;
      card: CardInstance;
      viewerPlayerId: number;
      public?: boolean;
    }
  | {
      type: 'suspicion_pick';
      targetPlayerId: number;
      viewerPlayerId: number;
      selectableCardUids: string[];
      previewCardUid: string | null;
    }
  | { type: 'trade_offer'; fromId: number; toId: number; offeredCardUid: string }
  | {
      type: 'trade_defense';
      defenderId: number;
      fromId: number;
      offeredCardUid: string;
      reason: 'trade' | 'temptation' | 'flamethrower' | 'swap' | 'analysis';
    }
  | { type: 'panic_effect'; cardDefId: string; data?: unknown }
  | { type: 'choose_card_to_give'; targetPlayerId: number }
  | { type: 'choose_card_to_discard' }
  | { type: 'persistence_pick'; drawnCards: CardInstance[] }
  | { type: 'declare_victory' }
  | { type: 'show_hand_confirm'; playerId: number }
  | {
      type: 'whisky_reveal';
      playerId: number;
      cards: CardInstance[];
      viewerPlayerId: number;
      public?: boolean;
    }
  | { type: 'temptation_target'; cardUid: string; targets: number[] }
  | { type: 'party_pass'; pendingPlayerIds: number[]; chosen: { playerId: number; cardUid: string }[]; direction: 1 | -1 }
  | { type: 'temptation_response'; fromId: number; toId: number; offeredCardUid: string }
  | { type: 'just_between_us'; targets: number[] }
  | { type: 'just_between_us_pick'; playerA: number; playerB: number; cardUidA: string | null; cardUidB: string | null }
  | { type: 'panic_choose_target'; panicDefId: string; targets: number[] }
  | { type: 'blind_date_swap' }
  | { type: 'forgetful_discard'; remaining: number }
  | { type: 'panic_trade'; targetPlayerId: number }
  | { type: 'panic_trade_response'; fromId: number; toId: number; offeredCardUid: string }
  | { type: 'revelations_round'; currentRevealerIdx: number; revealOrder: number[] };

// ── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  phase: GamePhase;
  direction: 1 | -1;          // 1 = clockwise, -1 = counter-clockwise
  step: GameStep;
  currentPlayerIndex: number;  // index into players array
  players: Player[];
  seats: number[];             // player IDs in seat order
  doors: LockedDoor[];
  deck: CardInstance[];
  discard: CardInstance[];
  log: LogEntry[];
  winner: 'humans' | 'thing' | 'thing_solo' | null;
  winnerPlayerIds: number[];
  pendingAction: PendingAction | null;
  revealingPlayer: number;     // index during role_reveal phase
  tradeSkipped: boolean;       // if Temptation was played
  panicAnnouncement: string | null; // defId of last drawn panic card (shown to all)
  lang: 'en' | 'ru';
}

// ── Action Payloads ─────────────────────────────────────────────────────────

export type GameAction =
  | { type: 'START_GAME'; playerNames: string[]; thingInDeck?: boolean; chaosMode?: boolean }
  | { type: 'REVEAL_NEXT' }
  | { type: 'DRAW_CARD' }
  | { type: 'PLAY_CARD'; cardUid: string; targetPlayerId?: number; targetPosition?: number }
  | { type: 'DISCARD_CARD'; cardUid: string }
  | { type: 'SUSPICION_PREVIEW_CARD'; cardUid: string }
  | { type: 'SUSPICION_CONFIRM_CARD'; cardUid: string }
  | { type: 'OFFER_TRADE'; cardUid: string }
  | { type: 'RESPOND_TRADE'; cardUid: string }  // card from responder's hand
  | { type: 'PLAY_DEFENSE'; cardUid: string }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_VICTORY' }
  | { type: 'SELECT_TARGET'; targetPlayerId: number }
  | { type: 'PERSISTENCE_PICK'; keepUid: string; discardUids: string[] }
  | { type: 'CONFIRM_VIEW' }
  | { type: 'TEMPTATION_SELECT'; targetPlayerId: number; cardUid: string }
  | { type: 'PARTY_PASS_CARD'; cardUid: string; playerId: number }
  | { type: 'JUST_BETWEEN_US_SELECT'; player1: number; player2: number }
  | { type: 'JUST_BETWEEN_US_PICK'; cardUid: string; playerId: number }
  | { type: 'TEMPTATION_RESPOND'; cardUid: string }
  | { type: 'DECLINE_DEFENSE' }
  | { type: 'SET_LANG'; lang: 'en' | 'ru' }
  | { type: 'PANIC_SELECT_TARGET'; targetPlayerId: number }
  | { type: 'BLIND_DATE_PICK'; cardUid: string }
  | { type: 'FORGETFUL_DISCARD_PICK'; cardUid: string }
  | { type: 'PANIC_TRADE_SELECT'; targetPlayerId: number; cardUid: string }
  | { type: 'PANIC_TRADE_RESPOND'; cardUid: string }
  | { type: 'REVELATIONS_RESPOND'; show: boolean };
