import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';
import { TargetPanel } from './TargetPanel.tsx';
import { DiscardPanel } from './DiscardPanel.tsx';
import { PersistencePanel } from './PersistencePanel.tsx';
import { TemptationPanel } from './TemptationPanel.tsx';
import { RevealPanel } from './RevealPanel.tsx';
import { TradeDefensePanel } from './TradeDefensePanel.tsx';
import { JustBetweenUsPanel } from './JustBetweenUsPanel.tsx';
import { JustBetweenUsPickPanel } from './JustBetweenUsPickPanel.tsx';
import { PartyPassPanel } from './PartyPassPanel.tsx';
import { TemptationResponsePanel } from './TemptationResponsePanel.tsx';
import { PanicTargetPanel } from './PanicTargetPanel.tsx';
import { BlindDatePanel } from './BlindDatePanel.tsx';
import { ForgetfulPanel } from './ForgetfulPanel.tsx';
import { PanicTradePanel } from './PanicTradePanel.tsx';
import { PanicTradeResponsePanel } from './PanicTradeResponsePanel.tsx';
import { RevelationsPanel } from './RevelationsPanel.tsx';
import { SuspicionPickPanel } from './SuspicionPickPanel.tsx';
import { AxeChoicePanel } from './AxeChoicePanel.tsx';

export function PendingActionPanel({
  game,
  loading,
  me,
  onAction,
}: {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const pending = game.pendingAction;
  if (!pending) return null;

  if (pending.type === 'choose_target')
    return <TargetPanel game={game} pending={pending} />;
  if (pending.type === 'choose_card_to_discard')
    return <DiscardPanel game={game} loading={loading} me={me} onAction={onAction} />;
  if (pending.type === 'persistence_pick')
    return <PersistencePanel loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'choose_card_to_give')
    return <TemptationPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'suspicion_pick' && pending.viewerPlayerId === me.id)
    return <SuspicionPickPanel loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'view_hand' || pending.type === 'view_card' || pending.type === 'whisky_reveal')
    return <RevealPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'trade_defense')
    return <TradeDefensePanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'just_between_us')
    return <JustBetweenUsPanel game={game} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'just_between_us_pick')
    return <JustBetweenUsPickPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'party_pass')
    return <PartyPassPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'temptation_response')
    return <TemptationResponsePanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_choose_target')
    return <PanicTargetPanel game={game} pending={pending} />;
  if (pending.type === 'blind_date_swap')
    return <BlindDatePanel game={game} loading={loading} me={me} onAction={onAction} />;
  if (pending.type === 'forgetful_discard')
    return <ForgetfulPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_trade')
    return <PanicTradePanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'panic_trade_response')
    return <PanicTradeResponsePanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;
  if (pending.type === 'axe_choice')
    return <AxeChoicePanel game={game} loading={loading} pending={pending} onAction={onAction} />;
  if (pending.type === 'revelations_round')
    return <RevelationsPanel game={game} loading={loading} me={me} pending={pending} onAction={onAction} />;

  return null;
}
