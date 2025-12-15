import React from 'react';
import { GameState, GameStatus } from '../types';
import { ANSWER_COLORS } from '../constants';

interface PlayerGameProps {
  state: GameState;
  playerId: string;
  submitAnswer: (idx: number) => void;
}

const PlayerGame: React.FC<PlayerGameProps> = ({ state, playerId, submitAnswer }) => {
  const player = state.players.find(p => p.id === playerId);
  
  // Fix: Check strictly for null, and handle case where player is undefined (not yet synced)
  const hasAnswered = player ? player.lastAnswerIndex !== null : false;
  
  // If player data isn't synced yet, show a loading state instead of broken UI
  if (!player) {
      return (
          <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center">
              <div className="animate-pulse text-2xl font-bold">Connecting to game...</div>
          </div>
      );
  }

  // Reveal Screen
  if (state.status === GameStatus.REVEAL) {
    const currentQ = state.questions[state.currentQuestionIndex];
    const myAnswer = player.lastAnswerIndex;
    const isCorrect = myAnswer === currentQ.correctIndex;
    const score = player.score;

    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-8 text-white ${isCorrect ? 'bg-green-600' : 'bg-red-600'}`}>
         <div className="text-6xl mb-6">{isCorrect ? '🤩' : '😢'}</div>
         <h1 className="text-4xl font-black mb-2">{isCorrect ? 'Correct!' : 'Incorrect'}</h1>
         
         <div className="mt-8 bg-black/20 p-6 rounded-lg text-center min-w-[200px]">
            <div className="text-sm uppercase tracking-wider opacity-80">Current Score</div>
            <div className="text-3xl font-bold">{score}</div>
         </div>
         
         {!isCorrect && myAnswer !== null && (
           <p className="mt-8 text-lg opacity-80">Better luck next time!</p>
         )}
         {myAnswer === null && (
           <p className="mt-8 text-lg opacity-80">You didn't answer in time!</p>
         )}

         <div className="mt-12 animate-pulse text-sm">Waiting for host...</div>
      </div>
    );
  }

  if (state.status === GameStatus.FINISHED) {
    // Determine rank
    const sorted = [...state.players].sort((a,b) => b.score - a.score);
    const rank = sorted.findIndex(p => p.id === playerId) + 1;

    return (
        <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center p-6">
            <h1 className="text-3xl font-bold mb-8">Game Over</h1>
            <div className="bg-purple-800 p-8 rounded-lg text-center w-full max-w-sm border border-purple-600">
                <div className="text-gray-400 mb-2">You finished</div>
                <div className="text-6xl font-black mb-2">{rank}<span className="text-2xl align-top">th</span></div>
                <div className="text-2xl font-bold text-purple-300">{player.score} pts</div>
            </div>
        </div>
    );
  }

  // Waiting for others after answering
  if (hasAnswered) {
    return (
      <div className="min-h-screen bg-blue-900 text-white flex flex-col items-center justify-center p-8 text-center">
         <div className="animate-spin text-6xl mb-8">⏳</div>
         <h2 className="text-2xl font-bold">Answer Submitted!</h2>
         <p className="text-blue-300 mt-2">Waiting for everyone else...</p>
      </div>
    );
  }

  const currentQ = state.questions[state.currentQuestionIndex];

  // Active Buttons
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col p-4 md:p-6">
       {/* Top Bar Info */}
       <div className="flex justify-between items-center mb-6 max-w-3xl mx-auto w-full">
          <div className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-bold text-gray-700 border border-gray-200">
            Q {state.currentQuestionIndex + 1}
          </div>
          <div className="bg-purple-600 text-white px-4 py-2 rounded-full shadow-md text-sm font-bold">
            {player.score} pts
          </div>
       </div>

       {/* Main Content Container - Centered and max-width constrained */}
       <div className="flex-1 flex flex-col justify-center max-w-3xl mx-auto w-full">
           
           {/* Question Text Card */}
           {currentQ && (
             <div className="bg-white p-6 md:p-8 rounded-2xl shadow-lg mb-8 text-center border-b-4 border-gray-200">
                <h2 className="text-xl md:text-2xl font-bold text-gray-800 leading-snug">{currentQ.text}</h2>
             </div>
           )}

           {/* Question Grid - Fixed heights instead of filling screen */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
             {ANSWER_COLORS.map((color, idx) => (
               <button
                 key={idx}
                 onClick={() => submitAnswer(idx)}
                 className={`${color} rounded-xl shadow-lg flex items-center p-4 md:p-6 active:scale-95 transition-all text-left group min-h-24 md:min-h-40 h-auto hover:brightness-110 border-b-4 border-black/10`}
               >
                 <div className="bg-black/20 rounded-full w-10 h-10 md:w-14 md:h-14 flex items-center justify-center text-white text-xl md:text-2xl mr-4 shrink-0 group-hover:bg-black/30 transition-colors">
                    {idx === 0 && '▲'}
                    {idx === 1 && '◆'}
                    {idx === 2 && '●'}
                    {idx === 3 && '■'}
                 </div>
                 {/* Show Option Text if available */}
                 {currentQ && currentQ.options[idx] && (
                   <div className="text-white font-bold text-md md:text-xl leading-tight w-full break-words">
                     {currentQ.options[idx]}
                   </div>
                 )}
               </button>
             ))}
           </div>
       </div>
    </div>
  );
};

export default PlayerGame;