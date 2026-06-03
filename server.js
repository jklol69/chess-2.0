import { WebSocketServer } from "ws";
import { createServer } from "http";

const PORT = process.env.PORT || 8080;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Dual Kingdom Chess server running");
});

const wss = new WebSocketServer({ server });

// Each room is a separate game
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      assignedSlots: [false, false, false, false],
      gameState: null,
    });
  }
  return rooms.get(roomId);
}

function getTeammate(pid) {
  return [[0, 2], [1, 3]].find(t => t.includes(pid)).find(i => i !== pid);
}

function createInitialState() {
  const board = Array(8).fill(null).map(() => Array(16).fill(null));
  const placeArmy = (row, pawnRow, colStart, color) => {
    const order = ["R","N","B","Q","K","B","N","R"];
    for (let i = 0; i < 8; i++) board[row][colStart + i] = { type: order[i], color };
    for (let i = 0; i < 8; i++) board[pawnRow][colStart + i] = { type: "P", color };
  };
  placeArmy(0, 1, 0, "black");
  placeArmy(7, 6, 0, "white");
  placeArmy(0, 1, 8, "brown");
  placeArmy(7, 6, 8, "yellow");
  return {
    board,
    turnIndex: 0,
    eliminated: [false, false, false, false],
    inherited: [null, null, null, null],
    winner: null,
  };
}

function applyMove(state, from, to) {
  const s = JSON.parse(JSON.stringify(state));
  const piece = s.board[from[0]][from[1]];
  const captured = s.board[to[0]][to[1]];
  s.board[to[0]][to[1]] = piece;
  s.board[from[0]][from[1]] = null;

  if (piece.type === "P") {
    const up = piece.color === "white" || piece.color === "yellow";
    if ((up && to[0] === 0) || (!up && to[0] === 7)) {
      s.board[to[0]][to[1]] = { type: "Q", color: piece.color };
    }
  }

  if (captured && captured.type === "K") {
    const deadIdx = ["white","black","yellow","brown"].indexOf(captured.color);
    if (deadIdx >= 0) {
      s.eliminated[deadIdx] = true;
      const tm = getTeammate(deadIdx);
      if (!s.eliminated[tm]) s.inherited[tm] = captured.color;
    }
  }

  s.turnIndex = (s.turnIndex + 1) % 4;
  let tries = 0;
  while (s.eliminated[s.turnIndex % 4] && tries < 4) {
    s.turnIndex = (s.turnIndex + 1) % 4;
    tries++;
  }

  const t0 = [0, 2].filter(i => !s.eliminated[i]).length;
  const t1 = [1, 3].filter(i => !s.eliminated[i]).length;
  if (t0 === 0) s.winner = "Tume tiim võitis! (Must + Pruun)";
  if (t1 === 0) s.winner = "Hele tiim võitis! (Valge + Kollane)";

  return s;
}

function getPlayersInfo(room) {
  const info = [null, null, null, null];
  for (const [, p] of room.players) {
    info[p.colorIndex] = { name: p.name, colorIndex: p.colorIndex };
  }
  return info;
}

function broadcast(room, msg) {
  const str = JSON.stringify(msg);
  for (const [ws] of room.players) {
    if (ws.readyState === 1) ws.send(str);
  }
}

const COLORS = ["white","black","yellow","brown"];

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = "main";
  const room = getOrCreateRoom(roomId);

  if (room.gameState) {
    ws.send(JSON.stringify({ type: "state", state: room.gameState, players: getPlayersInfo(room) }));
  } else {
    ws.send(JSON.stringify({ type: "waiting", players: getPlayersInfo(room) }));
  }

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);

    if (msg.type === "join") {
      const slot = room.assignedSlots.indexOf(false);
      if (slot === -1) {
        ws.send(JSON.stringify({ type: "error", message: "Tuba on täis (4/4)" }));
        return;
      }
      room.assignedSlots[slot] = true;
      room.players.set(ws, { name: msg.name || `Mängija ${slot+1}`, colorIndex: slot });
      ws.send(JSON.stringify({ type: "joined", colorIndex: slot, colorName: COLORS[slot] }));
      broadcast(room, { type: "players", players: getPlayersInfo(room) });

      if (room.assignedSlots.every(Boolean) && !room.gameState) {
        room.gameState = createInitialState();
        broadcast(room, { type: "start", state: room.gameState, players: getPlayersInfo(room) });
      }
    }

    if (msg.type === "move") {
      const player = room.players.get(ws);
      if (!player || !room.gameState) return;
      const colors = [COLORS[player.colorIndex]];
      if (room.gameState.inherited[player.colorIndex]) colors.push(room.gameState.inherited[player.colorIndex]);
      const piece = room.gameState.board[msg.from[0]][msg.from[1]];
      if (!piece || !colors.includes(piece.color)) return;
      room.gameState = applyMove(room.gameState, msg.from, msg.to);
      broadcast(room, { type: "state", state: room.gameState, players: getPlayersInfo(room) });
      if (room.gameState.winner) broadcast(room, { type: "gameover", winner: room.gameState.winner });
    }

    if (msg.type === "pass") {
      const player = room.players.get(ws);
      if (!player || !room.gameState) return;
      const tm = getTeammate(player.colorIndex);
      if (!room.gameState.eliminated[tm]) {
        room.gameState.turnIndex = tm;
        broadcast(room, { type: "state", state: room.gameState, players: getPlayersInfo(room) });
      }
    }

    if (msg.type === "reset") {
      room.gameState = createInitialState();
      broadcast(room, { type: "start", state: room.gameState, players: getPlayersInfo(room) });
    }
  });

  ws.on("close", () => {
    const player = room.players.get(ws);
    if (player) {
      room.assignedSlots[player.colorIndex] = false;
      room.players.delete(ws);
      broadcast(room, { type: "players", players: getPlayersInfo(room) });
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
