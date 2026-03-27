/* ═══════════════════════════════════════════
   Aptutor — test-engine.js
   Core test interface: timer, navigation,
   answer saving, flag system, auto-submit
   ═══════════════════════════════════════════ */

let _sessionId = null;
let _totalQuestions = 0;
let _currentIndex = 0;
let _mode = 'timed';
let _timeLimit = 0;
let _timeRemaining = 0;
let _timerInterval = null;
let _answers = {};         // { index: selected_option }
let _flagged = new Set();  // Set of flagged indices
let _questionTimes = {};   // { index: seconds_spent }
let _questionStartTime = null;
let _isStudyMode = false;

// ── Initialize Test ──
async function initTest(sessionId) {
  _sessionId = sessionId;

  try {
    const q = await fetchQuestion(0);
    _totalQuestions = q.total;
    _mode = q.mode || 'timed';
    _isStudyMode = _mode === 'study';

    // Get time limit from session (stored in page or via API)
    // We'll compute it: 90 seconds per question for timed mode
    _timeLimit = _isStudyMode ? 0 : _totalQuestions * 90;
    _timeRemaining = _timeLimit;

    buildQuestionGrid();
    renderQuestion(q);

    if (!_isStudyMode) {
      startTimer();
      document.getElementById('modeLabel').textContent = 'TIMED';
    } else {
      document.getElementById('timerDisplay').textContent = '∞';
      document.getElementById('timerDisplay').style.color = 'var(--accent-bright)';
      document.getElementById('modeLabel').textContent = 'STUDY';
      document.getElementById('btnSkip').style.display = 'none';
    }

    updateNavButtons();
  } catch (e) {
    console.error('Failed to initialize test:', e);
    showToast('Failed to load test. Please refresh.', 'error');
  }
}

// ── Fetch Question from API ──
async function fetchQuestion(index) {
  const res = await fetch(`/api/test/${_sessionId}/question/${index}`);
  if (!res.ok) throw new Error('Failed to fetch question');
  return res.json();
}

// ── Render Question ──
function renderQuestion(q) {
  _currentIndex = q.index;
  _questionStartTime = Date.now();

  // Set chatbot context
  if (window.setChatbotContext) {
    setChatbotContext(q.id, _answers[_currentIndex] || null);
  }

  // Header
  document.getElementById('moduleLabel').textContent = `${(q.module || '').toUpperCase()} · ${(q.subtype || '').replace('_', ' ')}`;
  document.getElementById('progressLabel').textContent = `Q ${q.index + 1} / ${q.total}`;

  const progressPct = ((q.index + 1) / q.total) * 100;
  document.getElementById('progressBar').style.width = progressPct + '%';

  // Meta badges
  const diffColor = q.difficulty === 'easy' ? 'badge-success' : q.difficulty === 'medium' ? 'badge-accent' : 'badge-danger';
  document.getElementById('questionMeta').innerHTML = `
    <span class="badge ${diffColor}">${q.difficulty || 'medium'}</span>
    <span class="badge badge-muted">${(q.topic || '').replace(/_/g, ' ')}</span>
    <span class="badge badge-muted">~${q.avg_time_seconds || 60}s</span>
  `;

  // Question text
  document.getElementById('questionText').textContent = q.question;

  // Options
  const optsList = document.getElementById('optionsList');
  optsList.innerHTML = '';

  const userSelected = _answers[_currentIndex];

  Object.entries(q.options || {}).forEach(([key, val]) => {
    const btn = document.createElement('button');
    btn.className = 'option-item';
    btn.id = `opt-${key}`;

    if (userSelected === key) btn.classList.add('selected');

    // Study mode: show correct/incorrect if already answered
    if (_isStudyMode && q.correct && userSelected) {
      if (key === q.correct) btn.classList.add('correct');
      else if (key === userSelected && userSelected !== q.correct) btn.classList.add('incorrect');
      btn.disabled = true;
    }

    btn.innerHTML = `<span class="option-key">${key}</span><span class="option-text">${val}</span>`;
    btn.addEventListener('click', () => selectAnswer(key, q));
    optsList.appendChild(btn);
  });

  // Study mode explanation
  if (_isStudyMode && q.correct && userSelected) {
    showExplanation(q);
  } else {
    const expPanel = document.getElementById('explanationPanel');
    if (expPanel) expPanel.style.display = 'none';
  }

  // Update grid
  updateGrid();
  updateNavButtons();

  // Flag state
  const flagBtn = document.getElementById('btnFlag');
  if (flagBtn) {
    flagBtn.classList.toggle('flagged', _flagged.has(_currentIndex));
  }
}

