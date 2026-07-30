'use strict';

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

let currentPage = 'dashboard';
let billingMonth = null;
let billingYear = null;
let authToken = localStorage.getItem('token') || null;
let currentUser = null;
let userSubscription = null;
let isDark = localStorage.getItem('darkMode') === '1';

function setTheme(dark) {
  isDark = dark;
  document.body.classList.toggle('dark', dark);
  localStorage.setItem('darkMode', dark ? '1' : '0');
  document.getElementById('dark-toggle').textContent = dark ? '☀️' : '🌙';
  document.getElementById('theme-color')?.setAttribute('content', dark ? '#1c1c1e' : '#0071e3');
}
setTheme(isDark);

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.upgrade) { showUpgradeModal(data.message || 'Limite atteinte'); }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (method === 'DELETE') return null;
  const data = await res.json();
  if (data.error && data.upgrade) { showUpgradeModal(data.message); }
  return data;
}

let _loadingCounter = 0;
function showLoading(msg) {
  const el = document.getElementById('toast');
  _loadingCounter++;
  el.textContent = msg || 'Chargement...';
  el.classList.add('show', 'loading');
  clearTimeout(el._timer);
}
function hideLoading() {
  _loadingCounter--;
  if (_loadingCounter <= 0) {
    _loadingCounter = 0;
    const el = document.getElementById('toast');
    el.classList.remove('show', 'loading');
  }
}

function showToast(msg, duration) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration || 2500);
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

document.getElementById('modal-overlay').addEventListener('click', function (e) {
  if (e.target === this) hideModal();
});

// ───── UPGRADE MODAL ─────
function showUpgradeModal(msg) {
  const html = `<div class="text-center" style="padding:8px 0">
    <div style="font-size:48px;margin-bottom:12px">⭐</div>
    <h3>Version Pro requise</h3>
    <p style="color:var(--text-secondary);margin-bottom:16px">${msg || 'Vous avez atteint la limite gratuite.'}</p>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Passer en Pro : <strong>5€/mois</strong> — employeurs et présences illimités.</p>
    <div class="modal-actions" style="justify-content:center">
      <button class="btn btn-outline" onclick="hideModal()">Plus tard</button>
      <button class="btn btn-pro" onclick="hideModal();navigateTo('families');showProInfo()">Passer en Pro</button>
    </div>
  </div>`;
  showModal(html);
}

function showProInfo() {
  const html = `<div class="text-center" style="padding:8px 0">
    <div style="font-size:48px;margin-bottom:12px">⭐</div>
    <h3>Employé de Particulier Pro</h3>
    <p style="color:var(--text-secondary);margin:12px 0">Profitez de toutes les fonctionnalites sans limite.</p>
    <div style="text-align:left;margin:16px 0;padding:12px;background:var(--bg);border-radius:var(--radius-sm)">
      <div style="display:flex;justify-content:space-between;padding:6px 0"><span>✅ Gratuit</span><span>2 employeurs · 10 presences/mois</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0"><span>⭐ Pro</span><span><strong>Illimite</strong></span></div>
    </div>
    <p style="font-size:14px;font-weight:600;margin-bottom:12px">5€/mois · Paiement securise par Stripe</p>
    <div id="pro-action-area">
      <button class="btn btn-pro btn-block" onclick="startProCheckout()" id="pro-checkout-btn">
        ${authToken ? 'Passer en Pro' : 'Connectez-vous d\'abord'}
      </button>
    </div>
    <div class="modal-actions" style="justify-content:center;margin-top:12px">
      <button class="btn btn-outline" onclick="hideModal()">Plus tard</button>
    </div>
  </div>`;
  showModal(html);
}

async function startProCheckout() {
  if (!authToken) { hideModal(); showAuthModal(); return; }
  const btn = document.getElementById('pro-checkout-btn');
  btn.textContent = 'Redirection...'; btn.disabled = true;
  try {
    const res = await api('POST', '/api/subscription/create-checkout');
    if (res.url) window.location.href = res.url;
    else showToast('Erreur: pas d\'URL de paiement');
  } catch (err) {
    showToast('Erreur: ' + err.message);
    btn.textContent = 'Passer en Pro'; btn.disabled = false;
  }
}

// ───── AUTH ─────
async function checkAuth() {
  if (!authToken) { currentUser = null; userSubscription = null; updateAuthUI(); return; }
  try {
    const data = await api('GET', '/api/auth/me');
    currentUser = data.user;
    userSubscription = data.subscription;
  } catch {
    authToken = null; localStorage.removeItem('token');
    currentUser = null; userSubscription = null;
  }
  updateAuthUI();
}

function updateAuthUI() {
  const btn = document.getElementById('auth-btn');
  if (currentUser) {
    btn.textContent = currentUser.email;
    if (userSubscription?.tier === 'pro') btn.innerHTML = currentUser.email + ' <span class="pro-badge">PRO</span>';
  } else {
    btn.textContent = 'Connexion';
  }
}

