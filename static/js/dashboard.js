/* ═══════════════════════════════════════════
   Aptutor — dashboard.js
   Load and render user stats, recent tests,
   weak areas, and module performance
   ═══════════════════════════════════════════ */

// ── Greeting ──
const hour = new Date().getHours();
const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
const greetEl = document.getElementById('timeOfDay');
if (greetEl) greetEl.textContent = greeting;

// ── Load Stats ──
async function loadDashboard() {
  try {
    const res = await fetch('/api/user/stats');
    const data = await res.json();

    // Greeting name
    const nameEl = document.getElementById('greetName');
    if (nameEl) nameEl.textContent = (data.username || 'Candidate').split(' ')[0];

    // Stat cards
    document.getElementById('statTests').textContent = data.total_tests || 0;
    document.getElementById('statAccuracy').textContent = (data.accuracy || 0) + '%';
    document.getElementById('statTime').textContent = (data.avg_time || 0) + 's';
    document.getElementById('statStreak').textContent = (data.streak || 0) + ' 🔥';

    // Module performance bars
    renderModuleBars(data.module_stats || {});

    // Weak areas
    renderWeakAreas(data.weak_areas || []);

    // Recent tests
    renderRecentTests(data.recent_tests || []);

  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

// ── Module Performance Bars ──
function renderModuleBars(stats) {
  const modules = ['gmat', 'shl', 'watson'];

  modules.forEach(mod => {
    const bar = document.getElementById(`bar${mod.charAt(0).toUpperCase() + mod.slice(1)}`);
    const pct = document.getElementById(`pct${mod.charAt(0).toUpperCase() + mod.slice(1)}`);

    const s = stats[mod];
    if (s && s.total > 0) {
      const acc = Math.round(s.correct / s.total * 100);
      if (bar) setTimeout(() => { bar.style.width = acc + '%'; }, 300);
      if (pct) pct.textContent = acc + '%';

      // Color the bar
      if (bar) {
        bar.className = 'progress-bar-fill ' + (acc >= 70 ? 'success' : acc >= 50 ? '' : 'danger');
      }
    } else {
      if (pct) pct.textContent = '—';
    }
  });
}

// ── Weak Areas ──
function renderWeakAreas(areas) {
  const el = document.getElementById('weakAreas');
  if (!el) return;

  if (!areas.length) {
    el.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Complete at least 2 tests to see your weak areas.</p>';
    return;
  }

  el.innerHTML = areas.map(a => {
    const pct = a.accuracy;
    const col = pct >= 70 ? 'success' : pct >= 50 ? 'warning' : 'danger';
    return `
      <div class="weak-topic">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <span style="font-size:13px; color:var(--text-secondary); text-transform:capitalize;">${(a.topic || '').replace(/_/g,' ')}</span>
          <span style="font-family:var(--font-mono); font-size:12px; color:var(--${col});">${pct}%</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill ${col}" style="width:${pct}%; transition: width 0.8s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Recent Tests ──
function renderRecentTests(tests) {
  const el = document.getElementById('recentTests');
  if (!el) return;

  if (!tests.length) {
    el.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No tests completed yet. <a href="/test" style="color:var(--accent-bright)">Start your first test →</a></p>';
    return;
  }

  const rows = tests.slice(0, 8).map(t => {
    const modColor = t.module === 'gmat' ? 'accent' : t.module === 'shl' ? 'success' : 'warning';
    const accColor = t.accuracy >= 70 ? 'success' : t.accuracy >= 50 ? 'warning' : 'danger';
    return `
      <tr>
        <td><span class="module-pill ${t.module}">${t.module.toUpperCase()}</span></td>
        <td style="color:var(--text-secondary);">${(t.subtype || 'mixed').replace('_',' ')}</td>
        <td><span style="font-family:var(--font-mono); color:var(--${accColor});">${t.accuracy}%</span></td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">${t.score}/${t.total}</td>
        <td><span class="badge badge-muted">${t.date || ''}</span></td>
        <td><a href="/results/${t.id}" style="color:var(--accent-bright); font-size:12px;">Review →</a></td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Module</th><th>Type</th><th>Accuracy</th><th>Score</th><th>Date</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Daily Challenge ──
async function startDailyChallenge(e) {
  e.preventDefault();
  try {
    const res = await fetch('/api/daily-challenge');
    const data = await res.json();

    // Start a test session with these questions
    // For simplicity, redirect to test selection with a flag
    showToast('Starting today\'s challenge...', 'info');
    // Start a mixed test
    const startRes = await fetch('/test/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'gmat', subtype: '', difficulty: 'all', count: 5, mode: 'timed' })
    });
    const startData = await startRes.json();
    if (startData.session_id) {
      window.location.href = `/test/${startData.session_id}`;
    }
  } catch (e) {
    showToast('Failed to load daily challenge', 'error');
  }
}

// ── Load daily challenge info ──
async function loadDailyInfo() {
  try {
    const res = await fetch('/api/daily-challenge');
    const data = await res.json();
    const sub = document.getElementById('dailySub');
    if (sub) sub.textContent = `${data.total} questions · Mixed difficulty · ${new Date().toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })}`;
  } catch (e) {}
}

// ── Init ──
loadDashboard();
loadDailyInfo();
