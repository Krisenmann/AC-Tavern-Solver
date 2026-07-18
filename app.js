(function initTavernApp() {
  'use strict';

  const { games, searchBest, USER, OPPONENT } = window.TavernEngines;
  const FILES = 'ABCDEFGHI';
  const STORAGE_KEY = 'tavern-tactician-session-v1';
  const STORAGE_VERSION = 1;
  const ENGINE_VERSION = 1;
  const MAX_SAVED_MOVES = 1024;
  const MAX_SAVED_BYTES = 512 * 1024;

  const STRENGTHS = {
    quick: {
      label: 'Schnell',
      timeMs: 400,
      depths: { morris: 5, fanorona: 5, checkers: 7 },
    },
    strong: {
      label: 'Stark',
      timeMs: 1500,
      depths: { morris: 8, fanorona: 8, checkers: 11 },
    },
    maximum: {
      label: 'Maximum',
      timeMs: 4000,
      depths: { morris: 12, fanorona: 11, checkers: 15 },
    },
  };

  const RULES = {
    morris: `
      <p>Setze abwechselnd neun Steine. Drei eigene Steine in einer geraden Linie bilden eine Mühle; danach muss ein gegnerischer Stein außerhalb einer Mühle entfernt werden. Sind alle Gegnersteine gebunden, darf einer aus einer Mühle genommen werden.</p>
      <p>Nach der Setzphase wird auf einen verbundenen Nachbarpunkt gezogen. Mit genau drei Steinen darf auf jeden freien Punkt gesprungen werden.</p>
    `,
    fanorona: `
      <p>Ein Stein zieht entlang einer Linie auf einen freien Nachbarpunkt. Ist irgendwo ein Schlag möglich, ist er Pflicht. Annäherung (A) nimmt die gegnerische Reihe vor dem Ziel; Rückzug (R) die Reihe hinter dem Start.</p>
      <p>Eine Schlagkette darf freiwillig enden. Derselbe Stein darf keinen Punkt erneut besuchen und nicht zweimal direkt nacheinander in dieselbe Richtung ziehen.</p>
    `,
    checkers: `
      <p>Normale Steine ziehen und schlagen diagonal vorwärts. Damen ziehen in beide Richtungen jeweils ein Feld. Ein möglicher Schlag ist immer Pflicht; eine begonnene Mehrfachfolge muss vollständig gespielt werden.</p>
      <p>Ein Stein auf der gegnerischen Grundreihe wird zur Dame. Bei einer Krönung endet die laufende Schlagfolge sofort.</p>
    `,
  };

  const dom = {
    setupView: document.querySelector('#setup-view'),
    gameView: document.querySelector('#game-view'),
    setupForm: document.querySelector('#setup-form'),
    gameCards: [...document.querySelectorAll('[data-game-card]')],
    iosInstallHint: document.querySelector('#ios-install-hint'),
    strength: document.querySelector('#strength-select'),
    brandHome: document.querySelector('#brand-home'),
    backToSetup: document.querySelector('#back-to-setup'),
    activeGameTitle: document.querySelector('#active-game-title'),
    turnBadge: document.querySelector('#turn-badge'),
    undo: document.querySelector('#undo-btn'),
    fullscreen: document.querySelector('#fullscreen-btn'),
    restart: document.querySelector('#restart-btn'),
    boardFrame: document.querySelector('#board-frame'),
    canvas: document.querySelector('#game-board'),
    boardMessage: document.querySelector('#board-message'),
    boardHint: document.querySelector('#board-hint'),
    userPieceCount: document.querySelector('#user-piece-count'),
    opponentPieceCount: document.querySelector('#opponent-piece-count'),
    phaseIcon: document.querySelector('#phase-icon'),
    phaseEyebrow: document.querySelector('#phase-eyebrow'),
    phaseTitle: document.querySelector('#phase-title'),
    phaseCopy: document.querySelector('#phase-copy'),
    thinkingCard: document.querySelector('#thinking-card'),
    thinkingLabel: document.querySelector('#thinking-label'),
    recommendationCard: document.querySelector('#recommendation-card'),
    confidencePill: document.querySelector('#confidence-pill'),
    moveNotation: document.querySelector('#move-notation'),
    moveExplanation: document.querySelector('#move-explanation'),
    depthStat: document.querySelector('#depth-stat'),
    nodesStat: document.querySelector('#nodes-stat'),
    timeStat: document.querySelector('#time-stat'),
    entryCard: document.querySelector('#entry-card'),
    entryProgress: document.querySelector('#entry-progress'),
    entryTitle: document.querySelector('#entry-title'),
    entryHelp: document.querySelector('#entry-help'),
    variantList: document.querySelector('#variant-list'),
    gameOverCard: document.querySelector('#game-over-card'),
    gameOverIcon: document.querySelector('#game-over-icon'),
    gameOverTitle: document.querySelector('#game-over-title'),
    gameOverCopy: document.querySelector('#game-over-copy'),
    confirm: document.querySelector('#confirm-btn'),
    manual: document.querySelector('#manual-btn'),
    cancelEntry: document.querySelector('#cancel-entry-btn'),
    newAfterGame: document.querySelector('#new-after-game-btn'),
    moveCounter: document.querySelector('#move-counter'),
    moveLog: document.querySelector('#move-log'),
    rulesCopy: document.querySelector('#rules-copy'),
    toast: document.querySelector('#toast'),
  };

  const ctx = dom.canvas.getContext('2d');
  let session = null;
  let analysisToken = 0;
  let activeWorker = null;
  let boardHits = [];
  let hoverPoint = -1;
  let toastTimer = 0;

  function cloneState(state) {
    return { ...state, board: state.board.slice() };
  }

  function validConfig(config) {
    return Boolean(
      config
      && Object.prototype.hasOwnProperty.call(games, config.gameId)
      && ['user', 'opponent'].includes(config.starter)
      && Object.prototype.hasOwnProperty.call(STRENGTHS, config.strength),
    );
  }

  function clearPersistedSession() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Storage is optional; private browsing may make it unavailable.
    }
  }

  function persistSession() {
    if (!session || !validConfig(session.config) || session.log.length > MAX_SAVED_MOVES) return;
    const payload = {
      version: STORAGE_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: Date.now(),
      config: { ...session.config },
      moveIds: session.log.map((entry) => entry.moveId),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // A full or disabled storage must never interrupt a game.
    }
  }

  function replayPersistedSession(payload) {
    if (
      !payload
      || payload.version !== STORAGE_VERSION
      || payload.engineVersion !== ENGINE_VERSION
      || !validConfig(payload.config)
      || !Array.isArray(payload.moveIds)
      || payload.moveIds.length > MAX_SAVED_MOVES
    ) {
      throw new Error('Ungültiger Spielstand.');
    }

    const config = { ...payload.config };
    const game = games[config.gameId];
    const starter = config.starter === 'user' ? USER : OPPONENT;
    let state = game.initial(starter);
    const history = [];
    const log = [];

    for (const moveId of payload.moveIds) {
      if (typeof moveId !== 'string' || moveId.length === 0 || moveId.length > 512 || game.result(state)) {
        throw new Error('Ungültige Zugfolge.');
      }
      const matches = game.moves(state, state.turn).filter((move) => move.id === moveId);
      if (matches.length !== 1) throw new Error('Gespeicherter Zug ist nicht mehr legal.');
      const move = matches[0];
      history.push({
        state: cloneState(state),
        log: log.map((entry) => ({ ...entry })),
      });
      log.push({ actor: state.turn, notation: game.notation(move), moveId: move.id });
      state = game.apply(state, move);
    }

    return {
      config,
      game,
      state,
      phase: 'thinking',
      recommendation: null,
      input: null,
      history,
      log,
      result: null,
    };
  }

  function openGameView() {
    dom.setupView.hidden = true;
    dom.gameView.hidden = false;
    dom.boardFrame.dataset.game = session.config.gameId;
    dom.activeGameTitle.textContent = session.game.title;
    dom.rulesCopy.innerHTML = RULES[session.config.gameId];
    document.title = `${session.game.title} – Tavern Tactician`;
  }

  function continueSession() {
    const result = session.game.result(session.state);
    if (result) finishGame(result);
    else if (session.state.turn === USER) requestRecommendation();
    else beginEntry('opponent-input');
    resizeCanvas();
  }

  function restorePersistedSession() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return false;
    }
    if (!raw) return false;

    try {
      if (raw.length > MAX_SAVED_BYTES) throw new Error('Spielstand ist zu groß.');
      session = replayPersistedSession(JSON.parse(raw));
      openGameView();
      continueSession();
      showToast('Letzte Partie wiederhergestellt.');
      return true;
    } catch (error) {
      session = null;
      clearPersistedSession();
      return false;
    }
  }

  function selectedFormValue(name) {
    const field = dom.setupForm.elements[name];
    return field && field.value;
  }

  function showSetup() {
    cancelAnalysis();
    hideToast();
    clearPersistedSession();
    session = null;
    dom.setupView.hidden = false;
    dom.gameView.hidden = true;
    document.title = 'Tavern Tactician – AC4 Brettspiel-Solver';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startGame(config) {
    cancelAnalysis();
    hideToast();
    const game = games[config.gameId];
    const starter = config.starter === 'user' ? USER : OPPONENT;
    session = {
      config: { ...config },
      game,
      state: game.initial(starter),
      phase: starter === USER ? 'thinking' : 'opponent-input',
      recommendation: null,
      input: null,
      history: [],
      log: [],
      result: null,
    };
    openGameView();
    persistSession();
    continueSession();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restartGame() {
    if (!session) return;
    startGame(session.config);
    showToast('Die Partie wurde neu aufgebaut.');
  }

  function cancelAnalysis() {
    analysisToken += 1;
    if (activeWorker) {
      activeWorker.terminate();
      if (activeWorker.objectUrl) URL.revokeObjectURL(activeWorker.objectUrl);
      activeWorker = null;
    }
  }

  function searchOptions() {
    const strength = STRENGTHS[session.config.strength] || STRENGTHS.strong;
    const repetitionKeys = session.history
      .map((snapshot) => session.game.repetitionKey(snapshot.state))
      .concat(session.game.repetitionKey(session.state));
    return {
      timeMs: strength.timeMs,
      maxDepth: strength.depths[session.config.gameId],
      repetitionKeys,
    };
  }

  function createSolverWorker() {
    if (window.location.protocol !== 'file:') return new Worker('solver-worker.js');
    if (!window.TavernEngineFactorySource) throw new Error('Lokaler Worker-Code fehlt.');
    const handler = `
      self.onmessage = (event) => {
        const { token, gameId, state, options } = event.data;
        try {
          const game = self.TavernEngines.games[gameId];
          const result = self.TavernEngines.searchBest(game, state, options);
          self.postMessage({ token, result });
        } catch (error) {
          self.postMessage({ token, error: error instanceof Error ? error.message : String(error) });
        }
      };
    `;
    const objectUrl = URL.createObjectURL(new Blob([window.TavernEngineFactorySource, handler], { type: 'text/javascript' }));
    const worker = new Worker(objectUrl);
    worker.objectUrl = objectUrl;
    return worker;
  }

  function disposeWorker(worker) {
    worker.terminate();
    if (worker.objectUrl) URL.revokeObjectURL(worker.objectUrl);
    if (activeWorker === worker) activeWorker = null;
  }

  function requestRecommendation() {
    if (!session || session.state.turn !== USER) return;
    cancelAnalysis();
    session.phase = 'thinking';
    session.input = null;
    session.recommendation = null;
    updateUI();
    renderBoard();

    const token = analysisToken;
    const stateSnapshot = cloneState(session.state);
    const options = searchOptions();
    const useWorker = typeof Worker !== 'undefined';

    if (useWorker) {
      try {
        const worker = createSolverWorker();
        activeWorker = worker;
        worker.onmessage = (event) => {
          if (event.data.token !== token || token !== analysisToken || !session) return;
          disposeWorker(worker);
          if (event.data.error) {
            runSearchFallback(token, stateSnapshot, options);
            return;
          }
          finishRecommendation(event.data.result, token);
        };
        worker.onerror = () => {
          disposeWorker(worker);
          runSearchFallback(token, stateSnapshot, options);
        };
        worker.postMessage({ token, gameId: session.config.gameId, state: stateSnapshot, options });
        return;
      } catch (error) {
        activeWorker = null;
      }
    }
    runSearchFallback(token, stateSnapshot, options);
  }

  function runSearchFallback(token, stateSnapshot, options) {
    window.setTimeout(() => {
      if (token !== analysisToken || !session) return;
      try {
        const result = searchBest(session.game, stateSnapshot, options);
        finishRecommendation(result, token);
      } catch (error) {
        console.error(error);
        showToast('Die Stellung konnte nicht analysiert werden. Bitte den letzten Zug prüfen.');
        beginEntry('manual-input');
      }
    }, 40);
  }

  function finishRecommendation(result, token) {
    if (!session || token !== analysisToken || session.state.turn !== USER) return;
    if (!result.move) {
      finishGame(session.game.result(session.state) || { winner: OPPONENT, reason: 'blocked' });
      return;
    }
    session.recommendation = result;
    session.phase = 'recommendation';
    updateUI();
    renderBoard();
  }

  function beginEntry(phase) {
    if (!session) return;
    cancelAnalysis();
    session.phase = phase;
    const legalMoves = session.game.moves(session.state, session.state.turn);
    session.input = {
      moves: legalMoves,
      candidates: legalMoves,
      sequence: [],
      modePrefix: [],
      pending: null,
      exact: [],
    };
    updateUI();
    renderBoard();
  }

  function isPrefix(sequence, target) {
    return sequence.length <= target.length && sequence.every((value, index) => value === target[index]);
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function nextInputTargets() {
    if (!session || !session.input) return [];
    const position = session.input.sequence.length;
    return unique(
      session.input.candidates
        .map((move) => session.game.inputSequence(move)[position])
        .filter((value) => Number.isInteger(value)),
    );
  }

  function handleBoardPoint(index) {
    if (!session || !['opponent-input', 'manual-input'].includes(session.phase) || !session.input) return;
    const input = session.input;
    const proposed = input.sequence.concat(index);
    const modeCompatibleMoves = input.modePrefix.length
      ? input.moves.filter((move) => input.modePrefix.every((mode, modeIndex) => move.modes?.[modeIndex] === mode))
      : input.moves;
    let candidates = modeCompatibleMoves.filter((move) => isPrefix(proposed, session.game.inputSequence(move)));

    if (!candidates.length) {
      candidates = input.moves.filter((move) => session.game.inputSequence(move)[0] === index);
      if (!candidates.length) {
        showToast('Dieses Feld gehört zu keinem legalen Zug.');
        return;
      }
      input.sequence = [index];
      input.modePrefix = [];
    } else {
      input.sequence = proposed;
    }

    input.candidates = candidates;
    input.exact = candidates.filter((move) => session.game.inputSequence(move).length === input.sequence.length);
    input.pending = input.exact.length === 1 ? input.exact[0] : null;
    updateUI();
    renderBoard();
  }

  function chooseVariant(moveId) {
    if (!session || !session.input) return;
    const move = session.input.exact.find((candidate) => candidate.id === moveId);
    if (!move) return;
    session.input.pending = move;
    session.input.modePrefix = (move.modes || []).slice();
    session.input.candidates = session.input.candidates.filter((candidate) => (
      session.input.modePrefix.every((mode, modeIndex) => candidate.modes?.[modeIndex] === mode)
    ));
    session.input.exact = [move];
    updateUI();
    renderBoard();
  }

  function resetEntry() {
    if (!session || !session.input) return;
    const legalMoves = session.input.moves;
    session.input = { moves: legalMoves, candidates: legalMoves, sequence: [], modePrefix: [], pending: null, exact: [] };
    updateUI();
    renderBoard();
  }

  function cancelEntry() {
    if (!session) return;
    if (session.phase === 'manual-input') {
      session.input = null;
      session.phase = 'recommendation';
      updateUI();
      renderBoard();
    } else {
      resetEntry();
    }
  }

  function applyMove(move, actor) {
    if (!session || !move) return;
    session.history.push({
      state: cloneState(session.state),
      log: session.log.map((entry) => ({ ...entry })),
    });
    const notation = session.game.notation(move);
    session.log.push({ actor, notation, moveId: move.id });
    session.state = session.game.apply(session.state, move);
    session.input = null;
    session.recommendation = null;
    persistSession();
    const currentRepetitionKey = session.game.repetitionKey(session.state);
    const repetitionCount = 1 + session.history.filter((snapshot) => (
      session.game.repetitionKey(snapshot.state) === currentRepetitionKey
    )).length;
    if (repetitionCount >= 3) {
      showToast('Diese Stellung ist zum dritten Mal erreicht – ein Remisangebot ist möglich.');
    }
    const result = session.game.result(session.state);
    if (result) {
      finishGame(result);
      return;
    }
    if (session.state.turn === USER) requestRecommendation();
    else beginEntry('opponent-input');
  }

  function finishGame(result) {
    cancelAnalysis();
    session.result = result;
    session.phase = 'game-over';
    session.input = null;
    persistSession();
    updateUI();
    renderBoard();
  }

  function undoMove() {
    if (!session || !session.history.length) return;
    cancelAnalysis();
    const previous = session.history.pop();
    session.state = cloneState(previous.state);
    session.log = previous.log.map((entry) => ({ ...entry }));
    session.result = null;
    session.input = null;
    session.recommendation = null;
    persistSession();
    if (session.state.turn === USER) requestRecommendation();
    else beginEntry('opponent-input');
    showToast('Letzten Halbzug zurückgenommen.');
  }

  function setButtonText(button, text, suffix) {
    button.textContent = '';
    button.append(document.createTextNode(text));
    if (suffix) {
      const span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true');
      span.textContent = suffix;
      button.append(span);
    }
  }

  function pieceCountText(player) {
    const counts = session.game.counts(session.state);
    const count = player === USER ? counts.user : counts.opponent;
    if (session.config.gameId === 'morris') {
      const reserve = player === USER ? counts.reserveUser : counts.reserveOpponent;
      if (reserve > 0) return `${count} Brett · ${reserve} zu setzen`;
    }
    return `${count} ${count === 1 ? 'Stein' : 'Steine'}`;
  }

  function updateUI() {
    if (!session) return;
    const phase = session.phase;
    const isEntry = phase === 'opponent-input' || phase === 'manual-input';
    const playerTurn = session.state.turn === USER;
    const strength = STRENGTHS[session.config.strength] || STRENGTHS.strong;

    dom.activeGameTitle.textContent = session.game.title;
    dom.turnBadge.textContent = playerTurn ? 'Dein Zug' : 'Gegnerzug';
    dom.turnBadge.classList.toggle('opponent', !playerTurn);
    dom.userPieceCount.textContent = pieceCountText(USER);
    dom.opponentPieceCount.textContent = pieceCountText(OPPONENT);
    dom.undo.disabled = session.history.length === 0;
    dom.boardFrame.classList.toggle('interactive', isEntry);

    dom.thinkingCard.hidden = phase !== 'thinking';
    dom.recommendationCard.hidden = phase !== 'recommendation';
    dom.entryCard.hidden = !isEntry;
    dom.gameOverCard.hidden = phase !== 'game-over';
    dom.confirm.hidden = !['recommendation', 'opponent-input', 'manual-input'].includes(phase);
    dom.manual.hidden = phase !== 'recommendation';
    dom.cancelEntry.hidden = !isEntry || (phase === 'opponent-input' && session.input.sequence.length === 0);
    dom.newAfterGame.hidden = phase !== 'game-over';

    if (phase === 'thinking') {
      dom.phaseIcon.textContent = '✦';
      dom.phaseEyebrow.textContent = 'Lokale Analyse';
      dom.phaseTitle.textContent = 'Der beste Zug wird gesucht';
      dom.phaseCopy.textContent = 'Die Stellung wird Zug für Zug verglichen. Das Brett bleibt währenddessen unverändert.';
      dom.thinkingLabel.textContent = `${strength.label} · bis zu ${(strength.timeMs / 1000).toLocaleString('de-DE')} Sekunden`;
      dom.boardMessage.textContent = 'Analysiert';
      dom.boardHint.textContent = 'Bitte kurz warten – die Berechnung läuft vollständig lokal.';
    }

    if (phase === 'recommendation' && session.recommendation) {
      const result = session.recommendation;
      dom.phaseIcon.textContent = '↗';
      dom.phaseEyebrow.textContent = 'Zugempfehlung';
      dom.phaseTitle.textContent = 'Diesen Zug im Spiel ausführen';
      dom.phaseCopy.textContent = 'Die grüne Markierung zeigt die komplette Zugfolge. Danach den Zug hier bestätigen.';
      dom.moveNotation.textContent = session.game.notation(result.move);
      dom.moveExplanation.textContent = session.game.explain(session.state, result.move);
      dom.confidencePill.textContent = strength.label;
      dom.depthStat.textContent = result.depth || '1';
      dom.nodesStat.textContent = result.formattedNodes || new Intl.NumberFormat('de-DE').format(result.nodes || 0);
      dom.timeStat.textContent = `${(result.elapsedMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
      setButtonText(dom.confirm, 'Zug ausgeführt', '✓');
      dom.confirm.disabled = false;
      dom.boardMessage.textContent = 'Empfehlung';
      dom.boardHint.textContent = 'Grün zeigt deinen empfohlenen Zug; rote Ringe markieren entfernte Steine.';
    }

    if (isEntry) updateEntryUI();

    if (phase === 'game-over') {
      const won = session.result.winner === USER;
      const lost = session.result.winner === OPPONENT;
      dom.phaseIcon.textContent = won ? '✓' : lost ? '×' : '＝';
      dom.phaseEyebrow.textContent = 'Partie beendet';
      dom.phaseTitle.textContent = won ? 'Siegstellung erreicht' : lost ? 'Keine Rettung mehr' : 'Remis';
      dom.phaseCopy.textContent = 'Der Zugverlauf bleibt sichtbar und kann weiterhin zurückgenommen werden.';
      dom.gameOverIcon.textContent = won ? '✓' : lost ? '×' : '＝';
      dom.gameOverIcon.style.background = won ? '#16805f' : lost ? '#bd5d4c' : '#2c7374';
      dom.gameOverTitle.textContent = won ? 'Du hast gewonnen' : lost ? 'Der Gegner gewinnt' : 'Unentschieden';
      dom.gameOverCopy.textContent = session.result.reason === 'blocked'
        ? 'Die andere Seite hat keinen legalen Zug mehr.'
        : session.result.reason === 'draw-progress'
          ? '40 Züge je Seite ohne Schlag oder Fortschritt.'
          : 'Eine Seite hat nicht mehr genügend Steine.';
      dom.boardMessage.textContent = 'Partie beendet';
      dom.boardHint.textContent = 'Mit „Zurück“ kann der letzte eingegebene Zug korrigiert werden.';
    }

    renderMoveLog();
  }

  function updateEntryUI() {
    const input = session.input;
    const opponentEntry = session.phase === 'opponent-input';
    const next = nextInputTargets();
    const pending = input.pending;
    const hasCapture = input.moves.some((move) => move.captured.length > 0);

    dom.phaseIcon.textContent = opponentEntry ? '◎' : '◇';
    dom.phaseEyebrow.textContent = opponentEntry ? 'Stellung aktualisieren' : 'Eigener Alternativzug';
    dom.phaseTitle.textContent = opponentEntry ? 'Gegnerzug eingeben' : 'Eigenen Zug auswählen';
    dom.phaseCopy.textContent = opponentEntry
      ? 'Spiegle den vollständigen Zug des Gegners auf dem Brett und übernimm ihn anschließend.'
      : 'Wähle einen anderen legalen Zug. Danach wird mit dieser Stellung weitergerechnet.';
    dom.entryTitle.textContent = pending ? session.game.notation(pending) : 'Zug direkt auf dem Brett wählen';

    if (input.sequence.length === 0) {
      if (session.config.gameId === 'morris' && (session.state.reserveUser > 0 || session.state.reserveOpponent > 0)) {
        dom.entryHelp.textContent = 'Klicke den Punkt an, auf den der neue Stein gesetzt wurde.';
      } else {
        dom.entryHelp.textContent = hasCapture
          ? 'Ein Schlag ist Pflicht. Klicke den schlagenden Stein und danach alle Zielfelder an.'
          : 'Klicke zuerst den bewegten Stein und danach sein Zielfeld an.';
      }
    } else if (pending && next.length) {
      dom.entryHelp.textContent = session.config.gameId === 'fanorona'
        ? 'Die Kette darf hier enden – oder über einen markierten Punkt fortgesetzt werden.'
        : 'Der Zug ist gültig; weitere markierte Punkte gehören zu längeren Varianten.';
    } else if (pending) {
      dom.entryHelp.textContent = 'Der Zug ist vollständig. Jetzt übernehmen oder die Auswahl auf dem Brett ändern.';
    } else if (input.exact.length > 1) {
      dom.entryHelp.textContent = 'Gleicher Weg, anderer Schlag: Wähle unten die passende Variante.';
    } else {
      dom.entryHelp.textContent = 'Klicke einen der gold umrandeten nächsten Punkte an.';
    }

    dom.entryProgress.innerHTML = '';
    input.sequence.forEach((point, index) => {
      const span = document.createElement('span');
      span.className = 'entry-step';
      span.textContent = `${index + 1}. ${session.game.coord(point)}`;
      dom.entryProgress.append(span);
    });

    dom.variantList.innerHTML = '';
    dom.variantList.hidden = input.exact.length <= 1;
    if (input.exact.length > 1) {
      input.exact.slice(0, 12).forEach((move) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = session.game.notation(move);
        if (input.pending && input.pending.id === move.id) button.style.borderColor = '#16805f';
        button.addEventListener('click', () => chooseVariant(move.id));
        dom.variantList.append(button);
      });
    }

    setButtonText(dom.confirm, opponentEntry ? 'Gegnerzug übernehmen' : 'Eigenen Zug übernehmen', '✓');
    dom.confirm.disabled = !pending;
    dom.cancelEntry.textContent = opponentEntry ? 'Auswahl zurücksetzen' : 'Zur Empfehlung zurück';
    dom.boardMessage.textContent = opponentEntry ? 'Gegner eingeben' : 'Eigenen Zug wählen';
    dom.boardHint.textContent = next.length
      ? 'Goldene Ringe zeigen alle legalen nächsten Eingaben.'
      : 'Die Auswahl wird vor dem Übernehmen vollständig auf Legalität geprüft.';
  }

  function renderMoveLog() {
    const count = session.log.length;
    dom.moveCounter.textContent = `${count} ${count === 1 ? 'Zug' : 'Züge'}`;
    dom.moveLog.innerHTML = '';
    if (!count) {
      const empty = document.createElement('li');
      empty.className = 'empty-log';
      empty.textContent = 'Noch kein Zug ausgeführt.';
      dom.moveLog.append(empty);
      return;
    }
    session.log.forEach((entry, index) => {
      const item = document.createElement('li');
      const number = document.createElement('span');
      const actor = document.createElement('span');
      const notation = document.createElement('span');
      number.textContent = `${index + 1}.`;
      actor.textContent = entry.actor === USER ? 'Du' : 'Gegner';
      actor.className = entry.actor === USER ? 'actor-user' : 'actor-opponent';
      notation.textContent = entry.notation;
      item.append(number, actor, notation);
      dom.moveLog.append(item);
    });
    requestAnimationFrame(() => { dom.moveLog.scrollTop = dom.moveLog.scrollHeight; });
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    dom.toast.classList.remove('visible');
  }

  function showToast(message) {
    hideToast();
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    toastTimer = window.setTimeout(() => dom.toast.classList.remove('visible'), 2300);
  }

  // ---------------------------------------------------------------------------
  // Canvas rendering
  // ---------------------------------------------------------------------------

  function resizeCanvas() {
    if (dom.gameView.hidden) return;
    const rect = dom.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (dom.canvas.width !== width || dom.canvas.height !== height) {
      dom.canvas.width = width;
      dom.canvas.height = height;
    }
    renderBoard();
  }

  function canvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return { width: dom.canvas.width / dpr, height: dom.canvas.height / dpr, dpr };
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawBase(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f5ead2');
    gradient.addColorStop(0.48, '#ebdcc0');
    gradient.addColorStop(1, '#dfcca8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#7b5831';
    ctx.lineWidth = 1;
    for (let y = 20; y < height; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= width; x += 32) ctx.lineTo(x, y + Math.sin((x + y) * 0.03) * 3);
      ctx.stroke();
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, 'rgba(255,255,255,0)');
    vignette.addColorStop(1, 'rgba(71,46,21,0.12)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function drawPiece(x, y, radius, piece, options = {}) {
    const player = Math.sign(piece);
    const selected = options.selected;
    const hovered = options.hovered;
    ctx.save();
    ctx.shadowColor = 'rgba(44,34,20,0.3)';
    ctx.shadowBlur = radius * 0.38;
    ctx.shadowOffsetY = radius * 0.18;
    const gradient = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.32, radius * 0.08, x, y, radius);
    if (player === USER) {
      gradient.addColorStop(0, '#ffe6a5');
      gradient.addColorStop(0.5, '#e8ae43');
      gradient.addColorStop(1, '#a96617');
    } else {
      gradient.addColorStop(0, '#83b4b3');
      gradient.addColorStop(0.5, '#347b7c');
      gradient.addColorStop(1, '#17484e');
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1.5, radius * 0.11);
    ctx.strokeStyle = player === USER ? 'rgba(255,241,196,0.88)' : 'rgba(183,225,220,0.68)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, radius * 0.65, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.07);
    ctx.strokeStyle = player === USER ? 'rgba(120,70,12,0.3)' : 'rgba(6,49,53,0.34)';
    ctx.stroke();

    if (Math.abs(piece) === 2) {
      ctx.fillStyle = player === USER ? '#6d410b' : '#d1ece6';
      ctx.font = `700 ${Math.max(12, radius * 0.85)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♛', x, y + radius * 0.03);
    }

    if (selected || hovered) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.36, 0, Math.PI * 2);
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? '#d38c1e' : 'rgba(211,140,30,0.55)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function overlayData() {
    if (!session) return { move: null, sequence: [], next: [] };
    if (session.phase === 'recommendation' && session.recommendation) {
      return { move: session.recommendation.move, sequence: session.recommendation.move.path, next: [], recommended: true };
    }
    if (session.input) {
      return {
        move: session.input.pending,
        sequence: session.input.sequence,
        next: nextInputTargets(),
        recommended: false,
      };
    }
    return { move: null, sequence: [], next: [] };
  }

  function drawTargetRing(point, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(219,159,54,0.14)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#b87519';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }

  function drawMoveOverlay(move, positions, recommended) {
    if (!move || !move.path.length) return;
    const path = move.path.map((index) => positions[index]).filter(Boolean);
    const color = recommended ? '#16805f' : '#b87519';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 3;
    ctx.lineWidth = 4;
    if (path.length === 1) {
      ctx.beginPath();
      ctx.arc(path[0].x, path[0].y, path[0].radius * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(path[0].x, path[0].y, path[0].radius * 1.16, 0, Math.PI * 2);
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      for (let i = 1; i < path.length; i += 1) {
        const from = path[i - 1];
        const to = path[i];
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const startX = from.x + Math.cos(angle) * from.radius * 0.65;
        const startY = from.y + Math.sin(angle) * from.radius * 0.65;
        const endX = to.x - Math.cos(angle) * to.radius * 0.85;
        const endY = to.y - Math.sin(angle) * to.radius * 0.85;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        const arrow = Math.max(7, to.radius * 0.48);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * arrow, endY - Math.sin(angle - Math.PI / 6) * arrow);
        ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * arrow, endY - Math.sin(angle + Math.PI / 6) * arrow);
        ctx.closePath();
        ctx.fill();
        if (path.length > 2) {
          const bx = (startX + endX) / 2;
          const by = (startY + endY) / 2;
          ctx.beginPath();
          ctx.arc(bx, by, 9, 0, Math.PI * 2);
          ctx.fillStyle = '#fffaf0';
          ctx.fill();
          ctx.fillStyle = color;
          ctx.font = '700 9px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i), bx, by + 0.5);
          ctx.fillStyle = color;
        }
      }
    }

    for (const captured of move.captured || []) {
      const point = positions[captured];
      if (!point) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius * 1.25, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#bd5d4c';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x - point.radius * 0.46, point.y - point.radius * 0.46);
      ctx.lineTo(point.x + point.radius * 0.46, point.y + point.radius * 0.46);
      ctx.moveTo(point.x + point.radius * 0.46, point.y - point.radius * 0.46);
      ctx.lineTo(point.x - point.radius * 0.46, point.y + point.radius * 0.46);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSelectionPath(sequence, positions) {
    if (!sequence.length) return;
    const points = sequence.map((index) => positions[index]).filter(Boolean);
    ctx.save();
    ctx.strokeStyle = 'rgba(184,117,25,0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawCoordinates(text, x, y, align = 'center') {
    ctx.save();
    ctx.fillStyle = 'rgba(16,42,51,0.48)';
    ctx.font = '700 9px system-ui';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawMorris(width, height, overlay) {
    const size = Math.min(width * 0.72, height * 0.78);
    const left = (width - size) / 2;
    const top = (height - size) / 2;
    const positions = session.game.geometry.points.map(([x, y], index) => ({
      x: left + (x / 6) * size,
      y: top + (y / 6) * size,
      radius: Math.max(10, size / 25),
      index,
    }));
    boardHits = positions.map((point) => ({ ...point, hitRadius: point.radius * 1.7 }));

    ctx.save();
    ctx.strokeStyle = '#173b43';
    ctx.lineWidth = Math.max(2, size / 180);
    ctx.lineCap = 'round';
    for (const [a, b] of session.game.geometry.edges) {
      ctx.beginPath();
      ctx.moveTo(positions[a].x, positions[a].y);
      ctx.lineTo(positions[b].x, positions[b].y);
      ctx.stroke();
    }
    ctx.restore();

    for (const point of positions) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(3.3, point.radius * 0.24), 0, Math.PI * 2);
      ctx.fillStyle = '#173b43';
      ctx.fill();
      const [gx, gy] = session.game.geometry.points[point.index];
      const offsetX = gx <= 1 ? -11 : gx >= 5 ? 11 : 0;
      const offsetY = gy <= 1 ? -11 : gy >= 5 ? 11 : 0;
      drawCoordinates(session.game.coord(point.index), point.x + offsetX, point.y + offsetY, offsetX < 0 ? 'right' : offsetX > 0 ? 'left' : 'center');
    }

    for (const index of overlay.next) drawTargetRing(positions[index], positions[index].radius * 0.8);
    const selected = new Set(overlay.sequence);
    session.state.board.forEach((piece, index) => {
      if (!piece) return;
      drawPiece(positions[index].x, positions[index].y, positions[index].radius, piece, {
        selected: selected.has(index), hovered: hoverPoint === index,
      });
    });
    if (overlay.move) drawMoveOverlay(overlay.move, positions, overlay.recommended);
    else drawSelectionPath(overlay.sequence, positions);
  }

  function drawCheckers(width, height, overlay) {
    const size = Math.min(width * 0.74, height * 0.88);
    const left = (width - size) / 2;
    const top = (height - size) / 2;
    const cell = size / 8;
    const positions = [];

    ctx.save();
    ctx.shadowColor = 'rgba(63,43,22,0.24)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 9;
    roundRect(ctx, left - 8, top - 8, size + 16, size + 16, 11);
    ctx.fillStyle = '#5f4226';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const index = row * 8 + col;
        ctx.fillStyle = (row + col) % 2 === 0 ? '#e9d8b8' : '#244b52';
        ctx.fillRect(left + col * cell, top + row * cell, cell + 0.5, cell + 0.5);
        positions[index] = {
          x: left + (col + 0.5) * cell,
          y: top + (row + 0.5) * cell,
          radius: cell * 0.34,
          index,
        };
      }
    }
    ctx.restore();
    boardHits = positions.map((point) => ({ ...point, hitRadius: cell * 0.48 }));

    for (let col = 0; col < 8; col += 1) drawCoordinates(FILES[col], left + (col + 0.5) * cell, top + size + 15);
    for (let row = 0; row < 8; row += 1) drawCoordinates(String(8 - row), left - 14, top + (row + 0.5) * cell);
    for (const index of overlay.next) drawTargetRing(positions[index], cell * 0.24);

    const selected = new Set(overlay.sequence);
    session.state.board.forEach((piece, index) => {
      if (!piece) return;
      const point = positions[index];
      drawPiece(point.x, point.y, point.radius, piece, { selected: selected.has(index), hovered: hoverPoint === index });
    });
    if (overlay.move) drawMoveOverlay(overlay.move, positions, overlay.recommended);
    else drawSelectionPath(overlay.sequence, positions);
  }

  function drawFanorona(width, height, overlay) {
    const gridWidth = width * 0.82;
    const gridHeight = Math.min(height * 0.61, gridWidth * 0.48);
    const left = (width - gridWidth) / 2;
    const top = (height - gridHeight) / 2;
    const stepX = gridWidth / 8;
    const stepY = gridHeight / 4;
    const radius = Math.max(8, Math.min(stepX, stepY) * 0.27);
    const positions = Array.from({ length: 45 }, (_, index) => {
      const row = Math.floor(index / 9);
      const col = index % 9;
      return { x: left + col * stepX, y: top + row * stepY, radius, index };
    });
    boardHits = positions.map((point) => ({ ...point, hitRadius: radius * 1.55 }));

    ctx.save();
    ctx.strokeStyle = '#294b50';
    ctx.lineWidth = Math.max(1.5, radius * 0.13);
    ctx.lineCap = 'round';
    for (const [a, b] of session.game.geometry.edges) {
      ctx.beginPath();
      ctx.moveTo(positions[a].x, positions[a].y);
      ctx.lineTo(positions[b].x, positions[b].y);
      ctx.stroke();
    }
    ctx.restore();

    for (const point of positions) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(2.6, radius * 0.18), 0, Math.PI * 2);
      ctx.fillStyle = '#294b50';
      ctx.fill();
    }
    for (let col = 0; col < 9; col += 1) drawCoordinates(FILES[col], left + col * stepX, top + gridHeight + radius * 1.75);
    for (let row = 0; row < 5; row += 1) drawCoordinates(String(5 - row), left - radius * 1.6, top + row * stepY);
    for (const index of overlay.next) drawTargetRing(positions[index], radius * 0.78);

    const selected = new Set(overlay.sequence);
    session.state.board.forEach((piece, index) => {
      if (!piece) return;
      const point = positions[index];
      drawPiece(point.x, point.y, radius, piece, { selected: selected.has(index), hovered: hoverPoint === index });
    });
    if (overlay.move) drawMoveOverlay(overlay.move, positions, overlay.recommended);
    else drawSelectionPath(overlay.sequence, positions);
  }

  function renderBoard() {
    if (!session || dom.gameView.hidden || dom.canvas.width === 0) return;
    const { width, height, dpr } = canvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawBase(width, height);
    const overlay = overlayData();
    if (session.config.gameId === 'morris') drawMorris(width, height, overlay);
    else if (session.config.gameId === 'checkers') drawCheckers(width, height, overlay);
    else drawFanorona(width, height, overlay);
  }

  function pointFromEvent(event) {
    const rect = dom.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (dom.canvas.width / (Math.min(window.devicePixelRatio || 1, 2) * rect.width));
    const y = (event.clientY - rect.top) * (dom.canvas.height / (Math.min(window.devicePixelRatio || 1, 2) * rect.height));
    let nearest = null;
    let distance = Infinity;
    for (const hit of boardHits) {
      const candidate = Math.hypot(x - hit.x, y - hit.y);
      if (candidate <= hit.hitRadius && candidate < distance) {
        nearest = hit;
        distance = candidate;
      }
    }
    return nearest;
  }

  // ---------------------------------------------------------------------------
  // Events and automation hooks
  // ---------------------------------------------------------------------------

  dom.setupForm.addEventListener('change', (event) => {
    if (event.target.name === 'game') {
      dom.gameCards.forEach((card) => card.classList.toggle('selected', card.dataset.gameCard === event.target.value));
    }
  });

  dom.setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    startGame({
      gameId: selectedFormValue('game'),
      starter: selectedFormValue('starter'),
      strength: selectedFormValue('strength'),
    });
  });

  dom.brandHome.addEventListener('click', showSetup);
  dom.backToSetup.addEventListener('click', showSetup);
  dom.restart.addEventListener('click', restartGame);
  dom.undo.addEventListener('click', undoMove);
  dom.newAfterGame.addEventListener('click', restartGame);

  dom.confirm.addEventListener('click', () => {
    if (!session) return;
    if (session.phase === 'recommendation') applyMove(session.recommendation.move, USER);
    else if (session.phase === 'opponent-input' && session.input.pending) applyMove(session.input.pending, OPPONENT);
    else if (session.phase === 'manual-input' && session.input.pending) applyMove(session.input.pending, USER);
  });

  dom.manual.addEventListener('click', () => beginEntry('manual-input'));
  dom.cancelEntry.addEventListener('click', cancelEntry);

  dom.canvas.addEventListener('click', (event) => {
    const point = pointFromEvent(event);
    if (point) handleBoardPoint(point.index);
  });

  dom.canvas.addEventListener('mousemove', (event) => {
    if (!session || !session.input) return;
    const point = pointFromEvent(event);
    const nextHover = point ? point.index : -1;
    if (nextHover !== hoverPoint) {
      hoverPoint = nextHover;
      renderBoard();
    }
  });

  dom.canvas.addEventListener('mouseleave', () => {
    if (hoverPoint !== -1) {
      hoverPoint = -1;
      renderBoard();
    }
  });

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      showToast('Vollbild wird von diesem Browser nicht unterstützt.');
    }
  }

  dom.fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'f' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    dom.fullscreen.querySelector('span:last-child').textContent = document.fullscreenElement ? 'Beenden' : 'Vollbild';
    window.setTimeout(resizeCanvas, 50);
  });

  window.addEventListener('resize', resizeCanvas);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeCanvas).observe(dom.canvas);
  window.addEventListener('pagehide', persistSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistSession();
      if (session && session.phase === 'thinking') cancelAnalysis();
      return;
    }
    if (session && session.phase === 'thinking' && session.state.turn === USER && !activeWorker) {
      requestRecommendation();
    }
    resizeCanvas();
  });

  window.render_game_to_text = () => {
    if (!session) return JSON.stringify({ mode: 'setup', availableGames: Object.keys(games) });
    const board = { user: [], opponent: [], userKings: [], opponentKings: [] };
    session.state.board.forEach((piece, index) => {
      if (!piece) return;
      const coordinate = session.game.coord(index);
      if (piece > 0) board.user.push(coordinate);
      else board.opponent.push(coordinate);
      if (piece === 2) board.userKings.push(coordinate);
      if (piece === -2) board.opponentKings.push(coordinate);
    });
    const overlay = overlayData();
    const payload = {
      mode: session.phase,
      game: session.config.gameId,
      coordinateSystem: 'Spalten links→rechts A–I; Reihen unten→oben 1–8. Du spielst die goldenen Steine unten.',
      turn: session.state.turn === USER ? 'user' : 'opponent',
      board,
      reserve: session.config.gameId === 'morris'
        ? { user: session.state.reserveUser, opponent: session.state.reserveOpponent }
        : undefined,
      recommendation: session.recommendation
        ? {
            notation: session.game.notation(session.recommendation.move),
            path: session.recommendation.move.path.map(session.game.coord),
            captures: session.recommendation.move.captured.map(session.game.coord),
            modes: session.recommendation.move.modes || [],
            depth: session.recommendation.depth,
            nodes: session.recommendation.nodes,
          }
        : null,
      input: session.input
        ? {
            selected: session.input.sequence.map(session.game.coord),
            nextLegalPoints: overlay.next.map(session.game.coord),
            complete: Boolean(session.input.pending),
          }
        : null,
      moveCount: session.log.length,
      lastMoves: session.log.slice(-4),
    };
    return JSON.stringify(payload);
  };

  window.advanceTime = () => {
    renderBoard();
    return window.render_game_to_text();
  };

  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
        .then((registration) => {
          window.tavernServiceWorker = registration;
        })
        .catch(() => {
          // The game remains usable online when service-worker registration is unavailable.
        });
    });
  }

  // Ensure the initial radio styling is correct without requiring a first click.
  dom.gameCards.forEach((card) => card.classList.toggle('selected', card.querySelector('input').checked));
  const iosDevice = /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standaloneMode = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  dom.iosInstallHint.hidden = !iosDevice || standaloneMode || window.location.protocol === 'file:';
  restorePersistedSession();
})();
