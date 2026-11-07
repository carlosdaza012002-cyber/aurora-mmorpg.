const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const db = require("./db");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_PLAYERS = Math.max(1, Number(process.env.MAX_PLAYERS || 200));
const WORLD_NAME = process.env.WORLD_NAME || "Valle de Aurora";
const SECRET = process.env.TOKEN_SECRET || "development-secret-change-before-deploy";
const WORLD_LIMIT = 48, ZONE_ID = "valle-aurora-1";

function makeToken(payload) {
  const body=Buffer.from(JSON.stringify({...payload,exp:Date.now()+7*86400000})).toString("base64url");
  const sig=crypto.createHmac("sha256",SECRET).update(body).digest("base64url");return body+"."+sig;
}
function verifyToken(token) {
  if(!token||typeof token!=="string")return null;const [body,sig]=token.split(".");if(!body||!sig)return null;
  const expected=crypto.createHmac("sha256",SECRET).update(body).digest();let actual;
  try{actual=Buffer.from(sig,"base64url");}catch{return null;}
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
  try{const d=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));return d.exp>Date.now()?d:null;}catch{return null;}
}
function hashPassword(password,salt=crypto.randomBytes(16).toString("hex")){
  return {salt,hash:crypto.scryptSync(password,salt,64).toString("hex")};
}
function validEmail(email){return typeof email==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=180;}
function publicUser(u){return{id:u.id,email:u.email,characterName:u.characterName||"Aventurero",characterClass:u.characterClass||"Guerrero"};}

const app=express();app.disable("x-powered-by");app.use(express.json({limit:"20kb"}));app.use(express.static(require("path").join(__dirname,"public")));
// Small in-memory auth throttle for the starter. Use a shared rate-limit store in a multi-instance deployment.
const attempts=new Map();
app.use(["/api/login","/api/register"],(req,res,next)=>{
  const key=req.ip+":"+req.path,now=Date.now(),entry=attempts.get(key)||{count:0,start:now};
  if(now-entry.start>60000){entry.count=0;entry.start=now;}entry.count++;attempts.set(key,entry);
  if(entry.count>20)return res.status(429).json({error:"Demasiados intentos. Espera un minuto."});next();
});
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:false},maxHttpBufferSize:1e5,transports:["websocket","polling"]});
const players=new Map(),classes=new Set(["Guerrero","Maga","Arquero"]);

app.get("/api/status",(req,res)=>res.json({ok:true,world:WORLD_NAME,online:players.size,capacity:MAX_PLAYERS,storage:db.storageMode,zone:ZONE_ID}));
app.post("/api/register",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");
    const characterName=String(req.body.characterName||"Aventurero").trim().slice(0,18)||"Aventurero";
    if(!validEmail(email))return res.status(400).json({error:"Escribe un correo válido."});
    if(password.length<8||password.length>200)return res.status(400).json({error:"La contraseña debe tener al menos 8 caracteres."});
    const c=hashPassword(password),user={id:crypto.randomUUID(),email,characterName,characterClass:"Guerrero",salt:c.salt,passwordHash:c.hash,createdAt:new Date().toISOString()};
    await db.createUser(user);res.status(201).json({token:makeToken({sub:user.id}),user:publicUser(user)});
  }catch(err){if(err.code==="23505")return res.status(409).json({error:"Ese correo ya está registrado."});console.error("Register error:",err);res.status(500).json({error:"No se pudo crear la cuenta."});}
});
app.post("/api/login",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");
    const user=await db.findUserByEmail(email);if(!user)return res.status(401).json({error:"Correo o contraseña incorrectos."});
    const candidate=crypto.scryptSync(password,user.salt,64),stored=Buffer.from(user.passwordHash,"hex");
    if(candidate.length!==stored.length||!crypto.timingSafeEqual(candidate,stored))return res.status(401).json({error:"Correo o contraseña incorrectos."});
    res.json({token:makeToken({sub:user.id}),user:publicUser(user)});
  }catch(err){console.error("Login error:",err);res.status(500).json({error:"No se pudo iniciar sesión."});}
});
app.get("/api/me",async(req,res)=>{
  try{const claims=verifyToken((req.headers.authorization||"").replace(/^Bearer\s+/i,""));if(!claims)return res.status(401).json({error:"Sesión no válida."});
    const user=await db.findUserById(claims.sub);if(!user)return res.status(401).json({error:"Cuenta no encontrada."});res.json({user:publicUser(user)});
  }catch(err){console.error("Session error:",err);res.status(500).json({error:"No se pudo validar la sesión."});}
});

