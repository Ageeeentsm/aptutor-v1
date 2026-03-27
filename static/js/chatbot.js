/* ═══════════════════════════════════════════
   Aptutor — AI Tutor (Anthropic-powered)
   Real Claude API called from frontend
   ═══════════════════════════════════════════ */

let _chatContext = { questionId: null, userAnswer: null, questionData: null };
let _conversationHistory = [];
let _fabLabelTimer = null;

// ── FAB setup ──
const fab = document.getElementById('chatbotFab');
const panel = document.getElementById('chatbotPanel');
const closeBtn = document.getElementById('chatbotClose');
const fabLabel = document.getElementById('fabLabel');

// Hide label after 4s
if (fabLabel) {
  setTimeout(() => {
    if (fabLabel) { fabLabel.style.opacity = '0'; fabLabel.style.transition = 'opacity 0.5s'; }
    setTimeout(() => { if (fabLabel) fabLabel.style.display = 'none'; }, 500);
  }, 4000);
}

if (fab) {
  fab.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
      document.getElementById('chatbotInput').focus();
      if (fabLabel) fabLabel.style.display = 'none';
    }
  });
}
if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.remove('open'));

// ── Input ──
const sendBtn = document.getElementById('chatbotSend');
const input = document.getElementById('chatbotInput');
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); });

// ── Build system prompt ──
function buildSystemPrompt() {
  const q = _chatContext.questionData;
  let base = `You are Aptutor AI — an expert, patient, and encouraging exam tutor specialising in Nigerian recruitment aptitude tests: GMAT-style quantitative reasoning, SHL assessments (numerical, verbal, inductive), and Watson-Glaser critical thinking.

Your teaching style:
- Break concepts down step by step, like a real teacher at a whiteboard
- Use simple analogies and real Nigerian examples (Naira, Lagos, Nigerian companies)
- When explaining maths: show the formula first, then worked example, then the shortcut
- Always end with a memorable tip or mnemonic the student can use in the exam
- Be warm, direct, and encouraging — never condescending
- Use formatting: **bold** for key terms, numbered steps for processes, and clear structure
- Keep responses focused but complete — teach the concept, not just the answer
- If a student is struggling, offer to break it down even further

Response format guidance:
- Start with a direct answer or acknowledgment (1 sentence)
- Then teach/explain (the bulk)
- End with a ⚡ exam tip or follow-up offer`;

  if (q) {
    base += `

CURRENT QUESTION CONTEXT:
Question: ${q.question}
Options: ${JSON.stringify(q.options)}
Correct Answer: ${q.correct || 'not revealed yet'}
Topic: ${q.topic}
Module: ${q.module} (${q.subtype})
Difficulty: ${q.difficulty}
Explanation: ${q.explanation || ''}
Strategy Tip: ${q.deep_explanation?.strategy_tip || ''}
Why correct: ${q.deep_explanation?.why_correct || ''}
Why wrong options: ${JSON.stringify(q.deep_explanation?.why_wrong || {})}
Student's answer: ${_chatContext.userAnswer || 'not answered yet'}

When the student asks about this question, use ALL this context to give a thorough, teaching-focused response.`;
  }

  return base;
}

