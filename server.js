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
      players: new Map(),
      assignedSlots: [false,false,false,false],
      gameState: null,
      hasMoved: {},
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
    // Move king
    s.board[to[0]][to[1]] = piece;
    s.board[from[0]][from[1]] = null;
    // Move rook
    s.board[rookTo[0]][rookTo[1]] = s.board[rookFrom[0]][rookFrom[1]];
    s.board[rookFrom[0]][rookFrom[1]] = null;
    hm[`${from[0]},${from[1]}`] = true;
    hm[`${rookFrom[0]},${rookFrom[1]}`] = true;
  } else {
    s.board[to[0]][to[1]] = piece;
    s.board[from[0]][from[1]] = null;
    hm[`${from[0]},${from[1]}`] = true;
    // Pawn promotion
    if (piece.type==="P") {
      const up = piece.color==="white"||piece.color==="yellow";
      if((up&&to[0]===0)||(!up&&to[0]===7)) s.board[to[0]][to[1]]={type:"Q",color:piece.color};
    }
  }
 
  // King captured -> eliminate
  if (captured && captured.type==="K") {
    const di = ["white","black","yellow","brown"].indexOf(captured.color);
    if(di>=0){ s.eliminated[di]=true; const tm=getTeammate(di); if(!s.eliminated[tm]) s.inherited[tm]=captured.color; }
  }
 
  // Advance turn
  s.turnIndex=(s.turnIndex+1)%4;
  let tries=0;
  while(s.eliminated[s.turnIndex%4]&&tries<4){s.turnIndex=(s.turnIndex+1)%4;tries++;}
 
  const t0=[0,2].filter(i=>!s.eliminated[i]).length;
  const t1=[1,3].filter(i=>!s.eliminated[i]).length;
  if(t0===0) s.winner="Tume tiim v천itis! (Must + Pruun)";
  if(t1===0) s.winner="Hele tiim v천itis! (Valge + Kollane)";
 
  return {state:s, hasMoved:hm};
}
 
function getPlayersInfo(room) {
  const info=[null,null,null,null];
  for(const[,p] of room.players) info[p.colorIndex]={name:p.name,colorIndex:p.colorIndex};
  return info;
}
 
function broadcast(room, msg) {
  const str=JSON.stringify(msg);
  for(const[ws] of room.players) if(ws.readyState===1) ws.send(str);
}
 
const COLORS=["white","black","yellow","brown"];
 
wss.on("connection",(ws,req)=>{
  const url=new URL(req.url,"http://localhost");
  const roomId=url.searchParams.get("room")||"main";
  const room=getOrCreateRoom(roomId);
 
  if(room.gameState) ws.send(JSON.stringify({type:"state",state:room.gameState,hasMoved:room.hasMoved,players:getPlayersInfo(room)}));
  else ws.send(JSON.stringify({type:"waiting",players:getPlayersInfo(room)}));
 
  ws.on("message",raw=>{
    const msg=JSON.parse(raw);
 
    if(msg.type==="join"){
      const slot=room.assignedSlots.indexOf(false);
      if(slot===-1){ws.send(JSON.stringify({type:"error",message:"Tuba on t채is (4/4)"}));return;}
      room.assignedSlots[slot]=true;
      room.players.set(ws,{name:msg.name||`M채ngija ${slot+1}`,colorIndex:slot});
      ws.send(JSON.stringify({type:"joined",colorIndex:slot,colorName:COLORS[slot]}));
      broadcast(room,{type:"players",players:getPlayersInfo(room)});
      if(room.assignedSlots.every(Boolean)&&!room.gameState){
        room.gameState=createInitialState();
        room.hasMoved={};
        broadcast(room,{type:"start",state:room.gameState,hasMoved:room.hasMoved,players:getPlayersInfo(room)});
      }
    }
 
    if(msg.type==="move"){
      const player=room.players.get(ws);
      if(!player||!room.gameState) return;
      const colors=[COLORS[player.colorIndex]];
      if(room.gameState.inherited[player.colorIndex]) colors.push(room.gameState.inherited[player.colorIndex]);
      const piece=room.gameState.board[msg.from[0]][msg.from[1]];
      if(!piece||!colors.includes(piece.color)) return;
      const result=applyMove(room.gameState,room.hasMoved,msg.from,msg.to,msg.castle,msg.rookFrom,msg.rookTo);
      room.gameState=result.state;
      room.hasMoved=result.hasMoved;
      broadcast(room,{type:"state",state:room.gameState,hasMoved:room.hasMoved,players:getPlayersInfo(room)});
      if(room.gameState.winner) broadcast(room,{type:"gameover",winner:room.gameState.winner});
    }
 
    if(msg.type==="pass"){
      const player=room.players.get(ws);
      if(!player||!room.gameState) return;
      const tm=getTeammate(player.colorIndex);
      if(!room.gameState.eliminated[tm]){
        room.gameState.turnIndex=tm;
        broadcast(room,{type:"state",state:room.gameState,hasMoved:room.hasMoved,players:getPlayersInfo(room)});
      }
    }
 
    if(msg.type==="reset"){
      room.gameState=createInitialState();
      room.hasMoved={};
      broadcast(room,{type:"start",state:room.gameState,hasMoved:room.hasMoved,players:getPlayersInfo(room)});
    }
  });
 
  ws.on("close",()=>{
    const player=room.players.get(ws);
    if(player){
      room.assignedSlots[player.colorIndex]=false;
      room.players.delete(ws);
      broadcast(room,{type:"players",players:getPlayersInfo(room)});
    }
  });
});
 
server.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
