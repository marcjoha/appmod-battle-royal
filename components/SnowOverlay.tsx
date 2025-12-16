import React, { useMemo } from 'react';

// Snow Overlay Component for December
const SnowOverlay = React.memo(() => {
  const isDecember = new Date().getMonth() === 11;

  const flakes = useMemo(() => Array.from({ length: 50 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    width: Math.random() * 5 + 3,
    duration: Math.random() * 10 + 5,
    delay: Math.random() * 5,
    opacity: Math.random() * 0.4 + 0.2
  })), []);

  if (!isDecember) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
      <style>{`
        @keyframes snowfall {
          from { transform: translateY(-20px) translateX(0); }
          to { transform: translateY(120vh) translateX(20px); }
        }
      `}</style>
      {flakes.map(flake => (
        <div
          key={flake.id}
          className="absolute bg-white rounded-full"
          style={{
            left: `${flake.left}%`,
            top: -20,
            width: `${flake.width}px`,
            height: `${flake.width}px`,
            opacity: flake.opacity,
            animation: `snowfall ${flake.duration}s linear infinite`,
            animationDelay: `-${flake.delay}s`,
          }}
        />
      ))}
    </div>
  );
});

export default SnowOverlay;
