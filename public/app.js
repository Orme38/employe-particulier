'use strict';

// ====================== CONSTANTS ======================

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ====================== STATE ======================

let currentPage = 'families';
let billingMonth = null;
let billingYear = null;

// ====================== TOAST ======================

function showToast(msg, duration) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration || 2500);
}

// ====================== MODAL ======================

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

// ====================== API CLIENT ======================

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  if (method === 'DELETE') return null;
  return res.json();
}

// ====================== FAMILY OPERATIONS ======================

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
  if (data.id) {
    return api('PUT', `/api/families/${data.id}`, data);
  } else {
    return api('POST', '/api/families', data);
  }
}

async function deleteFamily(id) {
  return api('DELETE', `/api/families/${id}`);
}

async function getOrCreateFamilyByName(name) {
  let fam = await getFamilyByName(name.trim());
  if (!fam) {
    fam = await api('POST', '/api/families', { family_name: name.trim(), hourly_rate: 0 });
  }
  return fam;
}

// ====================== ATTENDANCE OPERATIONS ======================

async function getAttendances(filters) {
  const params = new URLSearchParams();
  if (filters?.month) params.set('month', filters.month);
  if (filters?.year) params.set('year', filters.year);
  if (filters?.family_name) params.set('family_name', filters.family_name);
  if (filters?.limit) params.set('limit', filters.limit);
  return api('GET', '/api/attendances?' + params.toString());
}

async function saveAttendance(data) {
  return api('POST', '/api/attendances', data);
}

async function deleteAttendance(id) {
  return api('DELETE', `/api/attendances/${id}`);
}

// ====================== BILLING OPERATIONS ======================

async function getBillingData(month, year) {
  return api('GET', `/api/billing?month=${month}&year=${year}`);
}

async function saveCafSubsidy(monthLabel, familyName, amount) {
  return api('POST', '/api/billing/caf', {
    billing_month_label: monthLabel,
    family_name: familyName,
    caf_subsidy: parseFloat(amount) || 0
  });
}

// ====================== HOURS CALCULATION ======================

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

// ====================== UI: FAMILIES ======================

