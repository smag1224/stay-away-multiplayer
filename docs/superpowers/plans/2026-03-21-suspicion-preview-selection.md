# Suspicion Preview Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the random `Suspicion` reveal with an explicit preview-and-confirm card selection flow that synchronizes provisional choice visibility to all players.

**Architecture:** Add a dedicated `suspicion_pick` pending action in shared game state, extend server-side viewer sanitization so each client gets the right amount of preview data, and add one focused center-panel UI for the acting player while reusing existing reveal behavior after confirmation. The preview uid becomes the single source of truth for all table-side animation and highlighting.

**Tech Stack:** React, TypeScript, Framer Motion, custom Node HTTP multiplayer server, existing game reducer tests

---

### Task 1: Extend shared game types for the new Suspicion flow

**Files:**
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\types.ts`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\multiplayer.ts`
- Test: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\__tests__\gameReducer.test.ts`

- [ ] **Step 1: Write the failing reducer test for Suspicion entering pick mode**

```ts
it('starts suspicion pick instead of revealing a random card', () => {
  const uid = giveCard(state, state.currentPlayerIndex, 'suspicion');
  const target = state.players[(state.currentPlayerIndex + 1) % state.players.length];
  target.hand = [card('fear', 'fear_1'), card('whisky', 'whisky_1')];

  const next = gameReducer(state, { type: 'PLAY_CARD', cardUid: uid, targetPlayerId: target.id });

  expect(next.pendingAction).toEqual({
    type: 'suspicion_pick',
    targetPlayerId: target.id,
    viewerPlayerId: state.players[state.currentPlayerIndex].id,
    selectableCardUids: ['fear_1', 'whisky_1'],
    previewCardUid: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/gameLogic/__tests__/gameReducer.test.ts`
Expected: FAIL because `suspicion_pick` and new actions/types do not exist yet.

- [ ] **Step 3: Add the new shared types**

Add to `src/types.ts`:

```ts
| {
    type: 'suspicion_pick';
    targetPlayerId: number;
    viewerPlayerId: number;
    selectableCardUids: string[];
    previewCardUid: string | null;
  }
```

Add to `GameAction`:

```ts
| { type: 'SUSPICION_PREVIEW_CARD'; cardUid: string }
| { type: 'SUSPICION_CONFIRM_CARD'; cardUid: string }
```

- [ ] **Step 4: Verify typecheck for the changed files**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: type errors move to reducer/server sites that still need implementation, but the new types parse correctly.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/multiplayer.ts src/gameLogic/__tests__/gameReducer.test.ts
git commit -m "feat: add suspicion pick state types"
```

### Task 2: Implement reducer logic for preview and confirm

**Files:**
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\cardEffects.ts`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\actionHandlers.ts`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\validation.ts`
- Test: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\__tests__\gameReducer.test.ts`

- [ ] **Step 1: Add failing tests for preview update and confirm**

```ts
it('updates suspicion preview uid without revealing the card', () => {
  state.pendingAction = {
    type: 'suspicion_pick',
    targetPlayerId: 1,
    viewerPlayerId: 0,
    selectableCardUids: ['a', 'b'],
    previewCardUid: null,
  };

  const next = gameReducer(state, { type: 'SUSPICION_PREVIEW_CARD', cardUid: 'b' });

  expect(next.pendingAction?.type).toBe('suspicion_pick');
  expect(next.pendingAction?.previewCardUid).toBe('b');
});

it('confirms the selected suspicion card and reveals that exact card', () => {
  // arrange target hand + suspicion_pick
  const next = gameReducer(state, { type: 'SUSPICION_CONFIRM_CARD', cardUid: 'b' });
  expect(next.pendingAction).toMatchObject({
    type: 'view_card',
    viewerPlayerId: 0,
    targetPlayerId: 1,
    card: { uid: 'b' },
  });
});
```

- [ ] **Step 2: Run reducer test to verify the new cases fail**

Run: `npm test -- src/gameLogic/__tests__/gameReducer.test.ts`
Expected: FAIL on unknown action handling / wrong Suspicion behavior.

- [ ] **Step 3: Change Suspicion from random reveal to pick state**

In `src/gameLogic/cardEffects.ts`, replace:

```ts
const randIdx = Math.floor(Math.random() * target.hand.length);
s.pendingAction = {
  type: 'view_card',
  targetPlayerId: target.id,
  card: target.hand[randIdx],
  viewerPlayerId: player.id,
};
```

with:

```ts
s.pendingAction = {
  type: 'suspicion_pick',
  targetPlayerId: target.id,
  viewerPlayerId: player.id,
  selectableCardUids: target.hand.map((item) => item.uid),
  previewCardUid: null,
};
```

- [ ] **Step 4: Implement preview and confirm handlers**

In `src/gameLogic/actionHandlers.ts`, add handlers that:
- update `previewCardUid` only if the uid is selectable;
- resolve `SUSPICION_CONFIRM_CARD` into a `view_card` pending action using the target hand card matching the chosen uid.

Use logic like:

```ts
if (!s.pendingAction || s.pendingAction.type !== 'suspicion_pick') return s;
if (!s.pendingAction.selectableCardUids.includes(action.cardUid)) return s;
```

- [ ] **Step 5: Add validation guardrails**

In `src/gameLogic/validation.ts`, allow the new actions only when:
- current pending action is `suspicion_pick`;
- acting player matches `viewerPlayerId`;
- selected uid exists in the selectable list.

- [ ] **Step 6: Re-run reducer tests**

Run: `npm test -- src/gameLogic/__tests__/gameReducer.test.ts`
Expected: PASS for the new Suspicion cases.

- [ ] **Step 7: Commit**

```bash
git add src/gameLogic/cardEffects.ts src/gameLogic/actionHandlers.ts src/gameLogic/validation.ts src/gameLogic/__tests__/gameReducer.test.ts
git commit -m "feat: implement suspicion preview and confirm flow"
```

### Task 3: Extend server viewer sanitization for shared preview visibility

**Files:**
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\server\server.ts`
- Test: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\__tests__\sixPlayerRender.test.tsx`

- [ ] **Step 1: Add a failing assertion for pending action visibility contract**

Add a focused test or temporary render assertion that a `suspicion_pick` state with `previewCardUid` can be passed into the UI without crashing.

- [ ] **Step 2: Update pending action visibility rules**

In `server/server.ts`, extend `canViewerSeePendingAction`:

```ts
case 'suspicion_pick':
  return true;
```

Then customize `sanitizePendingAction` so the payload is role-aware:
- acting player keeps full `selectableCardUids`;
- everyone else gets `targetPlayerId`, `viewerPlayerId`, and `previewCardUid`;
- no non-acting player receives target card faces.

- [ ] **Step 3: Keep the payload shape stable**

Return a sanitized clone like:

```ts
if (pendingAction.type === 'suspicion_pick' && pendingAction.viewerPlayerId !== viewerId) {
  return {
    type: 'suspicion_pick',
    targetPlayerId: pendingAction.targetPlayerId,
    viewerPlayerId: pendingAction.viewerPlayerId,
    selectableCardUids: [],
    previewCardUid: pendingAction.previewCardUid,
  };
}
```

- [ ] **Step 4: Verify the app still builds with the new server-visible state**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/server.ts src/components/panels/__tests__/sixPlayerRender.test.tsx
git commit -m "feat: expose suspicion preview state to viewers"
```

### Task 4: Add the acting-player Suspicion selection panel

**Files:**
- Create: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\SuspicionPickPanel.tsx`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\PendingActionPanel.tsx`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\App.css`

- [ ] **Step 1: Create a failing panel integration test**

Write a render test that mounts `PendingActionPanel` with:

```ts
pending: {
  type: 'suspicion_pick',
  targetPlayerId: 2,
  viewerPlayerId: 1,
  selectableCardUids: ['a', 'b', 'c'],
  previewCardUid: 'b',
}
```

Expected:
- three face-down selectable items render;
- confirm button is enabled only when a preview exists.

- [ ] **Step 2: Implement `SuspicionPickPanel.tsx`**

Render one face-down card per uid and wire buttons:

```tsx
onClick={() => void onAction({ type: 'SUSPICION_PREVIEW_CARD', cardUid: uid })}
onClick={() => void onAction({ type: 'SUSPICION_CONFIRM_CARD', cardUid: previewUid })}
```

Use Framer Motion or existing button/card classes so the selected back card raises slightly.

- [ ] **Step 3: Route the new pending action in `PendingActionPanel.tsx`**

Add:

```tsx
if (pending.type === 'suspicion_pick' && pending.viewerPlayerId === me.id) {
  return <SuspicionPickPanel ... />;
}
```

- [ ] **Step 4: Add panel styles**

Add small focused CSS classes for:
- center suspicion row;
- face-down selectable card;
- selected/raised state;
- mobile-friendly confirm button layout.

- [ ] **Step 5: Run focused UI test**

Run: `npm test -- src/components/panels`
Expected: PASS for the new panel test.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/SuspicionPickPanel.tsx src/components/panels/PendingActionPanel.tsx src/App.css
git commit -m "feat: add suspicion selection panel"
```

### Task 5: Synchronize preview highlights for target hand and public table fan

**Files:**
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\PlayerHand.tsx`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\PlayerCircle.tsx`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\App.css`

- [ ] **Step 1: Add focused render tests for preview highlighting**

Create assertions that:
- target player hand marks the `previewCardUid` card;
- opponent fan marks the matching slot/card-back as pushed forward.

- [ ] **Step 2: Highlight the target player's own card in `PlayerHand.tsx`**

Compute:

```ts
const suspicionPreviewUid =
  pending?.type === 'suspicion_pick' && pending.targetPlayerId === me.id
    ? pending.previewCardUid
    : null;
```

Apply a CSS class like `is-suspicion-preview` to the matching hand card container.

- [ ] **Step 3: Push forward the public fan card in `PlayerCircle.tsx`**

When rendering the target player's back-card fan, check whether:

```ts
game.pendingAction?.type === 'suspicion_pick'
&& game.pendingAction.targetPlayerId === player.id
```

Then mark the placeholder whose uid/slot matches the preview. Use a class like `opponent-card-back previewed`.

- [ ] **Step 4: Add CSS for the preview state**

Add minimal animation rules:

```css
.hand-card.is-suspicion-preview { transform: translateY(-18px) scale(1.03); }
.opponent-card-back.previewed { transform: translateX(-50%) translateX(var(--card-shift)) translateY(calc(var(--card-depth) - 10px)) rotate(var(--card-tilt)) scale(1.03); }
```

Tune values so the motion is readable but not disruptive.

- [ ] **Step 5: Run build and focused tests**

Run:
- `npm test -- src/components/panels`
- `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/PlayerHand.tsx src/components/panels/PlayerCircle.tsx src/App.css
git commit -m "feat: sync suspicion preview highlights"
```

### Task 6: Final verification

**Files:**
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\gameLogic\__tests__\gameReducer.test.ts`
- Modify: `C:\Users\smag1\OneDrive\Рабочий стол\CODEX NECHYO\НЕЧТО\stay-away-multiplayer\src\components\panels\__tests__\sixPlayerRender.test.tsx`

- [ ] **Step 1: Add unauthorized action coverage**

Add reducer/server-level tests that non-viewers cannot preview or confirm someone else's Suspicion pick.

- [ ] **Step 2: Add exact-card confirmation coverage**

Verify that previewing `uid_b` and confirming `uid_b` always reveals `uid_b`, never a random alternative.

- [ ] **Step 3: Run the full relevant test set**

Run:
- `npm test -- src/gameLogic/__tests__/gameReducer.test.ts`
- `npm test -- src/components/panels`
- `npm run build`

Expected: all PASS.

- [ ] **Step 4: Manual multiplayer smoke test**

Run the app and verify:
1. player A plays `Suspicion`;
2. center panel shows back cards;
3. target sees provisional highlight;
4. observers see provisional fan shift;
5. confirm reveals only to player A.

- [ ] **Step 5: Commit**

```bash
git add src/gameLogic/__tests__/gameReducer.test.ts src/components/panels/__tests__/sixPlayerRender.test.tsx
git commit -m "test: cover suspicion preview selection flow"
```

