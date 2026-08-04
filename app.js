let lastDashboard = null;
let lastAccounts = [];
let selectedAccountId = null;
let currentUser = null;

const playbookLabels = {
  supportEscalation: "Support escalation",
  renewalSave: "Renewal rescue",
  usageReactivation: "Usage reactivation",
  execAlignment: "Executive alignment",
  adoptionCoaching: "Adoption coaching",
  healthAudit: "Customer health audit",
};

function apiUrl() { return document.getElementById("apiUrl").value.replace(/\/$/, ""); }
function token() { return localStorage.getItem("ai_churn_rescue_token") || ""; }
function headers(extra = {}) { return { "Authorization": `Bearer ${token()}`, ...extra }; }
function euro(value) { return Number(value || 0).toLocaleString("en-US") + " €"; }
function safe(value) { return String(value ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

function riskConfidence(account) {
  const fields = [
    "account_name", "industry", "arr_eur", "days_to_renewal",
    "weekly_usage_change_pct", "active_users_change_pct", "days_since_last_login",
    "open_support_tickets", "critical_tickets", "avg_ticket_age_days",
    "sentiment_score", "payment_delay_days", "executive_sponsor_active",
    "relationship_health"
  ];
  let available = 0;
  for (const f of fields) {
    const v = account[f];
    if (v !== null && v !== undefined && String(v).trim() !== "") available += 1;
  }
  const score = Math.round((available / fields.length) * 100);
  const label = score >= 90 ? "High" : score >= 65 ? "Medium" : "Low";
  return {score, label};
}

function playbookLabel(value) { return playbookLabels[value] || value || ""; }
function toast(message) { const box = document.getElementById("toast"); box.textContent = message; box.style.display = "block"; setTimeout(() => box.style.display = "none", 2200); }

async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const status = document.getElementById("loginStatus");
  status.textContent = "Signing in...";
  const res = await fetch(`${apiUrl()}/api/v1/auth/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password}),
  });
  if (!res.ok) { status.textContent = "Login failed. Check email/password."; return; }
  const data = await res.json();
  localStorage.setItem("ai_churn_rescue_token", data.access_token);
  currentUser = data.user;
  status.textContent = "";
  showApp();
  await loadEverything();
}


async function signup() {
  const company_name = document.getElementById("signupCompany").value;
  const full_name = document.getElementById("signupName").value;
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  const status = document.getElementById("signupStatus");
  if (!company_name || !email || !password) {
    status.textContent = "Company, email and password are required.";
    return;
  }
  status.textContent = "Creating free trial workspace...";
  const res = await fetch(`${apiUrl()}/api/v1/auth/signup`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({company_name, full_name, email, password}),
  });
  if (!res.ok) {
    status.textContent = "Signup failed: " + await res.text();
    return;
  }
  const data = await res.json();
  localStorage.setItem("ai_churn_rescue_token", data.access_token);
  currentUser = data.user;
  status.textContent = "";
  showApp();
  await loadEverything();
}

async function loadMe() {
  if (!token()) return false;
  const res = await fetch(`${apiUrl()}/api/v1/auth/me`, {headers: headers()});
  if (!res.ok) return false;
  currentUser = await res.json();
  showApp();
  return true;
}

function showApp() {
  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("appPanel").style.display = "block";
  const org = currentUser.organization || {};
  document.getElementById("userBadge").textContent = `${currentUser.email} · ${currentUser.role}`;
  document.getElementById("orgBadge").textContent = org.name || "Organization";
  const orgInfo = document.getElementById("organizationInfo");
  if (orgInfo) orgInfo.textContent = `${org.name || "Organization"} · tenant: ${org.tenant_id || "demo"}`;
}

function logout() {
  localStorage.removeItem("ai_churn_rescue_token");
  currentUser = null;
  document.getElementById("loginPanel").style.display = "block";
  document.getElementById("appPanel").style.display = "none";
}

async function uploadCsv() {
  const file = document.getElementById("csvFile").files[0];
  const status = document.getElementById("status");
  if (!file) { status.textContent = "Please choose a CSV file."; return; }
  const formData = new FormData();
  formData.append("file", file);
  status.textContent = "Uploading and analyzing...";
  const res = await fetch(`${apiUrl()}/api/v1/accounts/upload-csv`, { method: "POST", headers: headers(), body: formData });
  if (!res.ok) {
    let message = await res.text();
    try {
      const parsed = JSON.parse(message);
      message = parsed.detail?.message || parsed.detail || message;
    } catch (e) {}
    status.textContent = "Error: " + message;
    return;
  }
  const data = await res.json();
  status.textContent = `${data.created} accounts analyzed.`;
  selectedAccountId = null;
  await loadEverything();
}

async function loadEverything() {
  await loadPlans(); await loadDashboard(); await loadMeta(); await loadExecutiveInsights(); await loadStatusSummary(); await loadPipeline(); await loadAccounts(); await loadUsers(); await loadConnectors(); await loadBilling(); await loadAuditLogs();
}



async function openNext actions(planKey) {
  const res = await fetch(`${apiUrl()}/api/v1/billing/upgrade/${planKey}`);
  if (!res.ok) {
    toast("Next actions link not available yet.");
    return;
  }
  const data = await res.json();
  if (data.status === "missing_stripe_link") {
    toast(`${data.plan} payment link is not configured yet. Opening Calendly instead.`);
  }
  window.open(data.url, "_blank");
}


async function openManualRequest(requestKey) {
  const res = await fetch(`${apiUrl()}/api/v1/billing/manual-request/${requestKey}`);
  if (!res.ok) {
    toast("Request link not available yet.");
    return;
  }
  const data = await res.json();
  toast(data.label || "Opening request link...");
  window.open(data.url, "_blank");
}

async function loadPlans() {
  const plansBox = document.getElementById("selfServicePlans");
  const currentBox = document.getElementById("currentPlanCards");
  if (!plansBox || !currentBox) return;

  const plansRes = await fetch(`${apiUrl()}/api/v1/billing/plans`);
  if (plansRes.ok) {
    const data = await plansRes.json();
    plansBox.innerHTML = data.plans.map(plan => `
      <div class="card">
        <h3>${safe(plan.name)}</h3>
        <p><strong>${safe(plan.price)}</strong></p>
        <p>${plan.account_limit ? `${plan.account_limit.toLocaleString()} accounts` : "Unlimited / custom volume"}</p>
        <p>${plan.csv_upload ? "CSV upload" : "No CSV"}${plan.connector_limit ? ` · ${plan.connector_limit} connector` : ""}</p>
        <p>${plan.executive_pdf ? "Executive PDF included" : "No executive PDF"}${plan.short_report ? " · Short report" : ""}</p>
      </div>
    `).join("");
  }

  const currentRes = await fetch(`${apiUrl()}/api/v1/billing/current-plan`, {headers: headers()});
  if (currentRes.ok) {
    const data = await currentRes.json();
    const plan = data.plan;
    currentBox.innerHTML = `
      <div class="card"><h3>Current plan</h3><p><strong>${safe(plan.name)}</strong></p><p>${safe(plan.price)}</p></div>
      <div class="card"><h3>Accounts used</h3><p>${Number(data.accounts_used || 0).toLocaleString()}</p></div>
      <div class="card"><h3>Accounts remaining</h3><p>${data.accounts_remaining === null ? "Custom / unlimited" : Number(data.accounts_remaining).toLocaleString()}</p></div>
      <div class="card"><h3>Next step</h3><p>${safe(plan.cta || "Next actions")}</p></div>
      <div class="card"><h3>Next actions</h3><p><button onclick="openManualRequest('demo')">Book a 30-minute demo</button></p><p><button class="secondary" onclick="openManualRequest('starter_pilot')">Request Starter Pilot</button></p><p><button class="secondary" onclick="openManualRequest('enterprise')">Enterprise discussion</button></p></div>
    `;
  }
}

async function loadDashboard() {
  const res = await fetch(`${apiUrl()}/api/v1/dashboard`, { headers: headers() });
  if (!res.ok) return;
  const data = await res.json();
  lastDashboard = data;
  document.getElementById("accountsMetric").textContent = data.accounts_analyzed;
  document.getElementById("arr").textContent = euro(data.total_arr_eur);
  document.getElementById("risk").textContent = euro(data.revenue_at_risk_eur);
  document.getElementById("riskRate").textContent = (data.arr_at_risk_rate * 100).toFixed(1) + "%";
  document.getElementById("p1p2").textContent = data.p1_p2_accounts;
  document.getElementById("savable").textContent = euro(data.savable_revenue_eur);
  renderRoi();
}

function renderRoi() {
  if (!lastDashboard) return;
  const pilotCost = Number(document.getElementById("pilotCost").value || 0);
  const targetSaveRate = Number(document.getElementById("targetSaveRate").value || 0) / 100;
  const grossMargin = Number(document.getElementById("grossMargin").value || 0) / 100;
  const expectedSaved = Math.round(lastDashboard.revenue_at_risk_eur * targetSaveRate);
  const marginImpact = Math.round(expectedSaved * grossMargin);
  const netImpact = marginImpact - pilotCost;
  const roi = pilotCost > 0 ? Math.round((netImpact / pilotCost) * 100) : 0;
  document.getElementById("expectedSaved").textContent = euro(expectedSaved);
  document.getElementById("marginImpact").textContent = euro(marginImpact);
  document.getElementById("netImpact").textContent = euro(netImpact);
  document.getElementById("roiMetric").textContent = roi + "%";
}

async function loadMeta() {
  const res = await fetch(`${apiUrl()}/api/v1/meta`, { headers: headers() });
  if (!res.ok) return;
  const meta = await res.json();
  fillSelect("csmFilter", meta.csm_owners || [], "All CSMs");
  fillSelect("playbookFilter", meta.playbooks || [], "All playbooks", playbookLabel);
}

function fillSelect(id, values, firstLabel, labelFn = v => v) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = `<option value="">${firstLabel}</option>` + values.map(v => `<option value="${safe(v)}">${safe(labelFn(v))}</option>`).join("");
  if (values.includes(current)) select.value = current;
}

async function loadStatusSummary() {
  const res = await fetch(`${apiUrl()}/api/v1/status-summary`, { headers: headers() });
  if (!res.ok) return;
  const statuses = await res.json();
  const labels = ["To do", "Contacted", "In progress", "Saved", "Lost"];
  document.getElementById("statusGrid").innerHTML = labels.map(label => {
    const data = statuses[label] || { count: 0, risk: 0, savable: 0 };
    return `<div class="card"><h3>${label}</h3><p><strong>${data.count}</strong> accounts</p><p class="muted">Risk: ${euro(data.risk)}</p><p class="muted">Savable: ${euro(data.savable)}</p></div>`;
  }).join("");
}

async function loadPipeline() {
  const res = await fetch(`${apiUrl()}/api/v1/pipeline`, { headers: headers() });
  if (!res.ok) return;
  const pipeline = await res.json();
  document.getElementById("pipelineGrid").innerHTML = pipeline.map(item => `
    <div class="card">
      <h3>${safe(item.csm_owner)}</h3>
      <p>P1: <strong>${item.p1}</strong> · P2: <strong>${item.p2}</strong></p>
      <p>Risk: <strong>${euro(item.revenue_at_risk_eur)}</strong></p>
      <p>Savable: <strong>${euro(item.savable_revenue_eur)}</strong></p>
      <p class="muted">${item.top_action ? safe(item.top_action.account_name + " — " + item.top_action.next_best_action) : "No priority action"}</p>
    </div>`).join("");
}

async function loadAccounts() {
  const params = new URLSearchParams();
  for (const [id, key] of [["priorityFilter","priority"],["riskFilter","risk_level"],["csmFilter","csm_owner"],["playbookFilter","playbook"],["search","search"],["minArr","min_arr"]]) {
    const v = document.getElementById(id).value;
    if (v) params.set(key, v);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${apiUrl()}/api/v1/accounts${query}`, { headers: headers() });
  if (!res.ok) return;
  const accounts = await res.json();
  lastAccounts = accounts;
  renderAccounts(accounts);
}

function renderAccounts(accounts) {
  document.getElementById("tableCount").textContent = `${accounts.length} account${accounts.length > 1 ? "s" : ""}`;
  let html = `<div class="table-wrap"><table><thead><tr>
    <th>Account</th><th>CSM</th><th>ARR</th><th>Score</th><th>Confidence</th><th>Risk</th><th>Priority</th><th>Playbook</th><th>Revenue at risk</th><th>Action</th><th>Status</th>
  </tr></thead><tbody>`;
  for (const account of accounts) {
    const confidence = riskConfidence(account);
    html += `<tr onclick="showDetail(${account.id})">
      <td><strong>${safe(account.account_name)}</strong><br><small>${safe(account.industry || "")}</small></td>
      <td>${safe(account.csm_owner || "")}</td><td>${euro(account.arr_eur)}</td><td>${account.risk_score}/100</td>
      <td><span class="badge confidence-${confidence.label.toLowerCase()}">${confidence.label}</span><br><small>${confidence.score}%</small></td>
      <td><span class="badge ${safe(account.risk_level)}">${safe(account.risk_level)}</span></td>
      <td><span class="badge ${safe(account.priority)}">${safe(account.priority)}</span></td>
      <td><span class="badge playbook">${safe(playbookLabel(account.playbook))}</span></td>
      <td>${euro(account.revenue_at_risk_eur)}</td>
      <td class="col-action"><div class="action-text">${safe(account.next_best_action || "")}</div></td>
      <td onclick="event.stopPropagation()"><select onchange="updateStatus(${account.id}, this.value)">
        ${["To do", "Contacted", "In progress", "Saved", "Lost"].map(s => `<option ${account.action_status === s ? "selected" : ""} value="${s}">${s}</option>`).join("")}
      </select></td>
    </tr>`;
  }
  html += "</tbody></table></div>";
  document.getElementById("accountsTable").innerHTML = html;
  if (selectedAccountId && accounts.some(a => a.id === selectedAccountId)) showDetail(selectedAccountId);
  else if (accounts.length) showDetail(accounts[0].id);
  else document.getElementById("accountDetail").innerHTML = "No account matches the selected filters.";
}

function showDetail(accountId) {
  selectedAccountId = accountId;
  const account = lastAccounts.find(a => a.id === accountId);
  if (!account) return;
  const email = buildCustomerEmail(account);
  const note = buildInternalNote(account);
  const confidence = riskConfidence(account);
  document.getElementById("accountDetail").classList.remove("muted");
  document.getElementById("accountDetail").innerHTML = `
    <div class="detail-card"><h3>${safe(account.account_name)}</h3><div class="detail-grid">
      <p><strong>Priority:</strong><br><span class="badge ${safe(account.priority)}">${safe(account.priority)}</span></p>
      <p><strong>Risk:</strong><br><span class="badge ${safe(account.risk_level)}">${safe(account.risk_level)}</span></p>
      <p><strong>Score:</strong><br>${account.risk_score}/100</p><p><strong>Risk confidence:</strong><br><span class="badge confidence-${confidence.label.toLowerCase()}">${confidence.label}</span> ${confidence.score}%</p><p><strong>ARR:</strong><br>${euro(account.arr_eur)}</p>
      <p><strong>Revenue at risk:</strong><br>${euro(account.revenue_at_risk_eur)}</p><p><strong>Savable revenue:</strong><br>${euro(account.savable_revenue_eur)}</p>
      <p><strong>Save probability:</strong><br>${account.save_probability}%</p><p><strong>Playbook:</strong><br>${safe(playbookLabel(account.playbook))}</p>
    </div></div>
    <h3>Why this account is at risk</h3><p>${safe(account.risk_explanation || "")}</p>
    <h3>Next best action</h3><p>${safe(account.next_best_action || "")}</p>
    <h3>Suggested customer email</h3><textarea id="emailBox">${safe(email)}</textarea><div class="copy-row"><button class="secondary" onclick="copyFrom('emailBox')">Copy email</button></div>
    <h3>Internal CSM note</h3><textarea id="noteBox">${safe(note)}</textarea><div class="copy-row"><button class="secondary" onclick="copyFrom('noteBox')">Copy note</button></div>`;
}

function buildCustomerEmail(account) {
  return `Subject: Quick value review before the next milestone

Hello,

I’d like to suggest a short working session this week to review your current usage and priorities.

We noticed a few signals worth addressing:
${account.risk_explanation || ""}

The goal is to remove blockers, clarify success criteria and make sure your team captures the expected value.

Would you be available for 30 minutes this week?

Best regards,`;
}

function buildInternalNote(account) {
  return `Account: ${account.account_name}
CSM: ${account.csm_owner || ""}
Priority: ${account.priority}
Risk score: ${account.risk_score}/100
Revenue at risk: ${euro(account.revenue_at_risk_eur)}
Savable revenue: ${euro(account.savable_revenue_eur)}
Playbook: ${playbookLabel(account.playbook)}
Status: ${account.action_status}

Risk explanation:
${account.risk_explanation || ""}

Next best action:
${account.next_best_action || ""}`;
}

function copyFrom(id) {
  navigator.clipboard.writeText(document.getElementById(id).value).then(() => toast("Copied."));
}

async function updateStatus(accountId, status) {
  await fetch(`${apiUrl()}/api/v1/accounts/${accountId}/status`, {
    method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ action_status: status })
  });
  await loadDashboard(); await loadStatusSummary(); await loadPipeline(); await loadAccounts();
}

