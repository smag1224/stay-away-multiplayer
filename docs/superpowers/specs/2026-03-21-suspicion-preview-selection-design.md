# Suspicion Preview Selection Design

## Goal

Replace the current random-card behavior of `Suspicion` with an explicit server-synchronized card selection flow.

The acting player should choose a target card face-down from the center of the table, then confirm the choice. Before confirmation, all players should see the provisional selection in different forms:

- the acting player sees the selected back card raised in the center panel;
- the suspected player sees which of their own cards is currently targeted;
- all other players see the corresponding card in the suspected player's table fan pushed forward slightly.

After confirmation, only the acting player sees the revealed face of the chosen card.

## Current Behavior

`Suspicion` currently picks a random card from the target hand immediately in `src/gameLogic/cardEffects.ts` and converts the effect straight into `pendingAction.type = 'view_card'`.

That prevents:

- player agency over which card is checked;
- mobile-safe interaction with explicit confirmation;
- synchronized provisional choice feedback for other players.

## Product Requirements

### Interaction

When `Suspicion` is played against a valid target:

1. The game enters a dedicated selection state instead of choosing a random card.
2. The acting player sees one face-down card slot per target hand card in stable hand order.
3. Tapping a card marks it as the provisional selection only.
4. A separate confirm button finalizes the chosen card.
5. The chosen card is revealed only after confirmation and only to the acting player.

### Visibility

During provisional selection:

- the acting player sees the selected center card raised;
- the target player sees the corresponding real card in their own hand highlighted/raised;
- all other players see the corresponding card back in the target table fan shifted forward;
- no non-acting player sees card faces or hidden card identities beyond the selected slot.

### Mobile

Selection must be tap-first and confirmation must be explicit. No hover-only interaction may be required for correctness.

## Proposed State Changes

Add a new `PendingAction` variant:

```ts
{
  type: 'suspicion_pick';
  targetPlayerId: number;
  viewerPlayerId: number;
  selectableCardUids: string[];
  previewCardUid: string | null;
}
```

### Notes

- `selectableCardUids` preserves the target hand order exactly as it exists at the moment `Suspicion` starts.
- `previewCardUid` is the current provisional selection shared by the server with all clients.
- The server remains the only source of truth.

## Proposed Action Changes

Add two new actions:

```ts
{ type: 'SUSPICION_PREVIEW_CARD'; cardUid: string }
{ type: 'SUSPICION_CONFIRM_CARD'; cardUid: string }
```

### Rules

- only the acting player may dispatch either action;
- `SUSPICION_PREVIEW_CARD` only updates `previewCardUid`;
- `SUSPICION_CONFIRM_CARD` is valid only if `cardUid` belongs to `selectableCardUids`;
- after confirmation, the game transitions into the existing `view_card` flow using the chosen card.

## Game Logic Changes

### `Suspicion` effect

In `src/gameLogic/cardEffects.ts`:

- stop choosing a random index;
- create `pendingAction.type = 'suspicion_pick'`;
- fill `selectableCardUids` from the target hand in current order;
- initialize `previewCardUid` to `null`.

### Reducer / action handling

Implement handlers so that:

- preview changes are cheap and reversible;
- confirm converts `suspicion_pick` into:

```ts
{
  type: 'view_card',
  targetPlayerId,
  viewerPlayerId,
  card: chosenCard
}
```

### Validation

Validate that:

- target still exists;
- selected uid still exists in target hand;
- acting player is still the authorized viewer;
- no other player can mutate preview state.

## Server Sanitization And Visibility

The server already sanitizes pending actions per viewer. Extend it for `suspicion_pick`.

### Acting player

Receives:

- full `suspicion_pick`;
- real `selectableCardUids`;
- current `previewCardUid`.

This is enough to render the center row of card backs and confirm a selection.

### Target player

Receives:

- `suspicion_pick`;
- `targetPlayerId`;
- `previewCardUid`.

Because the target already knows their own hand, the client can highlight the matching real card in-hand.

### Other players

Receives:

- `suspicion_pick`;
- `targetPlayerId`;
- `previewCardUid`.

They still do not receive card faces or target hand contents. They only use the chosen uid to push forward the matching hidden back in the public fan.

## UI Changes

### New panel

Add a dedicated `SuspicionPickPanel` for the acting player.

Behavior:

- renders one face-down card per `selectableCardUids`;
- selected card raises slightly;
- confirm button stays disabled until a card is selected;
- tapping a different card updates preview state immediately.

### Target hand

Update `PlayerHand` so that if:

- `pendingAction.type === 'suspicion_pick'`
- and `me.id === pendingAction.targetPlayerId`

then the matching card by `previewCardUid` is visually lifted or outlined.

### Table fan

Update `PlayerCircle` so that if:

- `pendingAction.type === 'suspicion_pick'`
- and the rendered opponent is the target player

then the matching card back in that fan is shifted forward slightly.

Because public opponent fans are built from count-only placeholders, their visual order must align with the stable `selectableCardUids` order.

## Animation Rules

Preview state should be subtle and readable:

- center selected card: raised upward;
- target private hand: raised or outlined;
- public opponent fan: moved forward along the local fan axis.

The preview effect should switch cleanly when the acting player taps another card.

## Edge Cases

- If the target has zero cards, `Suspicion` does nothing as today.
- If the previewed card disappears before confirmation due to future rule changes, confirm must fail safely.
- When confirmation completes, preview visuals must disappear for everyone immediately.
- Reconnects must restore the same preview state from server truth.

## Testing Plan

### Logic tests

Add tests covering:

1. `Suspicion` enters `suspicion_pick` instead of random reveal.
2. Preview updates only change `previewCardUid`.
3. Confirm reveals the exact chosen card.
4. Unauthorized players cannot preview or confirm.

### Viewer-state tests

Add tests covering:

1. acting player receives `suspicion_pick`;
2. target player receives enough data to highlight the chosen card;
3. non-target observers receive preview state without hidden card faces.

### UI tests

Add tests covering:

1. center panel selection enables confirm;
2. target hand highlights the previewed card;
3. opponent table fan pushes forward the previewed hidden card.

## Implementation Notes

- Reuse the existing reveal flow after confirmation instead of inventing a second reveal UI.
- Keep `previewCardUid` in server state rather than in ephemeral client-only animation state.
- Prefer minimal extensions to current sanitization instead of parallel ad hoc channels.

## Acceptance Criteria

- `Suspicion` no longer reveals a random card.
- The acting player must explicitly select and confirm a face-down card.
- The provisional selection is synchronized to every client before confirmation.
- The target can see which card is being targeted.
- Other players can see which hidden slot is being targeted in the public fan.
- Only the acting player sees the revealed card face after confirmation.
