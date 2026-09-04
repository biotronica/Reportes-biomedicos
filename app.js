'use strict';

/* =========================================================
   CONFIGURACIÓN — edita estos dos valores antes de publicar
   ========================================================= */
const CONFIG = {
  // Client ID de OAuth de Google Cloud Console (tipo "Aplicación web").
  // Ver README.md para los pasos exactos de cómo obtenerlo.
  GOOGLE_CLIENT_ID: '155395780717-8upptag4bmknce6gujv5u2aukgd14u0f.apps.googleusercontent.com',
  // ID de la carpeta de Drive donde se guardarán los informes generados a mano alzada
  // (el PDF genérico). Déjalo vacío ('') para guardarlos en la raíz de "Mi unidad".
  DRIVE_FOLDER_ID: '',
  // Carpeta MANTENIMIENTOS (en la Unidad compartida) donde viven las carpetas de cada
  // cliente, ya organizadas con sus propias subcarpetas (ej. "Reportes"). Los informes
  // oficiales se guardan en la carpeta del cliente (o su subcarpeta "Reportes" si existe).
  MANTENIMIENTOS_FOLDER_ID: '1F4xPV_Ot0oJftSvz-GgLEmb6CfI5Mun4',
  // 'drive' para leer/crear archivos, 'spreadsheets' para editar solo el contenido de
  // las celdas de la copia (sin tocar su formato) vía la API de Sheets.
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets'
};

/* ============== ESTADO ============== */
const STORAGE_KEY = 'reportes_intelmedica_state_v1';

function todayISO(){ return new Date().toISOString().slice(0,10); }

function defaultCliente(){
  return { nombre:'', solicitante:'', personaCargo:'', contacto:'', fecha: todayISO() };
}

function defaultDraft(){
  return {
    id: uid(), tipo:'', marca:'', modelo:'', serie:'', codigo:'', ubicacion:'', informeNo:'',
    tipoMantenimiento:'Preventivo', claseFalla:'', diagnostico:'',
    procedimientosAdicionales:'', limpiezaInterior:true, limpiezaExterior:true, fueraDeServicio:false,
    observaciones:'', repuestos:'', responsable:'', recibeSatisfaccion:''
  };
}

function uid(){ return 'eq_' + Math.random().toString(36).slice(2,10); }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    parsed.driveToken = null; // nunca se persiste el token
    if(!parsed.cliente) parsed.cliente = defaultCliente();
    if(!parsed.equipos) parsed.equipos = [];
    return parsed;
  }catch(e){ return null; }
}

let state = loadState() || {
  screen: 'cliente',
  cliente: defaultCliente(),
  equipos: [],
  draft: null,
  editingId: null,
  driveToken: null,
  driveExpiry: 0
};

/* ============== BASE DE CLIENTES (protegida con PIN) ============== */
const CLIENTES_PIN_KEY = 'reportes_intelmedica_clientes_pin';
let clientesDesbloqueado = false; // solo dura la sesión actual, no se guarda
let clientesCache = null;         // { clientes:[...], historial:[...] }
let clienteSeleccionado = null;

// Panel de "¿dónde se guarda?" antes de generar un informe oficial — una entrada por
// equipo (id) mientras se decide/confirma la carpeta destino.
let confirmacionCarpeta = {}; // { [equipoId]: { cargando, opciones, elegida:{id,nombre}, buscando, filtro } }

function tienePinConfigurado(){
  return !!localStorage.getItem(CLIENTES_PIN_KEY);
}
function guardarPin(pin){
  try{ localStorage.setItem(CLIENTES_PIN_KEY, pin); }catch(e){}
}
function verificarPin(pin){
  return localStorage.getItem(CLIENTES_PIN_KEY) === pin;
}
function restablecerPin(){
  try{ localStorage.removeItem(CLIENTES_PIN_KEY); }catch(e){}
  clientesDesbloqueado = false;
}

let aplicandoEstadoRemoto = false;
let syncPushTimer = null;

function saveState(){
  const toSave = Object.assign({}, state, { driveToken:null });
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); }catch(e){ /* almacenamiento lleno, ignorar */ }
  if(!aplicandoEstadoRemoto){
    state._localUpdatedAt = Date.now();
    if(state.driveToken){
      clearTimeout(syncPushTimer);
      syncPushTimer = setTimeout(() => { empujarEstadoADrive().catch(()=>{}); }, 2500);
    }
  }
}

function getPath(path){
  return path.split('.').reduce((o,p)=> (o==null? o : o[p]), state);
}
function setPath(path, value){
  const parts = path.split('.');
  let obj = state;
  for(let i=0;i<parts.length-1;i++){ obj = obj[parts[i]]; }
  obj[parts[parts.length-1]] = value;
}

/* ============== TOAST ============== */
let toastTimer = null;
function showToast(msg){
  const root = document.getElementById('toast-root');
  root.innerHTML = '<div class="toast">' + escapeHtml(msg) + '</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ root.innerHTML=''; }, 2800);
}

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============== DICTADO POR VOZ ============== */
let currentRecognition = null;
let currentRecognitionPath = null;

function getSpeechRecognitionCtor(){
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function toggleDictation(path, targetId, btnEl){
  const Ctor = getSpeechRecognitionCtor();
  if(!Ctor){
    showToast('El dictado por voz no está disponible en este navegador.');
    return;
  }
  if(currentRecognition && currentRecognitionPath === path){
    currentRecognition.stop();
    return;
  }
  if(currentRecognition){ currentRecognition.stop(); }

  const rec = new Ctor();
  rec.lang = 'es-CO';
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => { btnEl.classList.add('listening'); currentRecognitionPath = path; };
  rec.onerror = () => { btnEl.classList.remove('listening'); currentRecognitionPath = null; currentRecognition = null; };
  rec.onend = () => { btnEl.classList.remove('listening'); currentRecognitionPath = null; currentRecognition = null; };
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    appendDictatedText(path, targetId, text);
  };
  currentRecognition = rec;
  try{ rec.start(); }catch(e){ showToast('No se pudo iniciar el dictado.'); }
}

function appendDictatedText(path, targetId, text){
  const current = (getPath(path) || '').toString();
  let updated = current.trim() ? (current.trim() + ' ' + text) : text;
  updated = updated.charAt(0).toUpperCase() + updated.slice(1);
  setPath(path, updated);
  const el = document.getElementById(targetId);
  if(el) el.value = updated;
  saveState();
}

/* ============== NAVEGACIÓN ============== */
function goTo(screen){
  state.screen = screen;
  render();
  window.scrollTo(0,0);
}

function startNewEquipo(){
  state.draft = defaultDraft();
  state.editingId = null;
  goTo('formEquipo');
}

function editEquipo(id){
  const eq = state.equipos.find(e => e.id === id);
  if(!eq) return;
  state.draft = JSON.parse(JSON.stringify(eq));
  state.editingId = id;
  goTo('formEquipo');
}

function saveDraft(){
  const d = state.draft;
  if(!d.tipo){ showToast('Selecciona el tipo de equipo antes de guardar.'); return; }
  if(!d.marca && !d.serie && !d.codigo){ showToast('Agrega al menos marca, serie o código interno.'); return; }
  if(state.editingId){
    const idx = state.equipos.findIndex(e => e.id === state.editingId);
    if(idx>-1) state.equipos[idx] = d; else state.equipos.push(d);
  }else{
    state.equipos.push(d);
  }
  state.draft = null;
  state.editingId = null;
  goTo('equipos');
  showToast('Equipo guardado.');
}

function deleteEquipo(id){
  state.equipos = state.equipos.filter(e => e.id !== id);
  saveState();
  render();
}

function deleteDraftEquipo(){
  if(state.editingId) deleteEquipo(state.editingId);
  state.draft = null;
  state.editingId = null;
  goTo('equipos');
}

/* ============== RENDER RAÍZ ============== */
const app = document.getElementById('app');

function render(){
  app.innerHTML = '';
  if(state.screen === 'cliente') app.appendChild(renderCliente());
  else if(state.screen === 'equipos') app.appendChild(renderEquipos());
  else if(state.screen === 'formEquipo') app.appendChild(renderFormEquipo());
  else if(state.screen === 'exportar') app.appendChild(renderExportar());
  else if(state.screen === 'clientes') app.appendChild(renderClientes());
  wireCommonHandlers();
  saveState();
}

/* Helpers de construcción de DOM a partir de HTML string */
function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function stepPills(current){
  const steps = ['cliente','equipos','exportar'];
  const idx = steps.indexOf(current === 'formEquipo' ? 'equipos' : current);
  return steps.map((s,i)=>{
    const cls = i < idx ? 'done' : (i === idx ? 'active' : '');
    return '<div class="step-pill ' + cls + '"></div>';
  }).join('');
}

