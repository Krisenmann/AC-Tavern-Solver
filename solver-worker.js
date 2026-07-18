'use strict';

importScripts('engines.js');

self.onmessage = (event) => {
  const { token, gameId, state, options } = event.data;
  try {
    const game = self.TavernEngines.games[gameId];
    if (!game) throw new Error(`Unbekanntes Spiel: ${gameId}`);
    const result = self.TavernEngines.searchBest(game, state, options);
    self.postMessage({ token, result });
  } catch (error) {
    self.postMessage({ token, error: error instanceof Error ? error.message : String(error) });
  }
};
