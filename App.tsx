import React, { useState, useEffect } from 'react';
import HostView from './components/HostView';
import PlayerGame from './components/PlayerGame';
import Lobby from './components/Lobby';
import SnowOverlay from './components/SnowOverlay';
import { usePlayerGame } from './services/gameStore';
import { GameStatus } from './types';

function App() {
  // Simple routing state
  const [role, setRole] = useState<'home' | 'host' | 'player' | 'host-login'>('home');
  const [playerName, setPlayerName] = useState('');
  const [gamePin, setGamePin] = useState('');
  const [hostPassword, setHostPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const verifyHostPassword = () => {
    if (hostPassword === import.meta.env.VITE_HOST_PASSWORD) {
      setRole('host');
      setErrorMsg('');
      setHostPassword('');
    } else {
      setErrorMsg('Incorrect password');
    }
  };

  if (role === 'host') {
    return <HostView onRestart={() => setRole('home')} />;
  }

  if (role === 'player') {
    return <PlayerWrapper playerName={playerName} gamePin={gamePin} />;
  }

  if (role === 'host-login') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white relative overflow-hidden">
        <SnowOverlay />
        <div className="max-w-md w-full bg-gray-800 p-8 rounded-lg shadow-2xl border border-gray-700 relative z-10">
          <h2 className="text-3xl font-bold mb-6 text-center text-purple-400">Host Access</h2>
          <p className="mb-6 text-gray-400 text-center">Please enter the host password.</p>
          
          <input
            type="password"
            placeholder="Password"
            className="w-full bg-gray-900 border border-gray-600 rounded p-4 text-center font-bold text-xl mb-4 focus:outline-none focus:border-purple-500 text-white"
            value={hostPassword}
            onChange={(e) => setHostPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && verifyHostPassword()}
          />
          
          {errorMsg && (
            <div className="text-red-500 font-bold text-center mb-4 bg-red-900/20 p-2 rounded">
              {errorMsg}
            </div>
          )}

          <button
            onClick={verifyHostPassword}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 rounded text-xl transition-colors mb-4"
          >
            Enter Host Mode
          </button>
          
          <button
            onClick={() => {
              setRole('home');
              setHostPassword('');
              setErrorMsg('');
            }}
            className="w-full text-gray-400 hover:text-white font-bold py-2"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-700 to-indigo-900 flex flex-col items-center justify-center p-4 text-white relative overflow-hidden">
      <SnowOverlay />
      <div className="text-center max-w-md w-full relative z-10">
        <h1 className="text-5xl font-black mb-2 tracking-tighter">AppMod</h1>
        <h2 className="text-2xl font-bold mb-8 text-purple-200 uppercase tracking-widest">Battle Royal</h2>
        
        <div className="bg-white text-gray-900 p-6 rounded-lg shadow-2xl mb-8">
          <div className="space-y-4">
              <input
                type="text"
                placeholder="Game PIN (6 digits)"
                className="w-full bg-gray-100 border-2 border-gray-300 rounded p-4 text-center font-bold text-xl focus:outline-none focus:border-purple-600 tracking-widest"
                value={gamePin}
                maxLength={6}
                onChange={(e) => setGamePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <input
                type="text"
                placeholder="Enter your nickname"
                className="w-full bg-gray-100 border-2 border-gray-300 rounded p-4 text-center font-bold text-xl focus:outline-none focus:border-purple-600"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && playerName && gamePin.length === 6 && setRole('player')}
              />
          </div>
          <button
            onClick={() => playerName && gamePin.length === 6 && setRole('player')}
            className="w-full bg-gray-900 text-white font-bold py-4 rounded text-xl hover:bg-gray-800 transition-colors disabled:opacity-50 mt-4"
            disabled={!playerName || gamePin.length !== 6}
          >
            Enter Game
          </button>
        </div>

        <div className="text-sm text-purple-300">
          or
        </div>

        <button 
          onClick={() => setRole('host-login')}
          className="mt-4 text-white underline font-bold hover:text-purple-200"
        >
          Host a game instead
        </button>
      </div>
    </div>
  );
}

// Wrapper to isolate Player Hook
const PlayerWrapper: React.FC<{ playerName: string, gamePin: string }> = ({ playerName, gamePin }) => {
  const { state, playerId, submitAnswer, connected, requestSync } = usePlayerGame(playerName, gamePin);

  // Listen for the custom event from Lobby
  useEffect(() => {
      const handleSyncRequest = () => {
          requestSync();
      };
      document.addEventListener('appmod-request-sync', handleSyncRequest);
      return () => {
          document.removeEventListener('appmod-request-sync', handleSyncRequest);
      };
  }, [requestSync]);

  if (!connected) {
    return (
      <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center p-4 text-center">
         <div className="animate-spin text-5xl mb-6">⏳</div>
         <h2 className="text-2xl font-bold mb-2">Connecting to Game...</h2>
         <p className="text-purple-300">PIN: {gamePin}</p>
      </div>
    );
  }

  if (state.status === GameStatus.LOBBY) {
    return <Lobby state={state} playerName={playerName} />;
  }

  return <PlayerGame state={state} playerId={playerId} submitAnswer={submitAnswer} />;
};

export default App;