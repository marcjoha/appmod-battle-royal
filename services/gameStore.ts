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

// Revert to default PeerJS config (works better in some cloud environments than hardcoded STUN)
const PEER_CONFIG = {
  debug: 1
};

// Helper to create Host ID from PIN - V3 to avoid collisions
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
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, any>>(new Map());
  const timerRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Initialize Host
  useEffect(() => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const myId = getHostId(pin);
    const hostId = uuidv4();

    const newState = { ...INITIAL_STATE, hostId, gamePin: pin };
    setState(newState);
    
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
            // Player is alive
            return;
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

    peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
            alert("Host ID collision. Refreshing...");
            window.location.reload();
        }
    });

    // Start Heartbeat to keep NAT open
    heartbeatRef.current = setInterval(() => {
        connectionsRef.current.forEach((conn) => {
            if (conn.open) {
                safeSend(conn, { type: 'PING' });
            }
        });
    }, 2000);

    return () => {
      peer.destroy();
      if (timerRef.current) clearInterval(timerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Explicitly stringify to ensure reliable transmission across different browser environments
          conn.send(JSON.stringify(msg));
      } catch (e) {
          console.error("Send failed", e);
      }
  };

  const handleMessage = (msg: GameMessage) => {
    if (msg.type === MessageType.PLAYER_JOIN) {
        // Map the ephemeral peer ID to the persistent player ID if needed, 
        // but for now we just use the ID sent in payload
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
    playerStatus, // Exported to show in UI
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

  // Watchdog
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (connected && connRef.current?.open) {
         const silenceDuration = Date.now() - lastUpdateRef.current;
         if (silenceDuration > 3000) {
            console.warn("Watchdog: stale, pinging...");
            try {
                connRef.current.send(JSON.stringify({ type: 'REQUEST_STATE' }));
            } catch (e) { console.error(e); }
         }
      }
    }, 3000);
    return () => clearInterval(watchdog);
  }, [connected]);

  useEffect(() => {
    if (!gamePin || !playerName) return;

    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', () => {
      connectToHost();
    });

    peer.on('error', (err) => {
        console.error("Player Peer Error:", err);
        setConnected(false);
    });

    const connectToHost = () => {
        const hostPeerId = getHostId(gamePin);
        console.log('Connecting to:', hostPeerId);
        
        const conn = peer.connect(hostPeerId, { reliable: true });
        connRef.current = conn;

        conn.on('open', () => {
            console.log("Connected!");
            setConnected(true);
            lastUpdateRef.current = Date.now();
            
            // Send Join
            conn.send(JSON.stringify({ 
               type: MessageType.PLAYER_JOIN, 
               payload: { name: playerName, id: playerId } 
            }));
        });

        conn.on('data', (raw: any) => {
            lastUpdateRef.current = Date.now();
            const data = safeParse(raw);
            if (!data) return;

            if (data.type === 'PING') {
                // Respond to keep-alive
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
            console.log("Disconnected");
        });
    };

    return () => {
      peer.destroy();
    };
  }, [gamePin, playerName, playerId, connectAttempt]);

  const submitAnswer = (answerIndex: number) => {
    if (connRef.current && connRef.current.open) {
        connRef.current.send(JSON.stringify({
            type: MessageType.PLAYER_ANSWER,
            payload: { playerId, answerIndex }
        }));
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