// ── Select Answer ──
async function selectAnswer(key, q) {
  if (_isStudyMode && _answers[_currentIndex]) return; // Already answered in study mode

  // Record time spent on this question
  const elapsed = Math.round((Date.now() - _questionStartTime) / 1000);
  _questionTimes[_currentIndex] = (_questionTimes[_currentIndex] || 0) + elapsed;
  _questionStartTime = Date.now();

  _answers[_currentIndex] = key;

  // Highlight selection
  document.querySelectorAll('.option-item').forEach(btn => {
    btn.classList.remove('selected', 'correct', 'incorrect');
  });
  document.getElementById(`opt-${key}`)?.classList.add('selected');

  // Update chatbot context
  if (window.setChatbotContext) {
    setChatbotContext(q.id, key);
  }

  // Save to backend
  try {
    const res = await fetch(`/api/test/${_sessionId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index: _currentIndex,
        answer: key,
        time_spent: elapsed
      })
    });
    const data = await res.json();

    // Study mode: show explanation immediately
    if (_isStudyMode && data.correct !== undefined) {
      // Reveal correct/incorrect
      const correctKey = data.correct;
      Object.keys(q.options || {}).forEach(k => {
        const btn = document.getElementById(`opt-${k}`);
        if (!btn) return;
        btn.disabled = true;
        if (k === correctKey) btn.classList.add('correct');
        else if (k === key && key !== correctKey) btn.classList.add('incorrect');
      });

      // Show explanation from response data
      const enrichedQ = { ...q, ...data };
      showExplanation(enrichedQ);

      showToast(data.is_correct ? '✓ Correct!' : `✗ Incorrect — Answer is ${correctKey}`, data.is_correct ? 'success' : 'error');
    }

    updateGrid();
  } catch (e) {
    console.error('Failed to save answer:', e);
  }
}

// ── Show Explanation Panel ──
function showExplanation(q) {
  const panel = document.getElementById('explanationPanel');
  if (!panel) return;
  panel.style.display = 'block';

  const de = q.deep_explanation || {};

  // Main explanation
  document.getElementById('expMain').innerHTML = `
    <p>${q.explanation || ''}</p>
    ${de.why_correct ? `<p style="margin-top:10px;"><strong>Why correct:</strong> ${de.why_correct}</p>` : ''}
  `;

  // Why wrong options
  const wrongEntries = Object.entries(de.why_wrong || {});
  document.getElementById('expWrong').innerHTML = wrongEntries.length
    ? wrongEntries.map(([k, v]) => `<p style="margin-bottom:10px;"><strong style="color:var(--danger)">Option ${k}:</strong> ${v}</p>`).join('')
    : '<p>Detailed wrong-option analysis not available for this question.</p>';

  // Strategy tip
  document.getElementById('expStrategy').innerHTML = de.strategy_tip
    ? `<div class="strategy-tip">${de.strategy_tip}</div>`
    : '<p>No specific strategy tip for this question.</p>';
}

// ── Navigation ──
async function navigate(direction) {
  // Save time for current question
  if (_questionStartTime) {
    const elapsed = Math.round((Date.now() - _questionStartTime) / 1000);
    _questionTimes[_currentIndex] = (_questionTimes[_currentIndex] || 0) + elapsed;
  }

  const newIndex = _currentIndex + direction;
  if (newIndex < 0 || newIndex >= _totalQuestions) return;

  try {
    const q = await fetchQuestion(newIndex);
    renderQuestion(q);
  } catch (e) {
    showToast('Failed to load question', 'error');
  }
}

async function jumpToQuestion(index) {
  if (index < 0 || index >= _totalQuestions) return;

  // Save time for current
  if (_questionStartTime) {
    const elapsed = Math.round((Date.now() - _questionStartTime) / 1000);
    _questionTimes[_currentIndex] = (_questionTimes[_currentIndex] || 0) + elapsed;
  }

  try {
    const q = await fetchQuestion(index);
    renderQuestion(q);
  } catch (e) {
    showToast('Failed to load question', 'error');
  }
}

// ── Flag Question ──
function toggleFlag() {
  const flagBtn = document.getElementById('btnFlag');
  if (_flagged.has(_currentIndex)) {
    _flagged.delete(_currentIndex);
    flagBtn?.classList.remove('flagged');
    showToast('Flag removed', 'info');
  } else {
    _flagged.add(_currentIndex);
    flagBtn?.classList.add('flagged');
    showToast('Question flagged for review', 'info');
  }
  updateGrid();
}

// ── Question Grid ──
function buildQuestionGrid() {
  const grid = document.getElementById('qGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < _totalQuestions; i++) {
    const bubble = document.createElement('div');
    bubble.className = 'q-bubble';
    bubble.id = `qb-${i}`;
    bubble.textContent = i + 1;
    bubble.addEventListener('click', () => jumpToQuestion(i));
    grid.appendChild(bubble);
  }
}

function updateGrid() {
  for (let i = 0; i < _totalQuestions; i++) {
    const bubble = document.getElementById(`qb-${i}`);
    if (!bubble) continue;

    bubble.className = 'q-bubble';
    if (i === _currentIndex) bubble.classList.add('current');
    else if (_flagged.has(i)) bubble.classList.add('flagged');
    else if (_answers[i]) bubble.classList.add('answered');
  }
}

// ── Nav Button Visibility ──
function updateNavButtons() {
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');

  if (btnPrev) btnPrev.disabled = _currentIndex === 0;

  const isLast = _currentIndex === _totalQuestions - 1;
  if (btnNext) btnNext.style.display = isLast ? 'none' : 'inline-flex';
  if (btnSubmit) btnSubmit.style.display = isLast ? 'inline-flex' : 'none';
}

// ── Timer ──
function startTimer() {
  const display = document.getElementById('timerDisplay');
  if (!display || _isStudyMode) return;

  _timerInterval = setInterval(() => {
    _timeRemaining--;

    display.textContent = formatTime(_timeRemaining);

    // Color transitions
    const pct = _timeRemaining / _timeLimit;
    if (pct <= 0.1 || _timeRemaining <= 30) {
      display.className = 'timer-display danger';
    } else if (pct <= 0.25) {
      display.className = 'timer-display warning';
    } else {
      display.className = 'timer-display';
    }

    if (_timeRemaining <= 0) {
      clearInterval(_timerInterval);
      timeUp();
    }
  }, 1000);
}

function timeUp() {
  document.getElementById('timeUpModal')?.classList.add('show');
}

// ── Confirm Submit ──
function confirmSubmit() {
  const answered = Object.keys(_answers).length;
  document.getElementById('answeredCount').textContent = answered;
  document.getElementById('totalCount').textContent = _totalQuestions;
  document.getElementById('submitModal')?.classList.add('show');
}

function closeModal() {
  document.getElementById('submitModal')?.classList.remove('show');
}

// ── Final Submission ──
async function submitTest() {
  if (_timerInterval) clearInterval(_timerInterval);

  // Record final question time
  if (_questionStartTime) {
    const elapsed = Math.round((Date.now() - _questionStartTime) / 1000);
    _questionTimes[_currentIndex] = (_questionTimes[_currentIndex] || 0) + elapsed;
  }

  const totalTime = _timeLimit - _timeRemaining;

  try {
    const res = await fetch(`/api/test/${_sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time_taken: totalTime,
        per_question_times: _questionTimes
      })
    });
    const data = await res.json();

    if (data.redirect) {
      window.location.href = data.redirect;
    }
  } catch (e) {
    showToast('Submission failed. Please try again.', 'error');
  }
}
