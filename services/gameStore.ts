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

// PeerJS Configuration - Optimized for Mobile & Cross-Network
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { 
        urls: "turn:openrelay.metered.ca:80", 
        username: "openrelayproject", 
        credential: "openrelayproject" 
      },
      { 
        urls: "turn:openrelay.metered.ca:443", 
        username: "openrelayproject", 
        credential: "openrelayproject" 
      },
      { 
        urls: "turn:openrelay.metered.ca:443?transport=tcp", 
        username: "openrelayproject", 
        credential: "openrelayproject" 
      }
    ],
    iceCandidatePoolSize: 1, 
  },
  pingInterval: 5000, 
  secure: true,
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

// --- HOST HOOK ---
export const useHostGame = () => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [playerStatus, setPlayerStatus] = useState<Record<string, boolean>>({}); 
  const [retryCount, setRetryCount] = useState(0); 
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, any>>(new Map());
  const timerRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);
  const initTimeoutRef = useRef<any>(null);
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Initialize Host with Debounce for Strict Mode
  useEffect(() => {
    // Generate PIN if needed
    let pin = state.gamePin === '......' ? Math.floor(100000 + Math.random() * 900000).toString() : state.gamePin;
    
    // Update state if we just generated a pin
    if (state.gamePin === '......') {
        const hostId = state.hostId || uuidv4();
        setState(prev => ({ ...prev, hostId, gamePin: pin }));
        // The effect will re-run because state changes, so we exit this run
        return;
    }

    const myId = getHostId(pin);
    console.log(`[Host] Initializing for PIN: ${pin} (ID: ${myId}) - Attempt ${retryCount}`);

    const setupPeer = () => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }

        try {
            // @ts-ignore
            const peer = new Peer(myId, PEER_CONFIG);
            peerRef.current = peer;

            peer.on('open', (id) => {
              console.log('[Host] Online with ID:', id);
            });

            peer.on('connection', (conn) => {
              console.log('[Host] New connection from:', conn.peer);
              
              conn.on('open', () => {
                connectionsRef.current.set(conn.peer, conn);
                updatePlayerStatus(conn.peer, true);
                safeSend(conn, { type: MessageType.SYNC_STATE, payload: stateRef.current });
              });

              conn.on('data', (raw: any) => {
                const data = safeParse(raw);
                if (!data) return;

                if (data.type === 'REQUEST_STATE') {
                     safeSend(conn, { type: MessageType.SYNC_STATE, payload: stateRef.current });
                     return;
                }
                if (data.type === 'PONG') return;
                handleMessage(data);
              });

              conn.on('close', () => {
                console.log('[Host] Connection closed:', conn.peer);
                connectionsRef.current.delete(conn.peer);
                updatePlayerStatus(conn.peer, false);
              });

              conn.on('error', (err) => {
                console.error('[Host] Connection error:', err);
                connectionsRef.current.delete(conn.peer);
                updatePlayerStatus(conn.peer, false);
              });
            });

            peer.on('error', (err: any) => {
                console.error("[Host] Peer Error:", err);
                if (err.type === 'unavailable-id') {
                    // ID taken? Possibly a ghost from refresh. 
                    // In strict mode, this happens often. We can try a new PIN or wait.
                    // For robustness, let's try a new PIN after a delay.
                    console.log("[Host] ID collision. Generating new PIN...");
                    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
                    setTimeout(() => {
                        setState(prev => ({...prev, gamePin: newPin}));
                        setRetryCount(c => c + 1);
                    }, 2000);
                } else if (['network', 'server-error', 'peer-unavailable', 'socket-error'].includes(err.type)) {
                    console.log("[Host] Network issue, retrying in 3s...");
                    setTimeout(() => setRetryCount(prev => prev + 1), 3000);
                }
            });

        } catch (err) {
            console.error("[Host] Instantiation failed:", err);
            setTimeout(() => setRetryCount(prev => prev + 1), 3000);
        }
    };

    // Small delay to allow cleanup of previous effect to finish
    initTimeoutRef.current = setTimeout(setupPeer, 500);

    // Heartbeat
    heartbeatRef.current = setInterval(() => {
        connectionsRef.current.forEach((conn) => {
            if (conn.open) {
                safeSend(conn, { type: 'PING' });
            }
        });
    }, 3000);

    return () => {
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
      if (peerRef.current) peerRef.current.destroy();
      if (timerRef.current) clearInterval(timerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount, state.gamePin]); // Re-run if PIN changes or retry requested

  // Broadcast state changes
  useEffect(() => {
    connectionsRef.current.forEach((conn) => {
        if (conn.open) {
            safeSend(conn, { type: MessageType.SYNC_STATE, payload: state });
        }
    });
  }, [state]);

  // Game Timer Logic
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

  // Auto-advance Logic
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

// --- PLAYER HOOK ---
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
         if (silenceDuration > 5000) {
            console.warn("[Player] Watchdog: stale, pinging...");
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

    try {
        console.log(`[Player] Init Peer for ${playerName} (Attempt ${connectAttempt})`);
        // @ts-ignore
        const peer = new Peer(PEER_CONFIG);
        peerRef.current = peer;

        peer.on('open', (myId) => {
          console.log('[Player] Peer Open, My ID:', myId);
          connectToHost(peer);
        });

        peer.on('error', (err) => {
            console.error("[Player] Peer Error:", err.type, err);
            setConnected(false);
            
            // CRITICAL: Retry if peer-unavailable (Host might be restarting or not ready yet)
            if (['peer-unavailable', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
                 console.log(`[Player] Target peer unavailable or network error. Retrying in 2s...`);
                 setTimeout(() => {
                     setConnectAttempt(prev => prev + 1);
                 }, 2000);
            }
        });

        const connectToHost = (currentPeer: Peer) => {
            const hostPeerId = getHostId(gamePin);
            console.log('[Player] Connecting to Host:', hostPeerId);
            
            const conn = currentPeer.connect(hostPeerId, {
                reliable: true,
                serialization: 'json'
            });
            connRef.current = conn;

            // Manual timeout if connection takes too long
            const connTimeout = setTimeout(() => {
                if (!conn.open) {
                    console.log("[Player] Connection handshake timed out. Retrying...");
                    conn.close();
                    setConnectAttempt(prev => prev + 1);
                }
            }, 5000);

            conn.on('open', () => {
                clearTimeout(connTimeout);
                console.log("[Player] Connected to Host!");
                setConnected(true);
                lastUpdateRef.current = Date.now();
                
                // Send Join message
                setTimeout(() => {
                    try {
                        conn.send(JSON.stringify({ 
                           type: MessageType.PLAYER_JOIN, 
                           payload: { name: playerName, id: playerId } 
                        }));
                    } catch(e) { console.error("Join send failed", e); }
                }, 500); 
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
                console.log("[Player] Connection Closed.");
            });
            
            conn.on('error', (err) => {
                console.error("[Player] Connection Error:", err);
                setConnected(false);
            });
        };
    } catch (e) {
        console.error("[Player] Peer init exception:", e);
        setTimeout(() => setConnectAttempt(prev => prev + 1), 2000);
    }

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
      console.log("[Player] Manual Sync Request");
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