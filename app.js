'use strict';

/* =========================================================
   CONFIGURACIÓN — edita estos dos valores antes de publicar
   ========================================================= */
const CONFIG = {
  // Client ID de OAuth de Google Cloud Console (tipo "Aplicación web").
  // Ver README.md para los pasos exactos de cómo obtenerlo.
  GOOGLE_CLIENT_ID: 'REEMPLAZA_CON_TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  // ID de la carpeta de Drive donde se guardarán los informes generados a mano alzada
  // (el PDF genérico). Déjalo vacío ('') para guardarlos en la raíz de "Mi unidad".
  DRIVE_FOLDER_ID: '',
  // Carpeta MANTENIMIENTOS donde vive "Formatos Mantenimientos Preventivos". Ahí mismo
  // se crea (o reutiliza) la subcarpeta "Reportes generados" para los informes oficiales.
  MANTENIMIENTOS_FOLDER_ID: '1-KMSW8rkSDPJ3O7eMiUqzEVUMRzqMUYs',
  REPORTES_GENERADOS_FOLDER_NAME: 'Reportes generados',
  // 'drive' (no solo 'drive.file') porque la app necesita LEER las plantillas oficiales
  // que ya existen en tu Drive, no solo escribir archivos que ella misma creó.
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive'
};

/* ============== ESTADO ============== */
const STORAGE_KEY = 'reportes_intelmedica_state_v1';

function todayISO(){ return new Date().toISOString().slice(0,10); }

function defaultCliente(){
  return { nombre:'', solicitante:'', personaCargo:'', contacto:'', fecha: todayISO(), informeNo:'' };
}