document.getElementById('auth-btn').addEventListener('click', () => {
  if (currentUser) { navigateTo('account'); return; }
  showAuthModal();
});

document.getElementById('app-title').addEventListener('click', () => navigateTo('dashboard'));
document.getElementById('dark-toggle').addEventListener('click', () => setTheme(!isDark));

function showAuthModal() {
  const html = `<div class="auth-tabs">
      <button class="auth-tab active" onclick="switchAuthTab(this,'login')">Connexion</button>
      <button class="auth-tab" onclick="switchAuthTab(this,'register')">Inscription</button>
    </div>
    <div id="auth-form-container">
      <form id="auth-login-form" onsubmit="return submitLogin(event)">
        <div class="form-group"><label>Email</label><input type="email" name="email" required placeholder="votre@email.fr" autocomplete="email"></div>
        <div class="form-group"><label>Mot de passe</label><input type="password" name="password" required minlength="4" autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary btn-block">Se connecter</button>
        <p class="form-text text-center" style="margin-top:12px">Pas encore de compte ? <a href="#" onclick="switchAuthTab(document.querySelector('.auth-tab:last-child'),'register');return false">S'inscrire</a></p>
      </form>
      <form id="auth-register-form" style="display:none" onsubmit="return submitRegister(event)">
        <div class="form-group"><label>Nom (optionnel)</label><input type="text" name="name" placeholder="Votre nom"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" required placeholder="votre@email.fr" autocomplete="email"></div>
        <div class="form-group"><label>Mot de passe</label><input type="password" name="password" required minlength="4" autocomplete="new-password"></div>
        <button type="submit" class="btn btn-primary btn-block">S'inscrire</button>
        <p class="form-text text-center" style="margin-top:12px">Déjà un compte ? <a href="#" onclick="switchAuthTab(document.querySelector('.auth-tab:first-child'),'login');return false">Se connecter</a></p>
      </form>
    </div>`;
  showModal(html);
}

function switchAuthTab(el, tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('auth-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register-form').style.display = tab === 'register' ? 'block' : 'none';
}

async function submitLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    const res = await api('POST', '/api/auth/login', data);
    authToken = res.token; localStorage.setItem('token', res.token);
    currentUser = res.user;
    hideModal(); await checkAuth(); await renderCurrentPage(); showToast('Connecte ✓');
  } catch (err) { showToast('Erreur: ' + err.message); }
  return false;
}

async function submitRegister(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    const res = await api('POST', '/api/auth/register', data);
    authToken = res.token; localStorage.setItem('token', res.token);
    currentUser = res.user;
    hideModal(); await checkAuth(); await renderCurrentPage(); showToast('Compte cree ✓');
  } catch (err) { showToast('Erreur: ' + err.message); }
  return false;
}

function logout() {
  authToken = null; localStorage.removeItem('token');
  currentUser = null; userSubscription = null;
  updateAuthUI(); renderCurrentPage(); showToast('Deconnecte');
}

// ───── ACCOUNT PAGE ─────
async function renderAccountPage() {
  const el = document.getElementById('page-account');
  if (!currentUser) { await renderFamiliesPage(); return; }
  const isPro = userSubscription?.tier === 'pro';
  el.innerHTML = `<div class="card">
      <h2>Mon compte</h2>
      <div class="profile-card">
        <div class="profile-avatar">${currentUser.name ? currentUser.name[0].toUpperCase() : '👤'}</div>
        <div class="profile-info">
          <div class="pi-name">${esc(currentUser.name || 'Utilisateur')}</div>
          <div class="pi-email">${esc(currentUser.email)}</div>
        </div>
        ${isPro ? '<span class="pro-badge">PRO</span>' : ''}
      </div>
    </div>
    <div class="card">
      <h2>Abonnement</h2>
      <p style="margin-bottom:12px;color:var(--text-secondary)">
        ${isPro ? '✅ Vous etes abonne au plan <strong>Pro</strong>.' : '⭐ Vous etes sur le plan <strong>Gratuit</strong>.'}
        ${isPro ? '' : 'Passez en Pro pour debloquer les limites.'}
      </p>
      ${isPro ? `
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${userSubscription?.current_period_end ? 'Valable jusqu\'au ' + userSubscription.current_period_end : 'Abonnement actif'}</p>
        <button class="btn btn-outline" onclick="cancelSubscription()">Resilier l'abonnement</button>
      ` : `
        <button class="btn btn-pro btn-block" onclick="hideModal();showProInfo()">Passer en Pro - 5€/mois</button>
      `}
    </div>
    <div class="card">
      <button class="btn btn-outline btn-block" onclick="exportData()" style="margin-bottom:8px">📥 Exporter les donnees (CSV)</button>
      <button class="btn btn-outline btn-block" onclick="logout()" style="color:var(--danger);border-color:var(--danger)">Se deconnecter</button>
    </div>`;
}