/* ============== PANTALLA 1: DATOS DEL CLIENTE ============== */
function renderCliente(){
  const c = state.cliente;
  const driveOn = !!state.driveToken && Date.now() < state.driveExpiry;
  const wrap = el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <div>
          <div class="topbar-title">Datos del cliente</div>
          <div class="topbar-sub">Se piden una sola vez por visita</div>
        </div>
      </div>
      <div class="step-pills">${stepPills('cliente')}</div>
    </div>
    <div class="content">
      <div class="drive-status">
        <div class="drive-dot ${driveOn?'on':''}"></div>
        <div style="flex:1;">${driveOn ? 'Conectado a Google Drive' : 'No conectado a Google Drive'}</div>
        ${driveOn ? '<button class="btn btn-outline btn-sm" data-action="sincronizarAhora">🔄 Sincronizar</button>' : '<button class="btn btn-primary btn-sm" data-action="connectDrive">Conectar</button>'}
      </div>
      <div class="card">
        ${clienteSelectorHtml(c)}
        ${fieldMicHtml('cliente.solicitante', c.solicitante, 'Solicitante', false)}
        ${fieldMicHtml('cliente.personaCargo', c.personaCargo, 'Persona a cargo', false)}
        ${fieldMicHtml('cliente.contacto', c.contacto, 'Info. de contacto (teléfono / correo)', false)}
        <div class="field">
          <label>Fecha</label>
          <input type="date" data-path="cliente.fecha" value="${escapeHtml(c.fecha)}">
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-action="goTo" data-target="clientes" style="margin-top:14px;">📇 Base de clientes</button>
    </div>
    <div class="bottom-bar">
      <div class="bottom-bar-inner">
        <button class="btn btn-primary" data-action="continuarCliente">Continuar →</button>
      </div>
    </div>
  </div>`);
  return wrap;
}

// El nombre del cliente ahora se elige de una lista (los que ya están guardados en la
// base de clientes) en vez de escribirlo libre — evita duplicados por errores de tipeo.
// Solo se muestra un campo de texto cuando se elige explícitamente "+ Cliente nuevo".
function clienteSelectorHtml(c){
  if(!state.driveToken){
    return `<div class="field">
      <label>Cliente</label>
      <div class="status-line" style="text-align:left;margin:4px 0;">Conecta Google Drive para elegir de la lista de clientes.</div>
      <input type="text" data-path="cliente.nombre" value="${escapeHtml(c.nombre)}" placeholder="Nombre del cliente">
    </div>`;
  }
  if(!clientesCache){
    cargarBaseClientes().then(render).catch(()=>{});
    return `<div class="field"><label>Cliente</label><select disabled><option>Cargando clientes…</option></select></div>`;
  }

  const enListado = clientesCache.clientes.some(x => x.nombre === c.nombre);
  const modoNuevo = state._nuevoClienteModo || (c.nombre && !enListado);

  const opciones = clientesCache.clientes
    .slice()
    .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(x => `<option value="${escapeHtml(x.nombre)}" ${!modoNuevo && x.nombre===c.nombre ? 'selected':''}>${escapeHtml(x.nombre)}</option>`)
    .join('');

  const selectHtml = `
    <div class="field">
      <label>Cliente</label>
      <select id="clienteSelectDropdown">
        <option value="" ${!modoNuevo && !c.nombre ? 'selected':''}>-- Selecciona un cliente --</option>
        <option value="__nuevo__" ${modoNuevo ? 'selected':''}>+ Cliente nuevo</option>
        ${opciones}
      </select>
    </div>`;

  const textoNuevo = modoNuevo
    ? fieldMicHtml('cliente.nombre', c.nombre, 'Nombre del cliente nuevo', false)
    : '';

  return selectHtml + textoNuevo;
}

function fieldMicHtml(path, value, label, isTextarea, targetIdOverride){
  const targetId = targetIdOverride || ('fld_' + path.replace(/\./g,'_'));
  const inputHtml = isTextarea
    ? `<textarea id="${targetId}" data-path="${path}" placeholder="${escapeHtml(label)}">${escapeHtml(value)}</textarea>`
    : `<input type="text" id="${targetId}" data-path="${path}" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}">`;
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <div class="field-input-row">
        ${inputHtml}
        <button type="button" class="mic-btn" data-mic-path="${path}" data-mic-target="${targetId}" title="Dictar">🎤</button>
      </div>
    </div>`;
}

function continuarCliente(){
  if(!state.cliente.nombre){
    showToast('Escribe al menos el nombre del cliente.');
    return;
  }
  goTo('equipos');
}

/* ============== PANTALLA 2: LISTA DE EQUIPOS ============== */
function renderEquipos(){
  const c = state.cliente;
  const equiposHtml = state.equipos.length
    ? state.equipos.map(eq => `
      <div class="equipo-card" data-action="editEquipo" data-id="${eq.id}">
        <div class="equipo-icon">${escapeHtml((eq.tipo||'?').slice(0,1).toUpperCase())}</div>
        <div class="equipo-info">
          <div class="equipo-nombre">${escapeHtml(eq.tipo || 'Equipo sin tipo')}</div>
          <div class="equipo-meta">${escapeHtml(eq.marca||'—')} ${escapeHtml(eq.modelo||'')} · ${escapeHtml(eq.ubicacion||'sin ubicación')}</div>
        </div>
        <div class="equipo-chevron">›</div>
      </div>`).join('')
    : `<div class="empty-state">
         <div class="empty-state-icon">🩺</div>
         Aún no has agregado equipos.<br>Toca "Agregar equipo" para comenzar.
       </div>`;

  const wrap = el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="goTo" data-target="cliente">‹</button>
        <div>
          <div class="topbar-title">${escapeHtml(c.nombre || 'Equipos intervenidos')}</div>
          <div class="topbar-sub">${state.equipos.length} equipo${state.equipos.length===1?'':'s'} agregado${state.equipos.length===1?'':'s'}</div>
        </div>
      </div>
      <div class="step-pills">${stepPills('equipos')}</div>
    </div>
    <div class="content">
      ${equiposHtml}
    </div>
    <div class="bottom-bar">
      <div class="bottom-bar-inner" style="flex-direction:column;">
        <button class="btn btn-teal" data-action="startNewEquipo">+ Agregar equipo</button>
        ${state.equipos.length ? '<button class="btn btn-outline" data-action="goTo" data-target="exportar" style="margin-top:10px;">Generar informes →</button>' : ''}
      </div>
    </div>
  </div>`);
  return wrap;
}

/* ============== PANTALLA 3: FORMULARIO DE EQUIPO ============== */
function renderFormEquipo(){
  const d = state.draft;

  const wrap = el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="cancelForm">‹</button>
        <div>
          <div class="topbar-title">${state.editingId ? 'Editar equipo' : 'Nuevo equipo'}</div>
          <div class="topbar-sub">${escapeHtml(state.cliente.nombre)}</div>
        </div>
      </div>
    </div>
    <div class="content">

      <div class="card">
        <div class="card-title">🔧 Tipo de equipo</div>
        <div class="field equipo-search">
          <label>Buscar en el catálogo</label>
          <input type="text" id="equipoSearchInput" placeholder="Ej: CPAP, báscula, desfibrilador..." value="${escapeHtml(d.tipo)}" autocomplete="off">
          <div id="equipoSuggestions"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🏷️ Identificación del equipo</div>
        ${fieldMicHtml('draft.informeNo', d.informeNo, 'Informe No.', false)}
        ${fieldMicHtml('draft.marca', d.marca, 'Marca', false)}
        ${fieldMicHtml('draft.modelo', d.modelo, 'Modelo', false)}
        ${fieldMicHtml('draft.serie', d.serie, 'Número de serie', false)}
        ${fieldMicHtml('draft.codigo', d.codigo, 'Código interno', false)}
        ${fieldMicHtml('draft.ubicacion', d.ubicacion, 'Ubicación', false)}
      </div>

      <div class="card">
        <div class="card-title">🛠️ Tipo de mantenimiento</div>
        <div class="choice-row">
          ${['Correctivo','Preventivo','Predictivo','Diagnóstico'].map(o=>
            `<button type="button" class="choice-btn ${d.tipoMantenimiento===o?'selected':''}" data-action="setChoice" data-path="draft.tipoMantenimiento" data-value="${o}">${o}</button>`
          ).join('')}
        </div>
        <div style="height:12px;"></div>
        <label style="display:block;font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Clase de falla</label>
        <div class="choice-row">
          ${['Mecánica','Eléctrica','Electrónica','Otro','N/A'].map(o=>
            `<button type="button" class="choice-btn ${d.claseFalla===o?'selected':''}" data-action="setChoice" data-path="draft.claseFalla" data-value="${o}">${o}</button>`
          ).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">🩻 Diagnóstico</div>
        ${fieldMicHtml('draft.diagnostico', d.diagnostico, 'Diagnóstico del equipo', true)}
      </div>

      <div class="card">
        <div class="card-title">✅ Procedimientos adicionales</div>
        <div class="status-line">La plantilla oficial ya incluye los procedimientos estándar de este equipo. Escribe aquí solo si hiciste algo adicional a lo ya incluido (uno por línea).</div>
        ${fieldMicHtml('draft.procedimientosAdicionales', d.procedimientosAdicionales, 'Procedimientos adicionales (opcional)', true)}
      </div>

      <div class="card">
        <div class="card-title">🧼 Estado del equipo</div>
        <label style="display:block;font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Limpieza e inspección interior</label>
        <div class="choice-row">
          <button type="button" class="choice-btn ${d.limpiezaInterior?'selected':''}" data-action="setChoice" data-path="draft.limpiezaInterior" data-value="true" data-bool="1">Sí</button>
          <button type="button" class="choice-btn ${!d.limpiezaInterior?'selected':''}" data-action="setChoice" data-path="draft.limpiezaInterior" data-value="false" data-bool="1">No</button>
        </div>
        <div style="height:12px;"></div>
        <label style="display:block;font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Limpieza e inspección exterior</label>
        <div class="choice-row">
          <button type="button" class="choice-btn ${d.limpiezaExterior?'selected':''}" data-action="setChoice" data-path="draft.limpiezaExterior" data-value="true" data-bool="1">Sí</button>
          <button type="button" class="choice-btn ${!d.limpiezaExterior?'selected':''}" data-action="setChoice" data-path="draft.limpiezaExterior" data-value="false" data-bool="1">No</button>
        </div>
        <div style="height:12px;"></div>
        <label style="display:block;font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">¿Equipo fuera de servicio?</label>
        <div class="choice-row">
          <button type="button" class="choice-btn ${d.fueraDeServicio?'selected danger':''}" data-action="setChoice" data-path="draft.fueraDeServicio" data-value="true" data-bool="1">Sí</button>
          <button type="button" class="choice-btn ${!d.fueraDeServicio?'selected':''}" data-action="setChoice" data-path="draft.fueraDeServicio" data-value="false" data-bool="1">No</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📝 Observaciones adicionales</div>
        ${fieldMicHtml('draft.observaciones', d.observaciones, 'Observaciones adicionales (opcional)', true)}
      </div>

      <div class="card">
        <div class="card-title">⚙️ Repuestos utilizados (opcional)</div>
        ${fieldMicHtml('draft.repuestos', d.repuestos, 'Repuestos, costo y justificación', true)}
      </div>

      <div class="card">
        <div class="card-title">✍️ Responsables</div>
        ${fieldMicHtml('draft.responsable', d.responsable, 'Responsable(s) de ejecución', false)}
        ${fieldMicHtml('draft.recibeSatisfaccion', d.recibeSatisfaccion, 'Recibe a satisfacción', false)}
      </div>

      ${state.editingId ? '<button type="button" class="btn btn-danger-ghost" data-action="deleteDraftEquipo">Eliminar este equipo</button>' : ''}
    </div>
    <div class="bottom-bar">
      <div class="bottom-bar-inner">
        <button class="btn btn-primary" data-action="saveDraft">Guardar equipo</button>
      </div>
    </div>
  </div>`);
  return wrap;
}

function renderEquipoSuggestions(query){
  const box = document.getElementById('equipoSuggestions');
  if(!box) return;
  const q = (query||'').toLowerCase();
  const matches = EQUIPOS_LISTA.filter(name => name.toLowerCase().includes(q));
  if(!q || matches.length === 0){
    box.innerHTML = '';
    box.className = '';
    return;
  }
  box.className = 'equipo-suggestions';
  box.innerHTML = matches.slice(0,8).map(name =>
    `<div class="equipo-suggestion" data-action="pickEquipoTipo" data-value="${escapeHtml(name)}">${escapeHtml(name)}</div>`
  ).join('');
}

function pickEquipoTipo(name){
  state.draft.tipo = name;
  render();
}

function cancelForm(){
  state.draft = null;
  state.editingId = null;
  goTo('equipos');
}

/* ============== PANTALLA 4: EXPORTAR / DRIVE ============== */
function renderExportar(){
  const driveOn = !!state.driveToken && Date.now() < state.driveExpiry;
  const rows = state.equipos.map(eq => {
    const tieneTemplate = !!TEMPLATE_FILE_IDS[eq.tipo];
    return `
    <div class="card">
      <div class="card-title">${escapeHtml(eq.tipo)}</div>
      <div class="status-line" style="text-align:left;margin:0 0 10px;">${escapeHtml(eq.marca||'—')} ${escapeHtml(eq.modelo||'')} · Serie ${escapeHtml(eq.serie||'—')}</div>
      <div class="pdf-actions">
        ${tieneTemplate ? `<button class="btn btn-primary btn-sm" style="width:100%;" data-action="prepararGuardado" data-id="${eq.id}" ${driveOn?'':'disabled style="opacity:.5"'}>📄 Generar informe oficial (formato real)</button>` : `<div class="status-line">Sin plantilla oficial para este equipo — usa el PDF genérico abajo.</div>`}
        <button class="btn btn-outline btn-sm" style="width:100%;" data-action="verPdf" data-id="${eq.id}">👁️ Ver / Imprimir PDF genérico</button>
        <button class="btn btn-outline btn-sm" style="width:100%;" data-action="descargarPdf" data-id="${eq.id}">⬇️ Descargar PDF genérico</button>
        ${!tieneTemplate ? `<button class="btn btn-teal btn-sm" style="width:100%;" data-action="subirDrive" data-id="${eq.id}" ${driveOn?'':'disabled style="opacity:.5"'}>☁️ Subir PDF genérico a Drive</button>` : ''}
      </div>
      ${panelConfirmacionHtml(eq)}
      <div class="status-line" id="status_${eq.id}"></div>
    </div>
  `;}).join('');

  const wrap = el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="goTo" data-target="equipos">‹</button>
        <div>
          <div class="topbar-title">Generar informes</div>
          <div class="topbar-sub">${escapeHtml(state.cliente.nombre)}</div>
        </div>
      </div>
      <div class="step-pills">${stepPills('exportar')}</div>
    </div>
    <div class="content">
      <div class="drive-status">
        <div class="drive-dot ${driveOn?'on':''}"></div>
        <div style="flex:1;">${driveOn ? 'Conectado a Google Drive' : 'No conectado a Google Drive'}</div>
        ${driveOn ? '' : '<button class="btn btn-primary btn-sm" data-action="connectDrive">Conectar</button>'}
      </div>
      ${rows}
      <button class="btn btn-ghost" data-action="goTo" data-target="cliente" style="margin-top:6px;">+ Iniciar informe para otro cliente</button>
    </div>
  </div>`);
  return wrap;
}

