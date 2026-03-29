import { afterEach, describe, it, expect, vi } from 'vitest';
import { createInitialState, gameReducer } from '../index.ts';
import type { GameState, CardInstance } from '../../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startGame(playerCount = 4): GameState {
  const names = Array.from({ length: playerCount }, (_, i) => `Player${i + 1}`);
  let state = gameReducer(createInitialState(), {
    type: 'START_GAME',
    playerNames: names,
  });
  // Skip role reveal phase
  state = { ...state, phase: 'playing', revealingPlayer: playerCount - 1 };
  return state;
}

/** Create a card instance with a given defId and unique uid */
function card(defId: string, uid?: string): CardInstance {
  return { uid: uid ?? `test_${defId}_${Math.random().toString(36).slice(2, 8)}`, defId };
}

/** Inject a card on top of the deck so the next draw is deterministic */
function stackDeck(state: GameState, ...cards: CardInstance[]): void {
  // deck.pop() draws, so last element is "top"
  state.deck.push(...cards);
}

/** Ensure the current player has a specific card in hand, returns its uid */
function giveCard(state: GameState, playerIndex: number, defId: string): string {
  const c = card(defId);
  state.players[playerIndex].hand.push(c);
  return c.uid;
}

const ANOMALY_STRONG_CARD_IDS = new Set([
  'flamethrower',
  'analysis',
  'no_barbecue',
  'persistence',
  'anti_analysis',
  'fear',
  'quarantine',
]);

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('gameReducer', () => {
  // ── START_GAME ──────────────────────────────────────────────────────────

  describe('START_GAME', () => {
    it('creates the correct number of players', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      expect(state.players).toHaveLength(4);
    });

    it('deals 4 cards to each player', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      for (const p of state.players) {
        expect(p.hand).toHaveLength(4);
      }
    });

    it('assigns exactly one player the thing role', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      const things = state.players.filter(p => p.role === 'thing');
      expect(things).toHaveLength(1);
    });

    it('the thing player holds the_thing card', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      const thingPlayer = state.players.find(p => p.role === 'thing')!;
      expect(thingPlayer.hand.some(c => c.defId === 'the_thing')).toBe(true);
    });

    it('sets phase to role_reveal and step to draw', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      expect(state.phase).toBe('role_reveal');
      expect(state.step).toBe('draw');
    });

    it('creates a non-empty deck', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      expect(state.deck.length).toBeGreaterThan(0);
    });

    it('sets seats array matching player ids', () => {
      const state = gameReducer(createInitialState(), {
        type: 'START_GAME',
        playerNames: ['A', 'B', 'C', 'D'],
      });
      expect(state.seats).toEqual([0, 1, 2, 3]);
    });

    it.each([
      { playerCount: 5, strongOverflow: 2 },
      { playerCount: 6, strongOverflow: 1 },
      { playerCount: 8, strongOverflow: 1 },
      { playerCount: 10, strongOverflow: 1 },
    ])(
      'in anomaly mode still deals 4 cards to each player at $playerCount players when The Thing stays in deck',
      ({ playerCount, strongOverflow }) => {
        vi.spyOn(Math, 'random').mockReturnValue(0.9);
        const names = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);

        const state = gameReducer(createInitialState(), {
          type: 'START_GAME',
          playerNames: names,
          chaosMode: true,
        });

        expect(state.players.map((player) => player.hand.length)).toEqual(Array(playerCount).fill(4));

        const strongCardsInHands = state.players
          .flatMap((player) => player.hand)
          .filter((handCard) => ANOMALY_STRONG_CARD_IDS.has(handCard.defId));
        expect(strongCardsInHands).toHaveLength(strongOverflow);

        expect(state.players.some((player) => player.hand.some((handCard) => handCard.defId === 'the_thing'))).toBe(false);
        expect(state.deck.some((deckCard) => deckCard.defId === 'the_thing')).toBe(true);
      },
    );
  });

  // ── DRAW_CARD ───────────────────────────────────────────────────────────

  describe('DRAW_CARD', () => {
    it('increases hand size by 1 when drawing an event card', () => {
      const state = startGame(4);
      const cur = state.players[state.currentPlayerIndex];
      const handBefore = cur.hand.length;
      // Stack an event card on top of the deck
      stackDeck(state, card('suspicion'));

      const next = gameReducer(state, { type: 'DRAW_CARD' });
      const curAfter = next.players[next.currentPlayerIndex];
      expect(curAfter.hand.length).toBe(handBefore + 1);
    });

    it('changes step from draw to play_or_discard', () => {
      const state = startGame(4);
      expect(state.step).toBe('draw');
      stackDeck(state, card('suspicion'));

      const next = gameReducer(state, { type: 'DRAW_CARD' });
      expect(next.step).toBe('play_or_discard');
    });

    it('does nothing if step is not draw', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      const next = gameReducer(state, { type: 'DRAW_CARD' });
      expect(next.step).toBe('play_or_discard');
    });

    it('does nothing if pendingAction is set', () => {
      const state = startGame(4);
      state.pendingAction = { type: 'choose_target', cardUid: 'x', cardDefId: 'flamethrower', targets: [1] };
      const handBefore = state.players[state.currentPlayerIndex].hand.length;
      const next = gameReducer(state, { type: 'DRAW_CARD' });
      expect(next.players[next.currentPlayerIndex].hand.length).toBe(handBefore);
    });

    it('drawing the_thing card sets player role to thing', () => {
      const state = startGame(4);
      // Make sure current player is not already the thing
      state.players[state.currentPlayerIndex].role = 'human';
      state.players[state.currentPlayerIndex].hand = state.players[state.currentPlayerIndex].hand.filter(c => c.defId !== 'the_thing');

      stackDeck(state, card('the_thing'));
      const next = gameReducer(state, { type: 'DRAW_CARD' });
      const curAfter = next.players[next.currentPlayerIndex];
      expect(curAfter.role).toBe('thing');
      expect(curAfter.hand.some(c => c.defId === 'the_thing')).toBe(true);
    });

    it('increments reshuffle counter when discard pile becomes the new deck', () => {
      const state = startGame(4);
      state.deck = [];
      state.discard = [card('suspicion', 'reshuffled_suspicion')];

      const next = gameReducer(state, { type: 'DRAW_CARD' });

      expect(next.reshuffleCount).toBe(1);
      expect(next.players[next.currentPlayerIndex].hand.some((handCard) => handCard.uid === 'reshuffled_suspicion')).toBe(true);
    });
  });

  // ── DISCARD_CARD ────────────────────────────────────────────────────────

  describe('DISCARD_CARD', () => {
    it('removes card from hand and adds to discard pile', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      const cur = state.players[state.currentPlayerIndex];
      // Give a known discardable card
      const uid = giveCard(state, state.currentPlayerIndex, 'suspicion');
      const handBefore = cur.hand.length;

      const next = gameReducer(state, { type: 'DISCARD_CARD', cardUid: uid });
      const curAfter = next.players[next.currentPlayerIndex];
      expect(curAfter.hand.length).toBe(handBefore - 1);
      expect(curAfter.hand.find(c => c.uid === uid)).toBeUndefined();
      expect(next.discard.some(c => c.uid === uid)).toBe(true);
    });

    it('advances step to trade after discarding in play_or_discard', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      const uid = giveCard(state, state.currentPlayerIndex, 'suspicion');

      const next = gameReducer(state, { type: 'DISCARD_CARD', cardUid: uid });
      // Step should be trade or end_turn (if trade was auto-skipped)
      expect(['trade', 'end_turn', 'draw']).toContain(next.step);
    });

    it('cannot discard the_thing card', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      const cur = state.players[state.currentPlayerIndex];
      const thingUid = giveCard(state, state.currentPlayerIndex, 'the_thing');
      cur.role = 'thing';
      const handBefore = cur.hand.length;

      const next = gameReducer(state, { type: 'DISCARD_CARD', cardUid: thingUid });
      const curAfter = next.players[next.currentPlayerIndex];
      expect(curAfter.hand.length).toBe(handBefore);
    });
  });

  describe('automatic victory conditions', () => {
    it('ends the game when no living humans remain and The Thing has infected allies', () => {
      const state = startGame(4);
      state.phase = 'playing';
      state.step = 'end_turn';
      state.currentPlayerIndex = 0;

      state.players[0].role = 'thing';
      state.players[0].isAlive = true;
      state.players[1].role = 'infected';
      state.players[1].isAlive = true;
      state.players[2].role = 'infected';
      state.players[2].isAlive = true;
      state.players[3].role = 'human';
      state.players[3].isAlive = false;

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.phase).toBe('game_over');
      expect(next.winner).toBe('thing');
      expect(next.winnerPlayerIds).toEqual(expect.arrayContaining([
        state.players[0].id,
        state.players[1].id,
        state.players[2].id,
      ]));
    });
  });

  // ── PLAY_CARD — Flamethrower eliminates target ──────────────────────────

  describe('PLAY_CARD (flamethrower)', () => {
    it('eliminates adjacent target who has no defense', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      // Remove any no_barbecue from adjacent target
      const targetIdx = 1; // adjacent in a 4-player game
      state.players[targetIdx].hand = state.players[targetIdx].hand.filter(
        c => c.defId !== 'no_barbecue'
      );

      const flameUid = giveCard(state, state.currentPlayerIndex, 'flamethrower');

      const next = gameReducer(state, {
        type: 'PLAY_CARD',
        cardUid: flameUid,
        targetPlayerId: state.players[targetIdx].id,
      });

      const target = next.players[targetIdx];
      expect(target.isAlive).toBe(false);
    });

    it('triggers defense prompt when target has no_barbecue', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const targetIdx = 1;
      giveCard(state, targetIdx, 'no_barbecue');

      const flameUid = giveCard(state, state.currentPlayerIndex, 'flamethrower');

      const next = gameReducer(state, {
        type: 'PLAY_CARD',
        cardUid: flameUid,
        targetPlayerId: state.players[targetIdx].id,
      });

      expect(next.pendingAction).not.toBeNull();
      expect(next.pendingAction!.type).toBe('trade_defense');
      if (next.pendingAction!.type === 'trade_defense') {
        expect(next.pendingAction!.reason).toBe('flamethrower');
      }
    });

    it('rejects a quarantined target even if client sends targetPlayerId directly', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const targetIdx = 1;
      state.players[targetIdx].inQuarantine = true;
      state.players[targetIdx].quarantineTurnsLeft = 2;

      const flameUid = giveCard(state, state.currentPlayerIndex, 'flamethrower');
      const handBefore = state.players[state.currentPlayerIndex].hand.length;

      const next = gameReducer(state, {
        type: 'PLAY_CARD',
        cardUid: flameUid,
        targetPlayerId: state.players[targetIdx].id,
      });

      expect(next.players[targetIdx].isAlive).toBe(true);
      expect(next.players[next.currentPlayerIndex].hand.length).toBe(handBefore);
      expect(next.players[next.currentPlayerIndex].hand.some((handCard) => handCard.uid === flameUid)).toBe(true);
      expect(next.discard.some((discardCard) => discardCard.uid === flameUid)).toBe(false);
    });

    it('revalidates stale choose_target state and rejects flamethrower on a quarantined target', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const flameUid = giveCard(state, state.currentPlayerIndex, 'flamethrower');
      const targetId = state.players[1].id;
      state.pendingAction = {
        type: 'choose_target',
        cardUid: flameUid,
        cardDefId: 'flamethrower',
        targets: [targetId],
      };
      state.players[1].inQuarantine = true;
      state.players[1].quarantineTurnsLeft = 2;

      const next = gameReducer(state, { type: 'SELECT_TARGET', targetPlayerId: targetId });

      expect(next.players[1].isAlive).toBe(true);
      expect(next.pendingAction).toBeNull();
      expect(next.players[next.currentPlayerIndex].hand.some((handCard) => handCard.uid === flameUid)).toBe(true);
      expect(next.discard.some((discardCard) => discardCard.uid === flameUid)).toBe(false);
      expect(next.step).toBe('play_or_discard');
    });
  });

  describe('PLAY_CARD (suspicion)', () => {
    it('starts suspicion pick instead of revealing a random card', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const targetIdx = 1;
      const target = state.players[targetIdx];
      target.hand = [card('fear', 'fear_1'), card('whisky', 'whisky_1')];

      const suspicionUid = giveCard(state, state.currentPlayerIndex, 'suspicion');

      const next = gameReducer(state, {
        type: 'PLAY_CARD',
        cardUid: suspicionUid,
        targetPlayerId: target.id,
      });

      expect(next.pendingAction).toEqual({
        type: 'suspicion_pick',
        targetPlayerId: target.id,
        viewerPlayerId: state.players[state.currentPlayerIndex].id,
        selectableCardUids: ['fear_1', 'whisky_1'],
        previewCardUid: null,
      });
    });

    it('updates suspicion preview uid without revealing the card', () => {
      const state = startGame(4);
      state.pendingAction = {
        type: 'suspicion_pick',
        targetPlayerId: 1,
        viewerPlayerId: 0,
        selectableCardUids: ['card_a', 'card_b'],
        previewCardUid: null,
      };

      const next = gameReducer(state, { type: 'SUSPICION_PREVIEW_CARD', cardUid: 'card_b' });

      expect(next.pendingAction?.type).toBe('suspicion_pick');
      if (next.pendingAction?.type === 'suspicion_pick') {
        expect(next.pendingAction.previewCardUid).toBe('card_b');
      }
    });

    it('confirms the exact previewed suspicion card', () => {
      const state = startGame(4);
      const target = state.players[1];
      target.hand = [card('fear', 'card_a'), card('whisky', 'card_b')];
      state.pendingAction = {
        type: 'suspicion_pick',
        targetPlayerId: target.id,
        viewerPlayerId: state.players[state.currentPlayerIndex].id,
        selectableCardUids: ['card_a', 'card_b'],
        previewCardUid: 'card_b',
      };

      const next = gameReducer(state, { type: 'SUSPICION_CONFIRM_CARD', cardUid: 'card_b' });

      expect(next.pendingAction?.type).toBe('view_card');
      if (next.pendingAction?.type === 'view_card') {
        expect(next.pendingAction.targetPlayerId).toBe(target.id);
        expect(next.pendingAction.viewerPlayerId).toBe(state.players[state.currentPlayerIndex].id);
        expect(next.pendingAction.card.uid).toBe('card_b');
      }
    });
  });

  // ── OFFER_TRADE / RESPOND_TRADE ─────────────────────────────────────────

  describe('OFFER_TRADE / RESPOND_TRADE', () => {
    function setupTrade(): { state: GameState; offerUid: string; responseUid: string } {
      const state = startGame(4);
      state.step = 'trade';
      state.direction = 1;

      // Ensure current player (index 0) and next player (index 1) have tradeable cards
      const cur = state.players[0];
      const partner = state.players[1]; // adjacent, next in direction

      // Clear hands and give known cards
      cur.hand = [card('the_thing', 'keep_thing'), card('suspicion', 'offer_card')];
      cur.role = 'thing';
      partner.hand = [card('watch_your_back', 'resp_card'), card('suspicion', 'resp_extra')];

      // Make sure no doors/quarantine block trade
      state.doors = [];
      cur.inQuarantine = false;
      partner.inQuarantine = false;

      return { state, offerUid: 'offer_card', responseUid: 'resp_card' };
    }

    it('sets pendingAction to trade_defense on offer', () => {
      const { state, offerUid } = setupTrade();
      const next = gameReducer(state, { type: 'OFFER_TRADE', cardUid: offerUid });

      expect(next.pendingAction).not.toBeNull();
      expect(next.pendingAction!.type).toBe('trade_defense');
      expect(next.step).toBe('trade_response');
    });

    it('swaps cards between players on respond', () => {
      const { state, offerUid, responseUid } = setupTrade();

      // First offer
      let next = gameReducer(state, { type: 'OFFER_TRADE', cardUid: offerUid });
      // Then respond
      next = gameReducer(next, { type: 'RESPOND_TRADE', cardUid: responseUid });

      const cur = next.players[0];
      const partner = next.players[1];

      // Current player should now have the partner's card
      expect(cur.hand.some(c => c.uid === responseUid)).toBe(true);
      // Partner should now have the current player's card
      expect(partner.hand.some(c => c.uid === offerUid)).toBe(true);
    });

    it('advances turn after successful trade', () => {
      const { state, offerUid, responseUid } = setupTrade();

      let next = gameReducer(state, { type: 'OFFER_TRADE', cardUid: offerUid });
      next = gameReducer(next, { type: 'RESPOND_TRADE', cardUid: responseUid });

      // Turn should advance or step should be draw
      expect(next.step).toBe('draw');
      expect(next.pendingAction).toBeNull();
    });

    it('kills a player immediately if a trade gives them a fourth infection card', () => {
      const state = startGame(4);
      state.step = 'trade';
      state.direction = 1;
      state.doors = [];

      const thingPlayer = state.players[0];
      const targetPlayer = state.players[1];

      thingPlayer.role = 'thing';
      thingPlayer.hand = [card('the_thing', 'keep_thing'), card('infected', 'infected_offer')];
      targetPlayer.role = 'human';
      targetPlayer.hand = [
        card('infected', 'infected_a'),
        card('infected', 'infected_b'),
        card('infected', 'infected_c'),
        card('watch_your_back', 'survivor_reply'),
      ];

      let next = gameReducer(state, { type: 'OFFER_TRADE', cardUid: 'infected_offer' });
      next = gameReducer(next, { type: 'RESPOND_TRADE', cardUid: 'survivor_reply' });

      expect(next.players[1].isAlive).toBe(false);
      expect(next.players[1].hand).toHaveLength(0);
    });
  });

  // ── PLAY_DEFENSE ────────────────────────────────────────────────────────

  describe('PLAY_DEFENSE', () => {
    it('miss cancels temptation and ends the turn without a neighbor trade', () => {
      const state = startGame(4);
      state.step = 'trade_response';
      state.currentPlayerIndex = 0;
      state.direction = 1;
      state.doors = [];

      state.players[0].hand = [card('the_thing', 'keep_thing'), card('suspicion', 'tempt_offer')];
      state.players[0].role = 'thing';
      state.players[1].hand = [card('miss', 'miss_1'), card('whisky', 'defender_keep')];
      state.players[2].hand = [card('watch_your_back', 'neighbor_trade')];
      stackDeck(state, card('suspicion', 'draw_after_miss'));

      state.pendingAction = {
        type: 'trade_defense',
        defenderId: 1,
        fromId: 0,
        offeredCardUid: 'tempt_offer',
        reason: 'temptation',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: 'miss_1' });

      expect(next.step).toBe('draw');
      expect(next.currentPlayerIndex).toBe(1);
      expect(next.pendingAction).toBeNull();
      expect(next.players[0].hand.some(c => c.uid === 'tempt_offer')).toBe(true);
      expect(next.players[1].hand.some(c => c.uid === 'tempt_offer')).toBe(false);
      expect(next.players[2].hand.some(c => c.uid === 'neighbor_trade')).toBe(true);
    });

    it('fear against temptation reveals the offered card and still ends the turn without a neighbor trade', () => {
      const state = startGame(4);
      state.step = 'trade_response';
      state.currentPlayerIndex = 0;
      state.direction = 1;
      state.doors = [];

      state.players[0].hand = [card('the_thing', 'keep_thing'), card('suspicion', 'tempt_offer')];
      state.players[0].role = 'thing';
      state.players[1].hand = [card('fear', 'fear_1'), card('whisky', 'defender_keep')];
      state.players[2].hand = [card('watch_your_back', 'neighbor_trade')];
      stackDeck(state, card('suspicion', 'draw_after_fear'));

      state.pendingAction = {
        type: 'trade_defense',
        defenderId: 1,
        fromId: 0,
        offeredCardUid: 'tempt_offer',
        reason: 'temptation',
      };

      const afterDefense = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: 'fear_1' });

      expect(afterDefense.pendingAction?.type).toBe('view_card');
      if (afterDefense.pendingAction?.type === 'view_card') {
        expect(afterDefense.pendingAction.card.uid).toBe('tempt_offer');
      }

      const next = gameReducer(afterDefense, { type: 'CONFIRM_VIEW' });

      expect(next.step).toBe('draw');
      expect(next.currentPlayerIndex).toBe(1);
      expect(next.pendingAction).toBeNull();
      expect(next.players[0].hand.some(c => c.uid === 'tempt_offer')).toBe(true);
      expect(next.players[1].hand.some(c => c.uid === 'tempt_offer')).toBe(false);
      expect(next.players[2].hand.some(c => c.uid === 'neighbor_trade')).toBe(true);
    });

    it('no_thanks blocks trade and advances turn', () => {
      const state = startGame(4);
      state.step = 'trade_response';

      const defenderId = 1;
      const noThanksUid = giveCard(state, defenderId, 'no_thanks');

      state.pendingAction = {
        type: 'trade_defense',
        defenderId,
        fromId: 0,
        offeredCardUid: 'some_card',
        reason: 'trade',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: noThanksUid });

      expect(next.pendingAction).toBeNull();
      // Defense card should be in discard
      expect(next.discard.some(c => c.uid === noThanksUid)).toBe(true);
      // Defender should not have the card anymore
      expect(next.players[defenderId].hand.some(c => c.uid === noThanksUid)).toBe(false);
      // Step should advance
      expect(next.step).toBe('draw'); // after advanceTurn
    });

    it('no_barbecue blocks flamethrower', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const defenderId = 1;
      const noBbqUid = giveCard(state, defenderId, 'no_barbecue');

      state.pendingAction = {
        type: 'trade_defense',
        defenderId,
        fromId: 0,
        offeredCardUid: 'flame_card',
        reason: 'flamethrower',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: noBbqUid });

      expect(next.pendingAction).toBeNull();
      // Target should still be alive
      expect(next.players[defenderId].isAlive).toBe(true);
      expect(next.discard.some(c => c.uid === noBbqUid)).toBe(true);
    });

    it('anti_analysis defender dies immediately if the replacement draw creates a fourth infection', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      state.currentPlayerIndex = 0;
      state.direction = 1;
      state.doors = [];

      state.players.forEach((player, index) => {
        player.position = index;
        player.isAlive = true;
        player.inQuarantine = false;
      });

      state.players[0].role = 'human';
      state.players[0].hand = [card('the_thing', 'keep_thing'), card('suspicion', 'post_analysis_trade')];
      state.players[1].role = 'human';
      state.players[1].hand = [
        card('infected', 'inf_1'),
        card('infected', 'inf_2'),
        card('infected', 'inf_3'),
        card('anti_analysis', 'anti_1'),
      ];
      state.players[2].role = 'human';
      state.players[2].hand = [card('watch_your_back', 'alive_neighbor')];
      state.players[3].role = 'thing';
      stackDeck(state, card('infected', 'inf_drawn'));

      state.pendingAction = {
        type: 'trade_defense',
        defenderId: 1,
        fromId: 0,
        offeredCardUid: 'analysis_card',
        reason: 'analysis',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: 'anti_1' });

      expect(next.players[1].isAlive).toBe(false);
      expect(next.players[1].hand).toHaveLength(0);
      expect(next.pendingAction).toBeNull();
      expect(next.step).toBe('trade');
      expect(next.currentPlayerIndex).toBe(0);
    });

    it('im_fine_here defender dies immediately if the replacement draw creates a fourth infection', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      state.currentPlayerIndex = 0;
      state.direction = 1;
      state.doors = [];

      state.players.forEach((player, index) => {
        player.position = index;
        player.isAlive = true;
        player.inQuarantine = false;
      });

      state.players[0].role = 'human';
      state.players[0].hand = [card('the_thing', 'keep_thing'), card('suspicion', 'post_swap_trade')];
      state.players[1].role = 'human';
      state.players[1].hand = [
        card('infected', 'inf_1'),
        card('infected', 'inf_2'),
        card('infected', 'inf_3'),
        card('im_fine_here', 'fine_here_1'),
      ];
      state.players[2].role = 'human';
      state.players[2].hand = [card('watch_your_back', 'alive_neighbor')];
      state.players[3].role = 'thing';
      stackDeck(state, card('infected', 'inf_drawn'));

      state.pendingAction = {
        type: 'trade_defense',
        defenderId: 1,
        fromId: 0,
        offeredCardUid: 'swap_card',
        reason: 'swap',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: 'fine_here_1' });

      expect(next.players[1].isAlive).toBe(false);
      expect(next.players[1].hand).toHaveLength(0);
      expect(next.pendingAction).toBeNull();
      expect(next.step).toBe('trade');
      expect(next.currentPlayerIndex).toBe(0);
      expect(next.players[0].position).toBe(0);
      expect(next.players[2].position).toBe(2);
    });

    it('rejects defense card with wrong category', () => {
      const state = startGame(4);
      state.step = 'trade_response';

      const defenderId = 1;
      const suspicionUid = giveCard(state, defenderId, 'suspicion'); // not a defense card

      state.pendingAction = {
        type: 'trade_defense',
        defenderId,
        fromId: 0,
        offeredCardUid: 'some_card',
        reason: 'trade',
      };

      const next = gameReducer(state, { type: 'PLAY_DEFENSE', cardUid: suspicionUid });

      // Should not have processed — pendingAction still there
      expect(next.pendingAction).not.toBeNull();
    });

    it('blocks normal discard while analysis defense is pending', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';

      const attackerId = state.players[state.currentPlayerIndex].id;
      const discardUid = giveCard(state, state.currentPlayerIndex, 'suspicion');
      const handBefore = state.players[state.currentPlayerIndex].hand.length;

      state.pendingAction = {
        type: 'trade_defense',
        defenderId: state.players[1].id,
        fromId: attackerId,
        offeredCardUid: 'analysis_card',
        reason: 'analysis',
      };

      const next = gameReducer(state, { type: 'DISCARD_CARD', cardUid: discardUid });

      expect(next.players[next.currentPlayerIndex].hand.length).toBe(handBefore);
      expect(next.players[next.currentPlayerIndex].hand.some(c => c.uid === discardUid)).toBe(true);
      expect(next.pendingAction).toEqual(state.pendingAction);
    });
  });

  // ── DECLARE_VICTORY ─────────────────────────────────────────────────────

  describe('DECLARE_VICTORY', () => {
    it('thing wins when no humans remain and some eliminated', () => {
      const state = startGame(4);
      const cur = state.players[state.currentPlayerIndex];
      cur.role = 'thing';
      cur.hand = [card('the_thing')];

      // Make some infected alive, some eliminated
      state.players[1].role = 'infected';
      state.players[1].isAlive = true;
      state.players[2].role = 'infected';
      state.players[2].isAlive = true;
      state.players[3].isAlive = false;
      state.players[3].hand = [];

      const next = gameReducer(state, { type: 'DECLARE_VICTORY' });

      expect(next.phase).toBe('game_over');
      expect(next.winner).toBe('thing');
      expect(next.winnerPlayerIds).toContain(cur.id);
    });

    it('humans win when thing declares incorrectly (humans still alive)', () => {
      const state = startGame(4);
      const cur = state.players[state.currentPlayerIndex];
      cur.role = 'thing';
      cur.hand = [card('the_thing')];

      // Leave at least one human alive
      state.players[1].role = 'human';
      state.players[1].isAlive = true;

      const next = gameReducer(state, { type: 'DECLARE_VICTORY' });

      expect(next.phase).toBe('game_over');
      expect(next.winner).toBe('humans');
      expect(next.winnerPlayerIds).toContain(state.players[1].id);
    });

    it('non-thing player cannot declare victory', () => {
      const state = startGame(4);
      const cur = state.players[state.currentPlayerIndex];
      cur.role = 'human';

      const next = gameReducer(state, { type: 'DECLARE_VICTORY' });

      expect(next.phase).not.toBe('game_over');
      expect(next.winner).toBeNull();
    });

    it('thing_solo win when no humans and no eliminated players', () => {
      const state = startGame(4);
      const cur = state.players[state.currentPlayerIndex];
      cur.role = 'thing';
      cur.hand = [card('the_thing')];

      // Make all other players infected and alive (no eliminated)
      for (const p of state.players) {
        if (p.id !== cur.id) {
          p.role = 'infected';
          p.isAlive = true;
        }
      }

      const next = gameReducer(state, { type: 'DECLARE_VICTORY' });

      expect(next.phase).toBe('game_over');
      expect(next.winner).toBe('thing_solo');
      expect(next.winnerPlayerIds).toEqual([cur.id]);
    });
  });

  // ── syncPlayerRoles ─────────────────────────────────────────────────────

  describe('syncPlayerRoles', () => {
    it('player who receives the_thing card becomes thing role', () => {
      const state = startGame(4);
      // Give a human player the_thing card (simulating a trade or draw)
      const humanIdx = state.players.findIndex(p => p.role === 'human');
      expect(humanIdx).not.toBe(-1);

      state.players[humanIdx].hand.push(card('the_thing', 'injected_thing'));
      // Trigger any action to run syncPlayerRoles
      const next = gameReducer(state, { type: 'SET_LANG', lang: 'en' });

      expect(next.players[humanIdx].role).toBe('thing');
    });

    it('dead players are not synced', () => {
      const state = startGame(4);
      const idx = 2;
      state.players[idx].isAlive = false;
      state.players[idx].role = 'human';
      state.players[idx].hand = [card('the_thing', 'dead_thing')];

      const next = gameReducer(state, { type: 'SET_LANG', lang: 'en' });
      // Dead player's role should remain unchanged
      expect(next.players[idx].role).toBe('human');
    });
  });

  // ── END_TURN ────────────────────────────────────────────────────────────

  describe('END_TURN', () => {
    it('advances currentPlayerIndex to next alive player', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      const prevIdx = state.currentPlayerIndex;

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.currentPlayerIndex).not.toBe(prevIdx);
      expect(next.players[next.currentPlayerIndex].isAlive).toBe(true);
      expect(next.step).toBe('draw');
    });

    it('does nothing when end turn is triggered outside end_turn step', () => {
      const state = startGame(4);
      state.step = 'trade';
      const prevIdx = state.currentPlayerIndex;

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.currentPlayerIndex).toBe(prevIdx);
      expect(next.step).toBe('trade');
      expect(next.pendingAction).toBeNull();
    });

    it('resets step to draw when ending a clean turn', () => {
      const state = startGame(4);
      state.step = 'end_turn';

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.step).toBe('draw');
      expect(next.pendingAction).toBeNull();
    });

    it('blocks end turn while pendingAction is active', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      state.pendingAction = { type: 'choose_card_to_discard' };

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.step).toBe('end_turn');
      expect(next.pendingAction).toEqual(state.pendingAction);
      expect(next.currentPlayerIndex).toBe(state.currentPlayerIndex);
    });

    it('skips dead players', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      state.currentPlayerIndex = 0;

      // Kill player 1
      state.players[1].isAlive = false;

      const next = gameReducer(state, { type: 'END_TURN' });

      // Should skip player 1 and go to player 2 (or wherever direction leads)
      expect(next.players[next.currentPlayerIndex].isAlive).toBe(true);
      expect(next.currentPlayerIndex).not.toBe(1);
    });

    it('decrements quarantine turns on current player', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      const cur = state.players[state.currentPlayerIndex];
      cur.inQuarantine = true;
      cur.quarantineTurnsLeft = 2;

      const next = gameReducer(state, { type: 'END_TURN' });

      // The previous current player should have decremented quarantine
      const prevCur = next.players.find(p => p.id === cur.id)!;
      expect(prevCur.quarantineTurnsLeft).toBe(1);
      expect(prevCur.inQuarantine).toBe(true);
    });

    it('removes quarantine when turns reach zero', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      const cur = state.players[state.currentPlayerIndex];
      cur.inQuarantine = true;
      cur.quarantineTurnsLeft = 1;

      const next = gameReducer(state, { type: 'END_TURN' });

      const prevCur = next.players.find(p => p.id === cur.id)!;
      expect(prevCur.quarantineTurnsLeft).toBe(0);
      expect(prevCur.inQuarantine).toBe(false);
    });

    it('resets tradeSkipped flag', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      state.tradeSkipped = true;

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.tradeSkipped).toBe(false);
    });
  });

  describe('END_TURN', () => {
    it('eliminates the current player with four infection cards and passes the turn onward', () => {
      const state = startGame(4);
      state.step = 'end_turn';
      state.currentPlayerIndex = 0;
      state.players[0].role = 'human';
      state.players[0].hand = [
        card('infected', 'infected_1'),
        card('infected', 'infected_2'),
        card('infected', 'infected_3'),
        card('infected', 'infected_4'),
      ];

      const next = gameReducer(state, { type: 'END_TURN' });

      expect(next.players[0].isAlive).toBe(false);
      expect(next.currentPlayerIndex).toBe(1);
      expect(next.step).toBe('draw');
      expect(next.phase).toBe('playing');
    });
  });

  describe('REVELATIONS_RESPOND', () => {
    it('continues to the next player after confirming a non-infected public reveal', () => {
      const state = startGame(4);
      state.step = 'draw';
      state.players[0].hand = [
        card('suspicion', 'rev_suspicion'),
        card('axe', 'rev_axe'),
      ];
      state.pendingAction = {
        type: 'revelations_round',
        currentRevealerIdx: 0,
        revealOrder: [0, 1, 2, 3],
      };

      const revealed = gameReducer(state, { type: 'REVELATIONS_RESPOND', show: true });
      expect(revealed.pendingAction).toMatchObject({
        type: 'whisky_reveal',
        playerId: state.players[0].id,
        revealKind: 'all',
        revelationsResume: {
          revealOrder: [0, 1, 2, 3],
          nextRevealerIdx: 1,
        },
      });

      const resumed = gameReducer(revealed, { type: 'CONFIRM_VIEW' });
      expect(resumed.pendingAction).toEqual({
        type: 'revelations_round',
        currentRevealerIdx: 1,
        revealOrder: [0, 1, 2, 3],
      });
      expect(resumed.step).toBe('draw');
    });

    it('lets a player reveal only an infected card and then ends revelations after confirmation', () => {
      const state = startGame(4);
      state.step = 'draw';
      state.players[0].hand = [
        card('infected', 'rev_infected'),
        card('suspicion', 'rev_suspicion'),
        card('axe', 'rev_axe'),
      ];
      state.pendingAction = {
        type: 'revelations_round',
        currentRevealerIdx: 0,
        revealOrder: [0, 1, 2, 3],
      };

      const revealed = gameReducer(state, {
        type: 'REVELATIONS_RESPOND',
        show: true,
        mode: 'infected_only',
      });

      expect(revealed.pendingAction).toMatchObject({
        type: 'whisky_reveal',
        playerId: state.players[0].id,
        revealKind: 'infected_only',
        revelationsResume: {
          revealOrder: [0, 1, 2, 3],
          nextRevealerIdx: null,
        },
      });
      expect(revealed.pendingAction?.type).toBe('whisky_reveal');
      if (revealed.pendingAction?.type === 'whisky_reveal') {
        expect(revealed.pendingAction.cards).toHaveLength(1);
        expect(revealed.pendingAction.cards[0].defId).toBe('infected');
      }

      const finished = gameReducer(revealed, { type: 'CONFIRM_VIEW' });
      expect(finished.pendingAction).toBeNull();
      expect(finished.step).toBe('draw');
    });
  });

  describe('rulebook parity fixes', () => {
    it('panic Just Between Us ignores neighbors behind a locked door', () => {
      const state = startGame(4);
      state.players.forEach((player, index) => {
        player.position = index;
        player.isAlive = true;
        player.inQuarantine = false;
      });
      state.currentPlayerIndex = 0;
      state.doors = [{ between: [0, 1] }];

      stackDeck(state, card('panic_between_us', 'panic_between_us_top'));

      const next = gameReducer(state, { type: 'DRAW_CARD' });

      expect(next.pendingAction).toEqual({
        type: 'view_hand',
        targetPlayerId: state.players[3].id,
        cards: expect.any(Array),
        viewerPlayerId: state.players[3].id,
        public: false,
      });
    });

    it('cant_be_friends uses trade defense flow and allows No Thanks', () => {
      const state = startGame(4);
      state.currentPlayerIndex = 0;
      state.players[0].role = 'thing';
      state.players[0].hand = [card('the_thing', 'thing_keep'), card('suspicion', 'panic_offer')];
      state.players[1].hand = [card('no_thanks', 'panic_no_thanks'), card('whisky', 'panic_other')];
      state.pendingAction = { type: 'panic_trade', targetPlayerId: state.players[1].id };

      let next = gameReducer(state, {
        type: 'PANIC_TRADE_SELECT',
        targetPlayerId: state.players[1].id,
        cardUid: 'panic_offer',
      });

      expect(next.pendingAction).toEqual({
        type: 'trade_defense',
        defenderId: state.players[1].id,
        fromId: state.players[0].id,
        offeredCardUid: 'panic_offer',
        reason: 'panic_trade',
      });

      next = gameReducer(next, { type: 'PLAY_DEFENSE', cardUid: 'panic_no_thanks' });

      expect(next.pendingAction).toBeNull();
      expect(next.step).toBe('draw');
      expect(next.players[0].hand.some((handCard) => handCard.uid === 'panic_offer')).toBe(true);
      expect(next.players[1].hand.some((handCard) => handCard.uid === 'panic_other')).toBe(true);
    });

    it('axe asks which obstacle to remove when both door and quarantine are present', () => {
      const state = startGame(4);
      state.step = 'play_or_discard';
      state.currentPlayerIndex = 0;
      state.players[0].position = 0;
      state.players[1].position = 1;
      state.players[1].inQuarantine = true;
      state.players[1].quarantineTurnsLeft = 2;
      state.doors = [{ between: [0, 1] }];
      const axeUid = giveCard(state, 0, 'axe');

      let next = gameReducer(state, {
        type: 'PLAY_CARD',
        cardUid: axeUid,
        targetPlayerId: state.players[1].id,
      });

      expect(next.pendingAction).toEqual({
        type: 'axe_choice',
        targetPlayerId: state.players[1].id,
        canRemoveQuarantine: true,
        canRemoveDoor: true,
      });

      next = gameReducer(next, {
        type: 'AXE_CHOOSE_EFFECT',
        targetPlayerId: state.players[1].id,
        choice: 'door',
      });

      expect(next.pendingAction).toBeNull();
      expect(next.players[1].inQuarantine).toBe(true);
      expect(next.doors).toEqual([]);
      expect(next.step).toBe('draw');
    });
  });
});
