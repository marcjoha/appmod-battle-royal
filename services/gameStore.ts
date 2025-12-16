import { useEffect, useState, useRef } from 'react';
import { GameState, GameStatus, Question, MessageType, GameMessage, GeneratedQuestionRaw } from '../types';
import { MAX_TIME } from '../constants';
import { v4 as uuidv4 } from 'uuid';
import Peer from 'peerjs';

const INITIAL_STATE: GameState = {
  status: GameStatus.LOBBY,
  questions: [],
  currentQuestionIndex: 0,
  players: [],
  timer: MAX_TIME,
  hostId: '',
  gamePin: '......'
};

// PeerJS Configuration
// We use Google's public STUN servers which are reliable.
// IMPORTANT: Force secure (HTTPS/WSS) connection to 0.peerjs.com even if app is on HTTP.
// This prevents 'Failed to fetch' errors on mobile/networks that block HTTP port 80 or mixed content.
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  },
  secure: true,
  host: '0.peerjs.com',
  port: 443
};

// Helper to create Host ID from PIN - V3
const getHostId = (pin: string) => `appmod-v3-${pin}`;

// Helper for safe JSON parsing
const safeParse = (data: any) => {
    try {
        if (typeof data === 'string') return JSON.parse(data);
        return data;
    } catch (e) {
        console.error("Parse error", e);
        return null;
    }
};

