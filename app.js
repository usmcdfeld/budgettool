/* Envelope Budget PWA (Goodbudget-like MVP)
   - Local-only storage (localStorage)
   - Envelopes: name, monthlyAdd, startingBalance
   - Transactions: expense/income/transfer
   - Month view + rollover balances
*/

const STORE_KEY = "budgetPWA.v1";

const $ = (id) => document.getElementById(id);

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(16).slice(2);
}

function monthStart(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

function monthEnd(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth() + 1, 0, 23, 59, 59, 999);
}

function ym(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseYM(ymStr) {
  const [y, m] = ymStr.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function fmtMoney(amount, currency) {
  const n = Number(amount || 0);
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    // seed defaults
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const state = {
      settings: {
        budgetStartYM: ym(start),
        reportYM: ym(start),
        rollover: "on",
        currency: "AUD",
      },
      envelopes: [
        { id: uuid(), name: "To Be Budgeted", monthlyAdd: 0, startingBalance: 0 },
        { id: uuid(), name: "Groceries", monthlyAdd: 600, startingBalance: 0 },
        { id: uuid(), name: "Rent", monthlyAdd: 1800, startingBalance: 0 },
      ],
      transactions: [],
    };
    saveState(state);
    return state;
  }
  return JSON.parse(raw);
}

function saveState(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function monthsBetweenInclusive(startYM, endYM) {
  const a = parseYM(startYM);
  const b = parseYM(endYM);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(0, months + 1);
}

function isInMonth(txnDate, reportYM) {
  const d = new Date(txnDate);
  const start = parseYM(reportYM);
  return d >= monthStart(start) && d <= monthEnd(start);
}

/** Calculate envelope balance at end of report month */
function calcEnvelopeBalance(state, envId) {
  const { settings, envelopes, transactions } = state;
  const env = envelopes.find(e => e.id === envId);
  if (!env) return 0;

  const reportStart = parseYM(settings.reportYM);
  const reportEnd = monthEnd(reportStart);

  let balance = Number(env.startingBalance || 0);

  if (settings.rollover === "on") {
    const mi = monthsBetweenInclusive(settings.budgetStartYM, settings.reportYM);
    balance += Number(env.monthlyAdd || 0) * mi;
  } else {
    // month-only: only add monthlyAdd for report month
    balance += Number(env.monthlyAdd || 0);
  }

  // Apply transactions up to end of report month
  for (const t of transactions) {
    const d = new Date(t.date);
    if (d > reportEnd) continue;

    const amt = Number(t.amount || 0);

    if (t.type === "expense") {
      if (t.envelopeId === envId) balance -= amt;
    } else if (t.type === "income") {
      if (t.envelopeId === envId) balance += amt;
    } else if (t.type === "transfer") {
      if (t.fromEnvelopeId === envId) balance -= amt;
      if (t.toEnvelopeId === envId) balance += amt;
    }
  }
  return balance;
}

/** Remaining this month (monthlyAdd + inflowMonth - outflowMonth) */
function calcRemainingThisMonth(state, envId) {
  const { settings, envelopes, transactions } = state;
  const env = envelopes.find(e => e.id === envId);
  if (!env) return 0;

  let remaining = Number(env.monthlyAdd || 0);

  const reportStart = parseYM(settings.reportYM);
  const start = monthStart(reportStart);
  const end = monthEnd(reportStart);

  for (const t of transactions) {
    const d = new Date(t.date);
    if (d < start || d > end) continue;

    const amt = Number(t.amount || 0);

    if (t.type === "expense") {
      if (t.envelopeId === envId) remaining -= amt;
    } else if (t.type === "income") {
      if (t.envelopeId === envId) remaining += amt;
    } else if (t.type === "transfer") {
      if (t.fromEnvelopeId === envId) remaining -= amt;
      if (t.toEnvelopeId === envId) remaining += amt;
    }
  }
  return remaining;
}

function render(state) {
  // settings
  $("budgetStart").value = state.settings.budgetStartYM;
  $("reportMonth").value = state.settings.reportYM;
  $("rollover").value = state.settings.rollover;
  $("currency").value = state.settings.currency;

  // dropdowns
  const opts = state.envelopes.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  $("txnEnvelope").innerHTML = opts;
  $("txnFrom").innerHTML = opts;
  $("txnTo").innerHTML = opts;

  renderEnvelopeList(state);
  renderTxnList(state);
  syncTxnTypeUI();
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function renderEnvelopeList(state) {
  const cur = state.settings.currency;
  const list = state.envelopes.map(e => {
    const bal = calcEnvelopeBalance(state, e.id);
    const rem = calcRemainingThisMonth(state, e.id);
    const balCls = bal < 0 ? "neg" : "pos";
    const remCls = rem < 0 ? "neg" : "pos";
    return `
      <div class="tx" style="cursor:pointer;" data-env="${e.id}">
        <div class="top">
          <b>${escapeHtml(e.name)}</b>
          <span class="muted">Monthly: <span class="mono">${fmtMoney(e.monthlyAdd, cur)}</span></span>
        </div>
        <div class="grid" style="margin-top:8px;">
          <div class="muted"> </div>
          <div class="mono ${balCls}">${fmtMoney(bal, cur)}</div>
          <div class="mono ${remCls}">${fmtMoney(rem, cur)}</div>
        </div>
        <small>Tap to edit</small>
      </div>
    `;
  }).join("");

  $("envelopeList").innerHTML = list || `<div class="muted">No envelopes yet.</div>`;

  // click handlers to edit envelope
  document.querySelectorAll("[data-env]").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-env");
      const env = state.envelopes.find(x => x.id === id);
      if (!env) return;
      $("envId").value = env.id;
      $("envName").value = env.name;
      $("envMonthly").value = env.monthlyAdd;
      $("envStartBal").value = env.startingBalance;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderTxnList(state) {
  const cur = state.settings.currency;
  const txns = state.transactions
    .filter(t => isInMonth(t.date, state.settings.reportYM))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if (!txns.length) {
    $("txnList").innerHTML = `<div class="muted">No transactions in this month.</div>`;
    return;
  }

  const envName = (id) => state.envelopes.find(e => e.id === id)?.name ?? "Unknown";

  $("txnList").innerHTML = txns.map(t => {
    let title = "";
    let sign = "";
    if (t.type === "expense") {
      title = `${envName(t.envelopeId)} • ${escapeHtml(t.description || "Expense")}`;
      sign = "-";
    } else if (t.type === "income") {
      title = `${envName(t.envelopeId)} • ${escapeHtml(t.description || "Income")}`;
      sign = "+";
    } else {
      title = `${envName(t.fromEnvelopeId)} → ${envName(t.toEnvelopeId)} • ${escapeHtml(t.description || "Transfer")}`;
      sign = "";
    }
    return `
      <div class="tx" style="cursor:pointer;" data-txn="${t.id}">
        <div class="top">
          <b>${escapeHtml(title)}</b>
          <span class="mono ${t.type === "expense" ? "neg" : "pos"}">${sign}${fmtMoney(t.amount, cur)}</span>
        </div>
        <small>${escapeHtml(t.date)}</small>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-txn]").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-txn");
      const t = state.transactions.find(x => x.id === id);
      if (!t) return;
      $("txnId").value = t.id;
      $("txnDate").value = t.date;
      $("txnType").value = t.type;
      $("txnAmount").value = t.amount;
      $("txnDesc").value = t.description || "";

      if (t.type === "transfer") {
        $("txnFrom").value = t.fromEnvelopeId;
        $("txnTo").value = t.toEnvelopeId;
      } else {
        $("txnEnvelope").value = t.envelopeId;
      }

      $("deleteTxnBtn").style.display = "block";
      syncTxnTypeUI();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
  });
}

function syncTxnTypeUI() {
  const type = $("txnType").value;
  if (type === "transfer") {
    $("txnTransferFields").style.display = "block";
    $("txnExpenseIncomeFields").style.display = "none";
  } else {
    $("txnTransferFields").style.display = "none";
    $("txnExpenseIncomeFields").style.display = "block";
  }
}

function clearEnvForm() {
  $("envId").value = "";
  $("envName").value = "";
  $("envMonthly").value = "";
  $("envStartBal").value = "";
}

function clearTxnForm() {
  $("txnId").value = "";
  $("txnDate").value = new Date().toISOString().slice(0,10);
  $("txnType").value = "expense";
  $("txnAmount").value = "";
  $("txnDesc").value = "";
  $("deleteTxnBtn").style.display = "none";
  syncTxnTypeUI();
}

function upsertEnvelope(state) {
  const id = $("envId").value || uuid();
  const name = $("envName").value.trim();
  if (!name) return alert("Envelope name is required.");

  const monthlyAdd = Number($("envMonthly").value || 0);
  const startingBalance = Number($("envStartBal").value || 0);

  const existing = state.envelopes.find(e => e.id === id);
  if (existing) {
    existing.name = name;
    existing.monthlyAdd = monthlyAdd;
    existing.startingBalance = startingBalance;
  } else {
    state.envelopes.push({ id, name, monthlyAdd, startingBalance });
  }
  saveState(state);
}

function upsertTxn(state) {
  const id = $("txnId").value || uuid();
  const dateStr = $("txnDate").value;
  if (!dateStr) return alert("Date is required.");

  const type = $("txnType").value;
  const amount = Number($("txnAmount").value || 0);
  if (!(amount > 0)) return alert("Amount must be greater than 0.");

  const description = $("txnDesc").value.trim();

  let payload = { id, date: dateStr, type, amount, description };

  if (type === "transfer") {
    const fromId = $("txnFrom").value;
    const toId = $("txnTo").value;
    if (!fromId || !toId) return alert("Choose both From and To envelopes.");
    if (fromId === toId) return alert("From and To cannot be the same.");
    payload.fromEnvelopeId = fromId;
    payload.toEnvelopeId = toId;
  } else {
    const envId = $("txnEnvelope").value;
    if (!envId) return alert("Choose an envelope.");
    payload.envelopeId = envId;
  }

  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx >= 0) state.transactions[idx] = payload;
  else state.transactions.push(payload);

  saveState(state);
}

function deleteTxn(state) {
  const id = $("txnId").value;
  if (!id) return;
  if (!confirm("Delete this transaction?")) return;
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveState(state);
}

function exportBackup(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `budget-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.settings || !Array.isArray(parsed.envelopes) || !Array.isArray(parsed.transactions)) {
        alert("Invalid backup file.");
        return;
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
      cb();
    } catch (e) {
      alert("Could not read backup file.");
    }
  };
  reader.readAsText(file);
}

// ---------- init ----------
let state = loadState();

function bind() {
  // settings
  $("budgetStart").addEventListener("change", () => {
    state.settings.budgetStartYM = $("budgetStart").value;
    saveState(state); render(state);
  });
  $("reportMonth").addEventListener("change", () => {
    state.settings.reportYM = $("reportMonth").value;
    saveState(state); render(state);
  });
  $("rollover").addEventListener("change", () => {
    state.settings.rollover = $("rollover").value;
    saveState(state); render(state);
  });
  $("currency").addEventListener("change", () => {
    state.settings.currency = $("currency").value;
    saveState(state); render(state);
  });

  // envelope form
  $("saveEnvBtn").addEventListener("click", () => {
    upsertEnvelope(state);
    state = loadState();
    clearEnvForm();
    render(state);
  });
  $("clearEnvBtn").addEventListener("click", clearEnvForm);

  // txn form
  $("txnType").addEventListener("change", syncTxnTypeUI);
  $("saveTxnBtn").addEventListener("click", () => {
    upsertTxn(state);
    state = loadState();
    clearTxnForm();
    render(state);
  });
  $("deleteTxnBtn").addEventListener("click", () => {
    deleteTxn(state);
    state = loadState();
    clearTxnForm();
    render(state);
  });
  $("clearTxnFormBtn").addEventListener("click", () => { clearTxnForm(); });

  // import/export
  $("exportBtn").addEventListener("click", () => exportBackup(state));
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    importBackup(f, () => { state = loadState(); render(state); });
    e.target.value = "";
  });

  // default txn date
  if (!$("txnDate").value) $("txnDate").value = new Date().toISOString().slice(0,10);

  // PWA service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

bind();
render(state);
clearTxnForm();
