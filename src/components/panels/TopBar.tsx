import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lang } from '../../appHelpers.ts';
import type { RoomView } from '../../multiplayer.ts';

export function TopBar({
  deckCount,
  lang,
  mobileQuickActionLabel,
  mobileQuickActionVariant = 'danger',
  onMobileQuickAction,
  room,
  onCopy,
  onLeave,
  onToggleLang,
  showCardText,
  onToggleText,
}: {
  deckCount?: number;
  lang: Lang;
  mobileQuickActionLabel?: string;
  mobileQuickActionVariant?: 'danger' | 'accent';
  onMobileQuickAction?: () => void;
  room: RoomView;
  onCopy: () => Promise<void>;
  onLeave: () => void;
  onToggleLang?: () => void;
  showCardText?: boolean;
  onToggleText?: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="top-bar">
      <span className="top-bar-brand">STAY AWAY!</span>
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
      {deckCount !== undefined && (
        <span className="top-bar-deck">
          {t('game.deck')}: {deckCount}
        </span>
      )}
      {/* Desktop actions */}
      <div className="top-bar-actions desktop-actions">
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
          {onToggleText && (
            <button className="dropdown-item" onClick={() => { onToggleText(); setMenuOpen(false); }} type="button">
              {showCardText ? t('topbar.hideText') : t('topbar.cardText')}
            </button>
          )}
          <button className="dropdown-item" onClick={() => { void onCopy(); setMenuOpen(false); }} type="button">
            {t('topbar.copyLink')}
          </button>
          <button className="dropdown-item danger" onClick={() => { onLeave(); setMenuOpen(false); }} type="button">
            {t('topbar.leave')}
          </button>
        </div>
      )}
    </div>
  );
}
