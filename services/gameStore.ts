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

// Helper to create Host ID from PIN
const getHostId = (pin: string) => `appmod-v1-${pin}`;

// Hook for the HOST
export const useHostGame = () => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  
  // We use refs for peer/connections to access them inside closures/effects without dependency cycles
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, any>>(new Map());
  const timerRef = useRef<any>(null);
  
  // Ref for state to ensure event listeners always have access to latest state
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Initialize Host
  useEffect(() => {
    // Generate a 6-digit PIN
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const myId = getHostId(pin);
    const hostId = uuidv4();

    const newState = { ...INITIAL_STATE, hostId, gamePin: pin };
    setState(newState);
    
    // Create Peer
    const peer = new Peer(myId);
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('Host initialized with Peer ID:', id);
    });

    peer.on('connection', (conn) => {
      console.log('New connection from:', conn.peer);
      
      conn.on('open', () => {
        // Add to connections
        connectionsRef.current.set(conn.peer, conn);
        // Immediately sync state to the new player
        conn.send({ type: MessageType.SYNC_STATE, payload: stateRef.current });
      });

      conn.on('data', (data: any) => {
        // Handle explicit state requests from stuck players
        if (data && data.type === 'REQUEST_STATE') {
             console.log('Sync requested by:', conn.peer);
             conn.send({ type: MessageType.SYNC_STATE, payload: stateRef.current });
             return;
        }
        handleMessage(data);
      });

      conn.on('close', () => {
        console.log('Connection closed:', conn.peer);
        connectionsRef.current.delete(conn.peer);
        // Optional: Remove player from list? For now, we keep them in case they reconnect.
      });

      conn.on('error', (err) => {
        console.error('Connection error:', err);
        connectionsRef.current.delete(conn.peer);
      });
    });

    peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
            alert("Could not claim Host ID. Please refresh to try again.");
        }
    });

    return () => {
      peer.destroy();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Broadcast state whenever it changes locally
  useEffect(() => {
    // We throttle timer updates to avoid saturating the network? 
    // Actually PeerJS usually handles it, but let's be safe.
    // For now, raw broadcast is fine for < 100 players.
    connectionsRef.current.forEach((conn) => {
        if (conn.open) {
            conn.send({ type: MessageType.SYNC_STATE, payload: state });
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
        // Time's up! Move to REVEAL automatically
        setState(prev => ({ ...prev, status: GameStatus.REVEAL }));
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.status, state.timer]);

  // Auto-advance if everyone answered
  useEffect(() => {
    if (state.status === GameStatus.PLAYING && state.players.length > 0) {
      const allAnswered = state.players.every(p => p.lastAnswerIndex !== null);
      if (allAnswered) {
        // Short delay to ensure UX feels natural
        const timeout = setTimeout(() => {
           setState(prev => {
             // Double check we are still playing to avoid race conditions
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

  const handleMessage = (msg: GameMessage) => {
    switch (msg.type) {
      case MessageType.PLAYER_JOIN:
        addPlayer(msg.payload.name, msg.payload.id);
        break;
      case MessageType.PLAYER_ANSWER:
        recordAnswer(msg.payload.playerId, msg.payload.answerIndex);
        break;
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
      if (prev.status !== GameStatus.PLAYING) return prev; // Ignore late answers

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

  // Host Actions
  const loadQuestions = (rawQuestions: GeneratedQuestionRaw[]) => {
    const questions: Question[] = rawQuestions.map(q => ({
      id: uuidv4(),
      text: q.question,
      options: q.options,
      correctIndex: q.correctIndex
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
    loadQuestions,
    startGame,
    nextQuestion,
    showStats
  };
};

// Hook for the PLAYER
export const usePlayerGame = (playerName: string, gamePin: string) => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  
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

  useEffect(() => {
    if (!gamePin || !playerName) return;

    // Create a random Peer ID for the player
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      console.log('Player peer ready');
      connectToHost();
    });

    peer.on('error', (err) => {
        console.error("Player Peer Error:", err);
        // Simple retry logic could go here
    });

    const connectToHost = () => {
        const hostPeerId = getHostId(gamePin);
        console.log('Connecting to host:', hostPeerId);
        
        const conn = peer.connect(hostPeerId, { reliable: true });
        connRef.current = conn;

        conn.on('open', () => {
            console.log("Connected to Host!");
            setConnected(true);
            // Send Join Message
            conn.send({ 
               type: MessageType.PLAYER_JOIN, 
               payload: { name: playerName, id: playerId } 
            });
        });

        conn.on('data', (data: any) => {
            if (data.type === MessageType.SYNC_STATE) {
                const incomingState = data.payload as GameState;
                setState(incomingState);
            }
        });

        conn.on('close', () => {
            setConnected(false);
            console.log("Disconnected from Host");
        });

        conn.on('error', (err) => {
            console.error("Connection error:", err);
        });
    };

    return () => {
      peer.destroy();
    };
  }, [gamePin, playerName, playerId]);

  const submitAnswer = (answerIndex: number) => {
    if (connRef.current && connRef.current.open) {
        connRef.current.send({
            type: MessageType.PLAYER_ANSWER,
            payload: { playerId, answerIndex }
        });
    }
  };
  
  const requestSync = () => {
      if (connRef.current && connRef.current.open) {
          console.log("Requesting manual sync...");
          connRef.current.send({ type: 'REQUEST_STATE' });
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