/* ============== BASE DE CLIENTES: PANTALLAS ============== */
function renderClientes(){
  if(!state.driveToken){
    return el(`
    <div>
      <div class="topbar">
        <div class="topbar-row">
          <button class="topbar-back" data-action="goTo" data-target="cliente">‹</button>
          <div><div class="topbar-title">Base de clientes</div></div>
        </div>
      </div>
      <div class="content">
        <div class="card">
          <div class="status-line">Conecta Google Drive primero para ver la base de clientes.</div>
          <button class="btn btn-primary btn-sm" style="width:100%;margin-top:10px;" data-action="connectDrive">Conectar</button>
        </div>
      </div>
    </div>`);
  }
  if(!clientesDesbloqueado) return renderClientesPin();
  return renderClientesLista();
}

function renderClientesPin(){
  const existe = tienePinConfigurado();
  const wrap = el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="goTo" data-target="cliente">‹</button>
        <div><div class="topbar-title">Base de clientes</div><div class="topbar-sub">${existe ? 'Protegida con clave' : 'Crear clave de acceso'}</div></div>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <div class="card-title">🔒 ${existe ? 'Ingresa la clave' : 'Crea una clave de 4 dígitos'}</div>
        <div class="field">
          <input type="password" inputmode="numeric" maxlength="8" id="pinInput" placeholder="••••" style="text-align:center;font-size:22px;letter-spacing:6px;">
        </div>
        <button class="btn btn-primary" style="width:100%;" data-action="${existe ? 'intentarPin' : 'crearPin'}">${existe ? 'Entrar' : 'Guardar clave'}</button>
        ${existe ? '<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;" data-action="confirmarResetPin">¿Olvidaste la clave? Restablecer</button>' : ''}
      </div>
    </div>
  </div>`);
  return wrap;
}

function crearPin(){
  const val = (document.getElementById('pinInput').value || '').trim();
  if(val.length < 4){ showToast('Usa al menos 4 dígitos.'); return; }
  guardarPin(val);
  clientesDesbloqueado = true;
  showToast('Clave creada.');
  render();
  cargarBaseClientes().then(render).catch(()=>{});
}

function intentarPin(){
  const val = (document.getElementById('pinInput').value || '').trim();
  if(!verificarPin(val)){ showToast('Clave incorrecta.'); return; }
  clientesDesbloqueado = true;
  render();
  cargarBaseClientes().then(render).catch(err => showToast('No se pudo cargar la base de clientes.'));
}

function confirmarResetPin(){
  if(confirm('Esto borra la clave actual y vas a poder crear una nueva. ¿Continuar?')){
    restablecerPin();
    render();
  }
}

function renderClientesLista(){
  if(clienteSeleccionado) return renderClienteDetalle();

  if(!clientesCache){
    // primera vez que se entra en esta sesión: dispara la carga y muestra un estado
    cargarBaseClientes().then(render).catch(()=> showToast('No se pudo cargar la base de clientes.'));
    return el(`
    <div>
      <div class="topbar"><div class="topbar-row"><button class="topbar-back" data-action="goTo" data-target="cliente">‹</button><div><div class="topbar-title">Base de clientes</div></div></div></div>
      <div class="content"><div class="card"><div class="status-line">Cargando…</div></div></div>
    </div>`);
  }

  const filtro = normNombre(state._filtroClientes || '');
  const filas = filasClientesHtml(filtro);

  return el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="goTo" data-target="cliente">‹</button>
        <div><div class="topbar-title">Base de clientes</div><div class="topbar-sub">${clientesCache.clientes.length} cliente(s)</div></div>
      </div>
    </div>
    <div class="content">
      <button type="button" class="btn btn-outline btn-sm" style="width:100%;margin-bottom:12px;" data-action="iniciarImportacion">🔄 Importar desde carpetas existentes en Drive</button>
      <div id="importarStatus" class="status-line"></div>
      <div class="field">
        <input type="text" id="clienteFiltroInput" placeholder="Buscar cliente…" value="${escapeHtml(state._filtroClientes||'')}">
      </div>
      <div id="listaClientesBox">${filas}</div>
    </div>
  </div>`);
}

function filasClientesHtml(filtro){
  const lista = clientesCache.clientes
    .filter(c => !filtro || normNombre(c.nombre).includes(filtro))
    .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
  return lista.length
    ? lista.map(c => `
      <div class="equipo-card" data-action="verCliente" data-nombre="${escapeHtml(c.nombre)}">
        <div class="equipo-icon">${escapeHtml((c.nombre||'?').slice(0,1).toUpperCase())}</div>
        <div class="equipo-info">
          <div class="equipo-nombre">${escapeHtml(c.nombre)}</div>
          <div class="status-line" style="text-align:left;margin:0;">${escapeHtml(c.personaCargo||c.solicitante||'—')} · última visita ${escapeHtml(c.ultimaVisita||'—')}</div>
        </div>
      </div>`).join('')
    : '<div class="status-line">No hay clientes guardados todavía — se guardan solos cuando generas un informe oficial.</div>';
}

function verCliente(nombre){
  clienteSeleccionado = nombre;
  render();
}

function renderClienteDetalle(){
  const c = clientesCache.clientes.find(x => x.nombre === clienteSeleccionado) || { nombre: clienteSeleccionado };
  const visitas = clientesCache.historial
    .filter(h => normNombre(h.cliente) === normNombre(clienteSeleccionado))
    .sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));

  const filasHistorial = visitas.length
    ? visitas.map(h => `
      <div class="equipo-card" style="cursor:default;">
        <div class="equipo-icon">${escapeHtml((h.equipo||'?').slice(0,1).toUpperCase())}</div>
        <div class="equipo-info">
          <div class="equipo-nombre">${escapeHtml(h.equipo)} ${h.informeNo ? '· No. '+escapeHtml(h.informeNo) : ''}</div>
          <div class="status-line" style="text-align:left;margin:0;">${escapeHtml(h.fecha)}
            ${h.pdfUrl ? ` · <a href="${h.pdfUrl}" target="_blank">PDF</a>` : ''}
            ${h.excelUrl ? ` · <a href="${h.excelUrl}" target="_blank">Excel</a>` : ''}
          </div>
        </div>
      </div>`).join('')
    : '<div class="status-line">Sin informes registrados todavía.</div>';

  return el(`
  <div>
    <div class="topbar">
      <div class="topbar-row">
        <button class="topbar-back" data-action="cerrarClienteDetalle">‹</button>
        <div><div class="topbar-title">${escapeHtml(c.nombre)}</div><div class="topbar-sub">Ficha del cliente</div></div>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <div class="card-title">🏥 Datos de contacto</div>
        <div class="status-line" style="text-align:left;margin:0 0 6px;">Solicitante: ${escapeHtml(c.solicitante||'—')}</div>
        <div class="status-line" style="text-align:left;margin:0 0 6px;">Persona a cargo: ${escapeHtml(c.personaCargo||'—')}</div>
        <div class="status-line" style="text-align:left;margin:0;">Contacto: ${escapeHtml(c.contacto||'—')}</div>
      </div>
      <div class="card">
        <div class="card-title">🧾 Historial de informes (${visitas.length})</div>
        ${filasHistorial}
      </div>
      <button class="btn btn-primary" style="width:100%;" data-action="usarClienteExistente" data-nombre="${escapeHtml(c.nombre)}">Usar estos datos para una visita nueva</button>
    </div>
  </div>`);
}

function cerrarClienteDetalle(){
  clienteSeleccionado = null;
  render();
}

async function iniciarImportacion(){
  if(!state.driveToken){ showToast('Conecta Google Drive primero.'); return; }
  const statusEl = document.getElementById('importarStatus');
  const setStatus = (msg, cls) => { if(statusEl){ statusEl.textContent = msg; statusEl.className = 'status-line ' + (cls||''); } };
  const boton = document.querySelector('[data-action="iniciarImportacion"]');
  if(boton) boton.disabled = true;

  try{
    setStatus('Revisando carpetas en Drive…');
    const resultado = await importarDesdeCarpetasExistentes((hecho, total, nombreCarpeta) => {
      setStatus(`Revisando (${hecho}/${total}): ${nombreCarpeta}`);
    });
    setStatus(`✓ Listo — ${resultado.carpetasRevisadas} carpetas revisadas, ${resultado.clientesNuevos} cliente(s) nuevo(s), ${resultado.informesNuevos} informe(s) agregado(s) al historial.`, 'ok');
    showToast('Importación terminada.');
    await cargarBaseClientes();
    render();
  }catch(err){
    setStatus('Error al importar: ' + (err && err.message ? err.message : 'intenta de nuevo'), 'err');
  }finally{
    if(boton) boton.disabled = false;
  }
}

function usarClienteExistente(nombre){
  const c = clientesCache.clientes.find(x => x.nombre === nombre);
  if(!c) return;
  state.cliente = { nombre: c.nombre, solicitante: c.solicitante, personaCargo: c.personaCargo, contacto: c.contacto, fecha: todayISO() };
  state.equipos = [];
  clienteSeleccionado = null;
  goTo('cliente');
  showToast('Datos del cliente cargados.');
}

/* ============== GENERACIÓN DE PDF ============== */
function sanitizeFilename(s){
  return (s||'informe')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,60);
}

