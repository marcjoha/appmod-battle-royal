import React, { useState, useEffect, useRef } from 'react';
import { useHostGame } from '../services/gameStore';
import { generateQuestions } from '../services/gemini';
import { GameStatus } from '../types';
import { ANSWER_COLORS, ANSWER_SHAPES } from '../constants';
import { ResponsiveContainer, BarChart as RBarChart, Bar as RBar, XAxis as RXAxis, Cell } from 'recharts';

// Lounge music URL (Royalty Free Bossa Nova style)
const MUSIC_URL = "https://cdn.pixabay.com/audio/2022/11/22/audio_febc508520.mp3";

interface HostViewProps {
  onRestart: () => void;
}

const HostView: React.FC<HostViewProps> = ({ onRestart }) => {
  const { state, loadQuestions, startGame, nextQuestion, showStats } = useHostGame();
  const [loading, setLoading] = useState(false);
  const [questionCount, setQuestionCount] = useState<number | ''>(10);
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
    let count = typeof questionCount === 'number' ? questionCount : parseInt(String(questionCount));
    
    // Validation logic: bigger than 0 and max 30
    if (isNaN(count) || count < 1) count = 1;
    if (count > 30) count = 30;
    
    // Update state to clamped value
    setQuestionCount(count);

    setLoading(true);
    try {
      const q = await generateQuestions(count, timeRange);
      loadQuestions(q);
    } catch (e) {
      alert("Failed to generate questions. Try again.");
    } finally {
      setLoading(false);
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
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-12">
            <h1 className="text-3xl font-black text-purple-400">AppMod Battle Royal <span className="text-white text-sm font-normal uppercase tracking-widest border border-white px-2 py-1 rounded ml-2">Host</span></h1>
            <div className="bg-gray-800 px-4 py-2 rounded-full">
              Players: <span className="font-bold text-green-400">{state.players.length}</span>
            </div>
          </header>

          {state.questions.length === 0 ? (
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
              <h2 className="text-2xl font-bold mb-4">Create your quiz</h2>
              <div className="mb-6">
                <p className="text-gray-300 text-lg mb-6 leading-relaxed">
                  Ready to test knowledge on Google Cloud product launches? <br/>
                  This will generate trivia questions covering <span className="text-purple-300 font-bold">GKE, Cloud Run, Cloud Build, Artifact Manager, Cloud Deploy, Gemini Code Assist, Google Antigravity, Cloud Logging, and Cloud Monitoring.</span>
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                        <label className="block text-gray-400 text-sm font-bold mb-2">Number of Questions (1-30)</label>
                        <input 
                            type="number"
                            min="1"
                            max="30"
                            value={questionCount}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') setQuestionCount('');
                                else setQuestionCount(parseInt(val));
                            }}
                            onBlur={() => {
                                let val = Number(questionCount);
                                if (isNaN(val) || val < 1) val = 1;
                                if (val > 30) val = 30;
                                setQuestionCount(val);
                            }}
                            className="w-full bg-gray-900 border border-gray-600 text-white rounded p-3 focus:outline-none focus:border-purple-500"
                        />
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

                <button 
                  onClick={handleGenerate}
                  disabled={loading}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-lg transition-colors disabled:opacity-50 text-xl w-full md:w-auto shadow-lg"
                >
                  {loading ? 'Generating Questions...' : 'Generate Questions'}
                </button>
              </div>
              <p className="text-gray-400 text-sm">Powered by Google Gemini.</p>
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
                {state.players.map(p => (
                  <div key={p.id} className="bg-gray-800 px-4 py-2 rounded-full animate-pulse border border-gray-700">
                    {p.name}
                  </div>
                ))}
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
      <div className="min-h-screen bg-purple-900 text-white flex flex-col items-center justify-center p-8">
        <h1 className="text-5xl font-black mb-24">Podium</h1>
        <div className="flex items-end gap-4 mb-12 h-64">
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
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Audio Element */}
      <audio ref={audioRef} src={MUSIC_URL} loop />

      {/* Top Bar */}
      <div className="bg-white p-4 shadow-sm flex justify-between items-center text-xl font-bold text-gray-600 border-b border-gray-200">
         <div>Question {state.currentQuestionIndex + 1} / {state.questions.length}</div>
         
         <div className="flex items-center gap-2">
           <span className="text-2xl font-black text-purple-600">{answeredCount}</span>
           <span className="text-gray-400 font-bold text-sm">OUT OF</span>
           <span className="text-2xl font-black text-gray-700">{state.players.length}</span>
           <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Answers</span>
         </div>
      </div>

      <div className="flex-1 flex flex-col items-center p-8 relative">
        {/* Question */}
        <div className="bg-white p-8 rounded shadow-lg text-center max-w-4xl w-full mb-8">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-800 leading-tight">
            {currentQ?.text}
          </h2>
        </div>

        {/* Timer/Status or Graph */}
        <div className="flex-1 w-full flex flex-col justify-center max-w-5xl">
          {state.status === GameStatus.PLAYING ? (
             <div className="flex justify-center items-center h-full">
                <div className="w-32 h-32 rounded-full border-8 border-purple-600 flex items-center justify-center text-5xl font-black text-purple-700 animate-pulse">
                  {state.timer}
                </div>
             </div>
          ) : (
             <div className="h-64 w-full bg-white p-4 rounded shadow-lg flex flex-col">
               <h3 className="text-gray-500 font-bold mb-4 uppercase text-sm">Response Distribution</h3>
               <div className="flex-1">
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
          )}
        </div>

        {/* Options Grid (Visual only for Host) */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-5xl mt-8">
          {currentQ?.options.map((opt, idx) => {
            const isCorrect = idx === currentQ.correctIndex;
            const isReveal = state.status === GameStatus.REVEAL;
            const opacity = isReveal && !isCorrect ? 'opacity-30' : 'opacity-100';
            
            return (
              <div key={idx} className={`${ANSWER_COLORS[idx]} p-6 rounded shadow-lg flex items-center text-white text-xl font-bold transition-opacity duration-500 ${opacity} min-h-[100px]`}>
                <div className="mr-4 text-2xl opacity-50 shrink-0">
                   {idx === 0 && '▲'}
                   {idx === 1 && '◆'}
                   {idx === 2 && '●'}
                   {idx === 3 && '■'}
                </div>
                <span className="break-words w-full">{opt}</span>
                {isReveal && isCorrect && <span className="ml-auto text-3xl">✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-gray-800 p-4 flex justify-between items-center text-white sticky bottom-0">
         <div className="text-gray-400 text-sm flex items-center gap-4">
            <span>AppMod Battle Royal</span>
            <button onClick={toggleMute} className="text-xs border border-gray-600 px-2 py-1 rounded hover:bg-gray-700">
               {isMuted ? '🔇 Unmute Music' : '🔊 Mute Music'}
            </button>
         </div>
         <div>
            {state.status === GameStatus.PLAYING ? (
              <button onClick={showStats} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold">Skip Timer</button>
            ) : (
              <button onClick={nextQuestion} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold text-xl">
                 {isLastQuestion ? 'Show Results 🏆' : 'Next Question →'}
              </button>
            )}
         </div>
      </div>
    </div>
  );
};

export default HostView;