async function cancelSubscription() {
  if (!confirm('Voulez-vous vraiment resilier ?')) return;
  await api('POST', '/api/subscription/cancel');
  await checkAuth(); await renderAccountPage(); showToast('Abonnement resilie');
}

async function exportData() {
  showLoading('Preparation du fichier...');
  try {
    const res = await fetch('/api/export/csv', { headers: { 'Authorization': `Bearer ${authToken}` } });
    if (!res.ok) throw new Error('Erreur export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `employe-particulier-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('Exporte ✓');
  } catch (e) { showToast('Erreur: ' + e.message); }
  hideLoading();
}

// ───── FAMILY OPERATIONS ─────
async function getFamilies(search) {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  return api('GET', '/api/families' + q);
}

async function getFamily(id) {
  const list = await api('GET', '/api/families');
  return list.find(f => f.id === parseInt(id)) || null;
}

async function getFamilyByName(name) {
  return api('GET', `/api/families/by-name/${encodeURIComponent(name)}`);
}

async function saveFamily(data) {
  if (data.id) { return api('PUT', `/api/families/${data.id}`, data); }
  else { return api('POST', '/api/families', data); }
}

async function deleteFamily(id) { return api('DELETE', `/api/families/${id}`); }

// ───── ATTENDANCE OPERATIONS ─────
async function getAttendances(filters) {
  const params = new URLSearchParams();
  if (filters?.month) params.set('month', filters.month);
  if (filters?.year) params.set('year', filters.year);
  if (filters?.family_name) params.set('family_name', filters.family_name);
  if (filters?.limit) params.set('limit', filters.limit);
  return api('GET', '/api/attendances?' + params.toString());
}

async function saveAttendance(data) { return api('POST', '/api/attendances', data); }
async function deleteAttendance(id) { return api('DELETE', `/api/attendances/${id}`); }

// ───── BILLING OPERATIONS ─────
async function getBillingData(month, year) { return api('GET', `/api/billing?month=${month}&year=${year}`); }
async function saveCafSubsidy(monthLabel, familyName, amount) {
  return api('POST', '/api/billing/caf', { billing_month_label: monthLabel, family_name: familyName, caf_subsidy: parseFloat(amount) || 0 });
}

function calcHours(arrival, departure) {
  if (!arrival || !departure) return 0;
  const [ah, am] = arrival.split(':').map(Number);
  const [dh, dm] = departure.split(':').map(Number);
  if (isNaN(ah) || isNaN(am) || isNaN(dh) || isNaN(dm)) return 0;
  const start = ah * 60 + am;
  const end = dh * 60 + dm;
  if (end <= start) return 0;
  return Math.round((end - start) / 60 * 100) / 100;
}

// ───── DASHBOARD ─────
async function renderDashboardPage() {
  const el = document.getElementById('page-dashboard');
  let data;
  try { data = await api('GET', '/api/dashboard'); } catch { data = null; }

  if (!data) {
    el.innerHTML = `<div class="card text-center empty-state"><p>Chargement...</p></div>`;
    return;
  }

  const cm = data.current_month;

  let upgradeHtml = '';
  if (currentUser && userSubscription?.tier !== 'pro') {
    upgradeHtml = `<div class="upgrade-card">
      <h3>⭐ Passez en Pro</h3>
      <p>Employeurs et presences illimites pour seulement 5€/mois</p>
      <button class="btn" onclick="showProInfo()">Decouvrir le plan Pro</button>
    </div>`;
  } else if (!currentUser) {
    upgradeHtml = `<div class="upgrade-card">
      <h3>🔐 Creer un compte</h3>
      <p>Sauvegardez vos donnees et accedez-y depuis n'importe ou</p>
      <button class="btn" onclick="showAuthModal()">Creer un compte gratuit</button>
    </div>`;
  }

  el.innerHTML = `${upgradeHtml}
    <div class="card"><h2>${data.month} ${data.year}</h2>
      <div class="stats-grid">
        <div class="stat-card highlight"><div class="stat-icon">💰</div><div class="stat-label">Gagne ce mois</div><div class="stat-value">${cm.total_amount.toFixed(2).replace('.',',')} €</div></div>
        <div class="stat-card"><div class="stat-icon">⏰</div><div class="stat-label">Heures travaillees</div><div class="stat-value">${cm.total_hours.toFixed(1).replace('.',',')}</div><div class="stat-sub">${cm.days_count} jours · ${cm.families_count} employeur(s)</div></div>
        <div class="stat-card"><div class="stat-icon">🏢</div><div class="stat-label">Total employeurs</div><div class="stat-value">${data.all_time.total_families}</div><div class="stat-sub">Tous les mois confondus</div></div>
        <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-label">Total gagne</div><div class="stat-value">${data.all_time.total_earned.toFixed(2).replace('.',',')} €</div></div>
      </div>
    </div>
    <div class="card"><h2>Dernieres presences</h2>
      ${data.recent.length === 0 ? '<div class="empty-state"><p>Aucune presence recente</p></div>' : ''}
      ${data.recent.map(r => {
        const date = formatDateShort(r.attendance_date);
        const hrs = (r.total_hours || 0).toFixed(2).replace('.', ',');
        const amt = (r.amount || 0).toFixed(2).replace('.', ',');
        return `<div class="recent-item">
          <div class="ri-left"><div class="ri-name">${esc(r.family_name)}</div><div class="ri-date">${date} · ${r.arrival_time.slice(0,5)}→${r.departure_time.slice(0,5)}</div></div>
          <div class="ri-right"><div class="ri-amount">${amt} €</div><div class="ri-hours">${hrs} h</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

// ───── UI: FAMILIES ─────
async function renderFamiliesPage() {
  const families = await getFamilies();
  const el = document.getElementById('page-families');
  let limitInfo = '';
  if (authToken && userSubscription?.tier !== 'pro') {
    const count = families.length;
    limitInfo = `<div class="limit-info ${count >= 2 ? 'limit-warn' : ''}">${count}/2 employeurs utilises <span class="text-muted">(gratuit)</span>${count >= 2 ? ' · <a href="#" onclick="showProInfo();return false">Passez en Pro</a>' : ''}</div>`;
  }
  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="margin:0">Employeurs</h2>
      <div style="display:flex;gap:8px;align-items:center">${limitInfo}${authToken ? '<button class="btn btn-primary btn-sm" onclick="showFamilyForm()">+ Ajouter</button>' : ''}</div>
    </div>`;
  if (families.length === 0) { html += `<div class="empty-state"><p>Aucun employeur</p></div>`; }
  else {
    html += `<table class="data-table"><thead><tr><th>Famille</th><th>Service</th><th class="text-right">Tarif/h</th>${authToken ? '<th></th>' : ''}</tr></thead><tbody>`;
    for (const f of families) {
      const rate = (f.hourly_rate || 0).toFixed(2).replace('.', ',');
      html += `<tr><td class="truncate"><strong>${esc(f.family_name)}</strong></td><td class="truncate">${esc(f.service_type || '-')}</td><td class="text-right font-mono">${rate} €</td>
        ${authToken ? `<td class="text-right"><button class="btn btn-outline btn-sm" onclick="showFamilyForm(${f.id})">✎</button><button class="btn btn-danger btn-sm" onclick="confirmDeleteFamily(${f.id})">✕</button></td>` : ''}</tr>`;
    }
    html += `</tbody></table>`;
    html += `<div class="card-list">`;
    for (const f of families) {
      const rate = (f.hourly_rate || 0).toFixed(2).replace('.', ',');
      const svc = f.service_type ? `${esc(f.service_type)} · ` : '';
      html += `<div class="card-item"><div class="item-info"><div class="item-value">${esc(f.family_name)}</div><div class="item-label">${svc}${rate} €/h</div></div>
        ${authToken ? `<div class="item-actions"><button class="btn btn-outline btn-sm" onclick="showFamilyForm(${f.id})">✎</button><button class="btn btn-danger btn-sm" onclick="confirmDeleteFamily(${f.id})">✕</button></div>` : ''}</div>`;
    }
    html += `</div>`;
  }
  html += `</div>
    ${!authToken ? `<div class="card upgrade-card"><h3>🔐 Connectez-vous</h3><p>Pour ajouter et gerer vos employeurs</p><button class="btn" onclick="showAuthModal()">Se connecter</button></div>` : ''}
    <div class="card" style="font-size:13px;color:var(--muted)"><p>💡 Les employeurs peuvent aussi etre crees depuis la page <strong>Presences</strong>.</p></div>`;
  el.innerHTML = html;
}

function showFamilyForm(id) {
  (async () => {
    const fam = id ? await getFamily(id) : null;
    const title = fam ? "Modifier l'employeur" : 'Nouvel employeur';
    const html = `<h3>${title}</h3>
      <form id="family-form" onsubmit="return submitFamily(event)">
        ${fam ? `<input type="hidden" name="id" value="${fam.id}">` : ''}
        <div class="form-group"><label>Nom de famille</label><input type="text" name="family_name" required value="${fam ? escAttr(fam.family_name) : ''}" placeholder="Ex: Dupont"></div>
        <div class="form-group"><label>Type de service</label><input type="text" name="service_type" value="${fam ? escAttr(fam.service_type || '') : ''}" placeholder="Ex: Menage, Jardinage..." list="service-types">
          <datalist id="service-types"><option value="Garde d'enfants"><option value="Menage / Entretien"><option value="Jardinage"><option value="Soutien scolaire"><option value="Soins a la personne"><option value="Bricolage"><option value="Courses / Commissions"></datalist></div>
        <div class="form-row"><div class="form-group"><label>Tarif horaire (€)</label><input type="number" name="hourly_rate" step="0.5" min="0" value="${fam ? (fam.hourly_rate || 0) : ''}"></div>
          <div class="form-group"><label>Email</label><input type="email" name="parent_email" value="${fam ? escAttr(fam.parent_email || '') : ''}" placeholder="email@exemple.fr"></div></div>
        <div class="modal-actions"><button type="button" class="btn btn-outline" onclick="hideModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>
      </form>`;
    showModal(html);
  })();
}

async function submitFamily(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try { await saveFamily(data); hideModal(); await renderFamiliesPage(); showToast('Enregistre ✓'); }
  catch (err) { showToast('Erreur: ' + err.message); }
  return false;
}

function confirmDeleteFamily(id) {
  (async () => {
    const fam = await getFamily(id); if (!fam) return;
    const html = `<h3>Supprimer ${esc(fam.family_name)} ?</h3>
      <p style="color:var(--text-secondary);margin-bottom:16px">Toutes les presences associees seront supprimees.</p>
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Annuler</button><button class="btn btn-danger" onclick="doDeleteFamily(${id})">Supprimer</button></div>`;
    showModal(html);
  })();
}

async function doDeleteFamily(id) {
  await deleteFamily(id); hideModal(); await renderFamiliesPage(); showToast('Supprime');
}

// ───── UI: ATTENDANCES ─────
async function renderAttendancesPage() {
  const today = new Date().toISOString().split('T')[0];
  const el = document.getElementById('page-attendances');
  let html = '';
  if (authToken) {
    let limitInfo = '';
    if (userSubscription?.tier !== 'pro') {
      limitInfo = `<div class="limit-info limit-warn" style="margin-bottom:12px">10 presences/mois max <span class="text-muted">(gratuit)</span> · <a href="#" onclick="showProInfo();return false">Passez en Pro</a></div>`;
    }
    html += `<div class="card"><h2>Nouvelle presence</h2>${limitInfo}
      <form id="attendance-form" onsubmit="return submitAttendance(event)">
        <div class="form-group"><label>Date</label><input type="date" name="attendance_date" value="${today}" required></div>
        <div class="form-group"><label>Nom de famille</label><input type="text" name="family_name" id="att-family-name" required placeholder="Tapez un nom" autocomplete="off" oninput="onFamilyNameInput(this.value)">
          <div id="att-family-info" class="auto-value"></div></div>
        <div class="form-row"><div class="form-group"><label>Arrivee</label><input type="time" name="arrival_time" id="att-arrival" value="08:00" required onchange="calcAttendancePreview()"></div>
          <div class="form-group"><label>Depart</label><input type="time" name="departure_time" id="att-departure" value="17:00" required onchange="calcAttendancePreview()"></div></div>
        <div id="att-preview" class="billing-total" style="display:none"><strong id="att-preview-text"></strong></div>
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:12px">Enregistrer</button>
      </form></div>`;
  }
  html += `<div class="card"><h2>Presences recentes</h2><div id="attendance-list"></div></div>`;
  el.innerHTML = html;
  await renderAttendanceList();
}

async function onFamilyNameInput(value) {
  const info = document.getElementById('att-family-info');
  if (!value || !value.trim()) { info.textContent = ''; calcAttendancePreview(); return; }
  try {
    const fam = await getFamilyByName(value.trim());
    if (fam) {
      const rate = (fam.hourly_rate || 0).toFixed(2).replace('.', ',');
      let txt = `✓ <strong>${esc(fam.family_name)}</strong> — Tarif: ${rate} €/h`;
      if (fam.service_type) txt += ` — ${esc(fam.service_type)}`;
      info.innerHTML = txt;
    } else {
      info.innerHTML = `🆕 Nouvel employeur — tarif a 0 € (a modifier dans <a href="#" onclick="navigateTo('families');return false">Employeurs</a>)`;
    }
  } catch (_) {}
  calcAttendancePreview();
}

async function calcAttendancePreview() {
  const familyName = document.getElementById('att-family-name')?.value?.trim();
  const arrival = document.getElementById('att-arrival')?.value;
  const departure = document.getElementById('att-departure')?.value;
  const preview = document.getElementById('att-preview');
  const previewText = document.getElementById('att-preview-text');
  if (!familyName || !arrival || !departure) { preview.style.display = 'none'; return; }
  const hrs = calcHours(arrival, departure);
  if (hrs <= 0) { preview.style.display = 'none'; return; }
  try {
    const fam = await getFamilyByName(familyName);
    const rate = fam ? (fam.hourly_rate || 0) : 0;
    const amt = Math.round(hrs * rate * 100) / 100;
    preview.style.display = 'block';
    const hs = hrs.toFixed(2).replace('.', ','); const rs = rate.toFixed(2).replace('.', ','); const as = amt.toFixed(2).replace('.', ',');
    previewText.innerHTML = fam ? `${hs} h × ${rs} €/h = <span style="font-size:18px">${as} €</span>` : `${hs} h × ${rs} €/h = ${as} € (tarif a definir)`;
  } catch (_) { preview.style.display = 'none'; }
}

async function submitAttendance(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  if (!data.family_name.trim()) { showToast('Entrez un nom'); return false; }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Enregistrement...';
  try {
    const result = await saveAttendance(data);
    btn.disabled = false; btn.textContent = 'Enregistrer';
    e.target.reset(); document.getElementById('att-arrival').value = '08:00';
    document.getElementById('att-departure').value = '17:00';
    document.getElementById('att-family-info').textContent = '';
    document.getElementById('att-preview').style.display = 'none';
    showToast(`${result.family_name} — ${(result.total_hours||0).toFixed(2).replace('.',',')} h, ${(result.amount||0).toFixed(2).replace('.',',')} € ✓`);
    await renderAttendanceList();
  } catch (err) { showToast('Erreur: ' + err.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  return false;
}

async function renderAttendanceList() {
  const list = document.getElementById('attendance-list');
  if (!list) return;
  const rows = await getAttendances({ limit: 50 });
  if (rows.length === 0) { list.innerHTML = `<div class="empty-state"><p>Aucune presence</p></div>`; return; }
  let html = `<table class="data-table"><thead><tr><th>Date</th><th>Famille</th><th>Arrivee</th><th>Depart</th><th class="text-right">Heures</th><th class="text-right">Montant</th>${authToken ? '<th></th>' : ''}</tr></thead><tbody>`;
  for (const r of rows) {
    const hrs = (r.total_hours || 0).toFixed(2).replace('.', ','); const amt = (r.amount || 0).toFixed(2).replace('.', ',');
    html += `<tr><td>${formatDateShort(r.attendance_date)}</td><td class="truncate">${esc(r.family_name)}</td><td>${r.arrival_time.slice(0,5)}</td><td>${r.departure_time.slice(0,5)}</td><td class="text-right font-mono">${hrs}</td><td class="text-right font-mono">${amt} €</td>
      ${authToken ? `<td class="text-right"><button class="btn btn-danger btn-sm" onclick="confirmDeleteAttendance(${r.id})">✕</button></td>` : ''}</tr>`;
  }
  html += `</tbody></table>`;
  html += `<div class="card-list">`;
  for (const r of rows) {
    const hrs = (r.total_hours || 0).toFixed(2).replace('.', ','); const amt = (r.amount || 0).toFixed(2).replace('.', ',');
    html += `<div class="card-item"><div class="item-info"><div class="item-value">${esc(r.family_name)} · ${formatDateShort(r.attendance_date)}</div><div class="item-label">${r.arrival_time.slice(0,5)} → ${r.departure_time.slice(0,5)} · ${hrs} h · ${amt} €</div></div>
      ${authToken ? `<div class="item-actions"><button class="btn btn-danger btn-sm" onclick="confirmDeleteAttendance(${r.id})">✕</button></div>` : ''}</div>`;
  }
  html += `</div>`;
  list.innerHTML = html;
}

function confirmDeleteAttendance(id) {
  const html = `<h3>Supprimer cette presence ?</h3><p style="color:var(--text-secondary);margin-bottom:16px">Action irreversible.</p>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Annuler</button><button class="btn btn-danger" onclick="doDeleteAttendance(${id})">Supprimer</button></div>`;
  showModal(html);
}

async function doDeleteAttendance(id) {
  await deleteAttendance(id); hideModal(); await renderAttendanceList(); showToast('Supprimee');
}

// ───── UI: BILLING ─────
async function renderBillingPage() {
  const now = new Date();
  if (billingMonth === null) billingMonth = now.getMonth() + 1;
  if (billingYear === null) billingYear = now.getFullYear();
  const el = document.getElementById('page-billing');
  const monthLabel = `${MONTHS_FR[billingMonth - 1]} ${billingYear}`;
  el.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="btn btn-outline btn-sm" onclick="changeBillingMonth(-1)">◀</button>
        <h2 style="margin:0;font-size:18px">${monthLabel}</h2>
        <button class="btn btn-outline btn-sm" onclick="changeBillingMonth(1)">▶</button>
      </div></div>
    <div class="card"><div id="billing-content">Calcul...</div></div>`;
  await renderBillingContent();
}

async function changeBillingMonth(delta) {
  billingMonth += delta;
  if (billingMonth > 12) { billingMonth = 1; billingYear++; }
  if (billingMonth < 1) { billingMonth = 12; billingYear--; }
  await renderBillingPage();
}

async function renderBillingContent() {
  const content = document.getElementById('billing-content');
  if (!content) return;
  let data;
  try { data = await getBillingData(billingMonth, billingYear); } catch { data = []; }
  if (data.length === 0) { content.innerHTML = `<div class="empty-state"><p>Aucune presence ce mois-ci</p></div>`; return; }
  let html = `<table class="data-table"><thead><tr><th>Famille</th><th>Jours</th><th class="text-right">Heures</th><th class="text-right">Brut</th><th class="text-right">CAF</th><th class="text-right">Net</th></tr></thead><tbody>`;
  let totalHours = 0, totalGross = 0, totalSubsidy = 0, totalNet = 0;
  for (const r of data) {
    totalHours += r.total_hours; totalGross += r.gross_amount; totalSubsidy += r.caf_subsidy; totalNet += r.net_amount;
    html += `<tr><td><strong>${esc(r.family_name)}</strong></td><td>${r.days}</td><td class="text-right font-mono">${r.total_hours.toFixed(2).replace('.',',')}</td>
      <td class="text-right font-mono">${r.gross_amount.toFixed(2).replace('.',',')} €</td>
      <td class="text-right"><input class="caf-input" type="number" step="0.5" min="0" value="${r.caf_subsidy > 0 ? r.caf_subsidy : ''}" onchange="onCafChange('${escAttr(r.family_name)}', this.value)" placeholder="0"></td>
      <td class="text-right font-mono"><strong>${r.net_amount.toFixed(2).replace('.',',')} €</strong></td></tr>`;
  }
  const s = v => v.toFixed(2).replace('.', ',');
  html += `</tbody><tfoot style="font-weight:600;border-top:2px solid var(--text)"><tr><td><strong>Total</strong></td><td></td>
    <td class="text-right font-mono">${s(totalHours)}</td><td class="text-right font-mono">${s(totalGross)} €</td>
    <td class="text-right font-mono">${s(totalSubsidy)} €</td><td class="text-right font-mono">${s(totalNet)} €</td></tr></tfoot></table>`;
  html += `<div class="card-list">`;
  for (const r of data) {
    html += `<div class="billing-card">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">${esc(r.family_name)}</div>
      <div class="bc-row"><span class="bc-label">Jours</span><span>${r.days}</span></div>
      <div class="bc-row"><span class="bc-label">Heures</span><span class="bc-value">${r.total_hours.toFixed(2).replace('.',',')}</span></div>
      <div class="bc-row"><span class="bc-label">Brut</span><span class="bc-value">${r.gross_amount.toFixed(2).replace('.',',')} €</span></div>
      <div class="bc-row"><span class="bc-label">CAF</span><input class="caf-input" type="number" step="0.5" min="0" value="${r.caf_subsidy > 0 ? r.caf_subsidy : ''}" onchange="onCafChange('${escAttr(r.family_name)}', this.value)" placeholder="0"></div>
      <hr class="bc-divider"><div class="bc-row"><span class="bc-label">Net</span><span class="bc-value">${r.net_amount.toFixed(2).replace('.',',')} €</span></div></div>`;
  }
  html += `</div>`;
  content.innerHTML = html;
}

let _cafTimer = null;
function onCafChange(familyName, value) {
  clearTimeout(_cafTimer);
  _cafTimer = setTimeout(async () => {
    const monthLabel = `${MONTHS_FR[billingMonth - 1]} ${billingYear}`;
    await saveCafSubsidy(monthLabel, familyName, value);
    await renderBillingContent(); showToast('CAF mis a jour ✓');
  }, 400);
}

// ───── TUTORIAL ─────
function showTutorial() {
  const steps = [
    {
      icon: '👋',
      title: 'Bienvenue sur votre espace !',
      desc: 'Cette application vous permet de <strong>suivre vos heures travaillees</strong> et de <strong>calculer automatiquement vos gains</strong> du mois, que vous soyez aide-menagere, garde d\'enfants, jardinier ou tout autre employe de particulier.',
    },
    {
      icon: '🏢',
      title: '1. Ajoutez vos employeurs',
      desc: 'Rendez-vous dans l\'onglet <strong>Employeurs</strong> (en haut) pour ajouter les personnes chez qui vous travaillez. Saisissez leur nom, le type de service et votre <strong>tarif horaire</strong>.',
    },
    {
      icon: '⏰',
      title: '2. Enregistrez vos presences',
      desc: 'Dans l\'onglet <strong>Presences</strong>, saisissez la date et les horaires de chaque jour travaille. Le montant gagne se calcule automatiquement !',
    },
    {
      icon: '📊',
      title: '3. Consultez vos gains',
      desc: 'L\'onglet <strong>Facturation</strong> vous donne le recapitulatif du mois : heures totales, montant brut, deductions et <strong>montant net a recevoir</strong>.',
    },
    {
      icon: '🔐',
      title: '4. Sauvegardez vos donnees',
      desc: 'Creez un <strong>compte gratuit</strong> en cliquant sur "Connexion" en haut a droite. Vos donnees seront sauvegardees en ligne et accessibles depuis n\'importe ou !',
    },
  ];

  let currentStep = 0;

  function renderStep() {
    const s = steps[currentStep];
    const isFirst = currentStep === 0;
    const isLast = currentStep === steps.length - 1;
    const html = `<div class="text-center" style="padding:8px 0">
      <div style="font-size:64px;margin-bottom:16px;animation:pulse 2s infinite">${s.icon}</div>
      <h3 style="font-size:22px;margin-bottom:12px">${s.title}</h3>
      <p style="color:var(--text-secondary);line-height:1.6;margin-bottom:20px;font-size:15px">${s.desc}</p>
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:20px">
        ${steps.map((_, i) => `<div style="width:${i === currentStep ? '24px' : '8px'};height:8px;border-radius:4px;background:${i === currentStep ? 'var(--primary)' : 'var(--border)'};transition:all 0.3s"></div>`).join('')}
      </div>
      <div class="modal-actions" style="justify-content:${isFirst ? 'flex-end' : 'space-between'}">
        ${isFirst ? '' : `<button class="btn btn-outline" onclick="tutorialPrev()">Precedent</button>`}
        ${isLast
          ? `<button class="btn btn-primary" onclick="tutorialDone()">Commencer !</button>`
          : `<button class="btn btn-primary" onclick="tutorialNext()">Suivant</button>`}
      </div>
    </div>`;
    showModal(html);
  }

  window.tutorialNext = () => { if (currentStep < steps.length - 1) { currentStep++; renderStep(); } };
  window.tutorialPrev = () => { if (currentStep > 0) { currentStep--; renderStep(); } };
  window.tutorialDone = () => { hideModal(); localStorage.setItem('tutorial_done', '1'); };

  renderStep();
}

// ───── NAVIGATION ─────
async function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  try {
    switch (page) {
      case 'dashboard': await renderDashboardPage(); break;
      case 'families': await renderFamiliesPage(); break;
      case 'attendances': await renderAttendancesPage(); break;
      case 'billing': await renderBillingPage(); break;
      case 'account': await renderAccountPage(); break;
    }
  } catch (err) {
    document.getElementById('page-' + page).innerHTML = `<div class="card"><p>Erreur: ${esc(err.message)}</p></div>`;
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => navigateTo(tab.dataset.page));
});

