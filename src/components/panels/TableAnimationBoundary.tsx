import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { ViewerGameState } from '../../multiplayer.ts';
import { TableAnimation } from './TableAnimation.tsx';

type Props = {
  game: ViewerGameState;
};

type State = {
  hasError: boolean;
};

export class TableAnimationBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TableAnimationBoundary] table animation crashed', error, info);
  }

  componentDidUpdate(prevProps: Props) {
    const prevSceneId = prevProps.game.tableAnim && 'sceneId' in prevProps.game.tableAnim ? prevProps.game.tableAnim.sceneId : null;
    const nextSceneId = this.props.game.tableAnim && 'sceneId' in this.props.game.tableAnim ? this.props.game.tableAnim.sceneId : null;
    if (this.state.hasError && prevSceneId !== nextSceneId) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }

    return <TableAnimation game={this.props.game} />;
  }
}
