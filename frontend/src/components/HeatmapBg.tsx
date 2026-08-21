import { useEffect, useRef } from 'react';

interface Cell {
  x: number;
  y: number;
  intensity: number;
  targetIntensity: number;
  hue: number;
}

const CELL_SIZE = 40;
const GAP = 2;
const STEP = CELL_SIZE + GAP;

export default function HeatmapBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellsRef = useRef<Cell[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    let cols: number, rows: number;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      cols = Math.ceil(canvas!.width / STEP) + 1;
      rows = Math.ceil(canvas!.height / STEP) + 1;

      const newCells: Cell[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          newCells.push({
            x: c * STEP,
            y: r * STEP,
            intensity: 0,
            targetIntensity: 0,
            hue: pickHue(),
          });
        }
      }
      cellsRef.current = newCells;
    }

    function pickHue(): number {
      const choices = [180, 160, 330, 270, 140]; // cyan, teal, pink, purple, lime
      return choices[Math.floor(Math.random() * choices.length)];
    }

    function sparkRandom() {
      const cells = cellsRef.current;
      if (cells.length === 0) return;

      // Spark 2-5 random cells
      const count = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * cells.length);
        cells[idx].targetIntensity = 0.15 + Math.random() * 0.35;
        cells[idx].hue = pickHue();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      const cells = cellsRef.current;

      for (const cell of cells) {
        // Lerp intensity toward target
        cell.intensity += (cell.targetIntensity - cell.intensity) * 0.04;

        // Decay target
        cell.targetIntensity *= 0.992;

        if (cell.intensity < 0.01) continue;

        const alpha = cell.intensity;
        const sat = 80 + alpha * 20;
        const light = 50 + alpha * 15;

        ctx.fillStyle = `hsla(${cell.hue}, ${sat}%, ${light}%, ${alpha * 0.5})`;
        ctx.shadowColor = `hsla(${cell.hue}, 100%, 60%, ${alpha * 0.6})`;
        ctx.shadowBlur = 12 * alpha;

        ctx.beginPath();
        ctx.roundRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE, 4);
        ctx.fill();

        ctx.shadowBlur = 0;
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);

    // Spark interval
    const sparkInterval = setInterval(sparkRandom, 300);

    // Initial burst
    for (let i = 0; i < 15; i++) sparkRandom();

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      clearInterval(sparkInterval);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: 0.4,
      }}
    />
  );
}
