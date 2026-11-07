import * as THREE from "three";

const $ = id => document.getElementById(id);
const screens = ["loading","authScreen","characterScreen","gameScreen"];
let token = localStorage.getItem("auroraToken") || "";
let currentUser = null, registerMode = false, selectedClass = "Guerrero";
let socket = null, scene, camera, renderer, hero, clock, worldReady = false;
let remote = new Map(), keys = new Set(), touchMove = new Set(), lastSend = 0;
const walkSpeed = 6.5, runSpeed = 10.5;
const playerMeshes = new Map();

function show(id) { screens.forEach(s => $(s).classList.toggle("hidden", s !== id)); }
function setError(message) { $("authError").textContent = message || ""; }
function loading() {
  show("loading"); let p = 0;
  const timer = setInterval(() => {
    p = Math.min(100, p + 13 + Math.random() * 15);
    $("progressFill").style.width = p + "%";
    $("loadingText").textContent = `Preparando el portal · ${Math.floor(p)}%`;
    if (p >= 100) {
      clearInterval(timer);
      setTimeout(async () => {
        if (token) {
          try { const r = await fetch("/api/me",{headers:{Authorization:"Bearer "+token}}); if(!r.ok) throw Error(); currentUser=(await r.json()).user; show("characterScreen"); $("heroName").value=currentUser.characterName; }
          catch { token="";localStorage.removeItem("auroraToken");show("authScreen"); }
        } else show("authScreen");
      }, 250);
    }
  }, 130);
}
function setAuthMode() {
  $("authTitle").textContent = registerMode ? "Crea tu leyenda" : "Bienvenido, viajero";
  $("authSubmit").textContent = registerMode ? "Crear cuenta" : "Entrar al reino";
  $("toggleAuth").textContent = registerMode ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta";
  $("nameWrap").classList.toggle("hidden", !registerMode);
  $("password").autocomplete = registerMode ? "new-password" : "current-password";
  setError("");
}
$("toggleAuth").onclick = () => { registerMode = !registerMode; setAuthMode(); };
$("authForm").onsubmit = async e => {
  e.preventDefault(); setError(""); $("authSubmit").disabled = true;
  try {
    const payload = {email:$("email").value,password:$("password").value,characterName:$("characterName").value};
    const r = await fetch(registerMode?"/api/register":"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data = await r.json(); if(!r.ok) throw Error(data.error || "No se pudo iniciar sesión.");
    token=data.token;currentUser=data.user;localStorage.setItem("auroraToken",token);
    $("heroName").value=currentUser.characterName;show("characterScreen");
  } catch(err) { setError(err.message); }
  finally { $("authSubmit").disabled=false; }
};
document.querySelectorAll(".class-choice").forEach(btn => btn.onclick = () => {
  document.querySelectorAll(".class-choice").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");selectedClass=btn.dataset.class;
});
$("logout").onclick = () => { token="";currentUser=null;localStorage.removeItem("auroraToken");show("authScreen"); };
$("enterWorld").onclick = () => startGame();
$("exitWorld").onclick = () => { if(socket)socket.disconnect();socket=null;show("characterScreen"); };
$("chatForm").onsubmit = e => { e.preventDefault();const message=$("chatInput").value.trim();if(message&&socket?.connected){socket.emit("chat",{message});$("chatInput").value="";} };

function makeAvatar(characterClass="Guerrero", isSelf=false) {
  const group = new THREE.Group();
  const palette = characterClass === "Maga"
    ? { cloth:0x7654b8, accent:0xe6c8ff, hair:0x30214f, boot:0x33264c }
    : characterClass === "Arquero"
      ? { cloth:0x397e69, accent:0xd8c78c, hair:0x70452e, boot:0x263e39 }
      : { cloth:0x486aa8, accent:0xe2c17c, hair:0x29233f, boot:0x26334f };
  if (isSelf) palette.cloth = 0x7861bd;

  const mat = (color, roughness=.72, metalness=0) =>
    new THREE.MeshStandardMaterial({color, roughness, metalness});
  const skin = mat(0xffd5bd,.86);
  const cloth = mat(palette.cloth);
  const accent = mat(palette.accent,.58,.12);
  const dark = mat(palette.boot);
  const hair = mat(palette.hair);
  const white = new THREE.MeshBasicMaterial({color:0xffffff});
  const iris = new THREE.MeshBasicMaterial({color:characterClass==="Maga"?0x9b62e8:0x365f9c});
  const pupil = new THREE.MeshBasicMaterial({color:0x17172a});
  const addMesh = (parent, geometry, material, pos=[0,0,0], scale=null) => {
    const m = new THREE.Mesh(geometry,material);
    m.position.set(...pos);
    if(scale)m.scale.set(...scale);
    m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
  };
  const capsule = (radius,length,material,parent,pos=[0,0,0]) =>
    addMesh(parent,new THREE.CapsuleGeometry(radius,length,4,8),material,pos);

  // Soft ground shadow and a fully articulated, stylized anime adventurer.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.55,24),
    new THREE.MeshBasicMaterial({color:0x17203a,transparent:true,opacity:.22}));
  shadow.rotation.x=-Math.PI/2; shadow.position.y=.025; group.add(shadow);

  const hips = new THREE.Group(); hips.position.y=.92; group.add(hips);
  addMesh(hips,new THREE.SphereGeometry(.31,14,10),cloth,[0,0,0],[1,.62,.72]);
  const torso = new THREE.Group(); torso.position.y=.13; hips.add(torso);
  capsule(.30,.48,cloth,torso,[0,.30,0]);
  addMesh(torso,new THREE.BoxGeometry(.58,.13,.39),accent,[0,.12,.015]);
  addMesh(torso,new THREE.SphereGeometry(.105,12,10),accent,[0,.53,.02]);
  // Short coat panels add silhouette and readable motion.
  const coatL=addMesh(torso,new THREE.BoxGeometry(.19,.48,.09),cloth,[-.19,.03,-.12]);
  coatL.rotation.z=-.12;
  const coatR=addMesh(torso,new THREE.BoxGeometry(.19,.48,.09),cloth,[.19,.03,-.12]);
  coatR.rotation.z=.12;

  const neck = capsule(.105,.12,skin,torso,[0,.64,0]);
  const headPivot = new THREE.Group(); headPivot.position.set(0,.78,0); torso.add(headPivot);
  addMesh(headPivot,new THREE.SphereGeometry(.29,20,16),skin,[0,.10,0],[.88,1.08,.83]);
  // Anime eyes: whites, colored irises and dark pupils.
  for(const side of [-1,1]){
    addMesh(headPivot,new THREE.SphereGeometry(.067,12,10),white,[side*.105,.12,.235],[.82,1.12,.45]);
    addMesh(headPivot,new THREE.SphereGeometry(.041,12,10),iris,[side*.105,.115,.263]);
    addMesh(headPivot,new THREE.SphereGeometry(.022,10,8),pupil,[side*.105,.112,.285]);
  }
  addMesh(headPivot,new THREE.SphereGeometry(.31,18,10,0,Math.PI*2,0,Math.PI*.55),hair,[0,.22,-.025],[1.03,.92,.94]);
  // Layered fringe and side locks.
  for(let i=-2;i<=2;i++){
    const bang=addMesh(headPivot,new THREE.ConeGeometry(.105,.26,7),hair,[i*.105,.22,.22]);
    bang.rotation.x=.12; bang.rotation.z=i*.17;
  }
  for(const side of [-1,1]){
    const lock=addMesh(headPivot,new THREE.ConeGeometry(.09,.42,7),hair,[side*.245,-.02,.02]);
    lock.rotation.z=side*.16; lock.rotation.x=-.12;
  }

  const armPivots=[], legPivots=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group(); arm.position.set(side*.38,.54,0); torso.add(arm);
    arm.rotation.z=side*-.12; armPivots.push(arm);
    capsule(.105,.31,cloth,arm,[0,-.20,0]);
    const elbow=new THREE.Group(); elbow.position.y=-.39; arm.add(elbow);
    capsule(.083,.28,skin,elbow,[0,-.17,0]);
    addMesh(elbow,new THREE.SphereGeometry(.09,10,8),skin,[0,-.35,0]);
    addMesh(arm,new THREE.BoxGeometry(.24,.10,.24),accent,[0,-.05,.015]);

    const leg=new THREE.Group(); leg.position.set(side*.17,-.12,0); hips.add(leg);
    legPivots.push(leg);
    capsule(.125,.31,cloth,leg,[0,-.20,0]);
    const knee=new THREE.Group(); knee.position.y=-.39; leg.add(knee);
    capsule(.105,.30,dark,knee,[0,-.17,.005]);
    addMesh(knee,new THREE.BoxGeometry(.23,.13,.34),accent,[0,-.35,.07]);
  }

  // Class-specific visual accent: staff, bow-like curve or sword.
  if(characterClass==="Maga"){
    const staff=new THREE.Group(); staff.position.set(.48,.75,-.02); torso.add(staff);
    const rod=addMesh(staff,new THREE.CylinderGeometry(.025,.035,.95,8),dark,[0,-.30,0]);
    const orb=addMesh(staff,new THREE.SphereGeometry(.13,14,12),mat(0xb98aff,.25,.2),[0,.22,0]);
    orb.material.emissive=new THREE.Color(0x512c99); orb.material.emissiveIntensity=.55;
  } else if(characterClass==="Guerrero"){
    const sword=new THREE.Group(); sword.position.set(.48,.58,.02); torso.add(sword); sword.rotation.z=-.25;
    addMesh(sword,new THREE.BoxGeometry(.075,.72,.035),accent,[0,-.24,0]);
    addMesh(sword,new THREE.BoxGeometry(.25,.07,.10),dark,[0,-.57,0]);
  } else {
    const bow=new THREE.Group(); bow.position.set(.48,.62,-.02); torso.add(bow);
    const curve=new THREE.Mesh(new THREE.TorusGeometry(.24,.025,6,18,Math.PI),accent);
    curve.rotation.z=Math.PI/2; bow.add(curve);
    const string=addMesh(bow,new THREE.CylinderGeometry(.008,.008,.48,5),white,[0,-.01,0]);
  }

  group.userData.rig={hips,torso,headPivot,armPivots,legPivots,shadow,phase:Math.random()*6.28,mode:"idle",blink:0,blinkAt:2+Math.random()*3};
  return group;
}
function animateAvatar(mesh, dt, moving=false, running=false) {
  const rig=mesh?.userData?.rig; if(!rig)return;
  const mode=running?"run":moving?"walk":"idle";
  rig.phase += dt * (running?13.5:moving?8.2:2.0);
  const t=rig.phase, stride=running?1.0:.72;
  // Idle breathing is subtle; walk/run use a clear opposing arm-leg cycle.
  const bob=moving?Math.abs(Math.sin(t))*(running?.105:.065):Math.sin(t)*.018;
  rig.hips.position.y=.92+bob;
  rig.torso.rotation.z=moving?Math.sin(t)* (running?.055:.035):Math.sin(t)*.012;
  rig.torso.rotation.x=moving?(running?-.045:-.018):0;
  rig.headPivot.rotation.z=Math.sin(t*.5)*.025;
  rig.headPivot.rotation.x=moving?-.025:Math.sin(t*.7)*.012;
  rig.armPivots.forEach((arm,i)=>{
    const swing=moving?Math.sin(t+i*Math.PI)*(running?.88:.62):Math.sin(t+i)*.035;
    arm.rotation.x=swing;
    arm.rotation.z=(i===0?-.12:.12)+(moving?Math.cos(t+i*Math.PI)*(running?.10:.045):0);
  });
  rig.legPivots.forEach((leg,i)=>{
    leg.rotation.x=moving?Math.sin(t+i*Math.PI)*(running?1.02:.72):Math.sin(t+i)*.025;
  });
  rig.shadow.scale.setScalar(moving?(running?1.12:1.05):1);
  rig.shadow.material.opacity=moving?.17:.22;
  rig.mode=mode;
}