// Hook for the HOST
export const useHostGame = () => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [playerStatus, setPlayerStatus] = useState<Record<string, boolean>>({}); // Track online status
  const [retryCount, setRetryCount] = useState(0); // Trigger retries
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, any>>(new Map());
  const timerRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Initialize Host
  useEffect(() => {
    // Keep the same PIN across retries if possible, or generate new one if it was empty
    let pin = state.gamePin === '......' ? Math.floor(100000 + Math.random() * 900000).toString() : state.gamePin;
    const myId = getHostId(pin);
    const hostId = state.hostId || uuidv4();

    // Only update state if it's a fresh start
    if (state.gamePin === '......') {
        const newState = { ...INITIAL_STATE, hostId, gamePin: pin };
        setState(newState);
    }
    
    // Cleanup previous peer
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    console.log(`Host connecting to PeerServer... (Attempt ${retryCount})`);
    const peer = new Peer(myId, PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('Host initialized:', id);
    });

    peer.on('connection', (conn) => {
      console.log('New connection:', conn.peer);
      
      conn.on('open', () => {
        connectionsRef.current.set(conn.peer, conn);
        updatePlayerStatus(conn.peer, true);
        
        // Initial Sync
        safeSend(conn, { type: MessageType.SYNC_STATE, payload: stateRef.current });
      });

      conn.on('data', (raw: any) => {
        const data = safeParse(raw);
        if (!data) return;

        if (data.type === 'REQUEST_STATE') {
             safeSend(conn, { type: MessageType.SYNC_STATE, payload: stateRef.current });
             return;
        }
        if (data.type === 'PONG') {
            return; // Player is alive
        }
        handleMessage(data);
      });

      conn.on('close', () => {
        console.log('Closed:', conn.peer);
        connectionsRef.current.delete(conn.peer);
        updatePlayerStatus(conn.peer, false);
      });

      conn.on('error', (err) => {
        console.error('Conn error:', err);
        connectionsRef.current.delete(conn.peer);
        updatePlayerStatus(conn.peer, false);
      });
    });

    peer.on('error', (err: any) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
            // ID Collision: Try a new PIN
            const newPin = Math.floor(100000 + Math.random() * 900000).toString();
            console.log("Collision, trying new PIN:", newPin);
            setState(prev => ({...prev, gamePin: newPin}));
            // Trigger retry
            setTimeout(() => setRetryCount(prev => prev + 1), 1000);
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'peer-unavailable') {
            // Network/Server error: Retry connection
            console.log("Network error, retrying in 3s...");
            setTimeout(() => setRetryCount(prev => prev + 1), 3000);
        }
    });

    // Start Heartbeat
    heartbeatRef.current = setInterval(() => {
        connectionsRef.current.forEach((conn) => {
            if (conn.open) {
                safeSend(conn, { type: 'PING' });
            }
        });
    }, 3000);

    return () => {
      // Don't destroy peer here immediately if we are just re-rendering, 
      // but rely on the effect cleanup or the explicit destroy at start of effect.
      // Actually, for React useEffect, we should cleanup.
      if (peerRef.current) peerRef.current.destroy();
      if (timerRef.current) clearInterval(timerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]); // Re-run when retryCount changes

  // Broadcast state changes
  useEffect(() => {
    connectionsRef.current.forEach((conn) => {
        if (conn.open) {
            safeSend(conn, { type: MessageType.SYNC_STATE, payload: state });
        }
    });
  }, [state]);

  // Timer Logic
  useEffect(() => {
    if (state.status === GameStatus.PLAYING) {
      if (state.timer > 0) {
        timerRef.current = setTimeout(() => {
          setState(prev => ({ ...prev, timer: prev.timer - 1 }));
        }, 1000);
      } else {
        setState(prev => ({ ...prev, status: GameStatus.REVEAL }));
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.status, state.timer]);

  // Auto-advance
  useEffect(() => {
    if (state.status === GameStatus.PLAYING && state.players.length > 0) {
      const allAnswered = state.players.every(p => p.lastAnswerIndex !== null);
      if (allAnswered) {
        const timeout = setTimeout(() => {
           setState(prev => {
             if (prev.status === GameStatus.PLAYING) {
                return { ...prev, status: GameStatus.REVEAL };
             }
             return prev;
           });
        }, 500);
        return () => clearTimeout(timeout);
      }
    }
  }, [state.players, state.status]);

  const updatePlayerStatus = (peerId: string, isOnline: boolean) => {
      setPlayerStatus(prev => ({...prev, [peerId]: isOnline}));
  };

  const safeSend = (conn: any, msg: any) => {
      try {
          conn.send(JSON.stringify(msg));
      } catch (e) {
          console.error("Send failed", e);
      }
  };

  const handleMessage = (msg: GameMessage) => {
    if (msg.type === MessageType.PLAYER_JOIN) {
        addPlayer(msg.payload.name, msg.payload.id);
    } else if (msg.type === MessageType.PLAYER_ANSWER) {
        recordAnswer(msg.payload.playerId, msg.payload.answerIndex);
    }
  };

  const addPlayer = (name: string, id: string) => {
    setState(prev => {
      const existing = prev.players.find(p => p.id === id);
      if (existing) {
        if (existing.name !== name) {
           return {
             ...prev,
             players: prev.players.map(p => p.id === id ? { ...p, name } : p)
           };
        }
        return prev;
      }
      return {
        ...prev,
        players: [...prev.players, { id, name, score: 0, lastAnswerIndex: null, streak: 0 }]
      };
    });
  };

  const recordAnswer = (playerId: string, answerIndex: number) => {
    setState(prev => {
      if (prev.status !== GameStatus.PLAYING) return prev; 
      const currentQ = prev.questions[prev.currentQuestionIndex];
      const isCorrect = currentQ.correctIndex === answerIndex;
      return {
        ...prev,
        players: prev.players.map(p => {
          if (p.id !== playerId) return p;
          const points = isCorrect ? (1000 + (prev.timer * 10)) : 0;
          return {
            ...p,
            score: p.score + points,
            lastAnswerIndex: answerIndex,
            streak: isCorrect ? p.streak + 1 : 0
          };
        })
      };
    });
  };

  const loadQuestions = (rawQuestions: GeneratedQuestionRaw[]) => {
    const questions: Question[] = rawQuestions.map(q => ({
      id: uuidv4(),
      text: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceUrl: q.sourceUrl
    }));
    setState(prev => ({ ...prev, questions }));
  };

  const startGame = () => {
    if (state.questions.length === 0) return;
    setState(prev => ({
      ...prev,
      status: GameStatus.PLAYING,
      currentQuestionIndex: 0,
      timer: MAX_TIME,
      players: prev.players.map(p => ({ ...p, lastAnswerIndex: null }))
    }));
  };

  const nextQuestion = () => {
    setState(prev => {
      const nextIndex = prev.currentQuestionIndex + 1;
      if (nextIndex >= prev.questions.length) {
        return { ...prev, status: GameStatus.FINISHED };
      }
      return {
        ...prev,
        status: GameStatus.PLAYING,
        currentQuestionIndex: nextIndex,
        timer: MAX_TIME,
        players: prev.players.map(p => ({ ...p, lastAnswerIndex: null }))
      };
    });
  };

  const showStats = () => {
    setState(prev => ({ ...prev, status: GameStatus.REVEAL }));
  };

  return {
    state,
    playerStatus,
    loadQuestions,
    startGame,
    nextQuestion,
    showStats
  };
};

// Hook for the PLAYER
export const usePlayerGame = (playerName: string, gamePin: string) => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const lastUpdateRef = useRef<number>(Date.now());
  
  const [playerId] = useState(() => {
    const key = 'appmod_player_id';
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const newId = uuidv4();
    sessionStorage.setItem(key, newId);
    return newId;
  });

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [connectAttempt, setConnectAttempt] = useState(0);

  // Watchdog: If connected but silent for too long, ping
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (connected && connRef.current?.open) {
         const silenceDuration = Date.now() - lastUpdateRef.current;
         if (silenceDuration > 5000) {
            console.warn("Watchdog: stale, pinging...");
            try {
                connRef.current.send(JSON.stringify({ type: 'REQUEST_STATE' }));
            } catch (e) { console.error(e); }
         }
      }
    }, 2000);
    return () => clearInterval(watchdog);
  }, [connected]);

  useEffect(() => {
    if (!gamePin || !playerName) return;

    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    // New Peer
    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', () => {
      connectToHost();
    });

    peer.on('error', (err) => {
        console.error("Player Peer Error:", err);
        setConnected(false);
        // If it's a fatal initialization error (like can't reach server), retry after delay
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'peer-unavailable' || err.type === 'socket-error') {
             console.log("Peer fatal error, retrying in 2s...");
             setTimeout(() => {
                 setConnectAttempt(prev => prev + 1);
             }, 2000);
        }
    });

    const connectToHost = () => {
        const hostPeerId = getHostId(gamePin);
        console.log('Connecting to:', hostPeerId);
        
        const conn = peer.connect(hostPeerId, {
             reliable: true
        });
        connRef.current = conn;

        conn.on('open', () => {
            console.log("Connected!");
            setConnected(true);
            lastUpdateRef.current = Date.now();
            
            // Send Join
            setTimeout(() => {
                try {
                    conn.send(JSON.stringify({ 
                       type: MessageType.PLAYER_JOIN, 
                       payload: { name: playerName, id: playerId } 
                    }));
                } catch(e) { console.error("Join send failed", e); }
            }, 500); // Small delay to ensure channel is ready
        });

        conn.on('data', (raw: any) => {
            lastUpdateRef.current = Date.now();
            const data = safeParse(raw);
            if (!data) return;

            if (data.type === 'PING') {
                try { conn.send(JSON.stringify({ type: 'PONG' })); } catch (e) {}
                return;
            }

            if (data.type === MessageType.SYNC_STATE) {
                const incomingState = data.payload as GameState;
                setState(incomingState);
            }
        });

        conn.on('close', () => {
            setConnected(false);
            console.log("Disconnected (Close event)");
        });
        
        conn.on('error', (err) => {
            console.error("Conn Error", err);
            setConnected(false);
        });
    };

    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [gamePin, playerName, playerId, connectAttempt]);

  const submitAnswer = (answerIndex: number) => {
    if (connRef.current && connRef.current.open) {
        try {
            connRef.current.send(JSON.stringify({
                type: MessageType.PLAYER_ANSWER,
                payload: { playerId, answerIndex }
            }));
        } catch(e) {
            console.error("Answer send failed", e);
        }
    }
  };
  
  const requestSync = () => {
      console.log("Manual Sync / Reconnect");
      if (connRef.current && connRef.current.open) {
          try {
            connRef.current.send(JSON.stringify({ type: 'REQUEST_STATE' }));
          } catch (e) {
            setConnectAttempt(prev => prev + 1);
          }
      } else {
          setConnectAttempt(prev => prev + 1);
      }
  };

  return {
    state,
    playerId,
    submitAnswer,
    connected,
    requestSync
  };
};