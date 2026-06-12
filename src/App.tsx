import React, { useEffect, useRef, useState, useCallback } from 'react';
import { audioEngine } from './audioEngine';
import { Play, RotateCcw, Trophy, Bomb, XCircle, Pause, PlaySquare } from 'lucide-react';

type GameState = 'start' | 'playing' | 'paused' | 'gameover' | 'win';

interface GameObject {
  id: number;
  type: 'ball' | 'bomb';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  cut: boolean;
  rotation: number;
  rotV: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotV: number;
  radius: number;
  isTop: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

// Distance from point p to line segment v-w
function distToSegmentSquared(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // React State for UI Overlays
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [timeLeft, setTimeLeft] = useState(10);
  const [endReason, setEndReason] = useState<string>('');

  // Mutable Game State for Animation Loop (avoids stale closures)
  const engineState = useRef({
    status: 'start' as GameState,
    score: 0,
    misses: 0,
    objects: [] as GameObject[],
    particles: [] as Particle[],
    trail: [] as TrailPoint[],
    isDragging: false,
    lastSpawnTime: 0,
    startTime: 0,
    pauseStartTime: 0,
    lastTimeLeft: 10,
    nextObjectId: 0,
    width: 0,
    height: 0
  });

  const requestRef = useRef<number>();

  const startGame = useCallback(() => {
    audioEngine.init();
    audioEngine.playBGM();
    
    engineState.current.status = 'playing';
    engineState.current.score = 0;
    engineState.current.misses = 0;
    engineState.current.objects = [];
    engineState.current.particles = [];
    engineState.current.trail = [];
    engineState.current.startTime = Date.now();
    engineState.current.lastSpawnTime = Date.now();
    
    setGameState('playing');
    setScore(0);
    setMisses(0);
    setTimeLeft(10);
    setEndReason('');
  }, []);

  const togglePause = useCallback(() => {
    if (engineState.current.status === 'playing') {
      engineState.current.status = 'paused';
      engineState.current.pauseStartTime = Date.now();
      audioEngine.ctx?.suspend();
      setGameState('paused');
    } else if (engineState.current.status === 'paused') {
      const pausedDuration = Date.now() - engineState.current.pauseStartTime;
      engineState.current.startTime += pausedDuration;
      engineState.current.lastSpawnTime += pausedDuration;
      engineState.current.status = 'playing';
      audioEngine.ctx?.resume();
      setGameState('playing');
    }
  }, []);

  const triggerGameOver = useCallback((reason: string) => {
    engineState.current.status = 'gameover';
    audioEngine.stopBGM();
    audioEngine.playFail();
    setGameState('gameover');
    setEndReason(reason);
  }, []);

  const triggerWin = useCallback(() => {
    engineState.current.status = 'win';
    audioEngine.stopBGM();
    audioEngine.playWin();
    setGameState('win');
  }, []);

  // Main Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle Resize
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
        engineState.current.width = canvas.width;
        engineState.current.height = canvas.height;
      }
    });
    resizeObserver.observe(canvas.parentElement!);

    const spawnObject = () => {
      const { width, height } = engineState.current;
      const now = Date.now();
      const elapsed = (now - engineState.current.startTime) / 1000;
      const progress = Math.min(1, elapsed / 10); // 0 to 1 over 10 seconds
      
      // Spawn limits
      const spawnDelay = 1200 - progress * 600; // Gets faster
      const timeSinceLast = now - engineState.current.lastSpawnTime;
      
      if (timeSinceLast > spawnDelay) {
        engineState.current.lastSpawnTime = now;
        
        const isBomb = Math.random() < 0.1 + (progress * 0.2); // Up to 30% bombs
        const radius = isBomb ? 55 : 45; // Increased bomb size
        
        const x = width * 0.2 + Math.random() * (width * 0.6);
        const y = height + radius;
        
        // Scale physics to height
        const gravityEffect = progress * 0.2;
        const initialVy = -height * 0.025 - Math.random() * (height * 0.006) - gravityEffect;
        const initialVx = ((width / 2) - x) * 0.015 + (Math.random() - 0.5) * 5;
        
        engineState.current.objects.push({
          id: engineState.current.nextObjectId++,
          type: isBomb ? 'bomb' : 'ball',
          x,
          y,
          vx: initialVx,
          vy: initialVy,
          radius,
          cut: false,
          rotation: Math.random() * Math.PI * 2,
          rotV: (Math.random() - 0.5) * 0.1
        });
      }
    };

    const runFrame = () => {
      const state = engineState.current;
      const W = canvas.width;
      const H = canvas.height;
      const gravity = Math.max(H * 0.0004, 0.25);
      
      ctx.clearRect(0, 0, W, H);

      if (state.status === 'playing') {
        // Track Time
        const elapsed = (Date.now() - state.startTime) / 1000;
        const remaining = Math.max(0, 10 - Math.ceil(elapsed));
        
        if (remaining !== state.lastTimeLeft) {
          state.lastTimeLeft = remaining;
          setTimeLeft(remaining);
        }
        
        if (remaining <= 0) {
          triggerWin();
        } else {
          spawnObject();
        }
      }

      // Update and Draw Trail
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < state.trail.length; i++) {
        const pt = state.trail[i];
        pt.age++;
        
        ctx.lineWidth = Math.max(1, 8 - pt.age * 0.5);
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - pt.age * 0.1})`;
        
        if (i === 0) {
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
        } else {
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
        }
      }
      // Remove old points
      state.trail = state.trail.filter(pt => pt.age < 12);

      // Update and Draw Particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotV;
        
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        
        ctx.beginPath();
        if (p.isTop) {
          ctx.arc(0, 0, p.radius, Math.PI, 0);
        } else {
          ctx.arc(0, 0, p.radius, 0, Math.PI);
        }
        ctx.clip(); // Clip to half

        // Draw full ball inside clip
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#CCFF00';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(-p.radius*0.6, 0, p.radius*0.7, -Math.PI/3, Math.PI/3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.radius*0.6, 0, p.radius*0.7, Math.PI - Math.PI/3, Math.PI + Math.PI/3);
        ctx.stroke();
        
        ctx.fillStyle = '#000000';
        ctx.font = `900 ${p.radius * 0.45}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TENNIS', 0, 0);

        ctx.restore();
        
        if (p.y > H + p.radius) {
          state.particles.splice(i, 1);
        }
      }

      // Update and Draw Objects
      for (let i = state.objects.length - 1; i >= 0; i--) {
        const o = state.objects[i];
        // Physics update
        o.vy += gravity;
        o.x += o.vx;
        o.y += o.vy;
        o.rotation += o.rotV;

        if (!o.cut) {
          ctx.save();
          ctx.translate(o.x, o.y);
          ctx.rotate(o.rotation);

          if (o.type === 'ball') {
            // Ball Base
            ctx.beginPath();
            ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#CCFF00';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();

            // Ball Curves
            ctx.beginPath();
            ctx.arc(-o.radius*0.6, 0, o.radius*0.7, -Math.PI/3, Math.PI/3);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(o.radius*0.6, 0, o.radius*0.7, Math.PI - Math.PI/3, Math.PI + Math.PI/3);
            ctx.stroke();
            
            // Text
            ctx.fillStyle = '#000000';
            ctx.font = `900 ${o.radius * 0.45}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('TENNIS', 0, 0);

          } else {
            // Bomb Base
            ctx.beginPath();
            ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#111111';
            ctx.fill();

            // Bomb Highlight
            ctx.beginPath();
            ctx.arc(-o.radius * 0.3, -o.radius * 0.3, o.radius * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fill();

            // Skull Logo
            ctx.beginPath();
            ctx.arc(0, -o.radius * 0.1, o.radius * 0.3, Math.PI, 0);
            ctx.lineTo(o.radius * 0.2, o.radius * 0.3);
            ctx.lineTo(-o.radius * 0.2, o.radius * 0.3);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            
            // Skull eyes & nose
            ctx.beginPath();
            ctx.arc(-o.radius * 0.12, -o.radius * 0.05, o.radius * 0.08, 0, Math.PI * 2);
            ctx.arc(o.radius * 0.12, -o.radius * 0.05, o.radius * 0.08, 0, Math.PI * 2);
            ctx.fillStyle = '#111111';
            ctx.fill();
            
            ctx.beginPath();
            ctx.moveTo(0, o.radius * 0.05);
            ctx.lineTo(o.radius * 0.05, o.radius * 0.15);
            ctx.lineTo(-o.radius * 0.05, o.radius * 0.15);
            ctx.fill();

            // Cap
            ctx.fillStyle = '#444';
            ctx.fillRect(-o.radius*0.2, -o.radius*1.05, o.radius*0.4, o.radius*0.15);

            // Fuse
            ctx.beginPath();
            ctx.moveTo(0, -o.radius*1.05);
            ctx.quadraticCurveTo(o.radius*0.6, -o.radius*1.3, o.radius*0.5, -o.radius*1.6);
            ctx.strokeStyle = '#d2691e';
            ctx.lineWidth = o.radius * 0.1;
            ctx.stroke();

            // Sparkle
            const sparkTime = Date.now() / 100;
            const sparkPulse = (Math.sin(sparkTime) + 1) / 2;
            ctx.beginPath();
            ctx.arc(o.radius * 0.5, -o.radius * 1.6, 5 + sparkPulse * 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ff4500';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(o.radius * 0.5, -o.radius * 1.6, 2 + sparkPulse * 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700';
            ctx.fill();
          }

          ctx.restore();
        }

        // Miss check
        if (state.status === 'playing' && o.y > H + o.radius + 50 && !o.cut) {
          if (o.type === 'ball') {
            state.misses++;
            setMisses(state.misses);
            if (state.misses >= 3) {
              triggerGameOver('You missed 3 tennis balls!');
            }
          }
          state.objects.splice(i, 1);
        }
      }

      requestRef.current = requestAnimationFrame(runFrame);
    };

    requestRef.current = requestAnimationFrame(runFrame);
    return () => {
      cancelAnimationFrame(requestRef.current!);
      resizeObserver.disconnect();
    };
  }, [triggerGameOver, triggerWin]);

  // Pointer Interaction
  const handlePointerDown = (e: React.PointerEvent) => {
    engineState.current.isDragging = true;
    engineState.current.trail = [{ x: e.clientX, y: e.clientY, age: 0 }];
    
    // Resume audio context if needed on first interaction
    if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
      audioEngine.ctx.resume();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!engineState.current.isDragging) return;
    
    const state = engineState.current;
    if (state.status !== 'playing') return;

    const newPoint = { x: e.clientX, y: e.clientY, age: 0 };
    const lastPoint = state.trail[state.trail.length - 1];
    
    if (lastPoint) {
      // Check intersections with all active objects
      for (let i = 0; i < state.objects.length; i++) {
        const obj = state.objects[i];
        if (obj.cut) continue;
        
        const distSq = distToSegmentSquared(obj, lastPoint, newPoint);
        if (distSq < obj.radius * obj.radius) {
          obj.cut = true;
          
          if (obj.type === 'bomb') {
            audioEngine.playExplosion();
            triggerGameOver('You sliced a bomb!');
          } else {
            audioEngine.playHit();
            state.score += 10;
            setScore(state.score);
            
            // Create halves particles
            state.particles.push({
              id: state.nextObjectId++,
              x: obj.x, y: obj.y,
              vx: obj.vx - 2, // Drift left
              vy: obj.vy,
              radius: obj.radius,
              rotation: obj.rotation,
              rotV: obj.rotV - 0.1,
              isTop: true
            });
            state.particles.push({
              id: state.nextObjectId++,
              x: obj.x, y: obj.y,
              vx: obj.vx + 2, // Drift right
              vy: obj.vy,
              radius: obj.radius,
              rotation: obj.rotation,
              rotV: obj.rotV + 0.1,
              isTop: false
            });
          }
        }
      }
    }
    
    // Add point and play slash sound if moving fast enough
    if (lastPoint) {
      const dist = Math.sqrt((newPoint.x - lastPoint.x)**2 + (newPoint.y - lastPoint.y)**2);
      if (dist > 30) {
        audioEngine.playSlash();
      }
    }
    
    state.trail.push(newPoint);
  };

  const handlePointerUp = () => {
    engineState.current.isDragging = false;
  };

  return (
    <div 
      className="relative w-full h-screen bg-stone-900 overflow-hidden touch-none select-none font-sans"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full cursor-crosshair" 
      />

      {/* In-Game UI Header */}
      {(gameState === 'playing' || gameState === 'paused') && (
        <div className="absolute top-0 left-0 w-full p-4 md:p-8 flex justify-between items-start pointer-events-none z-20">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <div 
                  key={i} 
                  className={`w-8 h-8 md:w-12 md:h-12 rounded-full border-2 transition-all ${
                    misses > i ? 'bg-red-500/80 border-red-400' : 'bg-[#CCFF00] border-white'
                  } flex items-center justify-center font-black text-xs md:text-sm text-black shadow-md`}
                >
                  {misses > i ? 'X' : 'T'}
                </div>
              ))}
            </div>
            <div className="text-white text-xl md:text-2xl font-black drop-shadow-md">
              Score: {score}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <div className="text-3xl md:text-5xl font-black text-white drop-shadow-lg">
              {timeLeft}s
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); togglePause(); }}
              className="mt-2 text-white bg-black/30 hover:bg-black/50 p-3 rounded-full backdrop-blur-sm pointer-events-auto transition-all"
            >
              {gameState === 'paused' ? <PlaySquare className="w-6 h-6 md:w-8 md:h-8" /> : <Pause className="w-6 h-6 md:w-8 md:h-8" />}
            </button>
          </div>
        </div>
      )}

      {/* Paused Screen */}
      {gameState === 'paused' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-6xl font-black text-white mb-8 drop-shadow-lg uppercase tracking-tight">Paused</h2>
            <button 
              onClick={(e) => { e.stopPropagation(); togglePause(); }}
              className="bg-[#CCFF00] text-black font-black text-xl px-10 py-4 rounded-full hover:scale-105 hover:bg-yellow-300 transition-all shadow-xl flex items-center gap-2 cursor-pointer"
            >
              <Play className="fill-black" />
              RESUME
            </button>
          </div>
        </div>
      )}

      {/* Start Screen Overlay */}
      {gameState === 'start' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 transition-opacity">
          <div className="bg-white/10 p-8 rounded-3xl border border-white/20 shadow-2xl backdrop-blur-md flex flex-col items-center max-w-sm text-center">
            <h1 className="text-5xl font-black text-[#CCFF00] mb-2 tracking-tight drop-shadow-lg">
              TENNIS NINJA
            </h1>
            <p className="text-white/90 text-lg mb-8">
              Learn the word <strong className="text-[#CCFF00] font-black tracking-widest text-xl">TENNIS</strong> by slicing through falling tennis balls! Avoid the bombs!
            </p>
            <div className="flex flex-col gap-4 text-left w-full mb-8 text-white/80">
              <div className="flex items-center gap-3"><Trophy className="w-5 h-5 text-yellow-400"/> Survive for 10 seconds</div>
              <div className="flex items-center gap-3"><Bomb className="w-5 h-5 text-red-500"/> Slicing a bomb = Game Over</div>
              <div className="flex items-center gap-3"><XCircle className="w-5 h-5 text-gray-400"/> Miss 3 tennis balls = Game Over</div>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); startGame(); }}
              className="bg-[#CCFF00] text-black font-black text-xl px-10 py-4 rounded-full hover:scale-105 hover:bg-yellow-300 transition-all shadow-xl shadow-[#CCFF00]/20 flex items-center gap-2 group cursor-pointer"
            >
              <Play className="fill-black group-hover:translate-x-1 transition-transform" />
              PLAY NOW
            </button>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-red-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-in fade-in duration-300">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-6xl font-black text-red-500 mb-4 drop-shadow-lg uppercase tracking-tight">Game Over</h2>
            <p className="text-3xl text-white font-bold mb-2">{endReason}</p>
            <p className="text-xl text-white/70 mb-8 font-medium">Final Score: {score}</p>
            <button 
              onClick={(e) => { e.stopPropagation(); startGame(); }}
              className="bg-white text-red-900 font-black text-xl px-8 py-4 rounded-full hover:scale-105 transition-all shadow-xl flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-6 h-6" />
              TRY AGAIN
            </button>
          </div>
        </div>
      )}

      {/* Victory Screen */}
      {gameState === 'win' && (
        <div className="absolute inset-0 bg-[#CCFF00]/90 backdrop-blur-md flex flex-col items-center justify-center z-10 animate-in fade-in duration-500">
          <div className="bg-black/90 p-10 rounded-3xl flex flex-col items-center text-center max-w-md shadow-2xl border-4 border-yellow-300">
            <Trophy className="w-24 h-24 text-yellow-400 mb-6 drop-shadow-md" />
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tight">SUCCESS!</h2>
            <p className="text-xl text-white/90 mb-2 leading-relaxed">
              You survived the 10 seconds and learned the word:
            </p>
            <p className="text-5xl font-black text-[#CCFF00] tracking-widest mb-8 drop-shadow-md">
              TENNIS
            </p>
            <p className="text-lg text-white/70 mb-8 font-medium">Final Score: {score}</p>
            <button 
              onClick={(e) => { e.stopPropagation(); startGame(); }}
              className="bg-[#CCFF00] text-black font-black text-xl px-8 py-4 rounded-full hover:scale-105 hover:bg-yellow-300 transition-all shadow-xl flex items-center gap-2 cursor-pointer"
            >
              <Play className="fill-black" />
              PLAY AGAIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