function defaultDraft(){
  return {
    id: uid(), tipo:'', marca:'', modelo:'', serie:'', codigo:'', ubicacion:'',
    tipoMantenimiento:'Preventivo', claseFalla:'', diagnostico:'',
    checklist:[], limpiezaInterior:true, limpiezaExterior:true, fueraDeServicio:false,
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

function saveState(){
  const toSave = Object.assign({}, state, { driveToken:null });
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); }catch(e){ /* almacenamiento lleno, ignorar */ }
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
      <div class="card">
        <div class="card-title">🏥 Institución / Cliente</div>
        ${fieldMicHtml('cliente.nombre', c.nombre, 'Nombre del cliente o institución', false)}
        ${fieldMicHtml('cliente.solicitante', c.solicitante, 'Solicitante', false)}
        ${fieldMicHtml('cliente.personaCargo', c.personaCargo, 'Persona a cargo', false)}
        ${fieldMicHtml('cliente.contacto', c.contacto, 'Info. de contacto (teléfono / correo)', false)}
        <div class="field">
          <label>Fecha</label>
          <input type="date" data-path="cliente.fecha" value="${escapeHtml(c.fecha)}">
        </div>
        <div class="field">
          <label>Informe No. (opcional)</label>
          <input type="text" data-path="cliente.informeNo" value="${escapeHtml(c.informeNo)}" placeholder="Ej: 0342">
        </div>
      </div>
    </div>
    <div class="bottom-bar">
      <div class="bottom-bar-inner">
        <button class="btn btn-primary" data-action="continuarCliente">Continuar →</button>
      </div>
    </div>
  </div>`);
  return wrap;
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
  const checklistHtml = d.checklist.length
    ? d.checklist.map((item,i) => `
      <div class="checklist-item" data-action="toggleChecklist" data-idx="${i}">
        <div class="checklist-check ${item.cumplido ? 'on':''}">${item.cumplido ? '✓':''}</div>
        <div class="checklist-text">${escapeHtml(item.texto)}</div>
      </div>`).join('')
    : `<div class="status-line">Selecciona un tipo de equipo arriba para cargar su checklist.</div>`;

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
        ${fieldMicHtml('draft.marca', d.marca, 'Marca', false)}
        ${fieldMicHtml('draft.modelo', d.modelo, 'Modelo', false)}
        ${fieldMicHtml('draft.serie', d.serie, 'Número de serie', false)}
        ${fieldMicHtml('draft.codigo', d.codigo, 'Código interno', false)}
        ${fieldMicHtml('draft.ubicacion', d.ubicacion, 'Ubicación', false)}
      </div>

      <div class="card">
        <div class="card-title">🛠️ Tipo de mantenimiento</div>
        <div class="choice-row">
          ${['Correctivo','Preventivo','Predictivo','Otro'].map(o=>
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
        <div class="card-title">✅ Procedimientos realizados</div>
        ${checklistHtml}
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
        <div class="card-title">📝 Observaciones</div>
        ${fieldMicHtml('draft.observaciones', d.observaciones, 'Observaciones', true)}
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
  state.draft.checklist = (EQUIPOS_DATA[name] || []).map(texto => ({ texto, cumplido:true }));
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
        ${tieneTemplate ? `<button class="btn btn-primary btn-sm" style="width:100%;" data-action="generarOficial" data-id="${eq.id}" ${driveOn?'':'disabled style="opacity:.5"'}>📄 Generar informe oficial (formato real)</button>` : `<div class="status-line">Sin plantilla oficial para este equipo — usa el PDF genérico abajo.</div>`}
        <button class="btn btn-outline btn-sm" style="width:100%;" data-action="verPdf" data-id="${eq.id}">👁️ Ver / Imprimir PDF genérico</button>
        <button class="btn btn-outline btn-sm" style="width:100%;" data-action="descargarPdf" data-id="${eq.id}">⬇️ Descargar PDF genérico</button>
        ${!tieneTemplate ? `<button class="btn btn-teal btn-sm" style="width:100%;" data-action="subirDrive" data-id="${eq.id}" ${driveOn?'':'disabled style="opacity:.5"'}>☁️ Subir PDF genérico a Drive</button>` : ''}
      </div>
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

/* ============== GENERACIÓN DE PDF ============== */
function sanitizeFilename(s){
  return (s||'informe')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,60);
}

function nombreArchivo(equipo){
  const cli = sanitizeFilename(state.cliente.nombre);
  const tipo = sanitizeFilename(equipo.tipo);
  const fecha = state.cliente.fecha || todayISO();
  return `Informe_${tipo}_${cli}_${fecha}.pdf`;
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
  if(cliente.informeNo) doc.text('Informe No.: ' + cliente.informeNo, pageW-marginX, y, {align:'right'});
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
  if(equipo.checklist && equipo.checklist.length){
    equipo.checklist.forEach(item => checkboxLine(item.texto, item.cumplido));
  }else{
    doc.setFontSize(9.5);
    doc.text('— Sin checklist asociado —', marginX, y);
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

/* ============== PLANTILLA OFICIAL (xlsx real -> Google Sheets -> PDF) ============== */

function driveHeaders(){
  if(!state.driveToken) throw new Error('NO_DRIVE');
  return { Authorization: 'Bearer ' + state.driveToken };
}

async function descargarPlantillaXlsx(fileId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo descargar la plantilla (HTTP ' + res.status + ')');
  const buf = await res.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellStyles: true });
}

function normText(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function findCellsWithText(sheet, text){
  const target = normText(text);
  const out = [];
  for(const addr in sheet){
    if(addr[0] === '!') continue;
    const cell = sheet[addr];
    if(cell && typeof cell.v === 'string' && normText(cell.v) === target){
      out.push(addr);
    }
  }
  return out;
}

function writeCell(sheet, r, c, value){
  const addr = XLSX.utils.encode_cell({ r, c });
  sheet[addr] = { t: 's', v: String(value == null ? '' : value) };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if(r > range.e.r) range.e.r = r;
  if(c > range.e.c) range.e.c = c;
  sheet['!ref'] = XLSX.utils.encode_range(range);
}

// Busca, entre las celdas combinadas (merges) de la hoja, la más cercana a la derecha
// de (r,c) dentro de la misma fila. Estas plantillas suelen dejar el campo de respuesta
// como una celda combinada que empieza 1, 2 o más columnas después de la etiqueta — por
// eso no basta con asumir "la celda de al lado".
function celdaRespuestaEnFila(sheet, r, c){
  const merges = sheet['!merges'] || [];
  const DISTANCIA_MAXIMA = 6; // columnas; más lejos que esto ya no es el mismo campo
  let mejor = null;
  for(const m of merges){
    if(m.s.r === r && m.s.c > c && (m.s.c - c) <= DISTANCIA_MAXIMA){
      if(!mejor || m.s.c < mejor.s.c) mejor = m;
    }
  }
  if(mejor) return { r: mejor.s.r, c: mejor.s.c };
  return { r, c: c + 1 }; // sin combinada cercana: usar la celda inmediata como respaldo
}

// Escribe el valor en la celda de respuesta a la derecha de la primera celda que
// contenga labelText (coincidencia exacta, sin importar espacios extra).
function setRightOf(sheet, labelText, value){
  const matches = findCellsWithText(sheet, labelText);
  if(!matches.length) return false;
  const { r, c } = XLSX.utils.decode_cell(matches[0]);
  const destino = celdaRespuestaEnFila(sheet, r, c);
  writeCell(sheet, destino.r, destino.c, value);
  return true;
}

// Escribe el valor en la celda de la misma columna, una fila más abajo que labelText.
function setBelow(sheet, labelText, value){
  const matches = findCellsWithText(sheet, labelText);
  if(!matches.length) return false;
  const { r, c } = XLSX.utils.decode_cell(matches[0]);
  writeCell(sheet, r + 1, c, value);
  return true;
}

// Marca con "X" la casilla junto a labelText (a la izquierda, donde suelen ir los
// cuadros de chequeo en estas plantillas).
function marcarOpcion(sheet, labelText){
  const matches = findCellsWithText(sheet, labelText);
  if(!matches.length) return false;
  const { r, c } = XLSX.utils.decode_cell(matches[0]);
  writeCell(sheet, r, Math.max(0, c - 1), 'X');
  return true;
}

// Distingue las dos celdas "Otro" (una de Mantenimiento, otra de Clase de falla) usando
// la columna de "Mecánica" como referencia: antes de esa columna = mantenimiento,
// desde esa columna en adelante = clase de falla.
function marcarOtro(sheet, esClaseFalla){
  const mecanica = findCellsWithText(sheet, 'Mecánica')[0];
  const otros = findCellsWithText(sheet, 'Otro');
  if(!otros.length) return;
  const colRef = mecanica ? XLSX.utils.decode_cell(mecanica).c : 0;
  for(const addr of otros){
    const { r, c } = XLSX.utils.decode_cell(addr);
    const esDeFalla = c >= colRef;
    if(esDeFalla === !!esClaseFalla){
      writeCell(sheet, r, Math.max(0, c - 1), 'X');
      return;
    }
  }
}

// El SÍ/NO puede estar en la misma fila que la etiqueta (caso más común) o en la fila
// siguiente (caso de "Equipo fuera de servicio" en varias plantillas) — se revisan ambas.
function marcarSiNoEnFila(sheet, labelText, siValor){
  const matches = findCellsWithText(sheet, labelText);
  if(!matches.length) return false;
  const { r: rLabel } = XLSX.utils.decode_cell(matches[0]);
  const siCells = findCellsWithText(sheet, 'SÍ').concat(findCellsWithText(sheet, 'SI'));
  const noCells = findCellsWithText(sheet, 'NO');
  for(const rCandidata of [rLabel, rLabel + 1]){
    const enFila = (arr) => arr.filter(addr => XLSX.utils.decode_cell(addr).r === rCandidata);
    const si = enFila(siCells)[0];
    const no = enFila(noCells)[0];
    if(si || no){
      const objetivo = siValor ? si : no;
      if(objetivo){
        const { r: rr, c: cc } = XLSX.utils.decode_cell(objetivo);
        writeCell(sheet, rr, cc + 1, 'X');
      }
      return true;
    }
  }
  return false;
}

function marcarChecklistItem(sheet, textoItem, cumplido){
  const matches = findCellsWithText(sheet, textoItem);
  if(!matches.length) return false;
  const { r, c } = XLSX.utils.decode_cell(matches[0]);
  const prefijo = cumplido ? '✔ ' : '✘ NO CUMPLE — ';
  const addr = XLSX.utils.encode_cell({ r, c });
  const original = sheet[addr] && sheet[addr].v ? sheet[addr].v : textoItem;
  sheet[addr] = { t: 's', v: prefijo + original };
  return true;
}

function llenarPlantillaOficial(workbook, equipo, cliente){
  const sheet = workbook.Sheets['PRIMERA'];
  if(!sheet) throw new Error('La plantilla no tiene una hoja llamada "PRIMERA".');

  setRightOf(sheet, 'Fecha:', cliente.fecha);
  setRightOf(sheet, 'Solicitante:', cliente.solicitante);
  setRightOf(sheet, 'Persona a Cargo:', cliente.personaCargo);
  setRightOf(sheet, 'Info de contacto:', cliente.contacto);
  if(cliente.informeNo) setRightOf(sheet, 'Informe No.', cliente.informeNo);

  setRightOf(sheet, 'Ubicación:', equipo.ubicacion);
  setRightOf(sheet, 'Marca:', equipo.marca);
  setRightOf(sheet, 'Serie:', equipo.serie);
  setRightOf(sheet, 'Modelo:', equipo.modelo);
  setRightOf(sheet, 'Código:', equipo.codigo);
  setRightOf(sheet, 'Diagnóstico del equipo:', equipo.diagnostico);

  // Tipo de mantenimiento y clase de falla
  ['Correctivo', 'Preventivo', 'Predictivo'].forEach(opt => {
    if(equipo.tipoMantenimiento === opt) marcarOpcion(sheet, opt);
  });
  if(equipo.tipoMantenimiento === 'Otro') marcarOtro(sheet, false);
  ['Mecánica', 'Eléctrica', 'Electrónica'].forEach(opt => {
    if(equipo.claseFalla === opt) marcarOpcion(sheet, opt);
  });
  if(equipo.claseFalla === 'Otro') marcarOtro(sheet, true);

  marcarSiNoEnFila(sheet, 'Equipo fuera de servicio', equipo.fueraDeServicio);
  marcarSiNoEnFila(sheet, 'Limpieza e inspección interior:', equipo.limpiezaInterior);
  marcarSiNoEnFila(sheet, 'Limpieza e inspección exterior:', equipo.limpiezaExterior);

  (equipo.checklist || []).forEach(item => marcarChecklistItem(sheet, item.texto, item.cumplido));

  setRightOf(sheet, 'OBSERVACIONES', equipo.observaciones, 0);
  setBelow(sheet, 'OBSERVACIONES', equipo.observaciones);

  if(equipo.responsable) setBelow(sheet, 'Responsable(s) ejecución:', equipo.responsable);
  if(equipo.recibeSatisfaccion) setBelow(sheet, 'Recibe a satisfacción:', equipo.recibeSatisfaccion);

  return workbook;
}

async function encontrarCarpetaReportesGenerados(){
  const q = "name = '" + CONFIG.REPORTES_GENERADOS_FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and '" + CONFIG.MANTENIMIENTOS_FOLDER_ID + "' in parents and trashed = false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q), { headers: driveHeaders() });
  if(!res.ok) throw new Error('No se pudo buscar la carpeta de reportes (HTTP ' + res.status + ')');
  const data = await res.json();
  if(data.files && data.files.length) return data.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, driveHeaders()),
    body: JSON.stringify({
      name: CONFIG.REPORTES_GENERADOS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [CONFIG.MANTENIMIENTOS_FOLDER_ID]
    })
  });
  if(!createRes.ok) throw new Error('No se pudo crear la carpeta de reportes (HTTP ' + createRes.status + ')');
  const created = await createRes.json();
  return created.id;
}

async function subirComoGoogleSheet(workbook, filename, parentId){
  const xlsxBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

async function exportarComoPdf(sheetsFileId){
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + sheetsFileId + '/export?mimeType=application/pdf', {
    headers: driveHeaders()
  });
  if(!res.ok) throw new Error('No se pudo exportar a PDF (HTTP ' + res.status + ')');
  return res.blob();
}

async function generarInformeOficial(id){
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
    const workbook = await descargarPlantillaXlsx(templateId);

    setStatus('Llenando datos…');
    llenarPlantillaOficial(workbook, eq, state.cliente);

    setStatus('Guardando en Drive…');
    const folderId = await encontrarCarpetaReportesGenerados();
    const nombre = nombreArchivo(eq).replace(/\.pdf$/, '');
    const sheetFile = await subirComoGoogleSheet(workbook, nombre, folderId);

    setStatus('Generando PDF…');
    const pdfBlob = await exportarComoPdf(sheetFile.id);
    const url = URL.createObjectURL(pdfBlob);
    window.open(url, '_blank');

    setStatus('✓ Informe oficial generado y guardado en Drive', 'ok');
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
    }
  });
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
    case 'toggleChecklist': {
      const idx = parseInt(target.dataset.idx,10);
      state.draft.checklist[idx].cumplido = !state.draft.checklist[idx].cumplido;
      render();
      break;
    }
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
    case 'generarOficial': generarInformeOficial(id); break;
    case 'connectDrive': connectDrive(); break;
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
