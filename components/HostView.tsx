import React, { useState, useEffect, useRef } from 'react';
import { useHostGame } from '../services/gameStore';
import { generateQuestions } from '../services/gemini';
import { GameStatus } from '../types';
import { ANSWER_COLORS, ANSWER_SHAPES } from '../constants';
import { ResponsiveContainer, BarChart as RBarChart, Bar as RBar, XAxis as RXAxis, Cell } from 'recharts';
import SnowOverlay from './SnowOverlay';

// Lounge music URL (Royalty Free Bossa Nova style)
const MUSIC_URL = "https://cdn.pixabay.com/audio/2022/11/22/audio_febc508520.mp3";

interface HostViewProps {
  onRestart: () => void;
}

const HostView: React.FC<HostViewProps> = ({ onRestart }) => {
  const { state, playerStatus, loadQuestions, startGame, nextQuestion, showStats } = useHostGame();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [timeRange, setTimeRange] = useState('Year to Date (YTD)');
  
  // Audio state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeIntervalRef = useRef<number>(0);
  const [isMuted, setIsMuted] = useState(false);

  // Manage Audio Playback based on Game Status
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Clear any pending fade interval when state changes
    if (fadeIntervalRef.current) {
      window.clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = 0;
    }

    if (state.status === GameStatus.PLAYING) {
      // Start Playing immediately
      audio.volume = 1.0; 
      if (audio.paused) {
        audio.play().catch(e => console.error("Audio play failed:", e));
      }
    } else if (state.status === GameStatus.REVEAL) {
      // Graceful fade out over ~1.5 seconds
      if (!audio.paused) {
        fadeIntervalRef.current = window.setInterval(() => {
          if (audio.volume > 0.05) {
            audio.volume -= 0.05;
          } else {
            audio.volume = 0;
            audio.pause();
            if (fadeIntervalRef.current) {
              window.clearInterval(fadeIntervalRef.current);
              fadeIntervalRef.current = 0;
            }
          }
        }, 100);
      }
    } else {
      // Lobby or Finished: ensure stopped
      audio.pause();
      if (state.status === GameStatus.FINISHED) {
          audio.currentTime = 0;
      }
    }

    return () => {
        if (fadeIntervalRef.current) {
            window.clearInterval(fadeIntervalRef.current);
        }
    };
  }, [state.status]);

  // Toggle Mute
  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleGenerate = async () => {
    // Validate count before generating
    let count = questionCount;
    
    // Validation logic: bigger than 0 and max 30
    if (count < 1) count = 5;
    if (count > 30) count = 30;
    
    setLoading(true);
    setProgress(0);
    try {
      const q = await generateQuestions(count, timeRange, (p) => setProgress(p));
      if (q.length === 0) {
          alert("No questions could be generated. Please try again or adjust your criteria.");
      } else {
          loadQuestions(q);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate questions. Please try again.");
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const currentQ = state.questions[state.currentQuestionIndex];

  // Prepare data for graph
  const getAnswerStats = () => {
    const counts = [0, 0, 0, 0];
    state.players.forEach(p => {
      if (p.lastAnswerIndex !== null && p.lastAnswerIndex >= 0 && p.lastAnswerIndex < 4) {
        counts[p.lastAnswerIndex]++;
      }
    });
    return counts.map((count, idx) => ({ name: ANSWER_SHAPES[idx], count, fill: ANSWER_COLORS[idx] }));
  };

  const answeredCount = state.players.filter(p => p.lastAnswerIndex !== null).length;
  const isLastQuestion = state.questions.length > 0 && state.currentQuestionIndex === state.questions.length - 1;

  if (state.status === GameStatus.LOBBY) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8 relative overflow-hidden">
        <SnowOverlay />
        <div className="max-w-4xl mx-auto relative z-10">
          <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-4">
             <div className="flex items-center gap-4">
               <h1 className="text-3xl font-black text-purple-400">AppMod Battle Royal</h1>
               <span className="text-white text-sm font-bold uppercase tracking-widest border border-white px-2 py-1 rounded">Host</span>
             </div>
             
             {/* Game PIN Display */}
             <div className="bg-white text-gray-900 px-8 py-4 rounded-lg shadow-xl text-center transform rotate-1 hover:rotate-0 transition-transform duration-300">
               <div className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-1">Game PIN</div>
               <div className="text-5xl font-black tracking-widest text-purple-600">{state.gamePin}</div>
             </div>
          </header>

          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Lobby Status</h2>
            <div className="bg-gray-800 px-4 py-2 rounded-full">
               Players: <span className="font-bold text-green-400">{state.players.length}</span>
            </div>
          </div>

          {state.questions.length === 0 ? (
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
              <h2 className="text-2xl font-bold mb-4">Create your quiz</h2>
              <div className="mb-6">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                        <label className="block text-gray-400 text-sm font-bold mb-2">Number of Questions</label>
                        <div className="grid grid-cols-4 gap-2">
                            {[5, 10, 15, 20].map((num) => (
                                <button
                                    key={num}
                                    onClick={() => setQuestionCount(num)}
                                    className={`py-3 rounded font-bold border transition-all duration-200 ${
                                        questionCount === num
                                        ? 'bg-purple-600 border-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)] transform scale-105'
                                        : 'bg-gray-900 border-gray-600 text-gray-400 hover:bg-gray-800 hover:border-gray-500'
                                    }`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-gray-400 text-sm font-bold mb-2">Time Range</label>
                        <select 
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 text-white rounded p-3 focus:outline-none focus:border-purple-500"
                        >
                            <option value="This Quarter">This Quarter</option>
                            <option value="Year to Date (YTD)">Year to Date (YTD)</option>
                            <option value="Rolling 12 Months">Rolling 12 Months</option>
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="w-full flex flex-col items-center justify-center pt-8 pb-2">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-500 mb-4"></div>
                        <h3 className="text-xl font-bold text-white mb-2">Generating Questions...</h3>
                        <p className="text-sm text-gray-400 animate-pulse">Consulting Google Search & Gemini...</p>
                    </div>
                ) : (
                    <button 
                      onClick={handleGenerate}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-lg transition-colors text-xl w-full md:w-auto shadow-lg"
                    >
                      Generate Questions
                    </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 bg-gray-800 rounded-xl border border-gray-700 space-y-8">
                <div className="text-center">
                    <div className="text-6xl mb-6">✅</div>
                    <h2 className="text-3xl font-bold mb-4">{state.questions.length} Questions Loaded</h2>
                    <p className="text-gray-400 text-lg max-w-lg mx-auto">
                        The quiz is ready to begin. Questions are hidden so the host can play along on another device without seeing the answers!
                    </p>
                </div>
                
                <button 
                  onClick={startGame}
                  className="bg-green-500 hover:bg-green-600 text-white font-black py-4 px-12 rounded-lg shadow-lg transform hover:scale-105 transition-all text-2xl"
                >
                  START GAME
                </button>
            </div>
          )}

          {/* Player List in Lobby */}
          {state.players.length > 0 && (
            <div className="mt-12">
              <h3 className="text-xl font-bold mb-4 text-gray-400 uppercase tracking-widest">Players in Lobby</h3>
              <div className="flex flex-wrap gap-3">
                {state.players.map(p => {
                    // Check status from map
                    return (
                      <div key={p.id} className="relative bg-gray-800 px-4 py-2 rounded-full border border-gray-700 font-bold text-lg flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        {p.name}
                      </div>
                    );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // GAME PLAYING / REVEAL VIEW
  if (state.status === GameStatus.FINISHED) {
    return (
      <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center p-8 relative overflow-hidden">
        <SnowOverlay />
        <h1 className="text-5xl font-black mb-24 relative z-10">Podium</h1>
        <div className="flex items-end gap-4 mb-12 h-64 relative z-10">
           {/* Determine podium logic */}
           {(() => {
              const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
              return (
                <>
                  {/* 2nd Place */}
                  {sortedPlayers[1] && (
                     <div className="flex flex-col items-center">
                        <div className="mb-2 font-bold text-xl">{sortedPlayers[1].name}</div>
                        <div className="w-24 bg-gray-400 h-32 rounded-t-lg flex items-center justify-center text-2xl font-black shadow-lg">2</div>
                        <div className="mt-2 text-gray-300">{sortedPlayers[1].score} pts</div>
                     </div>
                  )}
                  {/* 1st Place */}
                  {sortedPlayers[0] && (
                     <div className="flex flex-col items-center">
                        <div className="text-4xl mb-2">👑</div>
                        <div className="mb-2 font-bold text-2xl text-yellow-300">{sortedPlayers[0].name}</div>
                        <div className="w-32 bg-yellow-500 h-48 rounded-t-lg flex items-center justify-center text-4xl font-black shadow-xl border-t-4 border-yellow-300">1</div>
                        <div className="mt-2 font-bold text-yellow-300">{sortedPlayers[0].score} pts</div>
                     </div>
                  )}
                  {/* 3rd Place */}
                  {sortedPlayers[2] && (
                     <div className="flex flex-col items-center">
                        <div className="mb-2 font-bold text-xl">{sortedPlayers[2].name}</div>
                        <div className="w-24 bg-orange-700 h-24 rounded-t-lg flex items-center justify-center text-2xl font-black shadow-lg">3</div>
                        <div className="mt-2 text-orange-300">{sortedPlayers[2].score} pts</div>
                     </div>
                  )}
                </>
              );
           })()}
        </div>
        <button onClick={onRestart} className="bg-white text-purple-900 px-8 py-3 rounded-full font-bold hover:bg-gray-200">Play Again</button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden font-sans">
      {/* Audio Element */}
      <audio ref={audioRef} src={MUSIC_URL} loop />

      {/* Top Bar - Fixed Height (Header) */}
      <div className="h-16 bg-white px-6 shadow-sm flex flex-none justify-between items-center text-xl font-bold text-gray-600 border-b border-gray-200 z-10">
         <div>Question {state.currentQuestionIndex + 1} / {state.questions.length}</div>
         
         <div className="flex items-center gap-2">
           <span className="text-2xl font-black text-purple-600">{answeredCount}</span>
           <span className="text-gray-400 font-bold text-sm">OUT OF</span>
           <span className="text-2xl font-black text-gray-700">{state.players.length}</span>
           <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Answers</span>
         </div>
      </div>

      {/* Main Layout Content Area - Flex Grow */}
      <div className="flex-1 flex flex-col items-center justify-between p-4 gap-4 w-full max-w-6xl mx-auto min-h-0">
        
        {/* Question Area - Max 25% of vertical space, min 15% */}
        <div className="w-full flex-none flex items-center justify-center min-h-[15%] max-h-[25%]">
             <div className="bg-white p-4 md:p-6 rounded-2xl shadow-md text-center w-full h-full flex items-center justify-center overflow-y-auto">
                <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-gray-800 leading-tight">
                    {currentQ?.text}
                </h2>
             </div>
        </div>

        {/* Center Area: Timer / Graph - Takes remaining available space */}
        <div className="w-full flex-1 min-h-0 flex flex-col justify-center relative">
          {state.status === GameStatus.PLAYING ? (
             <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-40 h-40 rounded-full border-8 border-purple-600 flex items-center justify-center text-6xl font-black text-purple-700 animate-pulse bg-white shadow-xl">
                  {state.timer}
                </div>
             </div>
          ) : (
            // Reveal Mode: Graph + Info Box
            <div className="absolute inset-0 flex gap-4">
                 {/* Graph Section - Takes available space */}
                 <div className="flex-1 bg-white p-4 rounded-xl shadow-md flex flex-col min-w-0">
                   <h3 className="text-gray-500 font-bold mb-2 uppercase text-xs flex-none">Response Distribution</h3>
                   <div className="flex-1 min-h-0">
                     <ResponsiveContainer width="100%" height="100%">
                        <RBarChart data={getAnswerStats()}>
                          <RXAxis dataKey="name" tick={false} axisLine={false} />
                          <RBar dataKey="count" radius={[4, 4, 0, 0]}>
                            {getAnswerStats().map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill.replace('bg-', '').replace('-500', '') === 'red' ? '#ef4444' : entry.fill.replace('bg-', '').replace('-500', '') === 'blue' ? '#3b82f6' : entry.fill.replace('bg-', '').replace('-500', '') === 'yellow' ? '#eab308' : '#22c55e'} />
                            ))}
                          </RBar>
                        </RBarChart>
                     </ResponsiveContainer>
                   </div>
                 </div>

                 {/* Info Box - 40% Width, only if explanation exists */}
                 {currentQ.explanation && (
                    <div className="w-[40%] bg-purple-50 border border-purple-100 p-4 rounded-xl shadow-md flex flex-col overflow-y-auto">
                        <div className="flex items-center gap-2 mb-2">
                             <span className="text-xl">💡</span>
                             <h3 className="text-purple-900 font-bold uppercase text-xs">Did you know?</h3>
                        </div>
                        <p className="text-sm md:text-base text-gray-800 mb-4 flex-1 leading-relaxed">
                            {currentQ.explanation}
                        </p>
                        {currentQ.sourceUrl && (
                            <div className="mt-auto pt-2 border-t border-purple-200">
                                <a 
                                  href={currentQ.sourceUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 truncate"
                                  title={currentQ.sourceUrl}
                                >
                                    <span>🔗 Source:</span>
                                    <span className="truncate">{new URL(currentQ.sourceUrl).hostname}</span>
                                    <span>↗</span>
                                </a>
                            </div>
                        )}
                    </div>
                 )}
             </div>
          )}
        </div>

        {/* Options Grid - Fixed 35% height so it stays put */}
        <div className="w-full h-[35%] flex-none grid grid-cols-2 gap-4">
          {currentQ?.options.map((opt, idx) => {
            const isCorrect = idx === currentQ.correctIndex;
            const isReveal = state.status === GameStatus.REVEAL;
            const opacity = isReveal && !isCorrect ? 'opacity-30' : 'opacity-100';
            
            return (
              <div key={idx} className={`${ANSWER_COLORS[idx]} p-4 md:p-6 rounded-lg shadow-lg flex items-center text-white text-lg md:text-2xl font-bold transition-opacity duration-500 ${opacity} h-full`}>
                <div className="mr-4 text-3xl opacity-50 shrink-0">
                   {idx === 0 && '▲'}
                   {idx === 1 && '◆'}
                   {idx === 2 && '●'}
                   {idx === 3 && '■'}
                </div>
                <span className="break-words w-full overflow-hidden text-ellipsis leading-tight line-clamp-3">{opt}</span>
                {isReveal && isCorrect && <span className="ml-auto text-4xl">✓</span>}
              </div>
            );
          })}
        </div>
      
      </div>

      {/* Control Bar - Fixed Height (Footer) */}
      <div className="h-16 bg-gray-800 p-4 flex flex-none justify-between items-center text-white z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.3)]">
         <div className="text-gray-400 text-sm flex items-center gap-4">
            <span className="hidden md:inline">AppMod Battle Royal (PIN: {state.gamePin})</span>
            <button onClick={toggleMute} className="text-xs border border-gray-600 px-2 py-1 rounded hover:bg-gray-700">
               {isMuted ? '🔇' : '🔊'} Music
            </button>
         </div>
         <div>
            {state.status === GameStatus.PLAYING ? (
              <button onClick={showStats} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold transition-colors">Skip Timer</button>
            ) : (
              <button onClick={nextQuestion} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold text-lg transition-colors">
                 {isLastQuestion ? 'Show Results 🏆' : 'Next Question →'}
              </button>
            )}
         </div>
      </div>
    </div>
  );
};

export default HostView;