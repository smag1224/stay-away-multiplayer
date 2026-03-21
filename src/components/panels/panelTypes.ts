import type { ViewerGameState, ViewerPlayerState } from '../../multiplayer.ts';
import type { GameAction } from '../../types.ts';

/** Common props shared by most panel components */
export interface PanelProps {
  game: ViewerGameState;
  loading: boolean;
  me: ViewerPlayerState;
  onAction: (action: GameAction) => Promise<void>;
}
