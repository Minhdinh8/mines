// app.js - frontend logic (no canvas)
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let state = {
  gameId: null,
  size: 4,
  bombs: 3,
  bet: 1,
  clientSeed: '',
  serverSeed: null,
  nonce: null,
  grid: [],
  opened: [],
  pendingQueue: [],
  auto: { mode: 'off', roundsBeforeRefresh: 40, roundsDone: 0 }
};

const spinner = $('#spinner');
function showSpinner(){spinner.classList.remove('hidden')}
function hideSpinner(){spinner.classList.add('hidden')}

function format(n){return Number(n).toFixed(4)}

function setMeta(meta){
  $('#gameId').textContent = meta.gameId || '-';
  $('#nonce').textContent = meta.nonce || '-';
  $('#serverSeed').textContent = meta.serverSeedPublic || '-';
}

function buildGrid(size){
  const wrap = $('#gridWrap');
  wrap.innerHTML = '';
  wrap.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  const total = size * size;
  for (let i = 0; i < total; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.dataset.index = i;
    c.textContent = '';
    c.addEventListener('click', () => onCellClick(i));
    wrap.appendChild(c);
  }
}

async function startGame(){
  const size = Number($('#sizeSelect').value);
  const bombs = Number($('#bombsInput').value);
  const bet = Number($('#betInput').value);
  const clientSeed = $('#clientSeed').value.trim() || (Math.random().toString(36).slice(2));
  if (bombs < 1 || bombs >= size*size) return alert('Invalid bombs count');
  showSpinner();
  try{
    const res = await fetch('/api/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ size, bombs, clientSeed, bet }) });
    const j = await res.json();
    if (!res.ok) return alert(j.error || 'Start error');
    state.size = size; state.bombs = bombs; state.bet = bet; state.clientSeed = clientSeed;
    state.gameId = j.gameId; state.serverSeed = j.serverSeedPublic; state.nonce = j.nonce; state.opened = []; state.pendingQueue = [];
    setMeta(j);
    buildGrid(size);
    $('#cashoutBtn').disabled = false; $('#verifyBtn').disabled = false;
    updateCounts();
  }catch(err){console.error(err);alert('Network error');}
  hideSpinner();
}

function updateCounts(){
  $('#pendingCount').textContent = state.pendingQueue.length;
  $('#openedCount').textContent = state.opened.length;
}

let revealTimer = null;
function enqueueReveal(index){
  if (state.opened.includes(index) || state.pendingQueue.includes(index)) return;
  state.pendingQueue.push(index);
  updateCounts();
  processQueue();
}

async function processQueue(){
  if (revealTimer) return;
  revealTimer = true;
  while (state.pendingQueue.length > 0) {
    const idx = state.pendingQueue.shift();
    updateCounts();
    const delay = 150 + Math.random()*200;
    await new Promise(r => setTimeout(r, delay));
    await revealSingle(idx);
    await new Promise(r => setTimeout(r, 30));
  }
  revealTimer = null;
}

async function revealSingle(index){
  showSpinner();
  try{
    const res = await fetch('/api/reveal', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ gameId: state.gameId, index }) });
    const j = await res.json();
    if (!res.ok) { alert(j.error || 'Reveal error'); hideSpinner(); return; }
    state.opened = j.opened;
    applyCellState(index, j.isBomb);
    $('#multiplier').textContent = j.multiplier ? Number(j.multiplier).toFixed(4) : '0';
    if (j.isBomb) {
      alert('Boom! Bạn thua.');
      $('#cashoutBtn').disabled = true;
      disableGrid();
    }
  }catch(err){console.error(err);alert('Network error');}
  hideSpinner();
  updateCounts();
}

function applyCellState(index, isBomb){
  const el = document.querySelector(`.cell[data-index='${index}']`);
  if (!el) return;
  el.classList.add('opened');
  el.textContent = isBomb ? '💣' : '💎';
  if (isBomb) el.classList.add('bomb');
}

function disableGrid(){
  $$('#gridWrap .cell').forEach(c=>{ const newc = c.cloneNode(true); c.parentNode.replaceChild(newc, c); });
}

function onCellClick(index){
  if (state.auto.mode !== 'off') return;
  enqueueReveal(index);
}

async function cashout(){
  showSpinner();
  try{
    const res = await fetch('/api/cashout', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ gameId: state.gameId }) });
    const j = await res.json();
    if (!res.ok) return alert(j.error || 'Cashout error');
    alert('Cashout thành công. Multiplier: x' + Number(j.payoutMultiplier).toFixed(4));
    $('#cashoutBtn').disabled = true;
    disableGrid();
  }catch(err){console.error(err);alert('Network error');}
  hideSpinner();
}

async function verify(){
  if (!state.gameId) return;
  showSpinner();
  try{
    const res = await fetch(`/api/verify/${state.gameId}`);
    const j = await res.json();
    if (!res.ok) return alert(j.error || 'Verify error');
    openVerifyModal(j);
  }catch(err){console.error(err);alert('Network error');}
  hideSpinner();
}

