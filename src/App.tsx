import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectScreen, LobbyScreen } from './ConnectLobby.tsx';
// Lazy-load the heavy game screen — only downloaded when a game actually starts
const GameScreen = lazy(() =>
  import('./GameScreen.tsx').then((m) => ({ default: m.GameScreen })),
);
import type { RoomView, SessionInfo } from './multiplayer.ts';
import {
  api,
  copyToClipboard,
  getViewerPlayer,
  readStoredSession,
  writeStoredLang,
  writeStoredSession,
} from './appHelpers.ts';
import type { Lang } from './appHelpers.ts';
import './App.css';

function App() {
  const { i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [session, setSession] = useState<SessionInfo | null>(() => readStoredSession());
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState(() => (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [gameMode, setGameMode] = useState<'standard' | 'thing_in_deck' | 'anomaly'>('standard');
  // Track latest known state timestamp to prevent stale poll responses from overwriting fresh action responses
  const lastKnownUpdatedAt = useRef(0);

  const toggleLang = () => {
    const next: Lang = lang === 'ru' ? 'en' : 'ru';
    void i18n.changeLanguage(next);
    writeStoredLang(next);
  };

  useEffect(() => {
    if (!session) {
      setRoom(null);
      lastKnownUpdatedAt.current = 0;
      return;
    }
    const activeSession = session;

    let cancelled = false;

    const handleRoomData = (nextRoom: RoomView) => {
      if (cancelled) return;
      if (nextRoom.updatedAt >= lastKnownUpdatedAt.current) {
        setRoom(nextRoom);
        lastKnownUpdatedAt.current = nextRoom.updatedAt;
        setError(null);
      }
    };

    const handleError = (message: string) => {
      if (cancelled) return;
      setError(message);
      if (message.includes('Room not found') || message.includes('Session not found')) {
        writeStoredSession(null);
        setSession(null);
        setRoom(null);
      }
    };

    let pollInterval: number | null = null;
    let isPending = false;

    function startPolling() {
      if (pollInterval || cancelled) return;
      const refresh = async () => {
        // Skip if a request is already in-flight — prevents pile-up on slow connections
        if (isPending || cancelled) return;
        isPending = true;
        try {
          const nextRoom = await api<RoomView>(`/api/rooms/${activeSession.roomCode}?sessionId=${activeSession.sessionId}`);
          handleRoomData(nextRoom);
        } catch (e) {
          handleError(e instanceof Error ? e.message : String(e));
        } finally {
          isPending = false;
        }
      };
      void refresh();
      pollInterval = window.setInterval(refresh, 1200);
    }

    // We intentionally use polling instead of SSE here.
    // During local multiplayer testing with many browser windows/tabs,
    // EventSource can hit per-origin connection limits and stall actions
    // like "start game", leaving the lobby stuck in a loading state.
    startPolling();

    return () => {
      cancelled = true;
      if (pollInterval) window.clearInterval(pollInterval);
    };
  }, [session]);

  useEffect(() => {
    if (!room) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', room.code);
    window.history.replaceState({}, '', nextUrl);
  }, [room]);

  const game = room?.game ?? null;
  const showFloatingLangToggle = !session || !room || !game;
  const me = useMemo(
    () => (game ? getViewerPlayer(game, room?.me.playerId ?? null) : null),
    [game, room?.me.playerId],
  );
  const shareUrl = room ? `${window.location.origin}?room=${room.code}` : '';

  const updateCopied = async () => {
    if (!shareUrl) return;
    try {
      await copyToClipboard(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  };

  const callRoomEndpoint = async (path: string, body: object) => {
    setLoading(true);
    try {
      const nextRoom = await api<RoomView>(path, { method: 'POST', body: JSON.stringify(body) });
      // Update the timestamp guard so stale poll responses don't overwrite this fresh state
      lastKnownUpdatedAt.current = nextRoom.updatedAt;
      setRoom(nextRoom);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  };

  const persistRoom = (nextRoom: RoomView) => {
    const nextSession = { roomCode: nextRoom.code, sessionId: nextRoom.me.sessionId };
    writeStoredSession(nextSession);
    setSession(nextSession);
    setRoom(nextRoom);
    setJoinCode(nextRoom.code);
  };

  return (
    <div className="app-shell">
      {showFloatingLangToggle && (
        <button className="lang-toggle" onClick={toggleLang} type="button">
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      )}

      {!session && (
        <ConnectScreen
          copied={copied}
          error={error}
          joinCode={joinCode}
          loading={loading}
          name={name}
          onCreateRoom={async () => {
            const trimmedName = name.trim();
            if (!trimmedName) return setError(i18n.t('connect.errorEnterName'));
            setLoading(true);
            try {
              const nextRoom = await api<RoomView>('/api/rooms/create', { method: 'POST', body: JSON.stringify({ name: trimmedName }) });
              persistRoom(nextRoom);
              setError(null);
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : String(createError));
            } finally {
              setLoading(false);
            }
          }}
          onJoinRoom={async () => {
            const trimmedName = name.trim();
            const roomCode = joinCode.trim().toUpperCase();
            if (!trimmedName || !roomCode) return setError(i18n.t('connect.errorEnterNameAndCode'));
            setLoading(true);
            try {
              const nextRoom = await api<RoomView>(`/api/rooms/${roomCode}/join`, { method: 'POST', body: JSON.stringify({ name: trimmedName }) });
              persistRoom(nextRoom);
              setError(null);
            } catch (joinError) {
              setError(joinError instanceof Error ? joinError.message : String(joinError));
            } finally {
              setLoading(false);
            }
          }}
          onJoinCodeChange={setJoinCode}
          onNameChange={setName}
        />
      )}

      {session && room && !game && (
        <LobbyScreen
          copied={copied}
          error={error}
          loading={loading}
          room={room}
          shareUrl={shareUrl}
          onCopy={updateCopied}
          onLeave={() => { writeStoredSession(null); setSession(null); setRoom(null); setError(null); }}
          onReset={() => callRoomEndpoint(`/api/rooms/${room.code}/reset`, { sessionId: room.me.sessionId })}
          gameMode={gameMode}
          onGameModeChange={setGameMode}
          onStart={() => callRoomEndpoint(`/api/rooms/${room.code}/start`, {
            sessionId: room.me.sessionId,
            thingInDeck: gameMode === 'thing_in_deck',
            chaosMode: gameMode === 'anomaly',
          })}
          onAddBot={() => callRoomEndpoint(`/api/rooms/${room.code}/add-bot`, { sessionId: room.me.sessionId })}
          onRemoveBot={(botSessionId: string) => callRoomEndpoint(`/api/rooms/${room.code}/remove-bot`, { sessionId: room.me.sessionId, botSessionId })}
        />
      )}

      {session && room && game && me && (
        <Suspense fallback={null}>
          <GameScreen
            error={error}
            game={game}
            loading={loading}
            me={me}
            onToggleLang={toggleLang}
            room={room}
            onAction={(action) => callRoomEndpoint(`/api/rooms/${room.code}/action`, { sessionId: room.me.sessionId, action })}
            onCopy={updateCopied}
            onLeave={() => { writeStoredSession(null); setSession(null); setRoom(null); setError(null); }}
            onReset={() => callRoomEndpoint(`/api/rooms/${room.code}/reset`, { sessionId: room.me.sessionId })}
            onShout={(phrase, phraseEn) => callRoomEndpoint(`/api/rooms/${room.code}/shout`, { sessionId: room.me.sessionId, phrase, phraseEn })}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
