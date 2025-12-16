import { useEffect, useState, useRef } from 'react';
import { GameState, GameStatus, Question, MessageType, GameMessage, GeneratedQuestionRaw } from '../types';
import { MAX_TIME } from '../constants';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_STATE: GameState = {
  status: GameStatus.LOBBY,
  questions: [],
  currentQuestionIndex: 0,
  players: [],
  timer: MAX_TIME,
  hostId: '',
  gamePin: '......'
};

const POLL_INTERVAL = 1000;

// Helper for API calls
const apiCall = async (endpoint: string, method: string, body?: any) => {
    try {
        const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        return await res.json();
    } catch (e) {
        console.error("API Error:", e);
        return null;
    }
};

// --- HOST HOOK ---
export const useHostGame = () => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [playerStatus, setPlayerStatus] = useState<Record<string, boolean>>({}); 
  
  const timerRef = useRef<any>(null);
  const pollRef = useRef<any>(null);
  const lastMsgIdRef = useRef<number>(0);
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Initialize Host
  useEffect(() => {
    // Generate PIN if needed
    let pin = state.gamePin === '......' ? Math.floor(100000 + Math.random() * 900000).toString() : state.gamePin;
    
    // Update state if we just generated a pin
    if (state.gamePin === '......') {
        const hostId = state.hostId || uuidv4();
        setState(prev => ({ ...prev, hostId, gamePin: pin }));
        return;
    }

    console.log(`[Host] Initializing Polling for PIN: ${pin}`);

    // Polling Loop
    const poll = async () => {
        const msgs = await apiCall(`/api/poll?room=${pin}&lastId=${lastMsgIdRef.current}&myId=${state.hostId}`, 'GET');
        if (msgs && Array.isArray(msgs)) {
            msgs.forEach((msg: any) => {
                if (msg.id > lastMsgIdRef.current) {
                    lastMsgIdRef.current = msg.id;
                    handleMessage(msg.payload, msg.senderId);
                }
            });
        }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gamePin]); 

  // Broadcast state changes
  useEffect(() => {
     safeSend({
         type: MessageType.SYNC_STATE, 
         payload: state 
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

  const safeSend = (payload: any, targetId?: string) => {
      apiCall('/api/send', 'POST', {
          room: state.gamePin,
          senderId: state.hostId,
          targetId,
          payload
      });
  };

  const handleMessage = (msg: any, senderId: string) => {
    if (msg.type === MessageType.PLAYER_JOIN) {
        addPlayer(msg.payload.name, msg.payload.id);
        // Reply with Sync State to THIS player specifically
        safeSend({ type: MessageType.SYNC_STATE, payload: stateRef.current }, senderId); 
        setPlayerStatus(prev => ({...prev, [msg.payload.id]: true}));

    } else if (msg.type === MessageType.PLAYER_ANSWER) {
        recordAnswer(msg.payload.playerId, msg.payload.answerIndex);
    } else if (msg.type === 'REQUEST_STATE') {
         safeSend({ type: MessageType.SYNC_STATE, payload: stateRef.current }, senderId);
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

  const pollRef = useRef<any>(null);
  const lastMsgIdRef = useRef<number>(0);
  const [connected, setConnected] = useState(false); // Virtual connection state

  // Watchdog (Polling replaces this somewhat, but we can check if poll succeeds)
  // We can treat successful poll as "connected"

  useEffect(() => {
    if (!gamePin || !playerName) return;

    console.log(`[Player] Init Polling for ${playerName}`);
    setConnected(true);

    // Initial Join
    safeSend({ 
        type: MessageType.PLAYER_JOIN, 
        payload: { name: playerName, id: playerId } 
    });

    const poll = async () => {
        const msgs = await apiCall(`/api/poll?room=${gamePin}&lastId=${lastMsgIdRef.current}&myId=${playerId}`, 'GET');
        if (msgs && Array.isArray(msgs)) {
            msgs.forEach((msg: any) => {
                if (msg.id > lastMsgIdRef.current) {
                    lastMsgIdRef.current = msg.id;
                    handleMessage(msg.payload);
                }
            });
            lastUpdateRef.current = Date.now();
        }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gamePin, playerName, playerId]);

  const handleMessage = (msg: any) => {
    if (msg.type === MessageType.SYNC_STATE) {
        const incomingState = msg.payload as GameState;
        setState(incomingState);
    }
  };

  const safeSend = (payload: any) => {
      apiCall('/api/send', 'POST', {
          room: gamePin,
          senderId: playerId,
          payload
      });
  };

  const submitAnswer = (answerIndex: number) => {
      safeSend({
            type: MessageType.PLAYER_ANSWER,
            payload: { playerId, answerIndex }
      });
  };
  
  const requestSync = () => {
      safeSend({ type: 'REQUEST_STATE' });
  };

  return {
    state,
    playerId,
    submitAnswer,
    connected,
    requestSync
  };
};
