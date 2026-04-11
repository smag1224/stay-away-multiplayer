import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

export type VoiceParticipant = {
  sessionId: string;
  name: string;
  speaking: boolean;
};

type VoiceSignal =
  | { type: 'voice:join'; from: string; name: string }
  | { type: 'voice:leave'; from: string }
  | { type: 'voice:offer'; from: string; offer: RTCSessionDescriptionInit }
  | { type: 'voice:answer'; from: string; answer: RTCSessionDescriptionInit }
  | { type: 'voice:ice'; from: string; candidate: RTCIceCandidateInit };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const SPEAKING_THRESHOLD = 15;

function isVoiceSignal(msg: unknown): msg is VoiceSignal {
  if (typeof msg !== 'object' || msg === null) return false;
  const o = msg as Record<string, unknown>;
  return typeof o.type === 'string' && o.type.startsWith('voice:') && 'from' in o;
}

export type UseVoiceChatOptions = {
  sessionId: string | null;
  /** Ref that always holds the active WS send function, or null if disconnected */
  wsSendRef: MutableRefObject<((data: string) => void) | null>;
  /** Ref into which this hook registers its signal handler */
  signalRef: MutableRefObject<((msg: unknown) => void) | null>;
  /** Ref that always holds the current room members (for name lookup) */
  membersRef: MutableRefObject<{ sessionId: string; name: string }[]>;
};