function nombreArchivo(equipo){
  const numero = sanitizeFilename(equipo.informeNo || 'SN');
  const tipo = sanitizeFilename(equipo.tipo);
  const serie = sanitizeFilename(equipo.serie || 'SN');
  return `${numero}_${tipo}_${serie}.pdf`;
}

function generarPDFDoc(equipo, cliente){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 15;
  let y = 18;

  function checkPageBreak(needed){
    if(y + needed > pageH - 16){
      doc.addPage();
      y = 18;
    }
  }
  function sectionHeader(title){
    checkPageBreak(11);
    doc.setFillColor(11,37,64);
    doc.rect(marginX, y-4.5, pageW-marginX*2, 7, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(10);
    doc.setFont(undefined,'bold');
    doc.text(title, marginX+3, y);
    doc.setTextColor(20,20,20);
    doc.setFont(undefined,'normal');
    y += 9;
  }
  function fieldLine(label, value){
    checkPageBreak(7);
    doc.setFontSize(9.5);
    doc.setFont(undefined,'bold');
    doc.text(label, marginX, y);
    const labelW = doc.getTextWidth(label) + 2;
    doc.setFont(undefined,'normal');
    const text = value && String(value).trim() ? String(value) : '—';
    const lines = doc.splitTextToSize(text, pageW - marginX*2 - labelW);
    doc.text(lines, marginX+labelW, y);
    y += Math.max(6, lines.length*4.6) + 1;
  }
  function paragraph(label, value){
    checkPageBreak(10);
    doc.setFontSize(9.5);
    doc.setFont(undefined,'bold');
    doc.text(label, marginX, y);
    y += 5;
    doc.setFont(undefined,'normal');
    const text = value && String(value).trim() ? String(value) : '—';
    const lines = doc.splitTextToSize(text, pageW - marginX*2);
    checkPageBreak(lines.length*4.6);
    doc.text(lines, marginX, y);
    y += lines.length*4.6 + 4;
  }
  function checkboxLine(label, checked){
    checkPageBreak(7);
    doc.setDrawColor(60);
    doc.setLineWidth(0.35);
    doc.rect(marginX, y-3.2, 4, 4);
    if(checked){
      doc.setFontSize(9);
      doc.setFont(undefined,'bold');
      doc.text('X', marginX+0.7, y-0.1);
    }
    doc.setFontSize(9.5);
    doc.setFont(undefined,'normal');
    const lines = doc.splitTextToSize(label, pageW - marginX*2 - 8);
    doc.text(lines, marginX+7, y);
    y += Math.max(6, lines.length*4.6);
  }

  // Encabezado
  doc.setFontSize(15);
  doc.setFont(undefined,'bold');
  doc.text('INFORME DE MANTENIMIENTO', marginX, y);
  doc.setFontSize(8.5);
  doc.setFont(undefined,'normal');
  doc.text('Código: F-01-P-SM01', pageW-marginX, y-9, {align:'right'});
  doc.text('Fecha: ' + (cliente.fecha||todayISO()), pageW-marginX, y-4.5, {align:'right'});
  if(equipo.informeNo) doc.text('Informe No.: ' + equipo.informeNo, pageW-marginX, y, {align:'right'});
  y += 5;
  doc.setDrawColor(210);
  doc.line(marginX, y, pageW-marginX, y);
  y += 9;

  sectionHeader('DATOS DEL CLIENTE');
  fieldLine('Cliente / Institución:', cliente.nombre);
  fieldLine('Solicitante:', cliente.solicitante);
  fieldLine('Persona a cargo:', cliente.personaCargo);
  fieldLine('Info. de contacto:', cliente.contacto);
  y += 2;

  sectionHeader('DATOS DEL EQUIPO');
  fieldLine('Equipo:', equipo.tipo);
  fieldLine('Ubicación:', equipo.ubicacion);
  fieldLine('Marca:', equipo.marca);
  fieldLine('Serie:', equipo.serie);
  fieldLine('Modelo:', equipo.modelo);
  fieldLine('Código interno:', equipo.codigo);
  y += 2;

  sectionHeader('MANTENIMIENTO');
  fieldLine('Tipo de mantenimiento:', equipo.tipoMantenimiento);
  fieldLine('Clase de falla:', equipo.claseFalla);
  paragraph('Diagnóstico del equipo:', equipo.diagnostico);
  checkboxLine('Equipo fuera de servicio', equipo.fueraDeServicio);
  checkboxLine('Limpieza e inspección interior realizada', equipo.limpiezaInterior);
  checkboxLine('Limpieza e inspección exterior realizada', equipo.limpiezaExterior);
  y += 3;

  sectionHeader('DESCRIPCIÓN DE LOS PROCEDIMIENTOS REALIZADOS');
  const procedimientosEstandar = EQUIPOS_DATA[equipo.tipo] || [];
  if(procedimientosEstandar.length){
    procedimientosEstandar.forEach(texto => checkboxLine(texto, true));
  }
  const adicionales = (equipo.procedimientosAdicionales || '').split('\n').map(l => l.trim()).filter(Boolean);
  adicionales.forEach(texto => checkboxLine(texto, true));
  if(!procedimientosEstandar.length && !adicionales.length){
    doc.setFontSize(9.5);
    doc.text('— Sin procedimientos registrados —', marginX, y);
    y += 6;
  }
  y += 3;

  sectionHeader('OBSERVACIONES');
  paragraph('', equipo.observaciones);

  if(equipo.repuestos && equipo.repuestos.trim()){
    sectionHeader('REPUESTOS UTILIZADOS');
    paragraph('', equipo.repuestos);
  }

  sectionHeader('RESPONSABLES');
  fieldLine('Responsable(s) ejecución:', equipo.responsable);
  fieldLine('Recibe a satisfacción:', equipo.recibeSatisfaccion);
  y += 10;
  checkPageBreak(14);
  doc.setDrawColor(150);
  doc.line(marginX, y, marginX+70, y);
  doc.line(pageW-marginX-70, y, pageW-marginX, y);
  y += 4;
  doc.setFontSize(8);
  doc.text('Firma responsable ejecución', marginX, y);
  doc.text('Firma recibe a satisfacción', pageW-marginX-70, y);

  // Pie de página en todas las páginas
  const totalPages = doc.internal.getNumberOfPages();
  for(let i=1;i<=totalPages;i++){
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text('Intelmedica · Área de Gestión de la Calidad · Generado el ' + new Date().toLocaleString('es-CO'), marginX, pageH-8);
    doc.text('Página ' + i + ' de ' + totalPages, pageW-marginX, pageH-8, {align:'right'});
    doc.setTextColor(20);
  }

  return doc;
}

function verPdf(id){
  const eq = state.equipos.find(e => e.id === id);
  if(!eq) return;
  const doc = generarPDFDoc(eq, state.cliente);
  const blobUrl = doc.output('bloburl');
  window.open(blobUrl, '_blank');
}

function descargarPdf(id){
  const eq = state.equipos.find(e => e.id === id);
  if(!eq) return;
  const doc = generarPDFDoc(eq, state.cliente);
  doc.save(nombreArchivo(eq));
}

function subirDrive(id){
  const eq = state.equipos.find(e => e.id === id);
  if(!eq) return;
  const statusEl = document.getElementById('status_' + id);
  if(!state.driveToken){
    showToast('Primero conecta tu cuenta de Google Drive.');
    return;
  }
  const doc = generarPDFDoc(eq, state.cliente);
  const blob = doc.output('blob');
  const filename = nombreArchivo(eq);
  if(statusEl){ statusEl.textContent = 'Subiendo a Drive…'; statusEl.className='status-line'; }

  const metadata = { name: filename, mimeType: 'application/pdf' };
  if(CONFIG.DRIVE_FOLDER_ID) metadata.parents = [CONFIG.DRIVE_FOLDER_ID];
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], {type:'application/json'}));
  form.append('file', blob);

  fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method:'POST',
    headers: { Authorization: 'Bearer ' + state.driveToken },
    body: form
  }).then(r => {
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(() => {
    if(statusEl){ statusEl.textContent = '✓ Subido a Drive correctamente'; statusEl.className='status-line ok'; }
    showToast('Informe subido a Drive.');
  }).catch(err => {
    if(statusEl){ statusEl.textContent = 'Error al subir. Intenta reconectar Drive.'; statusEl.className='status-line err'; }
    showToast('No se pudo subir a Drive.');
  });
}

/* ============== PLANTILLA OFICIAL (copia intacta -> Sheets API solo valores -> PDF) ==============
   Antes esta sección leía el xlsx con una librería en el navegador y lo reescribía —
   eso perdía colores, bordes y estilos porque esa librería no los conserva al guardar.
   Ahora: 1) se sube la plantilla SIN TOCAR a Drive pidiéndole a Google que la convierta
   a Hoja de cálculo (su propio conversor sí conserva el diseño real), y 2) se editan
   las celdas por la API de Sheets pidiendo explícitamente que solo cambie el VALOR de
   cada celda, nunca su formato. */

function driveHeaders(){
  if(!state.driveToken) throw new Error('NO_DRIVE');
  return { Authorization: 'Bearer ' + state.driveToken };
}

async function descargarPlantillaBytes(fileId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo descargar la plantilla (HTTP ' + res.status + ')');
  return res.arrayBuffer();
}

// Sube los bytes ORIGINALES de la plantilla (sin modificar) pidiendo a Drive que los
// convierta a Hoja de cálculo de Google — así el diseño lo reconstruye el propio
// conversor de Google, con toda su fidelidad, no una librería externa.
async function subirPlantillaComoSheet(bytesOriginales, filename, parentId){
  const blob = new Blob([bytesOriginales], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const metadata = { name: filename, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: driveHeaders(), body: form
  });
  if(!res.ok) throw new Error('No se pudo subir el informe (HTTP ' + res.status + ')');
  return res.json();
}

function normText(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// Trae el contenido de la hoja "PRIMERA" (valores + celdas combinadas) ya subida a
// Sheets, en una forma simple de recorrer: filas[r][c] = texto de esa celda.
// Se hace en dos consultas simples (en vez de una combinada con includeGridData) porque
// son más predecibles y fáciles de depurar si algo sale distinto a lo esperado.
async function obtenerGridPrimera(spreadsheetId){
  const valuesUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId
    + '/values/PRIMERA?valueRenderOption=FORMATTED_VALUE';
  const valuesRes = await fetch(valuesUrl, { headers: driveHeaders() });
  if(!valuesRes.ok) throw new Error('No se pudieron leer los datos de la hoja PRIMERA (HTTP ' + valuesRes.status + ')');
  const valuesData = await valuesRes.json();
  const filas = (valuesData.values || []).map(fila =>
    (Array.isArray(fila) ? fila : []).map(v => (v == null ? '' : String(v)))
  );

  const metaUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId
    + '?fields=sheets(properties(sheetId,title),merges)';
  const metaRes = await fetch(metaUrl, { headers: driveHeaders() });
  if(!metaRes.ok) throw new Error('No se pudo leer la información de la hoja (HTTP ' + metaRes.status + ')');
  const metaData = await metaRes.json();
  const hoja = (metaData.sheets || []).find(s => s.properties && s.properties.title === 'PRIMERA');
  if(!hoja) throw new Error('La plantilla no tiene una hoja llamada "PRIMERA".');
  const merges = (hoja.merges || []).map(m => ({
    s: { r: m.startRowIndex || 0, c: m.startColumnIndex || 0 },
    e: { r: m.endRowIndex || 0, c: m.endColumnIndex || 0 }
  }));
  return { sheetId: hoja.properties.sheetId, filas, merges };
}

function findCellsWithText(grid, text){
  const target = normText(text);
  const out = [];
  (grid.filas || []).forEach((fila, r) => {
    (Array.isArray(fila) ? fila : []).forEach((val, c) => {
      if(normText(val) === target) out.push({ r, c });
    });
  });
  return out;
}

// Registra un cambio de valor para (r,c) y lo refleja también en la grilla en memoria.
function marcarCambio(grid, cambios, r, c, value, formato){
  const texto = String(value == null ? '' : value);
  cambios.push({ r, c, value: texto, formato: formato || null });
  if(!grid.filas[r]) grid.filas[r] = [];
  grid.filas[r][c] = texto;
}

// Busca, entre las celdas combinadas de la hoja, la más cercana a la derecha de (r,c)
// dentro de la misma fila. Estas plantillas suelen dejar el campo de respuesta como una
// celda combinada que empieza 1, 2 o más columnas después de la etiqueta.
function celdaRespuestaEnFila(grid, r, c){
  const DISTANCIA_MAXIMA = 6;
  let mejor = null;
  for(const m of grid.merges){
    if(m.s.r === r && m.s.c > c && (m.s.c - c) <= DISTANCIA_MAXIMA){
      if(!mejor || m.s.c < mejor.s.c) mejor = m;
    }
  }
  if(mejor) return { r: mejor.s.r, c: mejor.s.c };
  return { r, c: c + 1 };
}

function setRightOf(grid, cambios, labelText, value, formato){
  const m = findCellsWithText(grid, labelText)[0];
  if(!m) return false;
  const destino = celdaRespuestaEnFila(grid, m.r, m.c);
  marcarCambio(grid, cambios, destino.r, destino.c, value, formato);
  return true;
}

function setBelow(grid, cambios, labelText, value){
  const m = findCellsWithText(grid, labelText)[0];
  if(!m) return false;
  marcarCambio(grid, cambios, m.r + 1, m.c, value);
  return true;
}

// Estas posiciones son exactas para la plantilla V6 corregida (misma para los 74
// equipos, porque todos comparten el mismo encabezado). Coordenadas 0-indexadas
// (fila, columna) verificadas directamente contra el archivo real — por eso ya no se
// buscan por texto ni por un cálculo aproximado: así no vuelven a quedar fuera del
// cuadrito.
const CASILLAS_V6 = {
  Correctivo: [12, 2], Preventivo: [13, 2],
  Predictivo: [12, 7], Diagnóstico: [13, 6],
  Mecánica: [12, 13], Eléctrica: [13, 13],
  Electrónica: [12, 18], OtroFalla: [13, 18],
  FueraServicioSI: [23, 16], FueraServicioNO: [23, 18],
  InteriorSI: [27, 5], InteriorNO: [27, 7],
  ExteriorSI: [27, 16], ExteriorNO: [27, 18]
};

function marcarCasilla(grid, cambios, clave){
  const pos = CASILLAS_V6[clave];
  if(!pos) return;
  marcarCambio(grid, cambios, pos[0], pos[1], 'X');
}

// Ubica el final del checklist YA IMPRESO en la plantilla (bajo "Descripción de los
// procedimientos realizados:") y agrega ahí, en las filas siguientes, cualquier
// procedimiento adicional que el técnico haya escrito (uno por línea). No toca ni
// reescribe los procedimientos que ya vienen impresos en la plantilla.
function agregarProcedimientosAdicionales(grid, cambios, textoAdicional){
  const lineas = String(textoAdicional || '').split('\n').map(l => l.trim()).filter(Boolean);
  if(!lineas.length) return;

  const label = findCellsWithText(grid, 'Descripción de los procedimientos realizados:')[0];
  if(!label) return;

  const LIMITE_FILAS = 60; // resguardo para no recorrer la hoja entera si algo no calza
  let r = label.r + 1;
  let vueltas = 0;
  while((grid.filas[r] && normText(grid.filas[r][label.c])) && vueltas < LIMITE_FILAS){
    r++; vueltas++;
  }
  lineas.forEach((linea, i) => marcarCambio(grid, cambios, r + i, label.c, '✔ ' + linea));
}

// Calcula la lista de cambios (celda + valor nuevo) a partir de los datos capturados.
// No toca nada de formato salvo donde se pide explícitamente (ver "formato" abajo).
function calcularCambiosPlantilla(grid, equipo, cliente){
  const cambios = [];
  const IZQ_ABAJO = { horizontalAlignment: 'LEFT', verticalAlignment: 'BOTTOM' };

  setRightOf(grid, cambios, 'Fecha:', cliente.fecha, IZQ_ABAJO);
  setRightOf(grid, cambios, 'Solicitante:', cliente.solicitante);
  setRightOf(grid, cambios, 'Persona a Cargo:', cliente.personaCargo);
  setRightOf(grid, cambios, 'Info de contacto:', cliente.contacto, IZQ_ABAJO);
  if(equipo.informeNo) setRightOf(grid, cambios, 'Informe No.', equipo.informeNo);

  setRightOf(grid, cambios, 'Ubicación:', equipo.ubicacion);
  setRightOf(grid, cambios, 'Marca:', equipo.marca);
  setRightOf(grid, cambios, 'Serie:', equipo.serie);
  setRightOf(grid, cambios, 'Modelo:', equipo.modelo);
  setRightOf(grid, cambios, 'Código:', equipo.codigo);
  setRightOf(grid, cambios, 'Diagnóstico del equipo:', equipo.diagnostico);

  if(CASILLAS_V6[equipo.tipoMantenimiento]) marcarCasilla(grid, cambios, equipo.tipoMantenimiento);
  if(equipo.claseFalla === 'Otro') marcarCasilla(grid, cambios, 'OtroFalla');
  else if(CASILLAS_V6[equipo.claseFalla]) marcarCasilla(grid, cambios, equipo.claseFalla);

  marcarCasilla(grid, cambios, equipo.fueraDeServicio ? 'FueraServicioSI' : 'FueraServicioNO');
  marcarCasilla(grid, cambios, equipo.limpiezaInterior ? 'InteriorSI' : 'InteriorNO');
  marcarCasilla(grid, cambios, equipo.limpiezaExterior ? 'ExteriorSI' : 'ExteriorNO');

  agregarProcedimientosAdicionales(grid, cambios, equipo.procedimientosAdicionales);

  setBelow(grid, cambios, 'OBSERVACIONES', equipo.observaciones);

  if(equipo.responsable) setBelow(grid, cambios, 'Responsable(s) ejecución:', equipo.responsable);
  if(equipo.recibeSatisfaccion) setBelow(grid, cambios, 'Recibe a satisfacción:', equipo.recibeSatisfaccion);

  return cambios;
}

// Aplica los cambios por la API de Sheets, pidiendo explícitamente "fields: userEnteredValue"
// para que solo se toque el contenido de cada celda — el formato original queda intacto.
async function aplicarCambiosEnSheet(spreadsheetId, sheetId, cambios){
  if(!cambios.length) return;
  const requests = cambios.map(cambio => {
    const celda = { userEnteredValue: { stringValue: cambio.value } };
    let fields = 'userEnteredValue';
    if(cambio.formato){
      celda.userEnteredFormat = {
        horizontalAlignment: cambio.formato.horizontalAlignment,
        verticalAlignment: cambio.formato.verticalAlignment
      };
      fields += ',userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment';
    }
    return {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: cambio.r, endRowIndex: cambio.r + 1,
          startColumnIndex: cambio.c, endColumnIndex: cambio.c + 1
        },
        rows: [{ values: [celda] }],
        fields
      }
    };
  });
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + ':batchUpdate', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({ requests })
  });
  if(!res.ok) throw new Error('No se pudieron escribir los datos en la hoja (HTTP ' + res.status + ')');
}

