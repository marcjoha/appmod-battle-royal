import React from 'react';
import { GameState } from '../types';
import { usePlayerGame } from '../services/gameStore';

interface LobbyProps {
  state: GameState;
  playerName: string;
}

const Lobby: React.FC<LobbyProps> = ({ state, playerName }) => {
  // We need access to requestSync, but this component receives state as prop.
  // Ideally, we should pass requestSync down, but for minimal intrusion, we can use a small hack or assume logic is correct.
  // Wait, Lobby is rendered by PlayerWrapper in App.tsx. We should update App.tsx to pass requestSync?
  // No, let's keep it simple. The PlayerWrapper has the hook.
  // I will modify App.tsx to pass requestSync to Lobby.
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
      
      <div className="mt-12 text-center">
         <p className="text-xs text-purple-400 mb-2">Stuck here?</p>
         <button 
           id="sync-btn"
           className="text-xs border border-purple-500 text-purple-300 px-3 py-1 rounded hover:bg-purple-800 transition-colors"
           onClick={() => {
               // Dispatch a custom event that PlayerWrapper can listen to, or simpler: 
               // Just rely on the user refreshing, but we want to avoid disconnects.
               // Actually, I should update App.tsx to pass the function.
               document.dispatchEvent(new CustomEvent('appmod-request-sync'));
           }}
         >
           Refresh Status
         </button>
      </div>
    </div>
  );
};

export default Lobby;