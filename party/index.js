export default class DualKingdomChess {
  constructor(room) {
    this.room = room;
    this.gameState = null;
    this.players = new Map(); // connectionId -> { name, colorIndex }
    this.assignedColors = [false, false, false, false]; // white, black, yellow, brown
    this.colorNames = ["white", "black", "yellow", "brown"];
    this.playerNames = ["Valge", "Must", "Kollane", "Pruun"];
  }

  onConnect(conn) {
    // Send current game state to new connection
    if (this.gameState) {
      conn.send(JSON.stringify({ type: "state", state: this.gameState, players: this.getPlayersInfo() }));
    } else {
      conn.send(JSON.stringify({ type: "waiting", players: this.getPlayersInfo() }));
    }
  }

  onMessage(message, sender) {
    const msg = JSON.parse(message);

    if (msg.type === "join") {
      // Assign a color slot if available
      const slot = this.assignedColors.indexOf(false);
      if (slot === -1) {
        sender.send(JSON.stringify({ type: "error", message: "Mäng on täis (4/4 mängijat)" }));
        return;
      }
      this.assignedColors[slot] = true;
      this.players.set(sender.id, { name: msg.name || this.playerNames[slot], colorIndex: slot });
      sender.send(JSON.stringify({ type: "joined", colorIndex: slot, colorName: this.colorNames[slot] }));
      this.broadcast({ type: "players", players: this.getPlayersInfo() });

      // Start game when all 4 players joined
      if (this.assignedColors.every(Boolean) && !this.gameState) {
        this.gameState = this.createInitialState();
        this.broadcast({ type: "start", state: this.gameState, players: this.getPlayersInfo() });
      }
    }

    if (msg.type === "move") {
      const player = this.players.get(sender.id);
      if (!player) return;
      if (!this.gameState) return;

      // Validate it's this player's turn
      const expectedColor = this.colorNames[this.gameState.turnIndex % 4];
      const playerColor = this.colorNames[player.colorIndex];

      // Allow move if it's their color OR their inherited color
      const myColors = [playerColor];
      const inheritedColor = this.gameState.inherited[player.colorIndex];
      if (inheritedColor) myColors.push(inheritedColor);

      // The piece being moved must belong to this player
      const piece = this.gameState.board[msg.from[0]][msg.from[1]];
      if (!piece || !myColors.includes(piece.color)) return;

      // Apply move
      this.gameState = this.applyMove(this.gameState, msg.from, msg.to);
      this.broadcast({ type: "state", state: this.gameState, players: this.getPlayersInfo() });

      if (this.gameState.winner) {
        this.broadcast({ type: "gameover", winner: this.gameState.winner });
      }
    }

    if (msg.type === "pass") {
      const player = this.players.get(sender.id);
      if (!player) return;
      if (!this.gameState) return;
      const pid = player.colorIndex;
      const teammate = this.getTeammate(pid);
      if (!this.gameState.eliminated[teammate]) {
        this.gameState.turnIndex = teammate;
        this.broadcast({ type: "state", state: this.gameState, players: this.getPlayersInfo() });
      }
    }

    if (msg.type === "reset") {
      this.gameState = this.createInitialState();
      this.broadcast({ type: "start", state: this.gameState, players: this.getPlayersInfo() });
    }
  }

  onClose(conn) {
    const player = this.players.get(conn.id);
    if (player) {
      this.assignedColors[player.colorIndex] = false;
      this.players.delete(conn.id);
      this.broadcast({ type: "players", players: this.getPlayersInfo() });
    }
  }

  broadcast(msg) {
    this.room.broadcast(JSON.stringify(msg));
  }

  getPlayersInfo() {
    const info = [null, null, null, null];
    for (const [id, p] of this.players) {
      info[p.colorIndex] = { name: p.name, colorIndex: p.colorIndex };
    }
    return info;
  }

  getTeammate(pid) {
    const teams = [[0, 2], [1, 3]];
    const team = teams.find(t => t.includes(pid));
    return team.find(i => i !== pid);
  }

  createInitialState() {
    const board = Array(8).fill(null).map(() => Array(16).fill(null));
    const placeArmy = (row, pawnRow, colStart, color) => {
      const order = ['R','N','B','Q','K','B','N','R'];
      for (let i = 0; i < 8; i++) board[row][colStart + i] = { type: order[i], color };
      for (let i = 0; i < 8; i++) board[pawnRow][colStart + i] = { type: 'P', color };
    };
    placeArmy(0, 1, 0, 'black');
    placeArmy(7, 6, 0, 'white');
    placeArmy(0, 1, 8, 'brown');
    placeArmy(7, 6, 8, 'yellow');

    return {
      board,
      turnIndex: 0,
      eliminated: [false, false, false, false],
      inherited: [null, null, null, null],
      winner: null,
    };
  }

  applyMove(state, from, to) {
    const s = JSON.parse(JSON.stringify(state)); // deep clone
    const piece = s.board[from[0]][from[1]];
    const captured = s.board[to[0]][to[1]];
    s.board[to[0]][to[1]] = piece;
    s.board[from[0]][from[1]] = null;

    // Pawn promotion
    if (piece.type === 'P') {
      const isUpward = piece.color === 'white' || piece.color === 'yellow';
      if ((isUpward && to[0] === 0) || (!isUpward && to[0] === 7)) {
        s.board[to[0]][to[1]] = { type: 'Q', color: piece.color };
      }
    }

    // King captured -> eliminate
    if (captured && captured.type === 'K') {
      const deadIdx = ['white','black','yellow','brown'].indexOf(captured.color);
      if (deadIdx >= 0) {
        s.eliminated[deadIdx] = true;
        const tm = this.getTeammate(deadIdx);
        if (!s.eliminated[tm]) s.inherited[tm] = captured.color;
      }
    }

    // Advance turn
    s.turnIndex = (s.turnIndex + 1) % 4;
    let tries = 0;
    while (s.eliminated[s.turnIndex % 4] && tries < 4) { s.turnIndex = (s.turnIndex + 1) % 4; tries++; }

    // Check win
    const team0 = [0, 2].filter(i => !s.eliminated[i]).length;
    const team1 = [1, 3].filter(i => !s.eliminated[i]).length;
    if (team0 === 0) s.winner = 'Tume tiim võitis! (Must + Pruun)';
    if (team1 === 0) s.winner = 'Hele tiim võitis! (Valge + Kollane)';

    return s;
  }
}
