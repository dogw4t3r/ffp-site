import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'

export default function EngineChessApp({ wasmUrl = '/wasm/ffp.js' }) {
  const [chess] = useState(() => new Chess());
  const [selected, setSelected] = useState(null);
  const [log, setLog] = useState('');
  const [depth, setDepth] = useState(6);
  const [engineSide, setEngineSide] = useState('b');
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState(null);
  const [thinking, setThinking] = useState(false);
  const workerRef = useRef(null);

  useEffect(() => {
    setEngineReady(false);
    setEngineError(null);
    const worker = new Worker(new URL("../workers/engineWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, line, output, error } = e.data || {}
      if (type === "ready") {
        setEngineReady(true);
        setEngineError(null);
      }
      if (type === 'print') setLog((s) => s + line + '\n');
      if (type === 'done') {
        setThinking(false);
        setLog((s) => s + '\n[engine finished]\n');
        if (output) {
          const best = parseBestMove(output);
          if (best) applyEngineMove(best);
        }
      }
      if (type === 'fatal') {
        setThinking(false);
        setEngineReady(false);
        setEngineError(error || "Engine failed to load");
        setLog((s) => s + '\n[FATAL] ' + error + '\n')
      }
    };

    worker.onerror = (event) => {
      setThinking(false);
      setEngineReady(false);
      setEngineError(event.message || "Engine worker error");
      setLog((s) => s + `\n[worker-error] ${event.message || event.type}\n`);
    };

    worker.onmessageerror = () => {
      setThinking(false);
      setEngineReady(false);
      setEngineError("Engine worker could not deserialize message");
      setLog((s) => s + "\n[worker-error] Failed to deserialize message\n");
    };

    const scriptUrl = new URL(wasmUrl, window.location.origin);
    const wasmBinaryUrl = new URL(scriptUrl);
    wasmBinaryUrl.pathname = wasmBinaryUrl.pathname.replace(/\.js$/, '.wasm');
    worker.postMessage({
      type: 'init',
      scriptUrl: scriptUrl.toString(),
      wasmBinaryUrl: wasmBinaryUrl.toString(),
    });

    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, [wasmUrl]);

  const boardRows = useMemo(() => chess.board(), [chess, chess.fen()]);
  const turn = chess.turn();
  const engineStatus = engineError ? "error" : engineReady ? "ready" : "loading…";

  function colorOf(piece) {
    return piece?.color;
  }

  function uciFromSANorUci(str) {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(str)) return str;
    return null;
  }

  function parseBestMove(all) {
    const m = all.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function coordToUci(fromSq, toSq, promo) {
    return `${'' + fromSq}${'' + toSq}${promo ?? ''}`;
  }

  function applyEngineMove(uci) {
    try {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promo = uci[4];
      const moveObj = { from, to };
      if (promo) moveObj.promotion = promo;
      const mv = chess.move(moveObj);
      if (!mv) {
        setLog(
          (s) => s + `[warn] Engine move illegal in current position: ${uci}\n`,
        );
        return;
      }
      forceRerender();
    } catch (e) {
      setLog((s) => s + `[error] Failed to apply engine move: ${String(e)}\n`);
    }
  }

  const [, setTick] = useState(0);
  const forceRerender = () => setTick((n) => n + 1);

  function requestEngineMove() {
    if (!engineReady || thinking) return;
    setThinking(true);
    setLog('');
    const fen = chess.fen();
    const args = ['--fen', fen, '--search', String(depth)];
    workerRef.current?.postMessage({ type: 'run', args });
  }

  useEffect(() => {
    const sideToMove = chess.turn();
    if (engineReady && sideToMove === engineSide && !thinking) {
      requestEngineMove();
    }
  }, [chess.fen(), engineReady, engineSide]);

  function onSquareClick(file, rank) {
    const sq = toSquare(file, rank);
    const piece = chess.get(sq);

    if (selected) {
      // Try move
      const from = selected;
      const to = sq;
      const legalMoves = chess.moves({ square: from, verbose: true }) || [];
      const match = legalMoves.find((m) => m.to === to);
      if (match) {
        const promotion = match.promotion || (match.flags.includes('p') && 'q');
        try {
          chess.move({ from, to, promotion });
          setSelected(null);
          forceRerender();
          return;
        } catch {}
      }
      setSelected(piece ? sq : null)
    } else {
      const humanSide = engineSide === 'w' ? 'b' : 'w'
      if (piece && piece.color === humanSide && chess.turn() === humanSide) {
        setSelected(sq)
      }
    }
  }

  function reset(startFen) {
    chess.reset()
    if (startFen) chess.load(startFen)
    setSelected(null)
    setLog('')
    setThinking(false)
    forceRerender()
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-3">Play vs FFP</h1>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Board */}
        <div>
          <Board
            board={boardRows}
            perspective={engineSide === 'w' ? 'black' : 'white'}
            selected={selected}
            onSquareClick={onSquareClick}
          />
          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm">Depth</label>
            <input
              type="range"
              min={1}
              max={20}
              value={depth}
              onChange={(e) => setDepth(parseInt(e.target.value))}
            />
            <div className="text-sm w-10 text-center">{depth}</div>
            <button
              className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-50"
              disabled={!engineReady || thinking || chess.turn() !== engineSide}
              onClick={requestEngineMove}
              title={engineReady ? 'Engine move' : 'Engine loading…'}
            >
              {thinking ? 'Thinking…' : 'Engine Move'}
            </button>
            <button
              className="px-3 py-1 rounded bg-slate-700 text-white"
              onClick={() => reset()}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Side panel */}
        <div className="flex-1">
          <div className="mb-2 text-sm text-slate-600">
            Engine: <b className={engineError ? "text-red-500" : engineReady ? "text-green-600" : ""}>{engineStatus}</b> | Side: {engineSide === "w" ? "Engine = White" : "Engine = Black"}
          </div>
          {engineError && (
            <div className="mb-2 text-xs text-red-500">
              {engineError}
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm">Engine side</label>
            <select
              className="border rounded px-2 py-1"
              value={engineSide}
              onChange={(e) => setEngineSide(e.target.value)}
            >
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </div>
          <div className="mb-2 text-sm">FEN</div>
          <textarea
            className="w-full h-24 border rounded p-2 font-mono text-sm"
            value={chess.fen()}
            onChange={(e) => {
              try {
                chess.load(e.target.value)
                forceRerender()
              } catch {}
            }}
          />

          <div className="mt-4">
            <div className="mb-2 text-sm">Engine output</div>
            <pre className="h-64 overflow-auto border rounded p-2 bg-black text-green-300 text-xs whitespace-pre-wrap">
              {log}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function Board({ board, perspective = 'white', selected, onSquareClick }) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1]
  const orientedFiles = perspective === 'white' ? files : [...files].reverse()
  const orientedRanks = perspective === 'white' ? ranks : [...ranks].reverse()

  return (
    <div className="grid grid-cols-8 border border-slate-400 rounded overflow-hidden select-none">
      {orientedRanks.map((r) =>
        orientedFiles.map((f, i) => {
          const sq = `${f}${r}`
          const piece = board[8 - r][files.indexOf(f)]
          const dark = (files.indexOf(f) + r) % 2 === 1
          const isSel = selected === sq
          return (
            <div
              key={sq}
              onClick={() => onSquareClick(f, r)}
              className={`${dark ? 'bg-emerald-900' : 'bg-emerald-200'} aspect-square flex items-center justify-center text-3xl cursor-pointer relative`}
            >
              {isSel && (
                <div className="absolute inset-0 ring-4 ring-yellow-400" />
              )}
              <Piece piece={piece} />
              <div className="absolute bottom-1 right-1 text-[10px] opacity-40">
                {sq}
              </div>
            </div>
          )
        }),
      )}
    </div>
  )
}

function Piece({ piece }) {
  if (!piece) return null
  const map = {
    p: '♟',
    r: '♜',
    n: '♞',
    b: '♝',
    q: '♛',
    k: '♚',
    P: '♙',
    R: '♖',
    N: '♘',
    B: '♗',
    Q: '♕',
    K: '♔',
  }
  const code =
    map[
      piece.type === 'p'
        ? piece.color === 'w'
          ? 'P'
          : 'p'
        : piece.type.toLowerCase() === piece.type
          ? piece.color === 'w'
            ? piece.type.toUpperCase()
            : piece.type
          : piece.type
    ]
  // Simpler: rely on chess.js piece.type and piece.color
  const glyph =
    piece.color === 'w'
      ? { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' }[piece.type]
      : { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }[piece.type]
  return <span>{glyph}</span>
}

function toSquare(file, rank) {
  return `${file}${rank}`
}
