import { useEffect, useMemo, useRef, useState } from 'react';

import { ConnectScreen, LobbyScreen } from './ConnectLobby.tsx';
import { GameScreen } from './GameScreen.tsx';
import type { RoomView, SessionInfo } from './multiplayer.ts';
import {
  api,
  copyToClipboard,
  getViewerPlayer,
  readStoredLang,
  readStoredSession,
  text,
  writeStoredLang,
  writeStoredSession,
  type Lang,
} from './appHelpers.ts';
import './App.css';

function App() {
  const [lang, setLang] = useState<Lang>(() => readStoredLang());
  const [session, setSession] = useState<SessionInfo | null>(() => readStoredSession());
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState(() => (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Track latest known state timestamp to prevent stale poll responses from overwriting fresh action responses
  const lastKnownUpdatedAt = useRef(0);

  useEffect(() => {
    writeStoredLang(lang);
  }, [lang]);

  useEffect(() => {
    if (!session) {
      setRoom(null);
      lastKnownUpdatedAt.current = 0;
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const nextRoom = await api<RoomView>(`/api/rooms/${session.roomCode}?sessionId=${session.sessionId}`);
        if (cancelled) return;
        // Only accept poll responses that are at least as fresh as our last known state
        // This prevents stale GET responses from overwriting a recent action POST response
        if (nextRoom.updatedAt >= lastKnownUpdatedAt.current) {
          setRoom(nextRoom);
          lastKnownUpdatedAt.current = nextRoom.updatedAt;
          setError(null);
        }
      } catch (refreshError) {
        if (cancelled) return;
        const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
        setError(message);
        if (message.includes('Room not found') || message.includes('Session not found')) {
          writeStoredSession(null);
          setSession(null);
          setRoom(null);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [session]);

  useEffect(() => {
    if (!room) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', room.code);
    window.history.replaceState({}, '', nextUrl);
  }, [room]);

  const game = room?.game ?? null;
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
      <button className="lang-toggle" onClick={() => setLang((prev) => (prev === 'ru' ? 'en' : 'ru'))} type="button">
        {lang === 'ru' ? 'EN' : 'RU'}
      </button>

      {!session && (
        <ConnectScreen
          copied={copied}
          error={error}
          joinCode={joinCode}
          lang={lang}
          loading={loading}
          name={name}
          onCreateRoom={async () => {
            const trimmedName = name.trim();
            if (!trimmedName) return setError(text(lang, 'Введите своё имя.', 'Enter your name.'));
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
            if (!trimmedName || !roomCode) return setError(text(lang, 'Введите имя и код комнаты.', 'Enter both your name and the room code.'));
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
          lang={lang}
          loading={loading}
          room={room}
          shareUrl={shareUrl}
          onCopy={updateCopied}
          onLeave={() => { writeStoredSession(null); setSession(null); setRoom(null); setError(null); }}
          onReset={() => callRoomEndpoint(`/api/rooms/${room.code}/reset`, { sessionId: room.me.sessionId })}
          onStart={() => callRoomEndpoint(`/api/rooms/${room.code}/start`, { sessionId: room.me.sessionId })}
        />
      )}

      {session && room && game && me && (
        <GameScreen
          error={error}
          game={game}
          lang={lang}
          loading={loading}
          me={me}
          room={room}
          onAction={(action) => callRoomEndpoint(`/api/rooms/${room.code}/action`, { sessionId: room.me.sessionId, action })}
          onCopy={updateCopied}
          onLeave={() => { writeStoredSession(null); setSession(null); setRoom(null); setError(null); }}
          onReset={() => callRoomEndpoint(`/api/rooms/${room.code}/reset`, { sessionId: room.me.sessionId })}
        />
      )}
    </div>
  );
}

export default App;