// Normaliza texto para comparar nombres de cliente sin que importen tildes,
// mayúsculas/minúsculas ni espacios de más (ej. "Clínica CES" = "clinica ces").
function normNombre(s){
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

// Busca dentro de MANTENIMIENTOS una carpeta cuyo nombre coincida con el del cliente
// (sin importar mayúsculas/minúsculas, tildes ni espacios de más, ya que tus carpetas
// existentes no siguen un mismo formato — "UCIS DE COLOMBIA", "Clinica CES", etc.). Si
// no existe ninguna con ese nombre, crea una nueva para ese cliente.
async function encontrarOCrearCarpetaCliente(nombreCliente){
  const nombre = (nombreCliente || '').trim();
  if(!nombre) return CONFIG.MANTENIMIENTOS_FOLDER_ID;

  const q = "mimeType = 'application/vnd.google-apps.folder' and '" + CONFIG.MANTENIMIENTOS_FOLDER_ID + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&pageSize=1000&fields=files(id,name)', {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo buscar la carpeta del cliente (HTTP ' + res.status + ')');
  const data = await res.json();
  const objetivo = normNombre(nombre);
  const exacta = (data.files || []).find(f => normNombre(f.name) === objetivo);
  if(exacta) return await usarSubcarpetaReportesSiExiste(exacta.id);

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [CONFIG.MANTENIMIENTOS_FOLDER_ID]
    })
  });
  if(!createRes.ok) throw new Error('No se pudo crear la carpeta del cliente (HTTP ' + createRes.status + ')');
  const created = await createRes.json();
  return created.id;
}

// Si la carpeta del cliente ya tiene una subcarpeta "Reportes" (como suele pasar en las
// carpetas organizadas de siempre, junto a "Entrega documentos" / "Hojas de vida"), los
// informes se guardan ahí en vez de sueltos en la raíz de la carpeta del cliente.
async function usarSubcarpetaReportesSiExiste(carpetaClienteId){
  const q = "name contains 'Reporte' and mimeType = 'application/vnd.google-apps.folder' and '" + carpetaClienteId + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', {
    headers: driveHeaders()
  });
  if(!res.ok) return carpetaClienteId; // si falla la búsqueda, no bloquea: se usa la raíz
  const data = await res.json();
  const reportes = (data.files || [])[0];
  return reportes ? reportes.id : carpetaClienteId;
}

