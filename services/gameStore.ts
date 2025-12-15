import { useEffect, useState, useRef, useCallback } from 'react';
import { GameState, GameStatus, Player, Question, MessageType, GameMessage, CHANNEL_NAME, GeneratedQuestionRaw } from '../types';
import { MAX_TIME } from '../constants';
import { v4 as uuidv4 } from 'uuid';

const INITIAL_STATE: GameState = {
  status: GameStatus.LOBBY,
  questions: [],
  currentQuestionIndex: 0,
  players: [],
  timer: MAX_TIME,
  hostId: ''
};

// Hook for the HOST
export const useHostGame = () => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const timerRef = useRef<any>(null);

  // Initialize Host
  useEffect(() => {
    const hostId = uuidv4();
    const newState = { ...INITIAL_STATE, hostId };
    setState(newState);
    
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    
    // Broadcast initial state
    channelRef.current.postMessage({ type: MessageType.SYNC_STATE, payload: newState });

    // Listen for player events
    channelRef.current.onmessage = (event) => {
      const msg = event.data as GameMessage;
      handleMessage(msg);
    };

    return () => {
      channelRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Broadcast state whenever it changes locally
  useEffect(() => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: MessageType.SYNC_STATE, payload: state });
    }
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
        // If player exists (e.g. refresh), update name if changed, but keep score
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
          
          // Calculate score based on time remaining
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
    // Manually trigger reveal if timer hasn't run out yet
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
export const usePlayerGame = (playerName: string) => {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  
  // Persist player ID in session storage to handle refreshes without creating ghost players
  const [playerId] = useState(() => {
    const key = 'appmod_player_id';
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const newId = uuidv4();
    sessionStorage.setItem(key, newId);
    return newId;
  });

  const channelRef = useRef<BroadcastChannel | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    
    // Join the game logic
    const joinGame = () => {
       if (playerName) {
         channelRef.current?.postMessage({ 
           type: MessageType.PLAYER_JOIN, 
           payload: { name: playerName, id: playerId } 
         });
       }
    };

    if (!joined) {
       joinGame();
       setJoined(true);
    }

    channelRef.current.onmessage = (event) => {
      const msg = event.data as GameMessage;
      if (msg.type === MessageType.SYNC_STATE) {
        const incomingState = msg.payload as GameState;
        setState(incomingState);

        // Auto-rejoin if we are missing from the host's player list
        // This handles cases where the player joined before the host was ready,
        // or if the host refreshed the page.
        const amIInList = incomingState.players.some(p => p.id === playerId);
        // Only rejoin if we are supposed to be in the game (we have a name) and we aren't in the list
        if (!amIInList && playerName) {
            console.log("Player missing from state, re-joining...", playerId);
            joinGame();
        }
      }
    };

    return () => {
      channelRef.current?.close();
    };
  }, [playerName, playerId, joined]);

  const submitAnswer = (answerIndex: number) => {
    channelRef.current?.postMessage({
      type: MessageType.PLAYER_ANSWER,
      payload: { playerId, answerIndex }
    });
  };

  return {
    state,
    playerId,
    submitAnswer
  };
};