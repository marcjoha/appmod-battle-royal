export enum GameStatus {
  LOBBY = 'LOBBY',
  PLAYING = 'PLAYING',
  REVEAL = 'REVEAL', // Host shows answer/leaderboard between questions
  FINISHED = 'FINISHED'
}

export interface Question {
  id: string;
  text: string;
  options: string[]; // Always 4 options
  correctIndex: number;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  lastAnswerIndex: number | null; // null if not answered yet
  streak: number;
}

export interface GameState {
  status: GameStatus;
  questions: Question[];
  currentQuestionIndex: number;
  players: Player[];
  timer: number; // Seconds remaining
  hostId: string; // To prevent multiple hosts taking over logically
  gamePin: string; // 6-digit pin for players to join
}

export enum MessageType {
  SYNC_STATE = 'SYNC_STATE',
  PLAYER_JOIN = 'PLAYER_JOIN',
  PLAYER_ANSWER = 'PLAYER_ANSWER',
  HOST_ACTION = 'HOST_ACTION' // Generic host command (start, next, etc)
}

export interface GameMessage {
  type: MessageType;
  payload: any;
}

export const CHANNEL_NAME = 'appmod_battle_royal_channel';

// Gemini related
export interface GeneratedQuestionRaw {
  question: string;
  options: string[];
  correctIndex: number;
}