async function renderFamiliesPage() {
  const families = await getFamilies();
  const el = document.getElementById('page-families');

  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="margin:0">Employeurs</h2>
      <button class="btn btn-primary btn-sm" onclick="showFamilyForm()">+ Ajouter</button>
    </div>`;

  if (families.length === 0) {
    html += `<div class="empty-state"><p>Aucun employeur inscrit</p></div>`;
  } else {
    // Table for desktop
    html += `<table class="data-table"><thead><tr>
      <th>Famille</th><th>Service</th><th class="text-right">Tarif/h</th><th></th>
    </tr></thead><tbody>`;

    for (const f of families) {
      const rate = (f.hourly_rate || 0).toFixed(2).replace('.', ',');
      html += `<tr>
        <td class="truncate"><strong>${esc(f.family_name)}</strong></td>
        <td class="truncate">${esc(f.service_type || '-')}</td>
        <td class="text-right font-mono">${rate} €</td>
        <td class="text-right">
          <button class="btn btn-outline btn-sm" onclick="showFamilyForm(${f.id})" aria-label="Modifier">✎</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteFamily(${f.id})" aria-label="Supprimer">✕</button>
        </td>
      </tr>`;
    }
    html += `</tbody></table>`;

    // Cards for mobile
    html += `<div class="card-list">`;
    for (const f of families) {
      const rate = (f.hourly_rate || 0).toFixed(2).replace('.', ',');
      const svc = f.service_type ? `${esc(f.service_type)} · ` : '';
      html += `<div class="card-item">
        <div class="item-info">
          <div class="item-value">${esc(f.family_name)}</div>
          <div class="item-label">${svc}${rate} €/h</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-outline btn-sm" onclick="showFamilyForm(${f.id})" aria-label="Modifier">✎</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteFamily(${f.id})" aria-label="Supprimer">✕</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>
    <div class="card" style="font-size:13px;color:var(--muted)">
      <p>💡 Les nouveaux employeurs peuvent aussi être créés automatiquement depuis la page <strong>Présences</strong>.</p>
    </div>`;

  el.innerHTML = html;
}

function showFamilyForm(id) {
  (async () => {
    const fam = id ? await getFamily(id) : null;
    const title = fam ? 'Modifier l\'employeur' : 'Nouvel employeur';
    const html = `<h3>${title}</h3>
      <form id="family-form" onsubmit="return submitFamily(event)">
        ${fam ? `<input type="hidden" name="id" value="${fam.id}">` : ''}
        <div class="form-group">
          <label>Nom de famille</label>
          <input type="text" name="family_name" required value="${fam ? escAttr(fam.family_name) : ''}" placeholder="Ex: Dupont">
        </div>
        <div class="form-group">
          <label>Type de service</label>
          <input type="text" name="service_type" value="${fam ? escAttr(fam.service_type || '') : ''}" placeholder="Ex: Ménage, Jardinage, Garde d'enfants..." list="service-types">
          <datalist id="service-types">
            <option value="Garde d'enfants">
            <option value="Ménage / Entretien">
            <option value="Jardinage">
            <option value="Soutien scolaire">
            <option value="Soins à la personne">
            <option value="Bricolage">
            <option value="Courses / Commissions">
          </datalist>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tarif horaire (€)</label>
            <input type="number" name="hourly_rate" step="0.5" min="0" value="${fam ? (fam.hourly_rate || 0) : ''}"></div>
          <div class="form-group"><label>Email</label>
            <input type="email" name="parent_email" value="${fam ? escAttr(fam.parent_email || '') : ''}" placeholder="email@exemple.fr"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" onclick="hideModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>`;
    showModal(html);
  })();
}

async function submitFamily(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    await saveFamily(data);
    hideModal();
    await renderFamiliesPage();
    showToast('Famille enregistrée ✓');
  } catch (err) {
    showToast('Erreur: ' + err.message);
  }
  return false;
}

function confirmDeleteFamily(id) {
  (async () => {
    const fam = await getFamily(id);
    if (!fam) return;
    const html = `<h3>Supprimer ${esc(fam.family_name)} ?</h3>
      <p style="color:var(--muted);margin-bottom:16px">Toutes les présences associées seront supprimées.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="hideModal()">Annuler</button>
        <button class="btn btn-danger" onclick="doDeleteFamily(${id})">Supprimer</button>
      </div>`;
    showModal(html);
  })();
}

async function doDeleteFamily(id) {
  await deleteFamily(id);
  hideModal();
  await renderFamiliesPage();
  showToast('Famille supprimée');
}

// ====================== UI: ATTENDANCES ======================

async function renderAttendancesPage() {
  const today = new Date().toISOString().split('T')[0];
  const el = document.getElementById('page-attendances');

  const html = `<div class="card">
      <h2>Nouvelle présence</h2>
      <form id="attendance-form" onsubmit="return submitAttendance(event)">
        <div class="form-group">
          <label>Date</label>
          <input type="date" name="attendance_date" value="${today}" required>
        </div>
        <div class="form-group">
          <label>Nom de famille</label>
          <input type="text" name="family_name" id="att-family-name" required
            placeholder="Tapez un nom de famille" autocomplete="off"
            oninput="onFamilyNameInput(this.value)">
          <div id="att-family-info" class="auto-value"></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Arrivée</label>
            <input type="time" name="arrival_time" id="att-arrival" value="08:00" required onchange="calcAttendancePreview()">
          </div>
          <div class="form-group">
            <label>Départ</label>
            <input type="time" name="departure_time" id="att-departure" value="17:00" required onchange="calcAttendancePreview()">
          </div>
        </div>
        <div id="att-preview" class="billing-total" style="display:none">
          <strong id="att-preview-text"></strong>
        </div>
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:12px">Enregistrer la présence</button>
      </form>
    </div>
    <div class="card">
      <h2>Présences récentes</h2>
      <div id="attendance-list"></div>
    </div>`;

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
      info.innerHTML = `🆕 Nouvel employeur — tarif à 0 € (à modifier dans <a href="#" onclick="navigateTo('families');return false">Employeurs</a>)`;
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
    const hs = hrs.toFixed(2).replace('.', ',');
    const rs = rate.toFixed(2).replace('.', ',');
    const as = amt.toFixed(2).replace('.', ',');
    previewText.innerHTML = fam
      ? `${hs} h × ${rs} €/h = <span style="font-size:18px">${as} €</span>`
      : `${hs} h × ${rs} €/h = <span style="font-size:18px">${as} €</span> <span style="color:var(--muted)">(tarif à définir)</span>`;
  } catch (_) { preview.style.display = 'none'; }
}

async function submitAttendance(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  if (!data.family_name.trim()) { showToast('Veuillez entrer un nom de famille'); return false; }
  try {
    const result = await saveAttendance(data);
    e.target.reset();
    document.getElementById('att-arrival').value = '08:00';
    document.getElementById('att-departure').value = '17:00';
    document.getElementById('att-family-info').textContent = '';
    document.getElementById('att-preview').style.display = 'none';
    const hs = (result.total_hours || 0).toFixed(2).replace('.', ',');
    const as = (result.amount || 0).toFixed(2).replace('.', ',');
    showToast(`${result.family_name} — ${hs} h, ${as} € ✓`);
    await renderAttendanceList();
  } catch (err) { showToast('Erreur: ' + err.message); }
  return false;
}

async function renderAttendanceList() {
  const list = document.getElementById('attendance-list');
  if (!list) return;
  const rows = await getAttendances({ limit: 50 });
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>Aucune présence enregistrée</p></div>`;
    return;
  }

  // Table (desktop)
  let html = `<table class="data-table"><thead><tr>
    <th>Date</th><th>Famille</th><th>Arrivée</th><th>Départ</th><th class="text-right">Heures</th><th class="text-right">Montant</th><th></th>
  </tr></thead><tbody>`;

  for (const r of rows) {
    const hrs = (r.total_hours || 0).toFixed(2).replace('.', ',');
    const amt = (r.amount || 0).toFixed(2).replace('.', ',');
    const date = formatDateShort(r.attendance_date);
    html += `<tr>
      <td>${date}</td><td class="truncate">${esc(r.family_name)}</td>
      <td>${r.arrival_time.slice(0,5)}</td><td>${r.departure_time.slice(0,5)}</td>
      <td class="text-right font-mono">${hrs}</td>
      <td class="text-right font-mono">${amt} €</td>
      <td class="text-right"><button class="btn btn-danger btn-sm" onclick="confirmDeleteAttendance(${r.id})" aria-label="Supprimer">✕</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;

  // Cards (mobile)
  html += `<div class="card-list">`;
  for (const r of rows) {
    const hrs = (r.total_hours || 0).toFixed(2).replace('.', ',');
    const amt = (r.amount || 0).toFixed(2).replace('.', ',');
    const date = formatDateShort(r.attendance_date);
    html += `<div class="card-item">
      <div class="item-info">
        <div class="item-value">${esc(r.family_name)} · ${date}</div>
        <div class="item-label">${r.arrival_time.slice(0,5)} → ${r.departure_time.slice(0,5)} · ${hrs} h · ${amt} €</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteAttendance(${r.id})" aria-label="Supprimer">✕</button>
      </div>
    </div>`;
  }
  html += `</div>`;

  list.innerHTML = html;
}

function confirmDeleteAttendance(id) {
  const html = `<h3>Supprimer cette présence ?</h3>
    <p style="color:var(--muted);margin-bottom:16px">Action irréversible.</p>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="hideModal()">Annuler</button>
      <button class="btn btn-danger" onclick="doDeleteAttendance(${id})">Supprimer</button>
    </div>`;
  showModal(html);
}

async function doDeleteAttendance(id) {
  await deleteAttendance(id);
  hideModal();
  await renderAttendanceList();
  showToast('Présence supprimée');
}

// ====================== UI: BILLING ======================

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
      </div>
    </div>
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
  const monthLabel = `${MONTHS_FR[billingMonth - 1]} ${billingYear}`;

  let data;
  try { data = await getBillingData(billingMonth, billingYear); } catch (_) { data = []; }

  if (data.length === 0) {
    content.innerHTML = `<div class="empty-state"><p>Aucune présence ce mois-ci</p></div>`;
    return;
  }

  // Table (desktop)
  let html = `<table class="data-table"><thead><tr>
    <th>Famille</th><th>Jours</th><th class="text-right">Heures</th><th class="text-right">Brut</th><th class="text-right">CAF</th><th class="text-right">Net</th>
  </tr></thead><tbody>`;

  let totalHours = 0, totalGross = 0, totalSubsidy = 0, totalNet = 0;

  for (const r of data) {
    totalHours += r.total_hours; totalGross += r.gross_amount;
    totalSubsidy += r.caf_subsidy; totalNet += r.net_amount;
    const hrs = r.total_hours.toFixed(2).replace('.', ',');
    const gross = r.gross_amount.toFixed(2).replace('.', ',');
    const net = r.net_amount.toFixed(2).replace('.', ',');
    html += `<tr>
      <td><strong>${esc(r.family_name)}</strong></td>
      <td>${r.days}</td>
      <td class="text-right font-mono">${hrs}</td>
      <td class="text-right font-mono">${gross} €</td>
      <td class="text-right">
        <input class="caf-input" type="number" step="0.5" min="0"
          value="${r.caf_subsidy > 0 ? r.caf_subsidy : ''}"
          onchange="onCafChange('${escAttr(r.family_name)}', this.value)"
          placeholder="0">
      </td>
      <td class="text-right font-mono"><strong>${net} €</strong></td>
    </tr>`;
  }

  const s = v => v.toFixed(2).replace('.', ',');
  html += `</tbody><tfoot style="font-weight:600;border-top:2px solid var(--text)"><tr>
    <td><strong>Total</strong></td><td></td>
    <td class="text-right font-mono">${s(totalHours)}</td>
    <td class="text-right font-mono">${s(totalGross)} €</td>
    <td class="text-right font-mono">${s(totalSubsidy)} €</td>
    <td class="text-right font-mono">${s(totalNet)} €</td>
  </tr></tfoot></table>`;

  // Cards (mobile)
  html += `<div class="card-list">`;
  for (const r of data) {
    const hrs = r.total_hours.toFixed(2).replace('.', ',');
    const gross = r.gross_amount.toFixed(2).replace('.', ',');
    const net = r.net_amount.toFixed(2).replace('.', ',');
    html += `<div class="billing-card">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">${esc(r.family_name)}</div>
      <div class="bc-row"><span class="bc-label">Jours</span><span>${r.days}</span></div>
      <div class="bc-row"><span class="bc-label">Heures</span><span class="bc-value">${hrs}</span></div>
      <div class="bc-row"><span class="bc-label">Brut</span><span class="bc-value">${gross} €</span></div>
      <div class="bc-row"><span class="bc-label">CAF</span>
        <input class="caf-input" type="number" step="0.5" min="0"
          value="${r.caf_subsidy > 0 ? r.caf_subsidy : ''}"
          onchange="onCafChange('${escAttr(r.family_name)}', this.value)"
          placeholder="0" style="border:1px solid var(--border)">
      </div>
      <hr class="bc-divider">
      <div class="bc-row"><span class="bc-label">Net</span><span class="bc-value">${net} €</span></div>
    </div>`;
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
    await renderBillingContent();
    showToast('Complément CAF mis à jour ✓');
  }, 400);
}

// ====================== NAVIGATION ======================

async function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));

  try {
    switch (page) {
      case 'families': await renderFamiliesPage(); break;
      case 'attendances': await renderAttendancesPage(); break;
      case 'billing': await renderBillingPage(); break;
    }
  } catch (err) {
    document.getElementById('page-' + page).innerHTML =
      `<div class="card"><p>Erreur de chargement: ${esc(err.message)}</p></div>`;
  }
}

// ====================== HELPERS ======================

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateShort(s) {
  if (!s) return '';
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}` : s;
}

// ====================== BOOTSTRAP ======================

document.addEventListener('DOMContentLoaded', async () => {
  // Check connectivity
  try {
    const res = await fetch('/api/families');
    if (!res.ok) throw new Error('API indisponible');
    document.getElementById('db-status').textContent = 'Connecté';
  } catch (e) {
    document.getElementById('db-status').textContent = 'Hors ligne (cache)';
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.page));
  });

  navigateTo('families');
});