function initScene() {
  const host=$("gameCanvas");scene=new THREE.Scene();scene.background=new THREE.Color(0x9bb8e8);scene.fog=new THREE.Fog(0x9bb8e8,35,95);
  camera=new THREE.PerspectiveCamera(55,host.clientWidth/host.clientHeight,.1,150);camera.position.set(0,7,12);
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.replaceChildren(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xdceaff,0x53604b,2));
  const sun=new THREE.DirectionalLight(0xffe6bd,2.2);sun.position.set(-10,20,8);sun.castShadow=true;scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:0x648b68,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const pathMat=new THREE.MeshStandardMaterial({color:0xc8b58f});
  const road=new THREE.Mesh(new THREE.PlaneGeometry(8,120),pathMat);road.rotation.x=-Math.PI/2;road.position.y=.015;scene.add(road);
  // Simple stylized anime-fantasy village landmarks.
  for(let i=0;i<18;i++){
    const x=(i%6-2.5)*12, z=(Math.floor(i/6)-1)*18-8;
    const base=new THREE.Mesh(new THREE.BoxGeometry(5,3.4,5),new THREE.MeshStandardMaterial({color:[0xd8c5ad,0xc8b6d9,0xe1d0a5][i%3]}));
    base.position.set(x,1.7,z);base.castShadow=true;base.receiveShadow=true;scene.add(base);
    const roof=new THREE.Mesh(new THREE.ConeGeometry(4.2,2.8,4),new THREE.MeshStandardMaterial({color:[0x76537d,0x9c554e,0x3d6683][i%3]}));
    roof.position.set(x,4.8,z);roof.rotation.y=Math.PI/4;roof.castShadow=true;scene.add(roof);
  }
  for(let i=0;i<35;i++){
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.18,.25,1.5,7),new THREE.MeshStandardMaterial({color:0x684832}));
    const crown=new THREE.Mesh(new THREE.SphereGeometry(1.25,9,7),new THREE.MeshStandardMaterial({color:i%2?0x4c956b:0x5c9b78}));
    const x=(Math.random()-.5)*90,z=(Math.random()-.5)*90;
    if(Math.abs(x)<7)continue;
    trunk.position.set(x,.75,z);crown.position.set(x,2,z);scene.add(trunk,crown);
  }
  hero=makeAvatar("Guerrero",true);scene.add(hero);hero.position.set(0,0,0);
  clock=new THREE.Clock();window.addEventListener("resize",resize);animate();
}
function resize(){if(!renderer)return;const host=$("gameCanvas");camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);}
function addRemote(p){
  if(playerMeshes.has(p.id))return;
  const mesh=makeAvatar(p.characterClass || "Guerrero", false);
  mesh.position.set(p.x,0,p.z);mesh.rotation.y=p.rotation||0;
  mesh.userData.net={target:new THREE.Vector3(p.x,0,p.z),rotation:p.rotation||0,lastMove:0,running:false};
  scene.add(mesh);playerMeshes.set(p.id,mesh);remote.set(p.id,p);
}
function updateRemote(p){
  const m=playerMeshes.get(p.id);if(!m){addRemote(p);return;}
  const net=m.userData.net;
  if(net){const next=new THREE.Vector3(p.x,0,p.z);if(next.distanceToSquared(net.target)>.0004)net.lastMove=performance.now();net.target.copy(next);net.rotation=p.rotation||0;net.running=!!p.running;}
  m.rotation.y=p.rotation||0;remote.set(p.id,p);
}
function removeRemote(id){const m=playerMeshes.get(id);if(m){scene.remove(m);playerMeshes.delete(id);}remote.delete(id);}