// ── Send message ──
async function sendMessage() {
  const msg = input.value.trim();
  if (!msg) return;

  appendMessage(msg, 'user');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  _conversationHistory.push({ role: 'user', content: msg });
  showTyping();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: buildSystemPrompt(),
        messages: _conversationHistory
      })
    });

    const data = await response.json();
    removeTyping();

    if (data.content && data.content[0]) {
      const reply = data.content[0].text;
      _conversationHistory.push({ role: 'assistant', content: reply });
      appendMessage(reply, 'bot', true);
    } else if (data.error) {
      appendMessage(`⚠️ API error: ${data.error.message}. Make sure your API key is set.`, 'bot');
    }
  } catch (err) {
    removeTyping();
    // Fallback to local tutor if API unavailable
    const fallback = localTutorFallback(msg);
    _conversationHistory.push({ role: 'assistant', content: fallback });
    appendMessage(fallback, 'bot', true);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ── Local fallback (when no API key) ──
function localTutorFallback(msg) {
  const q = _chatContext.questionData;
  const ua = _chatContext.userAnswer;
  const lower = msg.toLowerCase();

  if (q) {
    const de = q.deep_explanation || {};

    if (lower.includes('explain') || lower.includes('how') || lower.includes('why') || lower.includes('teach')) {
      return `**${(q.topic||'').replace(/_/g,' ').toUpperCase()} — Step by Step**\n\n${q.explanation}\n\n**Why the correct answer (${q.correct}) works:**\n${de.why_correct || ''}\n\n⚡ **Exam Strategy:** ${de.strategy_tip || 'Eliminate obviously wrong options first, then work through the remaining ones systematically.'}`;
    }

    if (lower.includes('wrong') || lower.includes('mistake') || lower.includes('why did')) {
      if (ua && ua !== q.correct) {
        const why = de.why_wrong?.[ua] || 'This option does not satisfy all the conditions in the question.';
        return `**Why option ${ua} is incorrect:**\n\n${why}\n\n**The correct answer is ${q.correct}:**\n${de.why_correct || q.explanation}\n\n⚡ **Key lesson:** ${de.strategy_tip || 'Always verify your answer satisfies ALL conditions in the question.'}`;
      }
      return `**Correct Answer: ${q.correct}**\n\n${q.explanation}\n\n⚡ ${de.strategy_tip || ''}`;
    }

    if (lower.includes('shortcut') || lower.includes('trick') || lower.includes('fast') || lower.includes('quick')) {
      return `⚡ **Shortcut for ${(q.topic||'this type').replace(/_/g,' ')}:**\n\n${de.strategy_tip || 'Eliminate two obviously wrong options first, then compare the remaining two carefully. This cuts decision time in half.'}\n\n**General exam tip:** Time-box at 90 seconds. If stuck after 60 seconds, make your best guess and move on — you can flag and return.`;
    }

    return `**On this question (${(q.topic||'').replace(/_/g,' ')}):**\n\n${q.explanation}\n\n⚡ ${de.strategy_tip || 'Read every option before choosing — the best answer is the most complete one.'}`;
  }

  // Generic teaching (no question context)
  const topics = {
    percent: `**Percentages — The Core Formula**\n\n1. **% of a number:** Multiply by the decimal\n   Example: 20% of 500 = 0.20 × 500 = **100**\n\n2. **% change:** (New − Old) ÷ Old × 100\n   Example: 400 → 500 = (500−400)/400 × 100 = **25% increase**\n\n3. **Reverse %:** If price after 20% discount = ₦80, original = 80 ÷ 0.8 = **₦100**\n\n⚡ **Trick:** Never add or subtract percentages directly. 50% off then 50% on does NOT equal 0% — it equals −25%!`,
    ratio: `**Ratios — The Unit Method**\n\n1. Find the total number of parts\n2. Divide the total by total parts = 1 unit value\n3. Multiply each share by its ratio number\n\n**Example:** ₦12,000 split in ratio 3:1\n- Total parts = 4\n- 1 unit = ₦12,000 ÷ 4 = ₦3,000\n- Share A = 3 × ₦3,000 = **₦9,000**\n- Share B = 1 × ₦3,000 = **₦3,000**\n\n⚡ **Exam shortcut:** If one person's share is given, find 1 unit directly then scale up.`,
    probability: `**Probability — Think in Fractions**\n\nP(event) = Favourable outcomes ÷ Total outcomes\n\n**With replacement:** Pool stays the same each draw\n**Without replacement:** Pool shrinks — adjust denominator\n\n**Example:** Bag has 5 red, 3 blue. Pick 2 without replacement:\n- P(both red) = (5/8) × (4/7) = 20/56 = **5/14**\n\n⚡ **Key rule:** Multiply probabilities for AND. Add for OR (when mutually exclusive).`,
    inference: `**Watson-Glaser Inference — The 5-Point Scale**\n\nYou must judge if a conclusion:  \n**True** → definitely follows\n**Probably True** → likely but not certain\n**Insufficient Data** → can't tell either way\n**Probably False** → unlikely\n**False** → definitely doesn't follow\n\n⚡ **Golden rule:** Stay STRICTLY within the information given. No outside knowledge, no assumptions. If in doubt → Insufficient Data.`,
  };

  for (const [key, val] of Object.entries(topics)) {
    if (lower.includes(key)) return val;
  }

  return `I'm your Aptutor AI coach! I can:\n\n📚 **Teach any topic** — percentages, ratios, probability, sequences, critical thinking\n🔍 **Break down any question** — step by step with full working\n❌ **Explain why you were wrong** — and what to do next time\n⚡ **Give shortcuts** — exam-tested strategies\n\nJust ask me anything! For example:\n- "Teach me how compound interest works"\n- "Why is my answer wrong?"\n- "Give me a shortcut for percentage questions"`;
}

// ── Append message with rich formatting ──
function appendMessage(text, sender, withFollowUps = false) {
  const msgs = document.getElementById('chatbotMessages');
  if (!msgs) return;

  const div = document.createElement('div');
  div.className = sender === 'bot' ? 'bot-message' : 'user-message';

  // Format bot messages
  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/^(\d+\.\s)/gm, '<br>$1')
    .replace(/\n/g, '<br>');

  div.innerHTML = html;

  // Add contextual follow-ups after bot messages
  if (sender === 'bot' && withFollowUps && _chatContext.questionData) {
    const q = _chatContext.questionData;
    const suggestions = getFollowUps(q);
    if (suggestions.length) {
      const fuDiv = document.createElement('div');
      fuDiv.className = 'follow-ups';
      fuDiv.innerHTML = suggestions.map(s =>
        `<button class="follow-up-btn" onclick="sendQuickMessage('${s.replace(/'/g, "\'")}')">${s}</button>`
      ).join('');
      div.appendChild(fuDiv);
    }
  }

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function getFollowUps(q) {
  const topic = (q.topic || '').replace(/_/g, ' ');
  return [
    `Give me a similar ${topic} question to practice`,
    `What are common mistakes in ${topic} questions?`,
    `Show me the shortcut for this type`,
  ].slice(0, 2);
}

function showTyping() {
  const msgs = document.getElementById('chatbotMessages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typingIndicator';
  div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function clearChat() {
  _conversationHistory = [];
  const msgs = document.getElementById('chatbotMessages');
  if (msgs) msgs.innerHTML = '<div class="bot-message"><strong>Chat cleared!</strong> Ask me anything to start fresh. 🎓</div>';
}

function sendQuickMessage(msg) {
  if (!panel.classList.contains('open')) panel.classList.add('open');
  if (input) { input.value = msg; sendMessage(); }
}

// ── Set context from test engine ──
function setChatbotContext(questionId, userAnswer, questionData) {
  _chatContext = { questionId, userAnswer, questionData: questionData || null };

  const dot = document.getElementById('ctxDot');
  const ctxText = document.getElementById('ctxText');

  if (questionId && questionData) {
    if (dot) dot.classList.add('active');
    if (ctxText) ctxText.textContent = `${(questionData.topic||'').replace(/_/g,' ')} · ${questionData.module?.toUpperCase()} · Q${(questionData.index||0)+1}`;
  } else if (questionId) {
    if (dot) dot.classList.add('active');
    if (ctxText) ctxText.textContent = `Question: ${questionId}`;
  } else {
    if (dot) dot.classList.remove('active');
    if (ctxText) ctxText.textContent = 'Open a test to get question-aware help';
  }
}

</script>
{%- block extra_js %}{% endblock %}
<script>
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (!sidebar.contains(e.target) && !menuToggle.contains(e.target))
        sidebar.classList.remove('open');
    });
  }
</script>
</body>
</html