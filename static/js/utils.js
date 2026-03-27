/* ═══════════════════════════════════════════
   Aptutor — utils.js
   Shared helper functions used across all pages
   ═══════════════════════════════════════════ */

// ── Toast Notifications ──
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  toast.innerHTML = `<span style="font-weight:700;">${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Tab Switcher (explanation panels) ──
function switchTab(btn, targetId) {
  const panel = btn.closest('.explanation-panel');
  if (!panel) return;

  panel.querySelectorAll('.exp-tab').forEach(t => t.classList.remove('active'));
  panel.querySelectorAll('.exp-content').forEach(c => c.classList.remove('active'));

  btn.classList.add('active');
  const target = document.getElementById(targetId);
  if (target) target.classList.add('active');
}

// ── Format Time ──
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Module color helpers ──
function moduleColor(mod) {
  return mod === 'gmat' ? 'accent' : mod === 'shl' ? 'success' : 'warning';
}

function difficultyColor(diff) {
  return diff === 'easy' ? 'success' : diff === 'medium' ? 'accent' : 'danger';
}

// ── Render markdown-ish bold ──
function parseBold(str) {
  return (str || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