async function exportarComoPdf(sheetsFileId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + sheetsFileId + '/export?mimeType=application/pdf', {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo exportar a PDF (HTTP ' + res.status + ')');
  return res.blob();
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function exportarComoXlsx(sheetsFileId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + sheetsFileId + '/export?mimeType=' + encodeURIComponent(MIME_XLSX), {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo exportar a Excel (HTTP ' + res.status + ')');
  return res.blob();
}

async function subirArchivoBinario(blob, filename, mimeType, parentId){
  const metadata = { name: filename, parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob, filename);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: driveHeaders(), body: form
  });
  if(!res.ok) throw new Error('No se pudo subir el archivo Excel (HTTP ' + res.status + ')');
  return res.json();
}

async function eliminarArchivo(fileId){
  try{
    await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE', headers: driveHeaders() });
  }catch(e){ /* si falla la limpieza no es grave, el informe ya quedó guardado */ }
}

/* ============== SINCRONIZACIÓN ENTRE DISPOSITIVOS (vía Google Drive) ==============
   Antes cada celular/PC guardaba su progreso solo en su propio navegador (localStorage),
   así que un informe empezado en el iPhone no se veía en el PC. Ahora, cuando hay Drive
   conectado, el progreso (cliente actual + equipos agregados) se guarda también en un
   archivo en Drive, y cada dispositivo revisa ese archivo al conectar para ofrecer traer
   lo más reciente. */
const SESION_SYNC_NOMBRE = 'Sesion_App_NO_BORRAR.json';
let sesionSyncIdCache = null;

async function obtenerOCrearArchivoSesion(){
  if(sesionSyncIdCache) return sesionSyncIdCache;
  const q = "name = '" + SESION_SYNC_NOMBRE + "' and '" + CONFIG.MANTENIMIENTOS_FOLDER_ID + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: driveHeaders() });
  if(!res.ok) throw new Error('No se pudo buscar el archivo de sincronización (HTTP ' + res.status + ')');
  const data = await res.json();
  if(data.files && data.files.length){
    sesionSyncIdCache = data.files[0].id;
    return sesionSyncIdCache;
  }

  const metadata = { name: SESION_SYNC_NOMBRE, parents: [CONFIG.MANTENIMIENTOS_FOLDER_ID] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify({ cliente: defaultCliente(), equipos: [], actualizadoEn: 0 })], { type: 'application/json' }));
  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: driveHeaders(), body: form
  });
  if(!createRes.ok) throw new Error('No se pudo crear el archivo de sincronización (HTTP ' + createRes.status + ')');
  const created = await createRes.json();
  sesionSyncIdCache = created.id;
  return sesionSyncIdCache;
}

async function empujarEstadoADrive(){
  if(!state.driveToken) return;
  const id = await obtenerOCrearArchivoSesion();
  const payload = { cliente: state.cliente, equipos: state.equipos, actualizadoEn: Date.now() };
  await fetch('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify(payload)
  });
  state._localUpdatedAt = payload.actualizadoEn;
}

async function traerEstadoDeDrive(){
  const id = await obtenerOCrearArchivoSesion();
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', { headers: driveHeaders() });
  if(!res.ok) throw new Error('No se pudo leer el estado remoto (HTTP ' + res.status + ')');
  return res.json();
}

// Se llama justo después de conectar Drive: si hay una visita más reciente guardada
// desde otro dispositivo, se ofrece traerla (nunca se reemplaza sin preguntar).
async function revisarSincronizacionRemota(){
  if(!state.driveToken) return;
  try{
    const remoto = await traerEstadoDeDrive();
    const remotoTs = remoto.actualizadoEn || 0;
    const localTs = state._localUpdatedAt || 0;
    const remotoTieneAlgo = (remoto.cliente && remoto.cliente.nombre) || (remoto.equipos && remoto.equipos.length);
    if(remotoTieneAlgo && remotoTs > localTs + 5000){
      if(confirm('Hay una visita más reciente guardada desde otro dispositivo. ¿Cargarla aquí? Esto reemplaza lo que tengas ahora en este dispositivo.')){
        aplicandoEstadoRemoto = true;
        state.cliente = remoto.cliente || defaultCliente();
        state.equipos = remoto.equipos || [];
        state.draft = null;
        state.editingId = null;
        state._localUpdatedAt = remotoTs;
        aplicandoEstadoRemoto = false;
        saveState();
        goTo('cliente');
        showToast('Datos cargados desde la nube.');
      }
    }
  }catch(e){ /* si falla la revisión, no se interrumpe el uso normal de la app */ }
}

/* ============== BASE DE CLIENTES (Google Sheets: Clientes + Historial) ============== */
const BASE_CLIENTES_NOMBRE = 'Base de Clientes - Intelmedica';
let baseClientesIdCache = null;

async function obtenerOCrearBaseClientes(){
  if(baseClientesIdCache) return baseClientesIdCache;

  const q = "name = '" + BASE_CLIENTES_NOMBRE + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and '" + CONFIG.MANTENIMIENTOS_FOLDER_ID + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: driveHeaders() });
  if(!res.ok) throw new Error('No se pudo buscar la base de clientes (HTTP ' + res.status + ')');
  const data = await res.json();
  if(data.files && data.files.length){
    baseClientesIdCache = data.files[0].id;
    return baseClientesIdCache;
  }

  // No existe todavía: se crea con sus dos pestañas y encabezados.
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({
      properties: { title: BASE_CLIENTES_NOMBRE },
      sheets: [{ properties: { title: 'Clientes' } }, { properties: { title: 'Historial' } }]
    })
  });
  if(!createRes.ok) throw new Error('No se pudo crear la base de clientes (HTTP ' + createRes.status + ')');
  const created = await createRes.json();
  const id = created.spreadsheetId;

  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Clientes!A1:E1?valueInputOption=RAW', {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({ values: [['Nombre', 'Solicitante', 'Persona a Cargo', 'Contacto', 'Última visita']] })
  });
  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Historial!A1:F1?valueInputOption=RAW', {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({ values: [['Fecha', 'Cliente', 'Equipo', 'Informe No.', 'Excel', 'PDF']] })
  });

  // Mover el archivo recién creado (queda en la raíz de "Mi unidad" por defecto) a MANTENIMIENTOS.
  await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?addParents=' + CONFIG.MANTENIMIENTOS_FOLDER_ID, {
    method: 'PATCH', headers: driveHeaders()
  });

  baseClientesIdCache = id;
  return id;
}

async function leerRangoSheet(spreadsheetId, rango){
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(rango), {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo leer la base de clientes (HTTP ' + res.status + ')');
  const data = await res.json();
  return data.values || [];
}

async function cargarBaseClientes(){
  const id = await obtenerOCrearBaseClientes();
  const [clientesRaw, historialRaw] = await Promise.all([
    leerRangoSheet(id, 'Clientes!A2:E10000'),
    leerRangoSheet(id, 'Historial!A2:F10000')
  ]);
  const clientes = clientesRaw
    .filter(f => f[0])
    .map(f => ({ nombre: f[0]||'', solicitante: f[1]||'', personaCargo: f[2]||'', contacto: f[3]||'', ultimaVisita: f[4]||'' }));
  const historial = historialRaw
    .filter(f => f[0])
    .map(f => ({ fecha: f[0]||'', cliente: f[1]||'', equipo: f[2]||'', informeNo: f[3]||'', excelUrl: f[4]||'', pdfUrl: f[5]||'' }));
  clientesCache = { clientes, historial };
  return clientesCache;
}

// Guarda (o actualiza) el cliente y agrega una fila al historial. Se llama automáticamente
// cada vez que se genera un informe oficial — no requiere ninguna acción del técnico.
// Interpreta "Informe_<Tipo>_<Cliente>_2026-07-28.pdf" sabiendo ya el nombre del
// cliente (viene de la carpeta), para sacar el tipo de equipo y la fecha.
// Reconoce dos formatos de nombre:
//  - viejo: "Informe_<Tipo>_<Cliente>_<Fecha>.pdf"  (trae la fecha en el nombre)
//  - nuevo: "<InformeNo>_<Tipo>_<Serie>.pdf"          (sin fecha; se usa la de Drive)
function parsearNombreInforme(filename, clienteNombre){
  const extMatch = filename.match(/\.(pdf|xlsx)$/i);
  if(!extMatch) return null;
  const ext = extMatch[1].toLowerCase();
  const base = filename.slice(0, -(ext.length + 1));

  const mViejo = base.match(/^Informe_(.+)_(\d{4}-\d{2}-\d{2})$/i);
  if(mViejo){
    const clienteSan = sanitizeFilename(clienteNombre);
    let tipoSan = mViejo[1];
    if(tipoSan.toLowerCase().endsWith('_' + clienteSan.toLowerCase())){
      tipoSan = tipoSan.slice(0, tipoSan.length - clienteSan.length - 1);
    }
    const tipoReal = EQUIPOS_LISTA.find(n => sanitizeFilename(n).toLowerCase() === tipoSan.toLowerCase()) || tipoSan.replace(/_/g, ' ');
    return { tipo: tipoReal, fecha: mViejo[2], informeNo: '', ext };
  }

  for(const nombreEquipo of EQUIPOS_LISTA){
    const marcador = '_' + sanitizeFilename(nombreEquipo).toLowerCase() + '_';
    const idx = base.toLowerCase().indexOf(marcador);
    if(idx > 0){
      return { tipo: nombreEquipo, fecha: null, informeNo: base.slice(0, idx), ext };
    }
  }
  return null;
}

async function listarSubcarpetas(folderId){
  const q = "mimeType = 'application/vnd.google-apps.folder' and '" + folderId + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&pageSize=1000&fields=files(id,name)', { headers: driveHeaders() });
  if(!res.ok) throw new Error('No se pudieron listar las carpetas (HTTP ' + res.status + ')');
  const data = await res.json();
  return data.files || [];
}
async function listarCarpetasDeMantenimientos(){
  return listarSubcarpetas(CONFIG.MANTENIMIENTOS_FOLDER_ID);
}

async function listarArchivosInforme(carpetaId){
  const q = "'" + carpetaId + "' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType = '" + MIME_XLSX + "')";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&pageSize=1000&fields=files(id,name,mimeType,modifiedTime)', { headers: driveHeaders() });
  if(!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

// Recorre todas las carpetas dentro de MANTENIMIENTOS, entra a la subcarpeta "Reportes"
// si existe, y arma el historial + la lista de clientes a partir de los nombres de
// archivo que ya sigue la app ("Informe_<Tipo>_<Cliente>_<Fecha>.pdf/.xlsx"). Los
// archivos que no siguen ese formato (informes viejos hechos a mano, etc.) se ignoran.
async function importarDesdeCarpetasExistentes(onProgreso){
  const carpetas = await listarCarpetasDeMantenimientos();
  const id = await obtenerOCrearBaseClientes();
  const clientesExistentes = await leerRangoSheet(id, 'Clientes!A2:E10000');
  const historialExistente = await leerRangoSheet(id, 'Historial!A2:F10000');
  const yaImportado = new Set(historialExistente.map(f => (f[4]||'') + '|' + (f[5]||'')));
  const nombresClientes = new Map(clientesExistentes.map(f => [normNombre(f[0]||''), f[0]]));

  const nuevosClientes = [];
  const nuevasFilas = [];
  let procesadas = 0;

  for(const carpeta of carpetas){
    procesadas++;
    if(onProgreso) onProgreso(procesadas, carpetas.length, carpeta.name);

    const carpetaReportes = await usarSubcarpetaReportesSiExiste(carpeta.id);
    const archivos = await listarArchivosInforme(carpetaReportes);
    if(!archivos.length) continue;

    // agrupar pdf+xlsx que corresponden al mismo informe (mismo nombre base)
    const grupos = {};
    for(const arch of archivos){
      const base = arch.name.replace(/\.(pdf|xlsx)$/i, '');
      if(!grupos[base]) grupos[base] = {};
      if(/\.pdf$/i.test(arch.name)) grupos[base].pdf = arch;
      else grupos[base].xlsx = arch;
    }

    let clienteTieneInformes = false;
    for(const base in grupos){
      const g = grupos[base];
      const cualquiera = g.pdf || g.xlsx;
      const parsed = parsearNombreInforme(cualquiera.name, carpeta.name);
      if(!parsed) continue; // no sigue el formato conocido, se ignora

      const excelUrl = g.xlsx ? 'https://drive.google.com/file/d/' + g.xlsx.id + '/view' : '';
      const pdfUrl = g.pdf ? 'https://drive.google.com/file/d/' + g.pdf.id + '/view' : '';
      const clave = excelUrl + '|' + pdfUrl;
      if(yaImportado.has(clave)) continue;

      const fecha = parsed.fecha || (cualquiera.modifiedTime ? cualquiera.modifiedTime.slice(0,10) : '');
      nuevasFilas.push([fecha, carpeta.name, parsed.tipo, parsed.informeNo || '', excelUrl, pdfUrl]);
      clienteTieneInformes = true;
    }

    if(clienteTieneInformes && !nombresClientes.has(normNombre(carpeta.name))){
      nuevosClientes.push([carpeta.name, '', '', '', '']);
      nombresClientes.set(normNombre(carpeta.name), carpeta.name);
    }
  }

  if(nuevosClientes.length){
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Clientes!A:E:append?valueInputOption=RAW', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
      body: JSON.stringify({ values: nuevosClientes })
    });
  }
  if(nuevasFilas.length){
    // la API de Sheets acepta como máximo unas pocas miles de filas por solicitud;
    // se manda en bloques de 500 por seguridad.
    for(let i = 0; i < nuevasFilas.length; i += 500){
      await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Historial!A:F:append?valueInputOption=RAW', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
        body: JSON.stringify({ values: nuevasFilas.slice(i, i+500) })
      });
    }
  }

  clientesCache = null;
  return { carpetasRevisadas: carpetas.length, clientesNuevos: nuevosClientes.length, informesNuevos: nuevasFilas.length };
}

