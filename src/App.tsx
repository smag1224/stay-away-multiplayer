import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectScreen, LobbyScreen } from './ConnectLobby.tsx';
const GameScreen = lazy(() =>
  import('./GameScreen.tsx').then((m) => ({ default: m.GameScreen })),
);
const ProfileScreen = lazy(() =>
  import('./ProfileScreen.tsx').then((m) => ({ default: m.ProfileScreen })),
);
import type { ApiResponse, AuthUser, RoomView, SessionInfo } from './multiplayer.ts';
import {
  api,
  copyToClipboard,
  createRoomWebSocketUrl,
  getViewerPlayer,
  readStoredAuthToken,
  readStoredPerformanceMode,
  readStoredSession,
  writeStoredAuthToken,
  writeStoredLang,
  writeStoredPerformanceMode,
  writeStoredSession,
} from './appHelpers.ts';
import type { Lang } from './appHelpers.ts';
import { useVoiceChat } from './hooks/useVoiceChat.ts';
import { VoiceChat } from './components/VoiceChat.tsx';
import './App.css';

const KICKED_BY_HOST_ERROR = 'KICKED_BY_HOST';

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
  const [performanceMode, setPerformanceMode] = useState(() => readStoredPerformanceMode());
  const [wsConnected, setWsConnected] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(() => readStoredAuthToken());
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  // Track latest known state timestamp to prevent stale network responses from overwriting fresh action responses
  const lastKnownUpdatedAt = useRef(0);

  // Voice chat: send function ref (updated on each WS connect/disconnect)
  const wsSendRef = useRef<((data: string) => void) | null>(null);
  // Voice chat: signal handler ref (registered by useVoiceChat hook)
  const voiceSignalRef = useRef<((msg: unknown) => void) | null>(null);
  // Voice chat: always-current room members for name lookup
  const voiceMembersRef = useRef<{ sessionId: string; name: string }[]>([]);

  // Verify stored auth token on mount
  useEffect(() => {
    if (!authToken) return;
    api<AuthUser>('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(user => setAuthUser(user))
      .catch(() => { writeStoredAuthToken(null); setAuthToken(null); });
  }, [authToken]);

  const handleAuth = (token: string, user: AuthUser) => {
    writeStoredAuthToken(token);
    setAuthToken(token);
    setAuthUser(user);
  };

  const handleLogout = () => {
    writeStoredAuthToken(null);
    setAuthToken(null);
    setAuthUser(null);
  };

  const openProfile = (username?: string) => {
    setProfileTarget(username ?? authUser?.username ?? null);
    setShowProfile(true);
  };

  const toggleLang = () => {
    const next: Lang = lang === 'ru' ? 'en' : 'ru';
    void i18n.changeLanguage(next);
    writeStoredLang(next);
  };

  const handleRoomError = (message: string) => {
    if (message === KICKED_BY_HOST_ERROR) {
      writeStoredSession(null);
      setSession(null);
      setRoom(null);
      lastKnownUpdatedAt.current = 0;
      setError(i18n.t('connect.kickedByHost'));
      return;
    }

    setError(message);
    if (message.includes('Room not found') || message.includes('Session not found')) {
      writeStoredSession(null);
      setSession(null);
      setRoom(null);
      lastKnownUpdatedAt.current = 0;
    }
  };

  useEffect(() => {
    if (!session) {
      setRoom(null);
      setWsConnected(true);
      wsSendRef.current = null;
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
      handleRoomError(message);
    };

    let pollInterval: number | null = null;
    let reconnectTimeout: number | null = null;
    let isPolling = false;
    let socket: WebSocket | null = null;
    let reconnectAttempts = 0;

    const stopPolling = () => {
      if (pollInterval) {
        window.clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const refresh = async () => {
      if (isPolling || cancelled) return;
      isPolling = true;
      try {
        const nextRoom = await api<RoomView>(`/api/rooms/${activeSession.roomCode}?sessionId=${activeSession.sessionId}`);
        handleRoomData(nextRoom);
      } catch (e) {
        handleError(e instanceof Error ? e.message : String(e));
      } finally {
        isPolling = false;
      }
    };

    const startPolling = () => {
      if (pollInterval || cancelled) return;
      void refresh();
      pollInterval = window.setInterval(refresh, performanceMode ? 3000 : 1500);
    };

    const cleanupSocket = () => {
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      socket = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimeout !== null) return;
      startPolling();
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 5000);
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        reconnectAttempts += 1;
        connectSocket();
      }, delay);
    };

    const connectSocket = () => {
      if (cancelled) return;
      cleanupSocket();

      const nextSocket = new WebSocket(createRoomWebSocketUrl(activeSession.roomCode, activeSession.sessionId));
      socket = nextSocket;

      nextSocket.onopen = () => {
        if (cancelled || socket !== nextSocket) return;
        reconnectAttempts = 0;
        wsSendRef.current = (data: string) => nextSocket.send(data);
        setWsConnected(true);
        stopPolling();
      };

      nextSocket.onmessage = (event) => {
        if (cancelled || socket !== nextSocket) return;
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          // Route voice signaling messages to the voice hook
          if (typeof payload.type === 'string' && payload.type.startsWith('voice:')) {
            voiceSignalRef.current?.(payload);
            return;
          }
          const roomPayload = payload as unknown as ApiResponse<RoomView>;
          if (roomPayload.ok) {
            handleRoomData(roomPayload.data);
            stopPolling();
            return;
          }
          handleError(roomPayload.error);
        } catch {
          // Ignore malformed frames and let reconnect/polling recover if needed.
        }
      };

      nextSocket.onerror = () => {
        if (nextSocket.readyState === WebSocket.CONNECTING || nextSocket.readyState === WebSocket.OPEN) {
          nextSocket.close();
        }
      };

      nextSocket.onclose = () => {
        if (cancelled || socket !== nextSocket) return;
        socket = null;
        wsSendRef.current = null;
        setWsConnected(false);
        scheduleReconnect();
      };
    };

    startPolling();
    connectSocket();

    return () => {
      cancelled = true;
      stopPolling();
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      cleanupSocket();
    };
  }, [performanceMode, session]);

  const togglePerformanceMode = () => {
    setPerformanceMode((value) => {
      const next = !value;
      writeStoredPerformanceMode(next);
      return next;
    });
  };

  useEffect(() => {
    if (!room) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', room.code);
    window.history.replaceState({}, '', nextUrl);
  }, [room]);

  // Keep voice members ref up to date for name lookup in the hook
  useEffect(() => {
    voiceMembersRef.current = room?.members ?? [];
  }, [room?.members]);

  const voice = useVoiceChat({
    sessionId: session?.sessionId ?? null,
    wsSendRef,
    signalRef: voiceSignalRef,
    membersRef: voiceMembersRef,
  });

  const game = room?.game ?? null;
  const showFloatingLangToggle = !session || !room || !game;
  const isWatcher = !!(room?.me.isSpectator);
  const me = useMemo(
    () => (game ? getViewerPlayer(game, room?.me.playerId ?? null) : null),
    [game, room?.me.playerId],
  );
  // Spectator sentinel — lets watchers see the GameScreen without being in game.players
  const SPECTATOR_ME = useMemo(() => ({
    id: -999, name: room?.me.name ?? '', role: null as null,
    avatarId: 'avatar_1', canReceiveInfectedCardFromMe: false,
    isKnownInfectedToMe: false, hand: [], handCount: 0,
    isAlive: false, inQuarantine: false, quarantineTurnsLeft: 0, position: -1,
  }), [room?.me.name]);
  const effectiveMe = me ?? (isWatcher && game ? SPECTATOR_ME : null);
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
      // Update the timestamp guard so stale background sync responses don't overwrite this fresh state
      lastKnownUpdatedAt.current = nextRoom.updatedAt;
      setRoom(nextRoom);
      setError(null);
    } catch (requestError) {
      handleRoomError(requestError instanceof Error ? requestError.message : String(requestError));
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

  const leaveRoom = async () => {
    const activeRoomCode = room?.code ?? session?.roomCode;
    const activeSessionId = room?.me.sessionId ?? session?.sessionId;

    if (activeRoomCode && activeSessionId) {
      try {
        await api(`/api/rooms/${activeRoomCode}/leave`, {
          method: 'POST',
          body: JSON.stringify({ sessionId: activeSessionId }),
        });
      } catch {
        // Local leave should still succeed even if the server room/session is already gone.
      }
    }

    writeStoredSession(null);
    setSession(null);
    setRoom(null);
    setError(null);
    lastKnownUpdatedAt.current = 0;
  };

  return (
    <div className={`app-shell${performanceMode ? ' perf-mode' : ''}`}>
      {session && !wsConnected && (
        <div className="ws-reconnect-banner" role="status" aria-live="polite">
          {lang === 'ru' ? '⟳ Переподключение...' : '⟳ Reconnecting...'}
        </div>
      )}
      {session && room && (
        <VoiceChat
          inVoice={voice.inVoice}
          muted={voice.muted}
          mySpeaking={voice.mySpeaking}
          myName={room.me.name}
          participants={voice.participants}
          onJoin={() => { void voice.join(); }}
          onLeave={voice.leave}
          onToggleMute={voice.toggleMute}
          lang={lang}
        />
      )}
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
          authUser={authUser}
          onAuth={handleAuth}
          onLogout={handleLogout}
          onOpenProfile={() => openProfile()}
          onCreateRoom={async () => {
            const trimmedName = name.trim();
            if (!trimmedName) return setError(i18n.t('connect.errorEnterName'));
            setLoading(true);
            try {
              const nextRoom = await api<RoomView>('/api/rooms/create', { method: 'POST', body: JSON.stringify({ name: trimmedName, token: authToken }) });
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
              const nextRoom = await api<RoomView>(`/api/rooms/${roomCode}/join`, { method: 'POST', body: JSON.stringify({ name: trimmedName, token: authToken }) });
              persistRoom(nextRoom);
              setError(null);
            } catch (joinError) {
              setError(joinError instanceof Error ? joinError.message : String(joinError));
            } finally {
              setLoading(false);
            }
          }}
          onWatchRoom={async () => {
            const trimmedName = name.trim();
            const roomCode = joinCode.trim().toUpperCase();
            if (!trimmedName || !roomCode) return setError(i18n.t('connect.errorEnterNameAndCode'));
            setLoading(true);
            try {
              const nextRoom = await api<RoomView>(`/api/rooms/${roomCode}/join`, { method: 'POST', body: JSON.stringify({ name: trimmedName, spectator: true, token: authToken }) });
              persistRoom(nextRoom);
              setError(null);
            } catch (watchError) {
              setError(watchError instanceof Error ? watchError.message : String(watchError));
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
          onCopy={updateCopied}
          onLeave={() => void leaveRoom()}
          gameMode={gameMode}
          onGameModeChange={setGameMode}
          onStart={() => callRoomEndpoint(`/api/rooms/${room.code}/start`, {
            sessionId: room.me.sessionId,
            thingInDeck: gameMode === 'thing_in_deck',
            chaosMode: gameMode === 'anomaly',
          })}
          onAddBot={() => callRoomEndpoint(`/api/rooms/${room.code}/add-bot`, { sessionId: room.me.sessionId })}
          onRemoveMember={(memberSessionId: string) => callRoomEndpoint(`/api/rooms/${room.code}/remove-member`, { sessionId: room.me.sessionId, memberSessionId })}
          onOpenProfile={openProfile}
        />
      )}

      {showProfile && profileTarget && (
        <Suspense fallback={null}>
          <ProfileScreen
            username={profileTarget}
            onClose={() => setShowProfile(false)}
          />
        </Suspense>
      )}

      {session && room && game && effectiveMe && (
        <Suspense fallback={null}>
          <GameScreen
            error={error}
            game={game}
            isWatcher={isWatcher}
            loading={loading}
            me={effectiveMe}
            onToggleLang={toggleLang}
            onTogglePerformanceMode={togglePerformanceMode}
            performanceMode={performanceMode}
            room={room}
            onAction={(action) => callRoomEndpoint(`/api/rooms/${room.code}/action`, { sessionId: room.me.sessionId, action })}
            onCopy={updateCopied}
            onLeave={() => void leaveRoom()}
            onReset={() => callRoomEndpoint(`/api/rooms/${room.code}/reset`, { sessionId: room.me.sessionId })}
            onShout={(phrase, phraseEn) => callRoomEndpoint(`/api/rooms/${room.code}/shout`, { sessionId: room.me.sessionId, phrase, phraseEn })}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