// ───── HELPERS ─────
function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
function escAttr(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : ''; }
function formatDateShort(s) { if (!s) return ''; const p = s.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : s; }

// ───── RENDER CURRENT PAGE ─────
async function renderCurrentPage() {
  if (currentPage) await navigateTo(currentPage);
}

// ───── CAPACITOR INTEGRATION ─────
async function initCapacitor() {
  if (typeof Capacitor === 'undefined') return;
  try {
    const { SplashScreen } = Capacitor.Plugins;
    if (SplashScreen) await SplashScreen.hide();
  } catch {}
  try {
    const { StatusBar } = Capacitor.Plugins;
    if (StatusBar) {
      await StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
      await StatusBar.setBackgroundColor({ color: isDark ? '#1c1c1e' : '#ffffff' });
    }
  } catch {}
  try {
    const { Keyboard } = Capacitor.Plugins;
    if (Keyboard) {
      Keyboard.addListener('keyboardWillShow', () => {
        document.getElementById('main-header').style.position = 'relative';
      });
      Keyboard.addListener('keyboardWillHide', () => {
        document.getElementById('main-header').style.position = 'sticky';
      });
    }
  } catch {}
  try {
    const { Network } = Capacitor.Plugins;
    if (Network) {
      Network.addListener('networkStatusChange', (s) => {
        document.getElementById('db-status').textContent = s.connected ? 'Connecte' : 'Hors ligne';
      });
    }
  } catch {}
}

// ───── BOOTSTRAP ─────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/families');
    if (!res.ok) throw new Error('offline');
    document.getElementById('db-status').textContent = 'Connecte';
  } catch { document.getElementById('db-status').textContent = 'Hors ligne (cache)'; }
  await initCapacitor();
  await checkAuth();
  await navigateTo('dashboard');
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    showToast('Paiement reussi ! Bienvenue en Pro ✓');
    window.history.replaceState({}, '', '/');
    await checkAuth();
    await renderCurrentPage();
  }
  if (!localStorage.getItem('tutorial_done')) {
    setTimeout(showTutorial, 500);
  }
});