// Crea o actualiza (según exista o no) la fila del cliente en la pestaña "Clientes".
// Se usa tanto al ir llenando el formulario como al generar un informe.
async function upsertClienteEnBase(cliente){
  const id = await obtenerOCrearBaseClientes();
  const filas = await leerRangoSheet(id, 'Clientes!A2:E10000');
  const objetivo = normNombre(cliente.nombre);
  const idx = filas.findIndex(f => normNombre(f[0]||'') === objetivo);
  const filaValores = [cliente.nombre, cliente.solicitante||'', cliente.personaCargo||'', cliente.contacto||'', cliente.fecha||todayISO()];

  if(idx >= 0){
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Clientes!A' + (idx+2) + ':E' + (idx+2) + '?valueInputOption=RAW', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
      body: JSON.stringify({ values: [filaValores] })
    });
  }else{
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Clientes!A:E:append?valueInputOption=RAW', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
      body: JSON.stringify({ values: [filaValores] })
    });
  }
  clientesCache = null; // se vuelve a cargar la próxima vez que haga falta
}

async function registrarVisitaCliente(cliente, equipo, links){
  await upsertClienteEnBase(cliente);
  const id = await obtenerOCrearBaseClientes();

  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/Historial!A:F:append?valueInputOption=RAW', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({ values: [[cliente.fecha, cliente.nombre, equipo.tipo, equipo.informeNo || '', links.excelUrl || '', links.pdfUrl || '']] })
  });

  clientesCache = null; // se recarga la próxima vez que se abra la base de clientes
}

async function obtenerNombreCarpeta(folderId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + folderId + '?fields=name', { headers: driveHeaders() });
  if(!res.ok) return '(carpeta)';
  const data = await res.json();
  return data.name || '(carpeta)';
}

// Paso 1: al tocar "Generar informe oficial" no se sube nada todavía — primero se
// resuelve la carpeta que la app usaría (por nombre de cliente / subcarpeta
// "Reportes") y se muestra para que el técnico la confirme o elija otra.
async function prepararGuardado(id){
  if(!state.driveToken){ showToast('Primero conecta tu cuenta de Google Drive.'); return; }
  const eq = state.equipos.find(e => e.id === id);
  if(eq && !eq.informeNo){
    if(!confirm('No escribiste el "Informe No." para este equipo — el archivo y el documento van a quedar sin ese número. ¿Continuar de todas formas?')) return;
  }
  confirmacionCarpeta[id] = { cargando: true, opciones: null, elegida: null, buscando: false, filtro: '', navPila: null };
  render();
  try{
    const folderId = await encontrarOCrearCarpetaCliente(state.cliente.nombre);
    const nombre = await obtenerNombreCarpeta(folderId);
    confirmacionCarpeta[id] = { cargando: false, opciones: null, elegida: { id: folderId, nombre }, buscando: false, filtro: '', navPila: null };
  }catch(err){
    confirmacionCarpeta[id] = { cargando: false, opciones: null, elegida: null, buscando: false, filtro: '', navPila: null, error: err.message };
  }
  render();
}

function cancelarGuardado(id){
  delete confirmacionCarpeta[id];
  render();
}

// Abre el explorador de carpetas empezando siempre en MANTENIMIENTOS, y deja navegar
// hacia adentro (subcarpetas de subcarpetas) — así se puede llegar, por ejemplo, a
// "Cliente → Reportes → 2026" si existiera.
async function mostrarSelectorCarpetas(id){
  const est = confirmacionCarpeta[id];
  if(!est) return;
  est.buscando = true;
  est.filtro = '';
  est.navPila = [{ id: CONFIG.MANTENIMIENTOS_FOLDER_ID, nombre: 'MANTENIMIENTOS' }];
  render();
  await cargarNivelCarpetas(id);
}

async function entrarACarpeta(id, folderId, nombre){
  const est = confirmacionCarpeta[id];
  if(!est) return;
  est.navPila.push({ id: folderId, nombre });
  est.filtro = '';
  render();
  await cargarNivelCarpetas(id);
}

async function subirNivelCarpeta(id){
  const est = confirmacionCarpeta[id];
  if(!est || est.navPila.length <= 1) return;
  est.navPila.pop();
  est.filtro = '';
  render();
  await cargarNivelCarpetas(id);
}

async function cargarNivelCarpetas(id){
  const est = confirmacionCarpeta[id];
  if(!est) return;
  const actual = est.navPila[est.navPila.length - 1];
  est.opciones = null;
  render();
  try{
    est.opciones = await listarSubcarpetas(actual.id);
  }catch(err){
    showToast('No se pudieron listar las carpetas.');
    est.opciones = [];
  }
  render();
}

function usarCarpetaActual(id){
  const est = confirmacionCarpeta[id];
  if(!est || !est.navPila) return;
  const actual = est.navPila[est.navPila.length - 1];
  elegirCarpetaGuardado(id, actual.id, actual.nombre);
}

function elegirCarpetaGuardado(id, folderId, nombre){
  const est = confirmacionCarpeta[id];
  if(!est) return;
  est.elegida = { id: folderId, nombre };
  est.buscando = false;
  est.navPila = null;
  render();
}

function confirmarGuardado(id){
  const est = confirmacionCarpeta[id];
  if(!est || !est.elegida) return;
  const folderId = est.elegida.id;
  delete confirmacionCarpeta[id];
  render();
  generarInformeOficial(id, folderId);
}

function panelConfirmacionHtml(eq){
  const est = confirmacionCarpeta[eq.id];
  if(!est) return '';

  if(est.cargando){
    return `<div class="status-line">Buscando la carpeta del cliente…</div>`;
  }
  if(est.error){
    return `<div class="status-line err">Error: ${escapeHtml(est.error)}</div>
      <button class="btn btn-outline btn-sm" style="width:100%;" data-action="cancelarGuardado" data-id="${eq.id}">Cerrar</button>`;
  }

  let listaHtml = '';
  if(est.buscando){
    const migas = est.navPila.map(n => escapeHtml(n.nombre)).join(' › ');
    const puedeSubir = est.navPila.length > 1;
    listaHtml = `
      <div class="status-line" style="text-align:left;margin:8px 0 4px;">📂 ${migas}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        ${puedeSubir ? `<button class="btn btn-outline btn-sm" data-action="subirNivelCarpeta" data-id="${eq.id}">‹ Atrás</button>` : ''}
        <button class="btn btn-outline btn-sm" style="flex:1;" data-action="usarCarpetaActual" data-id="${eq.id}">📌 Guardar en esta carpeta</button>
      </div>
      <div class="field"><input type="text" id="carpetaFiltro_${eq.id}" placeholder="Buscar dentro de esta carpeta…" value="${escapeHtml(est.filtro||'')}"></div>
      <div id="carpetaListaBox_${eq.id}">${filasCarpetasHtml(eq.id, est.filtro||'')}</div>`;
  }

  return `
    <div class="card" style="background:#f4f7fb;">
      <div class="card-title">📁 ¿Dónde se guarda?</div>
      <div class="status-line" style="text-align:left;margin:0 0 10px;">Se guardará en: <b>${escapeHtml(est.elegida.nombre)}</b></div>
      ${listaHtml}
      <button class="btn btn-primary btn-sm" style="width:100%;" data-action="confirmarGuardado" data-id="${eq.id}">Guardar aquí</button>
      <button class="btn btn-outline btn-sm" style="width:100%;margin-top:6px;" data-action="mostrarSelectorCarpetas" data-id="${eq.id}">Elegir otra carpeta</button>
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:6px;" data-action="cancelarGuardado" data-id="${eq.id}">Cancelar</button>
    </div>`;
}

function filasCarpetasHtml(equipoId, filtro){
  const est = confirmacionCarpeta[equipoId];
  if(!est || !est.opciones) return '<div class="status-line">Cargando carpetas…</div>';
  const f = normNombre(filtro);
  const lista = est.opciones
    .filter(c => !f || normNombre(c.name).includes(f))
    .sort((a,b) => a.name.localeCompare(b.name, 'es'))
    .slice(0, 50);
  if(!lista.length) return '<div class="status-line">Esta carpeta no tiene subcarpetas.</div>';
  return lista.map(c => `
    <div class="equipo-card">
      <div class="equipo-icon" data-action="entrarACarpeta" data-id="${equipoId}" data-folderid="${c.id}" data-foldername="${escapeHtml(c.name)}" style="cursor:pointer;">📁</div>
      <div class="equipo-info" data-action="entrarACarpeta" data-id="${equipoId}" data-folderid="${c.id}" data-foldername="${escapeHtml(c.name)}" style="cursor:pointer;">
        <div class="equipo-nombre">${escapeHtml(c.name)}</div>
        <div class="status-line" style="text-align:left;margin:0;">Toca para entrar</div>
      </div>
      <button class="btn btn-outline btn-sm" data-action="elegirCarpetaGuardado" data-id="${equipoId}" data-folderid="${c.id}" data-foldername="${escapeHtml(c.name)}">Usar</button>
    </div>`).join('');
}