io.use(async(socket,next)=>{try{const claims=verifyToken(socket.handshake.auth?.token);if(!claims)return next(new Error("Inicia sesión para entrar al mundo."));
  const user=await db.findUserById(claims.sub);if(!user)return next(new Error("Cuenta no encontrada."));socket.user=publicUser(user);next();
}catch(e){next(new Error("No se pudo validar la cuenta."));}});
io.on("connection",socket=>{
  if(players.size>=MAX_PLAYERS){socket.emit("server-full",{message:"El servidor está lleno. Inténtalo más tarde."});socket.disconnect(true);return;}
  const room=ZONE_ID;socket.join(room);
  const existing=[...players.values()].filter(p=>p.zone===room);
  const player={id:socket.id,userId:socket.user.id,name:socket.user.characterName,characterClass:socket.user.characterClass,
    x:0,z:0,rotation:0,running:false,zone:room,lastMoveAt:0};
  players.set(socket.id,player);
  socket.emit("world-state",{world:WORLD_NAME,zone:room,selfId:socket.id,players:existing.map(({lastMoveAt,...p})=>p)});
  socket.to(room).emit("player-joined",player);io.emit("online-count",players.size);
  socket.on("choose-character",async data=>{
    if(!data||!classes.has(data.characterClass))return;
    player.characterClass=data.characterClass;player.name=String(data.name||player.name).trim().slice(0,18)||player.name;
    try{await db.updateUserCharacter(player.userId,player.name,player.characterClass);}
    catch(err){console.error("Character save error:",err);socket.emit("system-message",{message:"No se pudo guardar la selección del personaje."});}
    socket.to(room).emit("player-updated",player);
  });
  socket.on("move",data=>{
    if(!data||!Number.isFinite(data.x)||!Number.isFinite(data.z)||!Number.isFinite(data.rotation))return;
    const now=Date.now(),elapsed=Math.max(.05,Math.min(.25,(now-(player.lastMoveAt||now-100))/1000));
    const x=Math.max(-WORLD_LIMIT,Math.min(WORLD_LIMIT,data.x)),z=Math.max(-WORLD_LIMIT,Math.min(WORLD_LIMIT,data.z));
    const distance=Math.hypot(x-player.x,z-player.z),maxStep=12*elapsed+.8;
    if(distance>maxStep)return; // reject teleport-sized client corrections
    player.x=x;player.z=z;player.rotation=Math.max(-Math.PI*2,Math.min(Math.PI*2,data.rotation));player.running=!!data.running;player.lastMoveAt=now;
    const {lastMoveAt,...snapshot}=player;socket.to(room).volatile.emit("player-moved",snapshot);
  });
  socket.on("chat",data=>{const message=String(data?.message||"").trim().slice(0,160);if(!message)return;io.to(room).emit("chat-message",{name:player.name,message,at:Date.now()});});
  socket.on("disconnect",()=>{players.delete(socket.id);socket.to(room).emit("player-left",socket.id);io.emit("online-count",players.size);});
});

(async()=>{try{await db.initStorage();server.listen(PORT,HOST,()=>{console.log(`Aurora MMORPG at http://${HOST}:${PORT}`);console.log(`World: ${WORLD_NAME} | zone: ${ZONE_ID} | cap: ${MAX_PLAYERS}`);});}
catch(err){console.error("Startup failed:",err);process.exit(1);}})();
