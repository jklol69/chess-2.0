import { WebSocketServer } from "ws";
import { createServer } from "http";

const PORT = process.env.PORT || 8080;
const server = createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"text/plain"});
  res.end("Dual Kingdom Chess server running");
});
const wss = new WebSocketServer({server});
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),   // ws -> {name, id, isAdmin}
      assignments: {},      // colorIndex -> id  (0-3 -> playerId)
      gameState: null,
      hasMoved: {},
      nextId: 0,
      adminId: null,
    });
  }
  return rooms.get(roomId);
}

function getTeammate(pid) {
  return [[0,2],[1,3]].find(t=>t.includes(pid)).find(i=>i!==pid);
}

function createInitialState() {
  const board = Array(8).fill(null).map(()=>Array(16).fill(null));
  const place = (row, prow, col, color) => {
    ["R","N","B","Q","K","B","N","R"].forEach((t,i)=>board[row][col+i]={type:t,color});
    for(let i=0;i<8;i++) board[prow][col+i]={type:"P",color};
  };
  place(0,1,0,"black"); place(7,6,0,"white");
  place(0,1,8,"brown"); place(7,6,8,"yellow");
  return {board, turnIndex:0, eliminated:[false,false,false,false], inherited:[null,null,null,null], winner:null};
}

function applyMove(state, hasMoved, from, to, castle, rookFrom, rookTo) {
  const s = JSON.parse(JSON.stringify(state));
  const hm = {...hasMoved};
  const piece = s.board[from[0]][from[1]];
  const captured = s.board[to[0]][to[1]];

  if (castle && rookFrom && rookTo) {
    s.board[to[0]][to[1]] = piece;
    s.board[from[0]][from[1]] = null;
    s.board[rookTo[0]][rookTo[1]] = s.board[rookFrom[0]][rookFrom[1]];
    s.board[rookFrom[0]][rookFrom[1]] = null;
    hm[`${from[0]},${from[1]}`] = true;
    hm[`${rookFrom[0]},${rookFrom[1]}`] = true;
  } else {
    s.board[to[0]][to[1]] = piece;
    s.board[from[0]][from[1]] = null;
    hm[`${from[0]},${from[1]}`] = true;
    if (piece.type==="P") {
      const up = piece.color==="white"||piece.color==="yellow";
      if((up&&to[0]===0)||(!up&&to[0]===7)) s.board[to[0]][to[1]]={type:"Q",color:piece.color};
    }
  }

  if (captured && captured.type==="K") {
    const di = ["white","black","yellow","brown"].indexOf(captured.color);
    if(di>=0){ s.eliminated[di]=true; const tm=getTeammate(di); if(!s.eliminated[tm]) s.inherited[tm]=captured.color; }
  }

  s.turnIndex=(s.turnIndex+1)%4;
  let tries=0;
  while(s.eliminated[s.turnIndex%4]&&tries<4){s.turnIndex=(s.turnIndex+1)%4;tries++;}

  const t0=[0,2].filter(i=>!s.eliminated[i]).length;
  const t1=[1,3].filter(i=>!s.eliminated[i]).length;
  if(t0===0) s.winner="Tume tiim võitis! (Must + Pruun)";
  if(t1===0) s.winner="Hele tiim võitis! (Valge + Kollane)";

  return {state:s, hasMoved:hm};
}

// Returns list of players with their assigned colors
function getPlayersInfo(room) {
  const list = [];
  for(const [,p] of room.players) {
    const colors = Object.entries(room.assignments)
      .filter(([,id])=>id===p.id)
      .map(([ci])=>parseInt(ci));
    list.push({id:p.id, name:p.name, isAdmin:p.isAdmin, colors});
  }
  return list;
}

function broadcast(room, msg) {
  const str = JSON.stringify(msg);
  for(const [ws] of room.players) if(ws.readyState===1) ws.send(str);
}

