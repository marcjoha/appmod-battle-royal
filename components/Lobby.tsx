import React from 'react';
import { GameState } from '../types';

interface LobbyProps {
  state: GameState;
  playerName: string;
}

const Lobby: React.FC<LobbyProps> = ({ state, playerName }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-purple-900 text-white p-4">
      <div className="animate-bounce text-6xl mb-8">🎮</div>
      <h1 className="text-4xl font-black mb-8">You're in!</h1>
      
      <div className="bg-purple-800 p-6 rounded-lg shadow-xl w-full max-w-md text-center border-2 border-purple-600">
        <h2 className="text-2xl font-bold mb-2">{playerName}</h2>
        <p className="text-purple-300">Waiting for host to start...</p>
      </div>

      <div className="mt-8 text-center text-sm text-purple-400">
        Playing AppMod Battle Royal
      </div>
    </div>
  );
};

export default Lobby;