async function downloadAuthenticated(url, filename) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) { toast("Download failed."); return; }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadCsv() { downloadAuthenticated(`${apiUrl()}/api/v1/reports/accounts.csv`, "ai_churn_rescue_accounts.csv"); }
function downloadActionPlan() { downloadAuthenticated(`${apiUrl()}/api/v1/reports/action-plan.csv`, "ai_churn_rescue_action_plan.csv"); }

loadMe().then(ok => { if (ok) loadEverything(); });


async function loadUsers() {
  const box = document.getElementById("usersList");
  if (!box) return;

  const res = await fetch(`${apiUrl()}/api/v1/admin/users`, { headers: headers() });
  if (!res.ok) {
    box.innerHTML = `<p class="muted">Admin or manager access required.</p>`;
    return;
  }

  const users = await res.json();
  box.innerHTML = users.map(u => `
    <div class="mini-item">
      <strong>${safe(u.email)}</strong><br>
      <span class="muted">${safe(u.full_name || "")} · ${safe(u.role)}</span>
    </div>
  `).join("");
}

async function createUser() {
  const payload = {
    email: document.getElementById("newUserEmail").value,
    full_name: document.getElementById("newUserName").value,
    role: document.getElementById("newUserRole").value,
    password: document.getElementById("newUserPassword").value || "changeme123",
  };

  const res = await fetch(`${apiUrl()}/api/v1/admin/users`, {
    method: "POST",
    headers: headers({"Content-Type": "application/json"}),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    toast("User creation failed.");
    return;
  }

  toast("User created.");
  document.getElementById("newUserEmail").value = "";
  document.getElementById("newUserName").value = "";
  await loadUsers();
  await loadAuditLogs();
}

async function loadConnectors() {
  const grid = document.getElementById("connectorsGrid");
  if (!grid) return;

  const res = await fetch(`${apiUrl()}/api/v1/connectors`, { headers: headers() });
  if (!res.ok) return;

  const connectors = await res.json();
  grid.innerHTML = connectors.map(c => `
    <div class="card connector-card ${safe(c.status)}">
      <h3>${safe(c.provider)}</h3>
      <p>Status: <strong>${safe(c.status.replace("_", " "))}</strong></p>
      <p class="muted">${safe(c.config_summary || "")}</p>
      <div class="row">
        <button onclick="syncConnector(${c.id})">Mock sync</button>
        <button class="secondary" onclick="markConnector(${c.id}, '${c.status === "connected" ? "not_connected" : "connected"}')">
          ${c.status === "connected" ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  `).join("");
}

async function markConnector(id, status) {
  await fetch(`${apiUrl()}/api/v1/connectors/${id}`, {
    method: "PATCH",
    headers: headers({"Content-Type": "application/json"}),
    body: JSON.stringify({status}),
  });
  await loadConnectors();
  await loadAuditLogs();
}

async function syncConnector(id) {
  const res = await fetch(`${apiUrl()}/api/v1/connectors/${id}/sync`, {
    method: "POST",
    headers: headers(),
  });
  if (res.ok) toast("Mock sync completed.");
  await loadConnectors();
  await loadAuditLogs();
}

async function loadBilling() {
  const panel = document.getElementById("billingPanel");
  if (!panel) return;

  const res = await fetch(`${apiUrl()}/api/v1/billing/plan`, { headers: headers() });
  if (!res.ok) return;

  const plan = await res.json();
  panel.innerHTML = `
    <div class="card"><h3>Plan</h3><p><strong>${safe(plan.plan)}</strong> · ${safe(plan.status)}</p></div>
    <div class="card"><h3>Limit</h3><p>${plan.monitored_accounts_limit} monitored accounts</p></div>
    <div class="card"><h3>Pricing</h3><p>${safe(plan.price_range)}</p><p class="muted">${safe(plan.pricing_model)}</p></div>
    <div class="card"><h3>Next step</h3><p>${safe(plan.next_step)}</p></div>
  `;
}

async function loadAuditLogs() {
  const box = document.getElementById("auditLog");
  if (!box) return;

  const res = await fetch(`${apiUrl()}/api/v1/audit-logs`, { headers: headers() });
  if (!res.ok) {
    box.innerHTML = `<p class="muted" style="padding:12px;">Admin or manager access required.</p>`;
    return;
  }

  const logs = await res.json();
  if (!logs.length) {
    box.innerHTML = `<p class="muted" style="padding:12px;">No audit log yet.</p>`;
    return;
  }

  box.innerHTML = logs.map(log => `
    <div class="audit-row">
      <div><strong>${safe(log.action)}</strong><br><small>${safe(log.created_at || "")}</small></div>
      <div>${safe(log.target_type || "")} ${safe(log.target_id || "")}</div>
      <div class="muted">${safe(log.details || "")}</div>
    </div>
  `).join("");
}



async function loadExecutiveInsights() {
  const res = await fetch(`${apiUrl()}/api/v1/executive-insights`, { headers: headers() });
  if (!res.ok) return;

  const data = await res.json();

  const board = document.getElementById("boardSummary");
  if (board) {
    board.innerHTML = (data.board_summary || []).map(line => `<li>${safe(line)}</li>`).join("");
  }

  const weekly = document.getElementById("weeklyPlan");
  if (weekly) {
    weekly.innerHTML = (data.recommended_weekly_plan || []).map(item => `
      <div class="mini-item">
        <strong>${safe(item.day)} · ${safe(item.focus)}</strong><br>
        <span class="muted">${safe(item.action)}</span>
      </div>
    `).join("");
  }

  renderInsightAccounts("topRevenueRisks", data.top_revenue_risks || [], "Revenue at risk");
  renderInsightAccounts("quickWins", data.quick_wins || [], "Savable");

  const overload = document.getElementById("csmOverload");
  if (overload) {
    overload.innerHTML = (data.csm_overload || []).map(c => `
      <div class="card insight-card">
        <h4>${safe(c.csm_owner)}</h4>
        <p>P1: <strong>${c.p1}</strong> · P2: <strong>${c.p2}</strong></p>
        <p>Priority accounts: <strong>${c.total_priority}</strong></p>
        <p class="insight-value">${euro(c.revenue_at_risk_eur)}</p>
        <p class="muted">Savable: ${euro(c.savable_revenue_eur)}</p>
      </div>
    `).join("");
  }

  const segments = document.getElementById("segmentRisk");
  if (segments) {
    segments.innerHTML = (data.segments || []).map(s => `
      <div class="card insight-card">
        <h4>${safe(s.segment)}</h4>
        <p>${s.accounts} accounts · ${s.p1_p2} P1/P2</p>
        <p class="insight-value">${euro(s.revenue_at_risk_eur)}</p>
        <p class="muted">ARR: ${euro(s.arr_eur)} · Risk rate: ${(s.risk_rate * 100).toFixed(1)}%</p>
      </div>
    `).join("");
  }

  const renewal = document.getElementById("renewalRisk");
  if (renewal) {
    renewal.innerHTML = Object.entries(data.renewal_buckets || {}).map(([bucket, value]) => `
      <div class="card insight-card">
        <h4>${safe(bucket)}</h4>
        <p>${value.accounts} accounts · ${value.p1_p2} P1/P2</p>
        <p class="insight-value">${euro(value.revenue_at_risk_eur)}</p>
      </div>
    `).join("");
  }
}

function renderInsightAccounts(elementId, accounts, valueLabel) {
  const box = document.getElementById(elementId);
  if (!box) return;

  box.innerHTML = accounts.map(a => {
    const value = valueLabel === "Savable" ? a.savable_revenue_eur : a.revenue_at_risk_eur;
    return `
      <div class="card insight-card">
        <h4>${safe(a.account_name)}</h4>
        <p><span class="badge ${safe(a.priority)}">${safe(a.priority)}</span> <span class="badge ${safe(a.risk_level)}">${safe(a.risk_level)}</span></p>
        <p class="insight-value">${euro(value)}</p>
        <p class="muted">${safe(a.csm_owner || "")} · renewal in ${a.days_to_renewal} days</p>
        <p class="muted">${safe(a.next_best_action || "")}</p>
      </div>
    `;
  }).join("");
}



function downloadExecutivePdf() {
  downloadAuthenticated(`${apiUrl()}/api/v1/reports/executive.pdf`, "ai_churn_rescue_executive_report.pdf");
}

function downloadPilotReportPdf() {
  downloadAuthenticated(`${apiUrl()}/api/v1/reports/pilot-report.pdf`, "ai_churn_rescue_pilot_report.pdf");
}

function downloadBoardSummary() {
  downloadAuthenticated(`${apiUrl()}/api/v1/reports/board-summary.csv`, "ai_churn_rescue_board_summary.csv");
}

function downloadCsmWeeklyPlan() {
  downloadAuthenticated(`${apiUrl()}/api/v1/reports/csm-weekly-plan.csv`, "ai_churn_rescue_csm_weekly_plan.csv");
}


async function loadDemoData() {
  const status = document.getElementById("uploadStatus");
  if (status) status.textContent = "Loading demo data...";
  try {
    const res = await fetch(`${apiUrl()}/api/v1/demo/load`, {
      method: "POST",
      headers: authHeaders()
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Demo data load failed");
    }
    const data = await res.json();
    if (status) status.textContent = `${data.accounts} demo accounts loaded.`;
    await refreshAll();
    document.querySelector("#dashboard")?.scrollIntoView({behavior:"smooth"});
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
  }
}


async function loadSystemStatus() {
  const el = document.getElementById("systemStatusCards");
  if (!el) return;
  try {
    const res = await fetch(`${apiUrl()}/api/v1/system/status`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const s = await res.json();
    el.innerHTML = `
      <div class="card"><h3>Backend</h3><p><b>${s.backend}</b><br/>Version ${s.version}</p></div>
      <div class="card"><h3>Database</h3><p><b>${s.database}</b><br/>Tenant: ${s.tenant_id}</p></div>
      <div class="card"><h3>Data volume</h3><p><b>${formatNumber(s.account_count)}</b> accounts<br/>${formatNumber(s.priority_accounts)} priority accounts</p></div>
      <div class="card"><h3>Latency</h3><p><b>${s.query_latency_ms} ms</b><br/>${s.commercial_readiness}</p></div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><h3>Status error</h3><p>${err.message}</p></div>`;
  }
}

async function loadCommercialReadiness() {
  const el = document.getElementById("commercialReadinessCards");
  if (!el) return;
  try {
    const res = await fetch(`${apiUrl()}/api/v1/commercial/readiness`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const r = await res.json();
    const proof = r.proof_points || {};
    el.innerHTML = `
      <div class="card"><h3>Stage</h3><p><b>${r.stage}</b><br/>${r.recommended_offer}</p></div>
      <div class="card"><h3>Proof points</h3><p>${formatNumber(proof.accounts_analyzed || 0)} accounts<br/>${formatCurrency(proof.revenue_at_risk_eur || 0)} at risk</p></div>
      <div class="card"><h3>Pricing path</h3><p><b>Pilot:</b> ${r.pilot_price_range}<br/><b>Annual:</b> ${r.annual_price_range}</p></div>
      <div class="card"><h3>Next step</h3><p>${(r.next_steps || []).slice(0, 3).join(" → ")}</p></div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><h3>Readiness error</h3><p>${err.message}</p></div>`;
  }
}

const originalRefreshAllV21 = typeof refreshAll === "function" ? refreshAll : null;
if (originalRefreshAllV21) {
  refreshAll = async function() {
    await originalRefreshAllV21();
    await loadSystemStatus();
    await loadCommercialReadiness();
    await loadDeploymentReadiness();
    await loadAutoSyncPlan();
    await loadConnectorReadiness();
    await loadCustomerDataMap();
    await loadConnectorCatalog();
  }
}


async function loadDeploymentReadiness() {
  const el = document.getElementById("deploymentReadinessCards");
  if (!el) return;
  try {
    const res = await fetch(`${apiUrl()}/api/v1/deployment/readiness`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    const checks = d.checks || [];
    const top = checks.slice(0, 4);
    el.innerHTML = top.map(c => `
      <div class="card">
        <h3>${c.name}</h3>
        <p><b>${c.status}</b><br/>${c.detail}</p>
      </div>
    `).join("") + `
      <div class="card wide-card">
        <h3>Deployment score</h3>
        <p><b>${d.ready_checks}/${d.total_checks}</b> readiness checks passed.<br/>Recommended: ${d.recommended_environment}</p>
      </div>
      <div class="card wide-card">
        <h3>Next actions</h3>
        <p>${(d.next_actions || []).slice(0, 5).join(" → ")}</p>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><h3>Deployment readiness error</h3><p>${err.message}</p></div>`;
  }
}


async function loadConnectorCatalog() {
  const el = document.getElementById("connectorCatalogCards");
  if (!el) return;
  const res = await fetch(`${apiUrl()}/api/v1/connectors/catalog`, { headers: authHeaders() });
  if (!res.ok) return;
  const items = await res.json();
  el.innerHTML = items.map(c => `
    <div class="card">
      <h3>${c.label}</h3>
      <p><b>${c.category}</b><br/>${c.auth_type}<br/><span class="muted">${c.docs}</span></p>
    </div>
  `).join("");
}

async function setupRealConnector() {
  const status = document.getElementById("realConnectorStatus");
  const key = document.getElementById("realConnectorKey").value;
  const token = document.getElementById("realConnectorToken").value;
  const instance = document.getElementById("realConnectorInstance").value;
  const frequency = document.getElementById("realConnectorFrequency").value;
  status.textContent = "Saving connector...";
  const payload = {
    connector_key: key,
    enabled: true,
    access_token: token || null,
    api_key: token || null,
    instance_url: key === "salesforce" ? instance : null,
    subdomain: key === "zendesk" ? instance : null,
    site: key === "chargebee" ? instance : null,
    sync_frequency: frequency
  };
  try {
    const res = await fetch(`${apiUrl()}/api/v1/connectors/setup`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    status.textContent = `${data.connector_key} saved. Status: ${data.status}`;
    await loadConnectors();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function testRealConnector() {
  const status = document.getElementById("realConnectorStatus");
  const key = document.getElementById("realConnectorKey").value;
  status.textContent = "Testing connector...";
  try {
    const res = await fetch(`${apiUrl()}/api/v1/connectors/${key}/test`, {
      method: "POST",
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    status.textContent = `${key} test: ${data.status} — ${data.message}`;
    await loadConnectors();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function syncRealConnector(replaceExisting=false) {
  const status = document.getElementById("realConnectorStatus");
  const key = document.getElementById("realConnectorKey").value;
  status.textContent = replaceExisting ? "Syncing and replacing data..." : "Syncing connector...";
  try {
    const res = await fetch(`${apiUrl()}/api/v1/connectors/${key}/sync?limit=100&replace_existing=${replaceExisting}`, {
      method: "POST",
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    const job = await res.json();
    status.textContent = `${key} sync ${job.status}: ${job.records_synced} accounts synced.`;
    await refreshAll();
    await loadSyncJobs();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function loadSyncJobs() {
  const body = document.getElementById("syncJobsBody");
  if (!body) return;
  const res = await fetch(`${apiUrl()}/api/v1/sync-jobs`, { headers: authHeaders() });
  if (!res.ok) return;
  const jobs = await res.json();
  body.innerHTML = jobs.map(j => `
    <tr>
      <td>${j.started_at ? new Date(j.started_at).toLocaleString() : ""}</td>
      <td>${j.connector_key}</td>
      <td><span class="pill">${j.status}</span></td>
      <td>${j.mode || ""}</td>
      <td>${j.records_synced || 0}</td>
      <td>${j.details || j.error_message || ""}</td>
    </tr>
  `).join("");
}

async function loadAutoSyncPlan() {
  const el = document.getElementById("autoSyncPlanCards");
  if (!el) return;
  const res = await fetch(`${apiUrl()}/api/v1/connectors/auto-sync-plan`, { headers: authHeaders() });
  if (!res.ok) return;
  const plan = await res.json();
  const freq = plan.recommended_frequency || {};
  el.innerHTML = Object.entries(freq).map(([key, value]) => `
    <div class="card"><h3>${key}</h3><p><b>${value}</b><br/>Scheduler-ready</p></div>
  `).join("") + `<div class="card wide-card"><h3>Production options</h3><p>${(plan.production_options || []).join(" → ")}</p></div>`;
}


async function loadCustomerDataMap() {
  const el = document.getElementById("customerDataMapCards");
  if (!el) return;
  const res = await fetch(`${apiUrl()}/api/v1/connectors/customer-data-map`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  el.innerHTML = Object.entries(data).map(([key, value]) => `
    <div class="card">
      <h3>${key.replace("_", " ").toUpperCase()}</h3>
      <p><b>${(value.connectors || []).join(" / ") || "Unified"}</b><br/>${value.purpose || value.business_value}<br/><span class="muted">${(value.fields || []).join(", ")}</span></p>
    </div>
  `).join("");
}

async function loadConnectorReadiness() {
  const el = document.getElementById("connectorReadinessCards");
  if (!el) return;
  const res = await fetch(`${apiUrl()}/api/v1/connectors/readiness-summary`, { headers: authHeaders() });
  if (!res.ok) return;
  const r = await res.json();
  el.innerHTML = `
    <div class="card"><h3>Coverage score</h3><p><b>${r.coverage_score}%</b><br/>${r.recommendation}</p></div>
    <div class="card"><h3>Configured</h3><p>${(r.configured_connectors || []).join(", ") || "No connectors configured yet"}</p></div>
    <div class="card"><h3>Missing</h3><p>${(r.missing_connectors || []).join(", ") || "None"}</p></div>
    <div class="card"><h3>Best stack</h3><p>${(r.best_stack || []).join(" + ")}</p></div>
  `;
}

async function syncUnifiedCustomerIntelligence() {
  const status = document.getElementById("customerIntelligenceStatus");
  if (status) status.textContent = "Syncing unified customer intelligence...";
  try {
    const res = await fetch(`${apiUrl()}/api/v1/connectors/sync-unified?limit=200&replace_existing=true`, {
      method: "POST",
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (status) status.textContent = `${data.records_synced} unified customer records synced.`;
    await refreshAll();
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
  }
}