wss.on("connection",(ws,req)=>{
  const url = new URL(req.url,"http://localhost");
  const roomId = url.searchParams.get("room")||"main";
  const room = getOrCreateRoom(roomId);

  ws.on("message",raw=>{
    const msg = JSON.parse(raw);

    if(msg.type==="join") {
      const id = room.nextId++;
      const isAdmin = room.players.size === 0;
      if(isAdmin) room.adminId = id;
      room.players.set(ws, {name: msg.name||`Mängija ${id+1}`, id, isAdmin});

      ws.send(JSON.stringify({
        type:"joined",
        id,
        isAdmin,
        assignments: room.assignments,
        players: getPlayersInfo(room),
        gameState: room.gameState,
        hasMoved: room.hasMoved,
      }));
      broadcast(room, {type:"players", players:getPlayersInfo(room), assignments:room.assignments});
    }

    if(msg.type==="assign") {
      const player = room.players.get(ws);
      if(!player||!player.isAdmin) return;
      // msg.assignments = { colorIndex: playerId or null }
      Object.assign(room.assignments, msg.assignments);
      broadcast(room, {type:"players", players:getPlayersInfo(room), assignments:room.assignments});
    }

    if(msg.type==="start") {
      const player = room.players.get(ws);
      if(!player||!player.isAdmin) return;
      // All 4 colors must be assigned
      if(Object.keys(room.assignments).length < 4) {
        ws.send(JSON.stringify({type:"error",message:"Kõik 4 värvi peavad olema assignitud enne alustamist."}));
        return;
      }
      room.gameState = createInitialState();
      room.hasMoved = {};
      broadcast(room, {type:"start", state:room.gameState, hasMoved:room.hasMoved,
        players:getPlayersInfo(room), assignments:room.assignments});
    }

    if(msg.type==="move") {
      const player = room.players.get(ws);
      if(!player||!room.gameState) return;
      // Which color indices does this player control?
      const myColorIndices = Object.entries(room.assignments)
        .filter(([,id])=>id===player.id)
        .map(([ci])=>parseInt(ci));
      const COLORS=["white","black","yellow","brown"];
      const myColors = myColorIndices.map(i=>COLORS[i]);
      // Also add inherited colors
      myColorIndices.forEach(ci=>{
        if(room.gameState.inherited[ci]) myColors.push(room.gameState.inherited[ci]);
      });
      const piece = room.gameState.board[msg.from[0]][msg.from[1]];
      if(!piece||!myColors.includes(piece.color)) return;
      const result = applyMove(room.gameState,room.hasMoved,msg.from,msg.to,msg.castle,msg.rookFrom,msg.rookTo);
      room.gameState = result.state;
      room.hasMoved = result.hasMoved;
      broadcast(room, {type:"state", state:room.gameState, hasMoved:room.hasMoved,
        players:getPlayersInfo(room), assignments:room.assignments});
      if(room.gameState.winner) broadcast(room, {type:"gameover", winner:room.gameState.winner});
    }

    if(msg.type==="pass") {
      const player = room.players.get(ws);
      if(!player||!room.gameState) return;
      const myColorIndices = Object.entries(room.assignments)
        .filter(([,id])=>id===player.id)
        .map(([ci])=>parseInt(ci));
      const cur = room.gameState.turnIndex%4;
      if(!myColorIndices.includes(cur)) return;
      const tm = getTeammate(cur);
      if(!room.gameState.eliminated[tm]){
        room.gameState.turnIndex = tm;
        broadcast(room, {type:"state", state:room.gameState, hasMoved:room.hasMoved,
          players:getPlayersInfo(room), assignments:room.assignments});
      }
    }

    if(msg.type==="reset") {
      const player = room.players.get(ws);
      if(!player||!player.isAdmin) return;
      room.gameState = createInitialState();
      room.hasMoved = {};
      broadcast(room, {type:"start", state:room.gameState, hasMoved:room.hasMoved,
        players:getPlayersInfo(room), assignments:room.assignments});
    }
  });

  ws.on("close",()=>{
    const player = room.players.get(ws);
    if(player){
      room.players.delete(ws);
      broadcast(room, {type:"players", players:getPlayersInfo(room), assignments:room.assignments});
    }
  });
});

server.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
