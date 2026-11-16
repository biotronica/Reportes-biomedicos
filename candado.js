/* ============== CANDADO INTELMEDICA ==============
   PIN por dispositivo + bloqueo por inactividad (15 min).
   Lo usan la Plataforma Biomédica y la App de Reportes: como las dos están en
   biotronica.github.io comparten el mismo PIN y la misma actividad (si se trabaja en
   Reportes, la Plataforma no se bloquea, y al revés).
   - El PIN nunca se guarda: solo un resumen PBKDF2-SHA256 con sal aleatoria.
   - 5 intentos fallidos → espera creciente (30 s, 1 min, 2 min… hasta 15 min).
   - "Olvidé el PIN": cada app define window.CANDADO_OLVIDE (la Plataforma pide iniciar
     sesión con una cuenta de Google autorizada y luego deja crear un PIN nuevo).
================================================== */
(function(){
  const K_PIN = 'intel_pin', K_ACT = 'intel_actividad', K_INT = 'intel_intentos';
  const INACTIVIDAD = 15 * 60 * 1000, ITER = 150000;
  if(!(window.crypto && crypto.subtle)) return; // solo funciona en https

  const ls = {
    get: k => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
    set: (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
    del: k => { try{ localStorage.removeItem(k); }catch(e){} }
  };
  const b64 = buf => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derivar(pin, sal, iter){
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' }, key, 256));
  }

  let bloqueado = false, capa = null;
  const tienePin = () => !!(ls.get(K_PIN) || {}).h;
  const vencido = () => { const a = ls.get(K_ACT); return !a || Date.now() - a > INACTIVIDAD; };
  let ultimaMarca = 0;
  function marcar(){
    if(bloqueado) return;
    const ahora = Date.now();
    if(ahora - ultimaMarca < 10000) return;
    ultimaMarca = ahora; ls.set(K_ACT, ahora);
  }

  const estilo = document.createElement('style');
  estilo.textContent = `
  #candadoIntel{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(160deg,#0a1f8f,#0b2a6f 55%,#06163f);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}
  #candadoIntel .cj{background:#fff;color:#14213d;border-radius:18px;max-width:340px;width:100%;padding:24px 20px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.35)}
  #candadoIntel h2{margin:6px 0 4px;font-size:20px}
  #candadoIntel p{margin:4px 0 14px;font-size:14px;color:#55607a;line-height:1.35}
  #candadoIntel input{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:10px;text-align:center;padding:10px;border:2px solid #cfd6e6;border-radius:12px;margin:6px 0;outline:none}
  #candadoIntel input:focus{border-color:#0a1f8f}
  #candadoIntel button{width:100%;padding:12px;border:0;border-radius:12px;background:#0a1f8f;color:#fff;font-size:16px;font-weight:600;margin-top:8px;cursor:pointer}
  #candadoIntel button.sec{background:transparent;color:#0a1f8f;font-size:14px;font-weight:500;margin-top:4px}
  #candadoIntel .err{color:#c62828;font-size:13px;min-height:18px;margin-top:4px}`;
  document.head.appendChild(estilo);

  function ocultar(){
    bloqueado = false;
    if(capa){ capa.remove(); capa = null; }
    ultimaMarca = 0; marcar();
  }

  function mostrar(modo){
    bloqueado = true;
    if(capa) capa.remove();
    capa = document.createElement('div');
    capa.id = 'candadoIntel';
    const crear = modo === 'crear';
    capa.innerHTML = `<div class="cj">
      <div style="font-size:38px">🔒</div>
      <h2>${crear ? 'Cree su PIN' : 'Ingrese su PIN'}</h2>
      <p>${crear ? 'Este dispositivo pedirá el PIN al abrir la Plataforma o Reportes y después de 15 minutos sin uso. Use de 4 a 6 números.' : 'Plataforma Biomédica · Intelmedica'}</p>
      <input id="cjPin" type="password" inputmode="numeric" autocomplete="${crear ? 'new-password' : 'current-password'}" maxlength="6" placeholder="••••">
      ${crear ? '<input id="cjPin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" placeholder="Repita el PIN">' : ''}
      <div class="err" id="cjErr"></div>
      <button id="cjOk">${crear ? 'Guardar PIN' : 'Desbloquear'}</button>
      ${crear ? '' : '<button class="sec" id="cjOlvide">Olvidé el PIN</button>'}
    </div>`;
    (document.body || document.documentElement).appendChild(capa);
    const pin = capa.querySelector('#cjPin'), pin2 = capa.querySelector('#cjPin2'), err = capa.querySelector('#cjErr');
    const soloNum = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); };
    pin.addEventListener('input', soloNum); if(pin2) pin2.addEventListener('input', soloNum);
    setTimeout(() => pin.focus(), 50);
    const enviar = async () => {
      err.textContent = '';
      const v = pin.value;
      if(crear){
        if(!/^\d{4,6}$/.test(v)){ err.textContent = 'El PIN debe tener de 4 a 6 números.'; return; }
        if(/^(\d)\1+$/.test(v) || '0123456789'.includes(v) || '9876543210'.includes(v)){ err.textContent = 'Use un PIN menos fácil de adivinar.'; return; }
        if(pin2.value !== v){ err.textContent = 'Los dos PIN no coinciden.'; return; }
        const sal = crypto.getRandomValues(new Uint8Array(16));
        ls.set(K_PIN, { s: b64(sal), h: await derivar(v, sal, ITER), it: ITER });
        ls.del(K_INT);
        ocultar();
        return;
      }
      const int = ls.get(K_INT) || { n: 0, hasta: 0 };
      if(Date.now() < int.hasta){ err.textContent = 'Demasiados intentos. Espere ' + Math.ceil((int.hasta - Date.now()) / 1000) + ' s.'; return; }
      const g = ls.get(K_PIN) || {};
      const ok = g.h && (await derivar(v, unb64(g.s), g.it || ITER)) === g.h;
      if(ok){ ls.del(K_INT); ocultar(); return; }
      int.n = (int.n || 0) + 1;
      if(int.n >= 5) int.hasta = Date.now() + Math.min(15 * 60, 30 * Math.pow(2, int.n - 5)) * 1000;
      ls.set(K_INT, int);
      pin.value = '';
      err.textContent = int.n >= 5 ? 'PIN incorrecto. Espere antes de intentar de nuevo.' : 'PIN incorrecto (' + int.n + ' de 5).';
    };
    capa.querySelector('#cjOk').addEventListener('click', enviar);
    capa.addEventListener('keydown', e => { if(e.key === 'Enter') enviar(); });
    const olv = capa.querySelector('#cjOlvide');
    if(olv) olv.addEventListener('click', async () => {
      if(typeof window.CANDADO_OLVIDE !== 'function'){ err.textContent = 'Abra la Plataforma Biomédica y use allí "Olvidé el PIN".'; return; }
      err.textContent = 'Inicie sesión con su cuenta de Google autorizada…';
      try{
        const ok = await window.CANDADO_OLVIDE();
        if(ok){ ls.del(K_PIN); ls.del(K_INT); mostrar('crear'); }
        else err.textContent = 'No se pudo comprobar la cuenta.';
      }catch(e){ err.textContent = e && e.message ? e.message : 'No se pudo comprobar la cuenta.'; }
    });
  }

  // Al abrir: sin PIN → crearlo; con PIN y más de 15 min sin uso → pedirlo.
  function revisar(){ if(bloqueado) return; if(!tienePin()) mostrar('crear'); else if(vencido()) mostrar('pedir'); }
  if(document.body) revisar(); else document.addEventListener('DOMContentLoaded', revisar);
  if(!bloqueado) marcar();

  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, marcar, { passive: true, capture: true }));
  setInterval(() => { if(!bloqueado && tienePin() && vencido()) mostrar('pedir'); }, 20000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') revisar(); });
  // Si se desbloqueó en la otra app (otra pestaña), se quita aquí también
  window.addEventListener('storage', e => { if(e.key === K_ACT && bloqueado && tienePin() && !vencido()) ocultar(); });

  window.Candado = {
    bloquear: () => mostrar('pedir'),
    cambiarPin: () => mostrar('crear'),
    tienePin
  };
})();