function openVerifyModal(data){
  const size = data.size;
  const wrap = document.createElement('div');
  wrap.style.position='fixed';wrap.style.left='0';wrap.style.top='0';wrap.style.right='0';wrap.style.bottom='0';wrap.style.background='rgba(0,0,0,0.6)';wrap.style.display='flex';wrap.style.alignItems='center';wrap.style.justifyContent='center';wrap.style.zIndex=9999;
  const box = document.createElement('div');box.style.background='#fff';box.style.color='#000';box.style.padding='14px';box.style.borderRadius='8px';box.style.maxWidth='90%';box.style.maxHeight='90%';box.style.overflow='auto';
  const title = document.createElement('h3'); title.textContent = 'Verify - Game ' + data.id; box.appendChild(title);
  const info = document.createElement('div');
  info.innerHTML = `<div>ClientSeed: <b>${data.clientSeed}</b></div><div>ServerSeed: <b>${data.serverSeed}</b></div><div>Nonce: <b>${data.nonce}</b></div><div>Bombs: <b>${data.bombs}</b></div>`;
  box.appendChild(info);

  const vg = document.createElement('div'); vg.className='verify-grid'; vg.style.gridTemplateColumns = `repeat(${size}, 18px)`;
  vg.style.display='grid'; vg.style.gridTemplateColumns = `repeat(${size}, 18px)`; vg.style.gap='4px'; vg.style.marginTop='8px';
  for (let i=0;i<data.totalCells;i++){
    const vc = document.createElement('div'); vc.className='verify-cell';
    if (data.bombsPositions.includes(i)) vc.classList.add('bomb');
    if (data.opened.includes(i)) vc.classList.add('opened');
    vc.textContent = data.bombsPositions.includes(i)?'💣':(data.opened.includes(i)?'💎':'');
    vg.appendChild(vc);
  }
  box.appendChild(vg);

  const btnClose = document.createElement('button'); btnClose.textContent='Đóng'; btnClose.style.marginTop='10px';
  btnClose.onclick = () => document.body.removeChild(wrap);
  box.appendChild(btnClose);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
}

async function loadHistory(){
  try{
    const res = await fetch('/api/history');
    const j = await res.json();
    const list = $('#historyList'); list.innerHTML='';
    j.forEach(it=>{
      const r = document.createElement('div'); r.className='hrow';
      r.innerHTML = `<div>${new Date(it.createdAt).toLocaleString()} - ${it.size}x${it.size} - bombs:${it.bombs}</div><div><button data-id='${it.id}' class='verifyBtnRow'>Verify</button></div>`;
      list.appendChild(r);
    });
    $$('.verifyBtnRow').forEach(b=>b.addEventListener('click', e=>{ const id=e.target.dataset.id; state.gameId=id; verify(); }));
  }catch(err){console.error(err)}
}

// Auto mode
let autoRunning = false;
async function startAuto(){
  const mode = $('#autoModeSelect').value;
  if (mode==='off') return;
  state.auto.mode = mode;
  state.auto.roundsBeforeRefresh = Number($('#autoRounds').value) || 40;
  autoRunning = true;
  while (autoRunning) {
    if (!state.gameId || state.opened.length>0 || (state.auto.roundsDone >= state.auto.roundsBeforeRefresh)) {
      if (state.auto.roundsDone >= state.auto.roundsBeforeRefresh) state.auto.roundsDone = 0;
      await startGame();
    }
    const total = state.size * state.size;
    const toOpen = [];
    for (let i=0;i<total;i++){ if (!state.opened.includes(i)) toOpen.push(i); }
    if (toOpen.length===0) { autoRunning=false; break; }

    if (state.auto.mode === 'enjoy') {
      for (let i=0;i<total;i++){
        if (!state.opened.includes(i)){
          enqueueReveal(i);
          await new Promise(r=>setTimeout(r, 50));
          if (!autoRunning) break;
        }
      }
    } else if (state.auto.mode === 'fast') {
      toOpen.forEach(i=>enqueueReveal(i));
    }

    while (state.pendingQueue.length>0) await new Promise(r=>setTimeout(r, 200));

    if (state.opened.length>= (state.size*state.size - state.bombs) || $('#cashoutBtn').disabled===true) {
      state.auto.roundsDone++;
      state.gameId = null;
    }

    if (state.auto.roundsDone >= state.auto.roundsBeforeRefresh) {
      state.auto.roundsDone = 0;
    }

    await new Promise(r=>setTimeout(r, 400));
  }
}

function stopAuto(){ autoRunning=false; state.auto.mode='off'; }

$('#startBtn').addEventListener('click', startGame);
$('#cashoutBtn').addEventListener('click', cashout);
$('#verifyBtn').addEventListener('click', verify);
$('#deposit').addEventListener('click', ()=>{ const amt = prompt('Số TRX muốn nạp:', '10'); if (amt) $('#balance').textContent = format(Number($('#balance').textContent) + Number(amt)); });
$('#withdraw').addEventListener('click', ()=>{ const amt = prompt('Số TRX muốn rút:', '10'); if (amt) $('#balance').textContent = format(Math.max(0, Number($('#balance').textContent) - Number(amt))); });
$('#autoModeSelect').addEventListener('change', ()=>{ if ($('#autoModeSelect').value !== 'off') startAuto(); else stopAuto(); });

buildGrid(4);
loadHistory();
