// server.js
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require('cors')());
app.use(express.static(path.join(__dirname, 'public')));

fs.ensureDirSync(DATA_DIR);
if (!fs.existsSync(HISTORY_FILE)) fs.writeJSONSync(HISTORY_FILE, []);
let history = fs.readJSONSync(HISTORY_FILE);

function saveHistory() {
  fs.writeJSONSync(HISTORY_FILE, history, { spaces: 2 });
}

// Try to fetch TRX block id using TronGrid public endpoint
async function fetchTrxBlockId() {
  try {
    const res = await axios.post('https://api.trongrid.io/wallet/getnowblock', {}, { timeout: 5000 });
    if (res.data && res.data.blockID) return res.data.blockID;
    return null;
  } catch (err) {
    console.warn('fetchTrxBlockId failed:', err.message);
    return null;
  }
}

// PRNG builder from hex
function xorshiftSeedFromHex(hex) {
  let s = 0;
  for (let i = 0; i < Math.min(32, hex.length); i += 8) {
    const part = parseInt(hex.slice(i, i + 8).padEnd(8, '0'), 16) || 0;
    s ^= part;
  }
  if (s === 0) s = 0x9e3779b9;
  return function() {
    s = Math.imul(s ^ (s >>> 15), 1 | s);
    s += 0x6D2B79F5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

// Generate bombs deterministically with HMAC-SHA512(serverSeed, `${clientSeed}:${nonce}`)
function generateBombs(serverSeed, clientSeed, nonce, totalCells, bombsCount) {
  const hmac = crypto.createHmac('sha512', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  const rnd = xorshiftSeedFromHex(hmac);
  const indices = Array.from({ length: totalCells }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, bombsCount).sort((a,b)=>a-b);
}

// Compute multiplier given safeOpened (houseEdge applied)
function computeMultiplier(totalCells, bombsCount, safeOpened) {
  if (safeOpened <= 0) return 1;
  let survival = 1;
  for (let i = 0; i < safeOpened; i++) {
    const remainingSafe = (totalCells - bombsCount) - i;
    const remainingCells = totalCells - i;
    if (remainingCells <= 0) { survival = 0; break; }
    survival *= (remainingSafe / remainingCells);
  }
  if (survival <= 0) return 0;
  const houseEdge = 0.98; // 2% house edge
  const multiplier = houseEdge / survival;
  return parseFloat(multiplier.toFixed(6));
}

// Start new game
app.post('/api/start', async (req, res) => {
  try {
    const { size, bombs, clientSeed, bet } = req.body;
    if (!size || !bombs || !clientSeed) return res.status(400).json({ error: 'missing params' });
    const sizeN = Number(size);
    const bombsN = Number(bombs);
    if (!Number.isInteger(sizeN) || sizeN <= 0) return res.status(400).json({ error: 'invalid size' });
    const totalCells = sizeN * sizeN;
    if (bombsN < 1 || bombsN >= totalCells) return res.status(400).json({ error: 'invalid bombs count' });

    const blockId = await fetchTrxBlockId();
    const serverSeed = blockId ? (String(blockId) + '2') : ('fallback-' + Date.now());

    const nonce = (history.length + 1);
    const bombsPositions = generateBombs(serverSeed, clientSeed, nonce, totalCells, bombsN);

    const game = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      size: sizeN,
      bombs: bombsN,
      totalCells,
      clientSeed,
      serverSeed,
      nonce,
      bet: Number(bet || 0),
      bombsPositions,
      opened: [],
      finished: false,
      result: null
    };

    history.push(game);
    saveHistory();

    res.json({ gameId: game.id, serverSeedPublic: game.serverSeed, nonce: game.nonce });
  } catch (err) {
    console.error('start error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Reveal cell
app.post('/api/reveal', (req, res) => {
  try {
    const { gameId, index } = req.body;
    const game = history.find(g => g.id === gameId);
    if (!game) return res.status(404).json({ error: 'game not found' });
    if (game.finished) return res.status(400).json({ error: 'game already finished' });

    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= game.totalCells) return res.status(400).json({ error: 'invalid index' });
    if (game.opened.includes(idx)) return res.status(400).json({ error: 'cell already opened' });

    const isBomb = game.bombsPositions.includes(idx);
    if (isBomb) {
      game.opened.push(idx);
      game.finished = true;
      game.result = 'lost';
      saveHistory();
      return res.json({ isBomb: true, opened: game.opened, multiplier: 0, game });
    }

    game.opened.push(idx);
    const safeOpened = game.opened.length;
    const multiplier = computeMultiplier(game.totalCells, game.bombs, safeOpened);
    saveHistory();
    return res.json({ isBomb: false, opened: game.opened, multiplier, game });
  } catch (err) {
    console.error('reveal error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Cashout
app.post('/api/cashout', (req, res) => {
  try {
    const { gameId } = req.body;
    const game = history.find(g => g.id === gameId);
    if (!game) return res.status(404).json({ error: 'game not found' });
    if (game.finished) return res.status(400).json({ error: 'game already finished' });

    const safeOpened = game.opened.length;
    const multiplier = computeMultiplier(game.totalCells, game.bombs, safeOpened);
    game.finished = true;
    game.result = 'cashed';
    game.payoutMultiplier = multiplier;
    saveHistory();
    return res.json({ success: true, payoutMultiplier: multiplier, game });
  } catch (err) {
    console.error('cashout error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// History summary (last 200)
app.get('/api/history', (req, res) => {
  const last = history.slice(-200).map(h => ({ id: h.id, createdAt: h.createdAt, size: h.size, bombs: h.bombs, bet: h.bet, result: h.result, nonce: h.nonce }));
  res.json(last.reverse());
});

// Verify full game details (including bombsPositions)
app.get('/api/verify/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const game = history.find(g => g.id === gameId);
  if (!game) return res.status(404).json({ error: 'game not found' });
  res.json({
    id: game.id,
    createdAt: game.createdAt,
    size: game.size,
    bombs: game.bombs,
    totalCells: game.totalCells,
    clientSeed: game.clientSeed,
    serverSeed: game.serverSeed,
    nonce: game.nonce,
    bombsPositions: game.bombsPositions,
    opened: game.opened,
    result: game.result,
    bet: game.bet
  });
});

app.listen(PORT, () => {
  console.log(`Crypto Mines server running on http://localhost:${PORT}`);
});
