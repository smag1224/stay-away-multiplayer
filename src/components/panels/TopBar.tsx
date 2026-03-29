import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lang } from '../../appHelpers.ts';
import type { RoomView } from '../../multiplayer.ts';
import { MusicVolumeSlider } from './MusicVolumeSlider.tsx';

export function TopBar({
  deckCount,
  lang,
  mobileQuickActionLabel,
  mobileQuickActionVariant = 'danger',
  onMobileQuickAction,
  performanceMode = false,
  room,
  onCopy,
  onLeave,
  onTogglePerformanceMode,
  onToggleLang,
  showCardText,
  onToggleText,
  hintsEnabled,
  onToggleHints,
  noticeContent,
}: {
  deckCount?: number;
  lang: Lang;
  mobileQuickActionLabel?: string;
  mobileQuickActionVariant?: 'danger' | 'accent';
  onMobileQuickAction?: () => void;
  performanceMode?: boolean;
  room: RoomView;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onTogglePerformanceMode?: () => void;
  onToggleLang?: () => void;
  showCardText?: boolean;
  onToggleText?: () => void;
  hintsEnabled?: boolean;
  onToggleHints?: () => void;
  noticeContent?: ReactNode;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="top-bar">
      <span className="top-bar-brand">НЕЧТО</span>
      {mobileQuickActionLabel && onMobileQuickAction && (
        <button
          className={`top-bar-quick-action ${mobileQuickActionVariant}`}
          onClick={onMobileQuickAction}
          type="button">
          {mobileQuickActionLabel}
        </button>
      )}
      <span className="top-bar-sep">·</span>
      <span className="top-bar-room-label">{t('topbar.room')}</span>
      <span className="top-bar-room">{room.code}</span>
      {noticeContent ? <div className="top-bar-notice-area">{noticeContent}</div> : null}
      {deckCount !== undefined && (
        <span className="top-bar-deck">
          {t('game.deck')}: {deckCount}
        </span>
      )}
      {/* Music volume slider */}
      <MusicVolumeSlider disabled={performanceMode} />
      {/* Desktop actions */}
      <div className="top-bar-actions desktop-actions">
        {onTogglePerformanceMode && (
          <button className={`btn small ${performanceMode ? 'primary' : 'ghost'}`} onClick={onTogglePerformanceMode} type="button">
            ⚡ {performanceMode ? t('topbar.performanceOn') : t('topbar.performanceOff')}
          </button>
        )}
        {onToggleHints && (
          <button className={`btn small ${hintsEnabled ? 'primary' : 'ghost'}`} onClick={onToggleHints} type="button">
            💡 {hintsEnabled ? t('topbar.hintsOn', 'Подсказки') : t('topbar.hintsOff', 'Подсказки')}
          </button>
        )}
        {onToggleText && (
          <button className={`btn small ${showCardText ? 'primary' : 'ghost'}`} onClick={onToggleText} type="button">
            {showCardText ? t('topbar.hideText') : t('topbar.cardText')}
          </button>
        )}
        <button className="btn small secondary" onClick={() => void onCopy()} type="button">
          {t('topbar.copyLink')}
        </button>
        <button className="btn small ghost" onClick={onLeave} type="button">
          {t('topbar.leave')}
        </button>
      </div>
      {/* Mobile hamburger */}
      <button
        className="top-bar-hamburger"
        onClick={() => setMenuOpen(v => !v)}
        type="button"
        aria-label="Menu"
      >
        <span className={`hamburger-icon ${menuOpen ? 'open' : ''}`}>
          <span /><span /><span />
        </span>
      </button>
      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="top-bar-dropdown">
          {onToggleLang && (
            <button className="dropdown-item" onClick={() => { onToggleLang(); setMenuOpen(false); }} type="button">
              {t('topbar.language')} {lang === 'ru' ? 'EN' : 'RU'}
            </button>
          )}
          {onTogglePerformanceMode && (
            <button className="dropdown-item" onClick={() => { onTogglePerformanceMode(); setMenuOpen(false); }} type="button">
              ⚡ {performanceMode ? t('topbar.performanceOn') : t('topbar.performanceOff')}
            </button>
          )}
          {onToggleHints && (
            <button className="dropdown-item" onClick={() => { onToggleHints(); setMenuOpen(false); }} type="button">
              💡 {hintsEnabled ? t('topbar.hintsOn', 'Подсказки вкл') : t('topbar.hintsOff', 'Подсказки выкл')}
            </button>
          )}
          {onToggleText && (
            <button className="dropdown-item" onClick={() => { onToggleText(); setMenuOpen(false); }} type="button">
              {showCardText ? t('topbar.hideText') : t('topbar.cardText')}
            </button>
          )}
          <button className="dropdown-item" onClick={() => { void onCopy(); setMenuOpen(false); }} type="button">
            {t('topbar.copyLink')}
          </button>
          <div className="dropdown-divider" />
          <button className="dropdown-item danger" onClick={() => { onLeave(); setMenuOpen(false); }} type="button">
            {t('topbar.leave')}
          </button>
        </div>
      )}
    </div>
  );
}