export function useVoiceChat({ sessionId, wsSendRef, signalRef, membersRef }: UseVoiceChatOptions) {
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [mySpeaking, setMySpeaking] = useState(false);

  const inVoiceRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElemsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analyzersRef = useRef<Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>>(new Map());
  const speakingRef = useRef<Map<string, boolean>>(new Map());
  const rafRef = useRef<number | null>(null);
  const localAnalyzerRef = useRef<{ analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; ctx: AudioContext } | null>(null);
  const mutedRef = useRef(false);

  const wsSend = useCallback((obj: unknown) => {
    wsSendRef.current?.(JSON.stringify(obj));
  }, [wsSendRef]);

  const updateParticipant = useCallback((sid: string, update: Partial<VoiceParticipant>) => {
    setParticipants(prev => prev.map(p => p.sessionId === sid ? { ...p, ...update } : p));
  }, []);

  const removePeer = useCallback((sid: string) => {
    const pc = peersRef.current.get(sid);
    if (pc) { pc.close(); peersRef.current.delete(sid); }
    const el = audioElemsRef.current.get(sid);
    if (el) { el.srcObject = null; document.body.removeChild(el); audioElemsRef.current.delete(sid); }
    analyzersRef.current.delete(sid);
    speakingRef.current.delete(sid);
    setParticipants(prev => prev.filter(p => p.sessionId !== sid));
  }, []);

  const createPeer = useCallback((sid: string, name: string): RTCPeerConnection => {
    // Close any existing connection first
    const existing = peersRef.current.get(sid);
    if (existing) { existing.close(); peersRef.current.delete(sid); }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(sid, pc);

    // Share local mic tracks with this peer
    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        wsSend({ type: 'voice:ice', to: sid, candidate: candidate.toJSON() });
      }
    };

    pc.ontrack = ({ streams }) => {
      const remoteStream = streams[0];
      if (!remoteStream) return;

      let el = audioElemsRef.current.get(sid);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        document.body.appendChild(el);
        audioElemsRef.current.set(sid, el);
      }
      el.srcObject = remoteStream;

      // Speaking detection analyzer
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(remoteStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        analyzersRef.current.set(sid, { analyser, data });
      } catch {
        // AudioContext unavailable — no speaking detection for this peer
      }
    };

    // Add to participants list
    setParticipants(prev => {
      if (prev.find(p => p.sessionId === sid)) return prev;
      return [...prev, { sessionId: sid, name, speaking: false }];
    });

    return pc;
  }, [wsSend]);

  // Speaking detection — rAF loop while in voice
  useEffect(() => {
    if (!inVoice) return;

    const tick = () => {
      // Remote peers
      for (const [sid, { analyser, data }] of analyzersRef.current) {
        analyser.getByteFrequencyData(data);
        const vol = data.reduce((s, v) => s + v, 0) / data.length;
        const speaking = vol > SPEAKING_THRESHOLD;
        if (speakingRef.current.get(sid) !== speaking) {
          speakingRef.current.set(sid, speaking);
          updateParticipant(sid, { speaking });
        }
      }
      // Local mic
      if (localAnalyzerRef.current && !mutedRef.current) {
        const { analyser, data } = localAnalyzerRef.current;
        analyser.getByteFrequencyData(data);
        const vol = data.reduce((s, v) => s + v, 0) / data.length;
        setMySpeaking(vol > SPEAKING_THRESHOLD);
      } else {
        setMySpeaking(false);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [inVoice, updateParticipant]);

  const handleSignal = useCallback(async (raw: unknown) => {
    if (!isVoiceSignal(raw) || !sessionId) return;
    const signal = raw;

    try {
      switch (signal.type) {
        case 'voice:join': {
          if (signal.from === sessionId || !inVoiceRef.current) return;
          // We're an existing participant — offer to the new joiner
          const pc = createPeer(signal.from, signal.name);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend({ type: 'voice:offer', to: signal.from, offer: pc.localDescription });
          break;
        }
        case 'voice:leave': {
          removePeer(signal.from);
          break;
        }
        case 'voice:offer': {
          // We received an offer (we just joined, existing participant is contacting us)
          let pc = peersRef.current.get(signal.from);
          if (!pc) {
            const name = membersRef.current.find(m => m.sessionId === signal.from)?.name ?? signal.from;
            pc = createPeer(signal.from, name);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend({ type: 'voice:answer', to: signal.from, answer: pc.localDescription });
          break;
        }
        case 'voice:answer': {
          const pc = peersRef.current.get(signal.from);
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          break;
        }
        case 'voice:ice': {
          const pc = peersRef.current.get(signal.from);
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
          break;
        }
      }
    } catch (e) {
      console.error('[voice] Signal handling error:', e);
    }
  }, [sessionId, createPeer, removePeer, wsSend, membersRef]);

  // Register signal handler with App.tsx
  useEffect(() => {
    signalRef.current = handleSignal;
    return () => { signalRef.current = null; };
  }, [handleSignal, signalRef]);

  const join = useCallback(async () => {
    if (!sessionId || inVoiceRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // Local speaking analyzer
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        localAnalyzerRef.current = { analyser, data, ctx };
      } catch {
        // ignore
      }

      inVoiceRef.current = true;
      setInVoice(true);
      wsSend({ type: 'voice:join' });
    } catch (e) {
      console.error('[voice] Microphone access denied:', e);
      alert('Нет доступа к микрофону / Microphone access denied');
    }
  }, [sessionId, wsSend]);

  const leave = useCallback(() => {
    if (!inVoiceRef.current) return;
    wsSend({ type: 'voice:leave' });
    for (const [sid] of [...peersRef.current]) removePeer(sid);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (localAnalyzerRef.current) {
      void localAnalyzerRef.current.ctx.close();
      localAnalyzerRef.current = null;
    }
    inVoiceRef.current = false;
    setInVoice(false);
    setParticipants([]);
    setMySpeaking(false);
    setMuted(false);
    mutedRef.current = false;
  }, [wsSend, removePeer]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      mutedRef.current = next;
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (inVoiceRef.current) {
        wsSendRef.current?.(JSON.stringify({ type: 'voice:leave' }));
        for (const [sid] of [...peersRef.current]) {
          const pc = peersRef.current.get(sid);
          if (pc) { pc.close(); peersRef.current.delete(sid); }
          const el = audioElemsRef.current.get(sid);
          if (el && document.body.contains(el)) { el.srcObject = null; document.body.removeChild(el); }
        }
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        if (localAnalyzerRef.current) void localAnalyzerRef.current.ctx.close();
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { inVoice, muted, mySpeaking, participants, join, leave, toggleMute };
}
