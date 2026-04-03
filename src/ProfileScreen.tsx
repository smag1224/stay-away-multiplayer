import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './appHelpers.ts';
import type { UserStats } from './multiplayer.ts';

function RoleBar({ label, played, wins }: { label: string; played: number; wins: number }) {
  const pct = played > 0 ? Math.round((wins / played) * 100) : 0;
  return (
    <div className="profile-role-row">
      <span className="profile-role-label">{label}</span>
      <div className="profile-role-bar-wrap">
        <div className="profile-role-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="profile-role-stat">{wins}/{played} ({pct}%)</span>
    </div>
  );
}

export function ProfileScreen({ username, onClose }: { username: string; onClose: () => void }) {
  const { i18n } = useTranslation();
  const isRu = i18n.language !== 'en';
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<UserStats>(`/api/users/${encodeURIComponent(username)}/stats`)
      .then(setStats)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [username]);

  const roleLabel = (role: string) => {
    if (isRu) return role === 'human' ? 'Человек' : role === 'thing' ? 'Нечто' : 'Заражённый';
    return role === 'human' ? 'Human' : role === 'thing' ? 'The Thing' : 'Infected';
  };

  return (
    <div className="profile-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="profile-card">
        <button className="profile-close" onClick={onClose} type="button">✕</button>

        <div className="profile-header">
          <div className="profile-avatar">👤</div>
          <h2 className="profile-username">{username}</h2>
          {stats && <div className="profile-elo">ELO: <strong>{stats.elo}</strong></div>}
        </div>

        {error && <p className="error-text" style={{ padding: '1rem' }}>{error}</p>}

        {!stats && !error && (
          <p style={{ padding: '1rem', opacity: 0.6 }}>{isRu ? 'Загрузка...' : 'Loading...'}</p>
        )}

        {stats && (
          <div className="profile-body">
            <div className="profile-summary">
              <div className="profile-stat-block">
                <span className="profile-stat-val">{stats.gamesPlayed}</span>
                <span className="profile-stat-lbl">{isRu ? 'Игр' : 'Games'}</span>
              </div>
              <div className="profile-stat-block">
                <span className="profile-stat-val">{stats.wins}</span>
                <span className="profile-stat-lbl">{isRu ? 'Побед' : 'Wins'}</span>
              </div>
              <div className="profile-stat-block">
                <span className="profile-stat-val">{Math.round(stats.winRate * 100)}%</span>
                <span className="profile-stat-lbl">{isRu ? 'Винрейт' : 'Win rate'}</span>
              </div>
            </div>

            <div className="profile-roles">
              <p className="profile-section-title">{isRu ? 'По ролям' : 'By role'}</p>
              <RoleBar label={roleLabel('human')}    played={stats.byRole.human.played}    wins={stats.byRole.human.wins} />
              <RoleBar label={roleLabel('thing')}    played={stats.byRole.thing.played}    wins={stats.byRole.thing.wins} />
              <RoleBar label={roleLabel('infected')} played={stats.byRole.infected.played} wins={stats.byRole.infected.wins} />
            </div>

            {stats.recentGames.length > 0 && (
              <div className="profile-history">
                <p className="profile-section-title">{isRu ? 'Последние игры' : 'Recent games'}</p>
                <div className="profile-history-list">
                  {stats.recentGames.map((g, i) => (
                    <div key={i} className={`profile-history-row ${g.result}`}>
                      <span className="ph-role">{roleLabel(g.role)}</span>
                      <span className="ph-players">{g.playerCount}p</span>
                      <span className={`ph-result ${g.result}`}>{g.result === 'win' ? (isRu ? 'Победа' : 'Win') : (isRu ? 'Поражение' : 'Loss')}</span>
                      <span className={`ph-elo ${g.eloChange >= 0 ? 'pos' : 'neg'}`}>{g.eloChange >= 0 ? '+' : ''}{g.eloChange}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.gamesPlayed === 0 && (
              <p style={{ opacity: 0.5, textAlign: 'center', padding: '1rem' }}>
                {isRu ? 'Игр пока нет' : 'No games yet'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
