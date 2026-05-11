// v1 API server for snakebot.
//
// snakebot was written against the 2018-era "world envelope" Battlesnake API
// (Profile A+C in the snake-zoo audit): top-level `world` object with
// `food.data`, `snakes.data`, `body.data`, and a top-left coordinate origin
// (up = y-1).
//
// The modern v1 API uses a flat `board` object with arrays of {x,y} and a
// bottom-left coordinate origin (up = y+1).
//
// This file is a stdlib Node shim that:
//   1. Listens for v1 API requests on PORT (5000 by default).
//   2. Translates each /move payload into the v0 `world` shape snakebot's
//      GameState class expects, mirroring Y so the strategy sees its native
//      top-left frame.
//   3. Invokes a pure-JS algorithm from algorithms/ (default: hungry) so we
//      don't need the C++ cpp_sim native binding (avoiding node-gyp/ARM64
//      pain for snake-zoo Docker builds).
//   4. Returns the v1-shape response.
//
// Original index.js is left untouched so upstream merges stay clean.

const http = require('http');

const ALGORITHM_KEY = process.env.SNAKEBOT_ALGORITHM || 'hungry';
const PORT = parseInt(process.env.PORT, 10) || 5000;

const algorithm = require(`./algorithms/${ALGORITHM_KEY}`);

function flipY(y, height) {
  return height - 1 - y;
}

function toV0Snake(snake, height) {
  return {
    id: snake.id,
    name: snake.name,
    health: snake.health,
    length: snake.length,
    body: {
      object: 'list',
      data: snake.body.map((p) => ({ object: 'point', x: p.x, y: flipY(p.y, height) })),
    },
  };
}

function v1ToV0World(v1) {
  const height = v1.board.height;
  const youV0 = toV0Snake(v1.you, height);
  return {
    id: v1.game.id,
    turn: v1.turn,
    width: v1.board.width,
    height,
    food: {
      object: 'list',
      data: v1.board.food.map((f) => ({ object: 'point', x: f.x, y: flipY(f.y, height) })),
    },
    snakes: {
      object: 'list',
      data: v1.board.snakes.map((s) => toV0Snake(s, height)),
    },
    you: youV0,
  };
}

function meta() {
  const m = algorithm.meta || {};
  return {
    apiversion: '1',
    author: 'graeme-hill',
    color: m.color || '#00FFFF',
    head: 'default',
    tail: 'default',
    version: ALGORITHM_KEY,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      json(res, 200, meta());
      return;
    }

    if (req.method === 'POST' && req.url === '/start') {
      const body = await readBody(req);
      if (algorithm.start && body && body.game && body.game.id) {
        try {
          algorithm.start(body.game.id);
        } catch (e) {
          console.error('algorithm.start failed:', e);
        }
      }
      json(res, 200, {});
      return;
    }

    if (req.method === 'POST' && req.url === '/move') {
      const body = await readBody(req);
      const world = v1ToV0World(body);
      const direction = algorithm.move(world);
      json(res, 200, { move: direction });
      return;
    }

    if (req.method === 'POST' && req.url === '/end') {
      json(res, 200, {});
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('handler error:', e);
    json(res, 500, { error: 'internal_error', message: String(e && e.message) });
  }
});

server.listen(PORT, () => {
  console.log(`snakebot v1 shim listening on :${PORT} (algorithm=${ALGORITHM_KEY})`);
});