function animate(){
  requestAnimationFrame(animate);if(!renderer||!worldReady)return;
  const dt=Math.min(clock.getDelta(),.05);let dx=0,dz=0;
  if(keys.has("w")||keys.has("arrowup")||touchMove.has("forward"))dz-=1;
  if(keys.has("s")||keys.has("arrowdown")||touchMove.has("back"))dz+=1;
  if(keys.has("a")||keys.has("arrowleft")||touchMove.has("left"))dx-=1;
  if(keys.has("d")||keys.has("arrowright")||touchMove.has("right"))dx+=1;
  const moving=!!(dx||dz), running=moving&&(keys.has("shift")||touchMove.has("run"));
  if(moving){const len=Math.hypot(dx,dz);dx/=len;dz/=len;const speed=running?runSpeed:walkSpeed;hero.position.x=THREE.MathUtils.clamp(hero.position.x+dx*speed*dt,-48,48);hero.position.z=THREE.MathUtils.clamp(hero.position.z+dz*speed*dt,-48,48);hero.rotation.y=Math.atan2(dx,dz);if(socket&&performance.now()-lastSend>65){socket.emit("move",{x:hero.position.x,z:hero.position.z,rotation:hero.rotation.y,running});lastSend=performance.now();}}
  animateAvatar(hero,dt,moving,running);
  const now=performance.now();
  for(const [id,mesh] of playerMeshes){
    const net=mesh.userData.net;if(!net)continue;
    // Smooth network corrections instead of teleporting on every packet.
    mesh.position.lerp(net.target,Math.min(1,dt*12));
    const turnDelta=Math.atan2(Math.sin(net.rotation-mesh.rotation.y),Math.cos(net.rotation-mesh.rotation.y));
    mesh.rotation.y+=turnDelta*Math.min(1,dt*10);
    const remoteMoving=now-net.lastMove<220;
    animateAvatar(mesh,dt,remoteMoving,remoteMoving&&net.running);
  }
  camera.position.lerp(new THREE.Vector3(hero.position.x,hero.position.y+7,hero.position.z+11),.08);camera.lookAt(hero.position.x,1,hero.position.z);
  renderer.render(scene,camera);
}
window.addEventListener("keydown",e=>{if(["INPUT"].includes(document.activeElement.tagName))return;keys.add(e.key.toLowerCase());});
window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
document.querySelectorAll("[data-move]").forEach(btn=>{
  const key=btn.dataset.move;
  btn.addEventListener("pointerdown",e=>{e.preventDefault();touchMove.add(key);});
  ["pointerup","pointercancel","pointerleave"].forEach(ev=>btn.addEventListener(ev,()=>touchMove.delete(key)));
});
function addChat(item){const row=document.createElement("div");const name=document.createElement("b");name.textContent=item.name+": ";const msg=document.createElement("span");msg.textContent=item.message;row.append(name,msg);$("chatLog").append(row);$("chatLog").scrollTop=$("chatLog").scrollHeight;}
async function startGame(){
  selectedClass=selectedClass||"Guerrero";
  if(!worldReady){initScene();worldReady=true;}
  if(hero){scene.remove(hero);hero=makeAvatar(selectedClass,true);scene.add(hero);}
  hero.position.set(0,0,0);show("gameScreen");
  $("playerLabel").textContent=$("heroName").value.trim()||currentUser.characterName;
  try{
    socket=io({auth:{token}});
    socket.on("connect",()=>{socket.emit("choose-character",{characterClass:selectedClass,name:$("heroName").value.trim()||currentUser.characterName});});
    socket.on("connect_error",err=>addChat({name:"Sistema",message:err.message}));
    socket.on("world-state",data=>{$("worldName").textContent=data.world;data.players.forEach(addRemote);});
    socket.on("player-joined",addRemote);socket.on("player-updated",updateRemote);socket.on("player-moved",updateRemote);socket.on("player-left",removeRemote);
    socket.on("online-count",n=>$("onlineCount").textContent=n);
    socket.on("chat-message",addChat);socket.on("system-message",data=>addChat({name:"Sistema",message:data.message}));
    socket.on("server-full",data=>addChat({name:"Sistema",message:data.message}));
  }catch(err){addChat({name:"Sistema",message:"No se pudo conectar al servidor."});}
}
loading();