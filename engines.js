(function initTavernEngines(global) {
  'use strict';

  const USER = 1;
  const OPPONENT = -1;
  const MATE = 1_000_000;
  const FILES = 'ABCDEFGHI';

  const countPieces = (board, player) => board.reduce((sum, piece) => sum + (Math.sign(piece) === player ? 1 : 0), 0);
  const sign = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);
  const samePath = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
  }

  function coordGrid(index, width, height) {
    const row = Math.floor(index / width);
    const col = index % width;
    return `${FILES[col]}${height - row}`;
  }

  function makeMoveId(move) {
    const path = (move.path || []).join('.');
    const captures = (move.captured || []).join('.');
    const modes = (move.modes || []).join('');
    return `${move.kind || 'move'}:${path}:${captures}:${modes}`;
  }

  // ---------------------------------------------------------------------------
  // Nine Men's Morris
  // ---------------------------------------------------------------------------

  const MORRIS_POINTS = [
    [0, 0], [3, 0], [6, 0],
    [1, 1], [3, 1], [5, 1],
    [2, 2], [3, 2], [4, 2],
    [0, 3], [1, 3], [2, 3], [4, 3], [5, 3], [6, 3],
    [2, 4], [3, 4], [4, 4],
    [1, 5], [3, 5], [5, 5],
    [0, 6], [3, 6], [6, 6],
  ];

  const MORRIS_EDGES = [
    [0, 1], [0, 9], [1, 2], [1, 4], [2, 14],
    [3, 4], [3, 10], [4, 5], [4, 7], [5, 13],
    [6, 7], [6, 11], [7, 8], [8, 12],
    [9, 10], [9, 21], [10, 11], [10, 18], [11, 15],
    [12, 13], [12, 17], [13, 14], [13, 20], [14, 23],
    [15, 16], [16, 17], [16, 19],
    [18, 19], [19, 20], [19, 22],
    [21, 22], [22, 23],
  ];

  const MORRIS_ADJ = Array.from({ length: 24 }, () => []);
  for (const [a, b] of MORRIS_EDGES) {
    MORRIS_ADJ[a].push(b);
    MORRIS_ADJ[b].push(a);
  }

  const MORRIS_MILLS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11],
    [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
    [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7],
    [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
  ];

  const MORRIS_MILLS_AT = Array.from({ length: 24 }, () => []);
  MORRIS_MILLS.forEach((mill, index) => mill.forEach((point) => MORRIS_MILLS_AT[point].push(index)));

  function morrisReserve(state, player) {
    return player === USER ? state.reserveUser : state.reserveOpponent;
  }

  function morrisIsMill(board, point, player) {
    return MORRIS_MILLS_AT[point].some((millIndex) => MORRIS_MILLS[millIndex].every((cell) => board[cell] === player));
  }

  function morrisCaptureTargets(board, opponent) {
    const all = [];
    const outsideMills = [];
    for (let i = 0; i < board.length; i += 1) {
      if (board[i] !== opponent) continue;
      all.push(i);
      if (!morrisIsMill(board, i, opponent)) outsideMills.push(i);
    }
    return outsideMills.length ? outsideMills : all;
  }

  function morrisMoves(state, player = state.turn) {
    const board = state.board;
    const moves = [];
    const reserve = morrisReserve(state, player);
    const ownCount = countPieces(board, player);

    if (reserve > 0) {
      for (let to = 0; to < 24; to += 1) {
        if (board[to] !== 0) continue;
        const nextBoard = board.slice();
        nextBoard[to] = player;
        if (morrisIsMill(nextBoard, to, player)) {
          const targets = morrisCaptureTargets(nextBoard, -player);
          if (targets.length) {
            for (const capture of targets) {
              const move = { kind: 'place', path: [to], captured: [capture], gain: 1 };
              move.id = makeMoveId(move);
              moves.push(move);
            }
            continue;
          }
        }
        const move = { kind: 'place', path: [to], captured: [], gain: 0 };
        move.id = makeMoveId(move);
        moves.push(move);
      }
      return moves;
    }

    if (ownCount < 3) return moves;
    const flying = ownCount === 3;
    for (let from = 0; from < 24; from += 1) {
      if (board[from] !== player) continue;
      const destinations = flying
        ? board.map((piece, index) => (piece === 0 ? index : -1)).filter((index) => index >= 0)
        : MORRIS_ADJ[from].filter((to) => board[to] === 0);

      for (const to of destinations) {
        const nextBoard = board.slice();
        nextBoard[from] = 0;
        nextBoard[to] = player;
        if (morrisIsMill(nextBoard, to, player)) {
          const targets = morrisCaptureTargets(nextBoard, -player);
          if (targets.length) {
            for (const capture of targets) {
              const move = { kind: flying ? 'fly' : 'slide', path: [from, to], captured: [capture], gain: 1 };
              move.id = makeMoveId(move);
              moves.push(move);
            }
            continue;
          }
        }
        const move = { kind: flying ? 'fly' : 'slide', path: [from, to], captured: [], gain: 0 };
        move.id = makeMoveId(move);
        moves.push(move);
      }
    }
    return moves;
  }

  function morrisHasMove(state, player = state.turn) {
    if (morrisReserve(state, player) > 0) return state.board.some((piece) => piece === 0);
    const ownCount = countPieces(state.board, player);
    if (ownCount < 3) return false;
    if (ownCount === 3) return state.board.some((piece) => piece === 0);
    return state.board.some((piece, from) => (
      piece === player && MORRIS_ADJ[from].some((to) => state.board[to] === 0)
    ));
  }

  function morrisApply(state, move) {
    const player = state.turn;
    const next = {
      board: state.board.slice(),
      reserveUser: state.reserveUser,
      reserveOpponent: state.reserveOpponent,
      turn: -player,
      quiet: move.captured.length ? 0 : state.quiet + 1,
      ply: state.ply + 1,
    };
    if (move.kind === 'place') {
      next.board[move.path[0]] = player;
      if (player === USER) next.reserveUser -= 1;
      else next.reserveOpponent -= 1;
    } else {
      next.board[move.path[0]] = 0;
      next.board[move.path[1]] = player;
    }
    for (const capture of move.captured) next.board[capture] = 0;
    return next;
  }

  function morrisResult(state, skipMobility = false) {
    for (const player of [USER, OPPONENT]) {
      if (morrisReserve(state, player) === 0 && countPieces(state.board, player) < 3) {
        return { winner: -player, reason: 'pieces' };
      }
    }
    if (!skipMobility && !morrisHasMove(state, state.turn)) {
      return { winner: -state.turn, reason: 'blocked' };
    }
    return null;
  }

  function morrisEvaluate(state, perspective) {
    const board = state.board;
    const opponent = -perspective;
    const ownTotal = countPieces(board, perspective) + morrisReserve(state, perspective);
    const enemyTotal = countPieces(board, opponent) + morrisReserve(state, opponent);
    let score = (ownTotal - enemyTotal) * 135;

    for (let point = 0; point < 24; point += 1) {
      if (board[point] === perspective) score += (MORRIS_ADJ[point].length - 2) * 5;
      if (board[point] === opponent) score -= (MORRIS_ADJ[point].length - 2) * 5;
    }

    for (const mill of MORRIS_MILLS) {
      let own = 0;
      let enemy = 0;
      let empty = 0;
      for (const point of mill) {
        if (board[point] === perspective) own += 1;
        else if (board[point] === opponent) enemy += 1;
        else empty += 1;
      }
      if (own === 3) score += 38;
      else if (own === 2 && empty === 1) score += 24;
      else if (own === 1 && empty === 2) score += 4;
      if (enemy === 3) score -= 38;
      else if (enemy === 2 && empty === 1) score -= 26;
      else if (enemy === 1 && empty === 2) score -= 4;
    }

    if (morrisReserve(state, perspective) === 0) {
      const ownCount = countPieces(board, perspective);
      if (ownCount > 3) score += morrisMoves({ ...state, turn: perspective }, perspective).length * 2;
    }
    if (morrisReserve(state, opponent) === 0) {
      const enemyCount = countPieces(board, opponent);
      if (enemyCount > 3) score -= morrisMoves({ ...state, turn: opponent }, opponent).length * 2;
    }
    return score;
  }

  function morrisCoord(index) {
    const [x, y] = MORRIS_POINTS[index];
    return `${FILES[x]}${7 - y}`;
  }

  function morrisNotation(move) {
    const captureText = move.captured.length ? ` · ${morrisCoord(move.captured[0])} nehmen` : '';
    if (move.kind === 'place') return `${morrisCoord(move.path[0])} setzen${captureText}`;
    const verb = move.kind === 'fly' ? 'springen' : 'ziehen';
    return `${morrisCoord(move.path[0])} → ${morrisCoord(move.path[1])} ${verb}${captureText}`;
  }

  const Morris = {
    id: 'morris',
    title: 'Mühle',
    geometry: { points: MORRIS_POINTS, edges: MORRIS_EDGES, width: 7, height: 7 },
    initial(starter = USER) {
      return {
        board: Array(24).fill(0),
        reserveUser: 9,
        reserveOpponent: 9,
        turn: starter,
        quiet: 0,
        ply: 0,
      };
    },
    moves: morrisMoves,
    hasMove: morrisHasMove,
    apply: morrisApply,
    result: morrisResult,
    evaluate: morrisEvaluate,
    notation: morrisNotation,
    coord: morrisCoord,
    inputSequence(move) { return move.path.concat(move.captured); },
    key(state) {
      return `m|${state.turn}|${state.reserveUser},${state.reserveOpponent}|${state.board.map((v) => v + 1).join('')}`;
    },
    repetitionKey(state) {
      return `mr|${state.turn}|${state.reserveUser},${state.reserveOpponent}|${state.board.map((v) => v + 1).join('')}`;
    },
    moveScore(state, move) {
      const destination = move.path[move.kind === 'place' ? 0 : 1];
      return move.gain * 1000 + MORRIS_ADJ[destination].length * 9;
    },
    counts(state) {
      return {
        user: countPieces(state.board, USER),
        opponent: countPieces(state.board, OPPONENT),
        reserveUser: state.reserveUser,
        reserveOpponent: state.reserveOpponent,
      };
    },
    explain(state, move) {
      if (move.captured.length) return 'Schließt eine Mühle und entfernt direkt einen gegnerischen Stein.';
      const destination = move.path[move.path.length - 1];
      const openLines = MORRIS_MILLS_AT[destination].filter((millIndex) => {
        const line = MORRIS_MILLS[millIndex];
        const board = morrisApply(state, move).board;
        return line.filter((point) => board[point] === state.turn).length === 2 && line.some((point) => board[point] === 0);
      }).length;
      if (openLines >= 2) return 'Baut eine Doppeldrohung über zwei mögliche Mühlen auf.';
      if (move.kind === 'place') return 'Besetzt einen gut angebundenen Punkt und verbessert die nächsten Setzzüge.';
      return 'Hält die Stellung beweglich und begrenzt gegnerische Mühlenchancen.';
    },
  };

  // ---------------------------------------------------------------------------
  // English draughts / American checkers
  // ---------------------------------------------------------------------------

  const CHECKER_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function checkerIndex(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : -1;
  }

  function checkerDirs(piece, player) {
    if (Math.abs(piece) === 2) return CHECKER_DIRS;
    const forward = player === USER ? -1 : 1;
    return [[forward, -1], [forward, 1]];
  }

  function checkerCaptureMoves(state, player) {
    const output = [];
    const board = state.board;

    function explore(currentBoard, start, current, piece, path, captured) {
      const row = Math.floor(current / 8);
      const col = current % 8;
      let extended = false;
      for (const [dr, dc] of checkerDirs(piece, player)) {
        const middle = checkerIndex(row + dr, col + dc);
        const landing = checkerIndex(row + dr * 2, col + dc * 2);
        if (middle < 0 || landing < 0 || sign(currentBoard[middle]) !== -player || currentBoard[landing] !== 0) continue;
        extended = true;
        const nextBoard = currentBoard.slice();
        nextBoard[current] = 0;
        nextBoard[middle] = 0;
        nextBoard[landing] = piece;
        const nextPath = path.concat(landing);
        const nextCaptured = captured.concat(middle);
        const landingRow = Math.floor(landing / 8);
        const crowned = Math.abs(piece) === 1 && ((player === USER && landingRow === 0) || (player === OPPONENT && landingRow === 7));

        if (crowned) {
          const move = { kind: 'capture', path: nextPath, captured: nextCaptured, gain: nextCaptured.length, promotes: true };
          move.id = makeMoveId(move);
          output.push(move);
        } else {
          explore(nextBoard, start, landing, piece, nextPath, nextCaptured);
        }
      }
      if (!extended && captured.length) {
        const move = { kind: 'capture', path, captured, gain: captured.length, promotes: false };
        move.id = makeMoveId(move);
        output.push(move);
      }
    }

    for (let start = 0; start < 64; start += 1) {
      const piece = board[start];
      if (sign(piece) !== player) continue;
      explore(board, start, start, piece, [start], []);
    }
    return output;
  }

  function checkerMoves(state, player = state.turn) {
    const captures = checkerCaptureMoves(state, player);
    if (captures.length) return captures;
    const moves = [];
    for (let from = 0; from < 64; from += 1) {
      const piece = state.board[from];
      if (sign(piece) !== player) continue;
      const row = Math.floor(from / 8);
      const col = from % 8;
      for (const [dr, dc] of checkerDirs(piece, player)) {
        const to = checkerIndex(row + dr, col + dc);
        if (to < 0 || state.board[to] !== 0) continue;
        const toRow = Math.floor(to / 8);
        const promotes = Math.abs(piece) === 1 && ((player === USER && toRow === 0) || (player === OPPONENT && toRow === 7));
        const move = { kind: 'step', path: [from, to], captured: [], gain: 0, promotes };
        move.id = makeMoveId(move);
        moves.push(move);
      }
    }
    return moves;
  }

  function checkerHasMove(state, player = state.turn) {
    let hasStep = false;
    for (let from = 0; from < 64; from += 1) {
      const piece = state.board[from];
      if (sign(piece) !== player) continue;
      const row = Math.floor(from / 8);
      const col = from % 8;
      for (const [dr, dc] of checkerDirs(piece, player)) {
        const to = checkerIndex(row + dr, col + dc);
        if (to >= 0 && state.board[to] === 0) hasStep = true;
        const middle = to;
        const landing = checkerIndex(row + dr * 2, col + dc * 2);
        if (middle >= 0 && landing >= 0 && sign(state.board[middle]) === -player && state.board[landing] === 0) return true;
      }
    }
    return hasStep;
  }

  function checkerApply(state, move) {
    const player = state.turn;
    const board = state.board.slice();
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    let piece = board[from];
    board[from] = 0;
    for (const capture of move.captured) board[capture] = 0;
    const row = Math.floor(to / 8);
    if (Math.abs(piece) === 1 && ((player === USER && row === 0) || (player === OPPONENT && row === 7))) {
      piece = player * 2;
    }
    board[to] = piece;
    return {
      board,
      turn: -player,
      quiet: move.captured.length || Math.abs(state.board[from]) === 1 ? 0 : state.quiet + 1,
      ply: state.ply + 1,
    };
  }

  function checkerResult(state, skipMobility = false) {
    if (countPieces(state.board, USER) === 0) return { winner: OPPONENT, reason: 'pieces' };
    if (countPieces(state.board, OPPONENT) === 0) return { winner: USER, reason: 'pieces' };
    if (!skipMobility && !checkerHasMove(state, state.turn)) return { winner: -state.turn, reason: 'blocked' };
    return null;
  }

  function checkerEvaluate(state, perspective) {
    let score = 0;
    for (let index = 0; index < 64; index += 1) {
      const piece = state.board[index];
      if (!piece) continue;
      const owner = sign(piece);
      const factor = owner === perspective ? 1 : -1;
      const row = Math.floor(index / 8);
      const col = index % 8;
      if (Math.abs(piece) === 2) score += factor * 176;
      else {
        const advance = owner === USER ? 7 - row : row;
        score += factor * (100 + advance * 5);
        const homeRow = owner === USER ? 7 : 0;
        if (row === homeRow) score += factor * 7;
      }
      if (row >= 2 && row <= 5 && col >= 2 && col <= 5) score += factor * 5;
      if (col === 0 || col === 7) score += factor * 3;
    }
    const ownCaptures = checkerCaptureMoves({ ...state, turn: perspective }, perspective);
    const enemyCaptures = checkerCaptureMoves({ ...state, turn: -perspective }, -perspective);
    score += (ownCaptures.length - enemyCaptures.length) * 4;
    return score;
  }

  function checkerNotation(move) {
    const separator = move.captured.length ? ' × ' : ' → ';
    const path = move.path.map((index) => coordGrid(index, 8, 8)).join(separator);
    return `${path}${move.promotes ? ' · Dame' : ''}`;
  }

  const Checkers = {
    id: 'checkers',
    title: 'Dame',
    geometry: { width: 8, height: 8 },
    initial(starter = USER) {
      const board = Array(64).fill(0);
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row * 8 + col] = OPPONENT;
      }
      for (let row = 5; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row * 8 + col] = USER;
      }
      return { board, turn: starter, quiet: 0, ply: 0 };
    },
    moves: checkerMoves,
    hasMove: checkerHasMove,
    apply: checkerApply,
    result: checkerResult,
    evaluate: checkerEvaluate,
    notation: checkerNotation,
    coord(index) { return coordGrid(index, 8, 8); },
    inputSequence(move) { return move.path; },
    key(state) { return `c|${state.turn}|${state.quiet}|${state.board.map((v) => v + 2).join('')}`; },
    repetitionKey(state) { return `cr|${state.turn}|${state.board.map((v) => v + 2).join('')}`; },
    searchDraw(state) { return state.quiet >= 80; },
    moveScore(state, move) {
      const destination = move.path[move.path.length - 1];
      const row = Math.floor(destination / 8);
      const col = destination % 8;
      return move.gain * 1000 + (move.promotes ? 500 : 0) + (row >= 2 && row <= 5 && col >= 2 && col <= 5 ? 12 : 0);
    },
    counts(state) {
      return { user: countPieces(state.board, USER), opponent: countPieces(state.board, OPPONENT) };
    },
    explain(state, move) {
      if (move.captured.length > 1) return `Nutzt den Pflichtschlag für eine Kette mit ${move.captured.length} geschlagenen Steinen.`;
      if (move.captured.length) return 'Erfüllt den Schlagzwang und verbessert dabei die Anschlussstellung.';
      if (move.promotes) return 'Erreicht die Grundreihe und wird zur beweglicheren Dame.';
      const destination = move.path[move.path.length - 1];
      const row = Math.floor(destination / 8);
      const col = destination % 8;
      if (row >= 2 && row <= 5 && col >= 2 && col <= 5) return 'Stärkt das Zentrum und hält mehrere diagonale Antworten offen.';
      return 'Vermeidet unmittelbare Tauschverluste und verbessert die Figurenstruktur.';
    },
  };

  // ---------------------------------------------------------------------------
  // Fanorona
  // ---------------------------------------------------------------------------

  const FAN_DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  function fanIndex(row, col) {
    return row >= 0 && row < 5 && col >= 0 && col < 9 ? row * 9 + col : -1;
  }

  function fanCanDiagonal(row, col) {
    return (row + col) % 2 === 0;
  }

  function fanDestination(from, dr, dc) {
    const row = Math.floor(from / 9);
    const col = from % 9;
    if (dr !== 0 && dc !== 0 && !fanCanDiagonal(row, col)) return -1;
    return fanIndex(row + dr, col + dc);
  }

  function fanScan(board, startRow, startCol, dr, dc, opponent) {
    const captured = [];
    let row = startRow;
    let col = startCol;
    while (true) {
      const index = fanIndex(row, col);
      if (index < 0 || board[index] !== opponent) break;
      captured.push(index);
      row += dr;
      col += dc;
    }
    return captured;
  }

  function fanCaptureSteps(board, from, player, visited, lastDirection) {
    const steps = [];
    const fromRow = Math.floor(from / 9);
    const fromCol = from % 9;
    for (const [dr, dc] of FAN_DIRS) {
      if (lastDirection && lastDirection[0] === dr && lastDirection[1] === dc) continue;
      const to = fanDestination(from, dr, dc);
      if (to < 0 || board[to] !== 0 || (visited && visited.has(to))) continue;
      const toRow = Math.floor(to / 9);
      const toCol = to % 9;
      const approach = fanScan(board, toRow + dr, toCol + dc, dr, dc, -player);
      const withdrawal = fanScan(board, fromRow - dr, fromCol - dc, -dr, -dc, -player);
      if (approach.length) steps.push({ to, mode: 'A', captured: approach, direction: [dr, dc] });
      if (withdrawal.length) steps.push({ to, mode: 'W', captured: withdrawal, direction: [dr, dc] });
    }
    return steps;
  }

  function fanCaptureMoves(state, player) {
    const output = [];

    function explore(board, current, path, modes, stepCaptures, captured, visited, lastDirection) {
      if (captured.length) {
        const move = {
          kind: 'capture',
          path: path.slice(),
          modes: modes.slice(),
          stepCaptures: stepCaptures.map((step) => step.slice()),
          captured: captured.slice(),
          gain: captured.length,
        };
        move.id = makeMoveId(move);
        output.push(move); // Fanorona chains may be stopped after every capture.
      }

      const steps = fanCaptureSteps(board, current, player, visited, lastDirection);
      for (const step of steps) {
        const nextBoard = board.slice();
        nextBoard[current] = 0;
        nextBoard[step.to] = player;
        for (const capture of step.captured) nextBoard[capture] = 0;
        const nextVisited = new Set(visited);
        nextVisited.add(step.to);
        explore(
          nextBoard,
          step.to,
          path.concat(step.to),
          modes.concat(step.mode),
          stepCaptures.concat([step.captured]),
          captured.concat(step.captured),
          nextVisited,
          step.direction,
        );
      }
    }

    for (let from = 0; from < 45; from += 1) {
      if (state.board[from] !== player) continue;
      const steps = fanCaptureSteps(state.board, from, player, new Set([from]), null);
      for (const step of steps) {
        const board = state.board.slice();
        board[from] = 0;
        board[step.to] = player;
        for (const capture of step.captured) board[capture] = 0;
        explore(
          board,
          step.to,
          [from, step.to],
          [step.mode],
          [step.captured],
          step.captured.slice(),
          new Set([from, step.to]),
          step.direction,
        );
      }
    }
    return output;
  }

  function fanMoves(state, player = state.turn) {
    const captures = fanCaptureMoves(state, player);
    if (captures.length) return captures;
    const moves = [];
    for (let from = 0; from < 45; from += 1) {
      if (state.board[from] !== player) continue;
      for (const [dr, dc] of FAN_DIRS) {
        const to = fanDestination(from, dr, dc);
        if (to < 0 || state.board[to] !== 0) continue;
        const move = { kind: 'paika', path: [from, to], modes: [], stepCaptures: [], captured: [], gain: 0 };
        move.id = makeMoveId(move);
        moves.push(move);
      }
    }
    return moves;
  }

  function fanHasMove(state, player = state.turn) {
    for (let from = 0; from < 45; from += 1) {
      if (state.board[from] !== player) continue;
      for (const [dr, dc] of FAN_DIRS) {
        const to = fanDestination(from, dr, dc);
        if (to >= 0 && state.board[to] === 0) return true;
      }
    }
    return false;
  }

  function fanApply(state, move) {
    const player = state.turn;
    const board = state.board.slice();
    board[move.path[0]] = 0;
    for (const capture of move.captured) board[capture] = 0;
    board[move.path[move.path.length - 1]] = player;
    return {
      board,
      turn: -player,
      quiet: move.captured.length ? 0 : state.quiet + 1,
      ply: state.ply + 1,
    };
  }

  function fanResult(state, skipMobility = false) {
    if (countPieces(state.board, USER) === 0) return { winner: OPPONENT, reason: 'pieces' };
    if (countPieces(state.board, OPPONENT) === 0) return { winner: USER, reason: 'pieces' };
    if (!skipMobility && !fanHasMove(state, state.turn)) return { winner: -state.turn, reason: 'blocked' };
    return null;
  }

  function fanImmediatePotential(state, player) {
    let total = 0;
    let largest = 0;
    for (let index = 0; index < 45; index += 1) {
      if (state.board[index] !== player) continue;
      for (const step of fanCaptureSteps(state.board, index, player, new Set([index]), null)) {
        total += step.captured.length;
        largest = Math.max(largest, step.captured.length);
      }
    }
    return { total, largest };
  }

  function fanEvaluate(state, perspective) {
    const opponent = -perspective;
    const ownCount = countPieces(state.board, perspective);
    const enemyCount = countPieces(state.board, opponent);
    let score = (ownCount - enemyCount) * (ownCount + enemyCount < 10 ? 1500 : 1000);
    let ownMobility = 0;
    let enemyMobility = 0;

    for (let index = 0; index < 45; index += 1) {
      const piece = state.board[index];
      if (!piece) continue;
      const row = Math.floor(index / 9);
      const col = index % 9;
      const center = 6 - Math.abs(row - 2) - Math.abs(col - 4) * 0.45;
      const strongPoint = fanCanDiagonal(row, col) ? 1 : 0;
      const factor = piece === perspective ? 1 : -1;
      score += factor * (center * 10 + strongPoint * 7);
      for (const [dr, dc] of FAN_DIRS) {
        const to = fanDestination(index, dr, dc);
        if (to >= 0 && state.board[to] === 0) {
          if (piece === perspective) ownMobility += 1;
          else enemyMobility += 1;
        }
      }
    }
    score += (ownMobility - enemyMobility) * 6;
    const ownPotential = fanImmediatePotential(state, perspective);
    const enemyPotential = fanImmediatePotential(state, opponent);
    score += (ownPotential.total - enemyPotential.total) * 25;
    score += (ownPotential.largest - enemyPotential.largest) * 35;
    if (state.turn === perspective) score += ownPotential.largest * 15;
    else score -= enemyPotential.largest * 15;
    return score;
  }

  function fanNotation(move) {
    const parts = [];
    for (let i = 1; i < move.path.length; i += 1) {
      const mode = move.modes[i - 1] === 'A' ? 'A' : move.modes[i - 1] === 'W' ? 'R' : '';
      parts.push(`${coordGrid(move.path[i - 1], 9, 5)}→${coordGrid(move.path[i], 9, 5)}${mode ? ` (${mode})` : ''}`);
    }
    return parts.join(' · ');
  }

  const FAN_EDGES = [];
  for (let index = 0; index < 45; index += 1) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const to = fanDestination(index, dr, dc);
      if (to >= 0) FAN_EDGES.push([index, to]);
    }
  }

  const Fanorona = {
    id: 'fanorona',
    title: 'Fanorona',
    geometry: { width: 9, height: 5, edges: FAN_EDGES },
    initial(starter = USER) {
      const board = Array(45).fill(0);
      for (let row = 0; row < 2; row += 1) for (let col = 0; col < 9; col += 1) board[row * 9 + col] = OPPONENT;
      const middle = [OPPONENT, USER, OPPONENT, USER, 0, OPPONENT, USER, OPPONENT, USER];
      for (let col = 0; col < 9; col += 1) board[18 + col] = middle[col];
      for (let row = 3; row < 5; row += 1) for (let col = 0; col < 9; col += 1) board[row * 9 + col] = USER;
      return { board, turn: starter, quiet: 0, ply: 0 };
    },
    moves: fanMoves,
    hasMove: fanHasMove,
    apply: fanApply,
    result: fanResult,
    evaluate: fanEvaluate,
    notation: fanNotation,
    coord(index) { return coordGrid(index, 9, 5); },
    inputSequence(move) { return move.path; },
    key(state) { return `f|${state.turn}|${state.board.map((v) => v + 1).join('')}`; },
    repetitionKey(state) { return `fr|${state.turn}|${state.board.map((v) => v + 1).join('')}`; },
    moveScore(state, move) {
      const destination = move.path[move.path.length - 1];
      const row = Math.floor(destination / 9);
      const col = destination % 9;
      return move.gain * 1200 + move.path.length * 15 + (fanCanDiagonal(row, col) ? 8 : 0);
    },
    counts(state) { return { user: countPieces(state.board, USER), opponent: countPieces(state.board, OPPONENT) }; },
    explain(state, move) {
      if (move.captured.length >= 4) return `Entfernt ${move.captured.length} Steine in einer kontrollierten Schlagfolge.`;
      if (move.captured.length) {
        if (move.path.length > 2) return `Verbindet ${move.path.length - 1} Schläge und nimmt ${move.captured.length} gegnerische Steine.`;
        return `Nutzt den Pflichtschlag und nimmt ${move.captured.length} gegnerische${move.captured.length === 1 ? 'n Stein' : ' Steine'}.`;
      }
      return 'Verteilt die Formation und reduziert gefährliche gegnerische Linien.';
    },
  };

  // ---------------------------------------------------------------------------
  // Generic iterative-deepening alpha-beta search
  // ---------------------------------------------------------------------------

  class SearchTimeout extends Error {}

  function searchBest(game, state, options = {}) {
    const start = now();
    const timeMs = Math.max(80, options.timeMs || 1200);
    const maxDepth = Math.max(1, options.maxDepth || 10);
    const deadline = start + timeMs;
    const transposition = new Map();
    const repetitionCounts = new Map();
    const repetitionIds = new Map();
    const repetitionPath = [];
    let nextRepetitionId = 1;
    let nodes = 0;
    let completedDepth = 0;
    let bestMove = null;
    let bestScore = -Infinity;
    let rootMoves = game.moves(state, state.turn);

    for (const key of options.repetitionKeys || []) {
      repetitionCounts.set(key, (repetitionCounts.get(key) || 0) + 1);
      if (!repetitionIds.has(key)) repetitionIds.set(key, nextRepetitionId++);
    }
    const rootRepetitionKey = game.repetitionKey ? game.repetitionKey(state) : game.key(state);
    if (!repetitionCounts.has(rootRepetitionKey)) repetitionCounts.set(rootRepetitionKey, 1);
    if (!repetitionIds.has(rootRepetitionKey)) repetitionIds.set(rootRepetitionKey, nextRepetitionId++);

    if (!rootMoves.length) {
      return { move: null, score: -MATE, depth: 0, nodes: 0, elapsedMs: Math.round(now() - start), pv: [] };
    }

    rootMoves.sort((a, b) => game.moveScore(state, b) - game.moveScore(state, a));
    bestMove = rootMoves[0];

    function checkTime() {
      if ((nodes & 127) === 0 && now() >= deadline) throw new SearchTimeout();
    }

    function terminalScore(result, sideToMove, ply) {
      if (!result) return null;
      if (result.winner === 0) return 0;
      return result.winner === sideToMove ? MATE - ply : -MATE + ply;
    }

    function negamax(current, depth, alpha, beta, ply) {
      nodes += 1;
      checkTime();
      const repetitionKey = game.repetitionKey ? game.repetitionKey(current) : game.key(current);
      const previousRepetitions = repetitionCounts.get(repetitionKey) || 0;
      if (previousRepetitions >= 2) return 0;
      if (!repetitionIds.has(repetitionKey)) repetitionIds.set(repetitionKey, nextRepetitionId++);
      repetitionCounts.set(repetitionKey, previousRepetitions + 1);
      repetitionPath.push(repetitionIds.get(repetitionKey));

      try {
      const result = game.result(current, true);
      const terminal = terminalScore(result, current.turn, ply);
      if (terminal !== null) return terminal;
      if (game.searchDraw && game.searchDraw(current)) return 0;
      if (depth <= 0) {
        if (!game.hasMove(current, current.turn)) return -MATE + ply;
        return game.evaluate(current, current.turn);
      }

      const historySignature = repetitionPath.slice().sort((a, b) => a - b).join('.');
      const key = `${game.key(current)}|h${historySignature}`;
      const cached = transposition.get(key);
      const alphaOriginal = alpha;
      if (cached && cached.depth >= depth) {
        if (cached.flag === 'exact') return cached.value;
        if (cached.flag === 'lower') alpha = Math.max(alpha, cached.value);
        else if (cached.flag === 'upper') beta = Math.min(beta, cached.value);
        if (alpha >= beta) return cached.value;
      }

      let moves = game.moves(current, current.turn);
      if (!moves.length) return -MATE + ply;
      const cachedMoveId = cached && cached.bestMoveId;
      moves.sort((a, b) => {
        if (a.id === cachedMoveId) return -1;
        if (b.id === cachedMoveId) return 1;
        return game.moveScore(current, b) - game.moveScore(current, a);
      });

      let value = -Infinity;
      let localBest = moves[0];
      for (const move of moves) {
        const child = game.apply(current, move);
        const score = -negamax(child, depth - 1, -beta, -alpha, ply + 1);
        if (score > value) {
          value = score;
          localBest = move;
        }
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break;
      }

      let flag = 'exact';
      if (value <= alphaOriginal) flag = 'upper';
      else if (value >= beta) flag = 'lower';
      if (transposition.size > 80_000) transposition.clear();
      transposition.set(key, { depth, value, flag, bestMoveId: localBest.id });
      return value;
      } finally {
        repetitionPath.pop();
        if (previousRepetitions === 0) repetitionCounts.delete(repetitionKey);
        else repetitionCounts.set(repetitionKey, previousRepetitions);
      }
    }

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      let iterationBest = rootMoves[0];
      let iterationScore = -Infinity;
      let alpha = -Infinity;
      try {
        const rootEntry = transposition.get(game.key(state));
        const preferred = rootEntry && rootEntry.bestMoveId;
        rootMoves.sort((a, b) => {
          if (a.id === preferred || a.id === bestMove.id) return -1;
          if (b.id === preferred || b.id === bestMove.id) return 1;
          return game.moveScore(state, b) - game.moveScore(state, a);
        });

        for (const move of rootMoves) {
          nodes += 1;
          checkTime();
          const child = game.apply(state, move);
          const score = -negamax(child, depth - 1, -Infinity, -alpha, 1);
          if (score > iterationScore) {
            iterationScore = score;
            iterationBest = move;
          }
          alpha = Math.max(alpha, score);
        }
        bestMove = iterationBest;
        bestScore = iterationScore;
        completedDepth = depth;
        transposition.set(game.key(state), { depth, value: bestScore, flag: 'exact', bestMoveId: bestMove.id });
        if (Math.abs(bestScore) > MATE - 1000) break;
      } catch (error) {
        if (!(error instanceof SearchTimeout)) throw error;
        break;
      }
      if (now() >= deadline) break;
    }

    const pv = [];
    let pvState = state;
    for (let step = 0; step < completedDepth; step += 1) {
      const entry = transposition.get(game.key(pvState));
      if (!entry || !entry.bestMoveId) break;
      const move = game.moves(pvState, pvState.turn).find((candidate) => candidate.id === entry.bestMoveId);
      if (!move) break;
      pv.push(move);
      pvState = game.apply(pvState, move);
    }

    return {
      move: bestMove,
      score: Number.isFinite(bestScore) ? bestScore : game.moveScore(state, bestMove),
      depth: completedDepth,
      nodes,
      elapsedMs: Math.round(now() - start),
      pv,
      formattedNodes: formatNumber(nodes),
    };
  }

  const games = { morris: Morris, fanorona: Fanorona, checkers: Checkers };

  global.TavernEngines = {
    USER,
    OPPONENT,
    games,
    searchBest,
    helpers: { countPieces, coordGrid, samePath, makeMoveId },
  };
  global.TavernEngineFactorySource = `(${initTavernEngines.toString()})(self);`;

  if (typeof module !== 'undefined' && module.exports) module.exports = global.TavernEngines;
})(typeof globalThis !== 'undefined' ? globalThis : window);