async function generarInformeOficial(id, folderId){
  const eq = state.equipos.find(e => e.id === id);
  if(!eq) return;
  const templateId = TEMPLATE_FILE_IDS[eq.tipo];
  const statusEl = document.getElementById('status_' + id);
  const setStatus = (msg, cls) => { if(statusEl){ statusEl.textContent = msg; statusEl.className = 'status-line ' + (cls || ''); } };

  if(!templateId){
    showToast('Este tipo de equipo no tiene una plantilla oficial asociada todavía.');
    return;
  }
  if(!state.driveToken){
    showToast('Primero conecta tu cuenta de Google Drive.');
    return;
  }

  try{
    setStatus('Descargando plantilla oficial…');
    const bytesOriginales = await descargarPlantillaBytes(templateId);

    setStatus('Copiando plantilla con su diseño original…');
    const nombre = nombreArchivo(eq).replace(/\.pdf$/, '');
    const sheetFile = await subirPlantillaComoSheet(bytesOriginales, nombre, folderId);

    setStatus('Llenando datos…');
    const grid = await obtenerGridPrimera(sheetFile.id);
    const cambios = calcularCambiosPlantilla(grid, eq, state.cliente);
    await aplicarCambiosEnSheet(sheetFile.id, grid.sheetId, cambios);

    setStatus('Generando PDF…');
    const pdfBlob = await exportarComoPdf(sheetFile.id);
    const url = URL.createObjectURL(pdfBlob);
    window.open(url, '_blank');
    const pdfFile = await subirArchivoBinario(pdfBlob, nombre + '.pdf', 'application/pdf', folderId);

    setStatus('Guardando copia en Excel…');
    const xlsxBlob = await exportarComoXlsx(sheetFile.id);
    const xlsxFile = await subirArchivoBinario(xlsxBlob, nombre + '.xlsx', MIME_XLSX, folderId);

    // La copia de Google Sheets ya no hace falta: el Excel y el PDF quedan como
    // los archivos finales en la carpeta del cliente.
    await eliminarArchivo(sheetFile.id);

    // Se registra la visita en la base de clientes; si esto falla no se pierde el
    // informe (ya quedó guardado arriba), solo no se refleja en la base.
    try{
      await registrarVisitaCliente(state.cliente, eq, {
        excelUrl: 'https://drive.google.com/file/d/' + xlsxFile.id + '/view',
        pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.id + '/view'
      });
    }catch(e){ /* no bloquea el flujo principal */ }

    setStatus('✓ Informe oficial generado (Excel + PDF) y guardado en Drive', 'ok');
    showToast('Informe oficial listo.');
  }catch(err){
    if(err && err.message === 'NO_DRIVE'){
      setStatus('Conecta Google Drive primero.', 'err');
    }else{
      setStatus('Error: ' + (err && err.message ? err.message : 'no se pudo generar'), 'err');
    }
  }
}
/* ============== GOOGLE SIGN-IN / DRIVE ============== */
let tokenClient = null;
function initGoogle(){
  if(!window.google || !google.accounts || !google.accounts.oauth2){
    setTimeout(initGoogle, 400);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: CONFIG.DRIVE_SCOPE,
    callback: (resp) => {
      if(resp.error){ showToast('No se pudo conectar con Google Drive.'); return; }
      state.driveToken = resp.access_token;
      state.driveExpiry = Date.now() + ((resp.expires_in||3500)*1000);
      render();
      showToast('Conectado a Google Drive.');
      revisarSincronizacionRemota();
    }
  });
}
// Al salir del campo "Nombre del cliente": si ya existe en la base, ofrece llenar el
// resto de los datos con lo que ya se tiene guardado; si no existe, empieza a
// registrarlo de una vez (sin esperar a que se genere un informe).
let upsertClienteTimer = null;
function programarUpsertCliente(){
  if(!state.driveToken || !state.cliente.nombre) return;
  clearTimeout(upsertClienteTimer);
  upsertClienteTimer = setTimeout(() => { upsertClienteEnBase(state.cliente).catch(()=>{}); }, 800);
}

async function manejarNombreClienteIngresado(nombre){
  nombre = (nombre || '').trim();
  if(!nombre || !state.driveToken) return;
  try{
    if(!clientesCache) await cargarBaseClientes();
    const existente = clientesCache.clientes.find(c => normNombre(c.nombre) === normNombre(nombre));
    if(existente){
      let cambiado = false;
      if(!state.cliente.solicitante && existente.solicitante){ state.cliente.solicitante = existente.solicitante; cambiado = true; }
      if(!state.cliente.personaCargo && existente.personaCargo){ state.cliente.personaCargo = existente.personaCargo; cambiado = true; }
      if(!state.cliente.contacto && existente.contacto){ state.cliente.contacto = existente.contacto; cambiado = true; }
      if(cambiado){
        saveState();
        render();
        showToast('Datos del cliente autocompletados desde la base.');
      }
    }else{
      programarUpsertCliente();
    }
  }catch(e){ /* si falla la consulta no se interrumpe el llenado normal */ }
}

async function sincronizarAhora(){
  if(!state.driveToken){ showToast('Conecta Google Drive primero.'); return; }
  showToast('Sincronizando…');
  await revisarSincronizacionRemota();
  await empujarEstadoADrive().catch(()=>{});
  showToast('Sincronizado.');
}

function connectDrive(){
  if(!tokenClient){ showToast('Google Sign-In aún está cargando, intenta de nuevo en unos segundos.'); return; }
  tokenClient.requestAccessToken();
}

/* ============== EVENT DELEGATION ============== */
function wireCommonHandlers(){
  // Inputs de texto / textarea / date con data-path: guardan en el estado al escribir
  app.querySelectorAll('[data-path]').forEach(elm => {
    if(elm.tagName === 'INPUT' || elm.tagName === 'TEXTAREA'){
      elm.addEventListener('input', () => {
        setPath(elm.dataset.path, elm.value);
      });
      elm.addEventListener('blur', saveState);
    }
  });

  // Botones de dictado
  app.querySelectorAll('[data-mic-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleDictation(btn.dataset.micPath, btn.dataset.micTarget, btn);
    });
  });

  // Nombre del cliente: al salir del campo, busca en la base de clientes. Si existe,
  // ofrece llenar el resto de los datos; si no existe, la va alimentando de una vez
  // (sin esperar a que se genere un informe).
  const nombreClienteInput = document.getElementById('fld_cliente_nombre');
  if(nombreClienteInput){
    nombreClienteInput.addEventListener('blur', () => {
      manejarNombreClienteIngresado(nombreClienteInput.value);
    });
  }
  const clienteSelect = document.getElementById('clienteSelectDropdown');
  if(clienteSelect){
    clienteSelect.addEventListener('change', () => {
      if(clienteSelect.value === '__nuevo__'){
        state._nuevoClienteModo = true;
        state.cliente.nombre = '';
        state.cliente.solicitante = '';
        state.cliente.personaCargo = '';
        state.cliente.contacto = '';
      }else{
        state._nuevoClienteModo = false;
        state.cliente.nombre = clienteSelect.value;
        state.cliente.solicitante = '';
        state.cliente.personaCargo = '';
        state.cliente.contacto = '';
        manejarNombreClienteIngresado(clienteSelect.value);
      }
      saveState();
      render();
    });
  }
  ['fld_cliente_solicitante', 'fld_cliente_personaCargo', 'fld_cliente_contacto'].forEach(id => {
    const input = document.getElementById(id);
    if(input) input.addEventListener('blur', programarUpsertCliente);
  });

  // Buscador de tipo de equipo
  const searchInput = document.getElementById('equipoSearchInput');
  if(searchInput){
    searchInput.addEventListener('input', () => {
      renderEquipoSuggestions(searchInput.value);
    });
    searchInput.addEventListener('focus', () => {
      if(searchInput.value) renderEquipoSuggestions(searchInput.value);
    });
  }

  // Buscador de la base de clientes (actualiza solo la lista, sin perder el foco)
  const clienteFiltroInput = document.getElementById('clienteFiltroInput');
  if(clienteFiltroInput){
    clienteFiltroInput.addEventListener('input', () => {
      state._filtroClientes = clienteFiltroInput.value;
      const box = document.getElementById('listaClientesBox');
      if(box) box.innerHTML = filasClientesHtml(normNombre(clienteFiltroInput.value));
    });
  }

  // Buscador de carpetas dentro del panel "¿Dónde se guarda?" (uno por equipo visible)
  Object.keys(confirmacionCarpeta).forEach(eqId => {
    const input = document.getElementById('carpetaFiltro_' + eqId);
    if(input){
      input.addEventListener('input', () => {
        const est = confirmacionCarpeta[eqId];
        if(!est) return;
        est.filtro = input.value;
        const box = document.getElementById('carpetaListaBox_' + eqId);
        if(box) box.innerHTML = filasCarpetasHtml(eqId, input.value);
      });
    }
  });

  // Delegación de clicks por data-action
  app.addEventListener('click', onAppClick);
}

function onAppClick(e){
  const target = e.target.closest('[data-action]');
  if(!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  const value = target.dataset.value;
  const path = target.dataset.path;
  const isBool = target.dataset.bool;

  switch(action){
    case 'continuarCliente': continuarCliente(); break;
    case 'goTo': goTo(target.dataset.target); break;
    case 'startNewEquipo': startNewEquipo(); break;
    case 'editEquipo': editEquipo(id); break;
    case 'saveDraft': saveDraft(); break;
    case 'cancelForm': cancelForm(); break;
    case 'deleteDraftEquipo': deleteDraftEquipo(); break;
    case 'crearPin': crearPin(); break;
    case 'intentarPin': intentarPin(); break;
    case 'confirmarResetPin': confirmarResetPin(); break;
    case 'verCliente': verCliente(target.dataset.nombre); break;
    case 'cerrarClienteDetalle': cerrarClienteDetalle(); break;
    case 'usarClienteExistente': usarClienteExistente(target.dataset.nombre); break;
    case 'iniciarImportacion': iniciarImportacion(); break;
    case 'setChoice': {
      const v = isBool ? (value === 'true') : value;
      setPath(path, v);
      render();
      break;
    }
    case 'pickEquipoTipo': pickEquipoTipo(value); break;
    case 'verPdf': verPdf(id); break;
    case 'descargarPdf': descargarPdf(id); break;
    case 'subirDrive': subirDrive(id); break;
    case 'prepararGuardado': prepararGuardado(id); break;
    case 'cancelarGuardado': cancelarGuardado(id); break;
    case 'mostrarSelectorCarpetas': mostrarSelectorCarpetas(id); break;
    case 'entrarACarpeta': entrarACarpeta(id, target.dataset.folderid, target.dataset.foldername); break;
    case 'subirNivelCarpeta': subirNivelCarpeta(id); break;
    case 'usarCarpetaActual': usarCarpetaActual(id); break;
    case 'elegirCarpetaGuardado': elegirCarpetaGuardado(id, target.dataset.folderid, target.dataset.foldername); break;
    case 'confirmarGuardado': confirmarGuardado(id); break;
    case 'connectDrive': connectDrive(); break;
    case 'sincronizarAhora': sincronizarAhora(); break;
  }
}

/* ============== ARRANQUE ============== */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
initGoogle();
render();
