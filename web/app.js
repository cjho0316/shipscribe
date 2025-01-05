const $ = (id) => document.getElementById(id);
const state = { raw: '', sections: { changelog: '', announcement: '', migration: '' }, tab: 'changelog', busy: false };

async function loadInfo() {
  try {
    const r = await fetch('/api/info');
    const info = await r.json();
    const badge = $('provider-badge');
    if (info.isAzure) {
      badge.textContent = `Azure Foundry \u00b7 ${info.model}`;
      badge.className = 'badge badge-azure';
    } else {
      badge.textContent = 'Offline mock';
      badge.className = 'badge badge-mock';
      badge.title = 'Set AZURE_OPENAI_ENDPOINT in .env to use Azure Foundry';
    }
    $('range').placeholder = `${info.defaultRange} (auto)`;
    $('repo-hint').textContent = `repo: ${info.repo}`;
  } catch {
    $('provider-badge').textContent = 'offline';
  }
}

// Split sentinel-delimited text into the three sections (live, while streaming).
function parseSections(text) {
  const markers = [
    ['changelog', '=== CHANGELOG ==='],
    ['announcement', '=== ANNOUNCEMENT ==='],
    ['migration', '=== MIGRATION ==='],
  ];
  const out = { changelog: '', announcement: '', migration: '' };
  markers.forEach(([key, tag], i) => {
    const start = text.indexOf(tag);
    if (start < 0) return;
    const from = start + tag.length;
    let end = text.length;
    markers.forEach(([, otherTag], j) => {
      if (j === i) return;
      const idx = text.indexOf(otherTag, from);
      if (idx >= 0 && idx < end) end = idx;
    });
    out[key] = text.slice(from, end).trim();
  });
  return out;
}

function render() {
  for (const key of ['changelog', 'announcement', 'migration']) {
    const el = $(`view-${key}`);
    const val = state.sections[key];
    el.textContent = val || '';
    if (!val && key === state.tab) el.innerHTML = '<div class="empty">Streaming\u2026</div>';
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`view-${tab}`).classList.remove('hidden');
}

function timelineReset() { $('timeline').innerHTML = ''; }
function timelineTool(name, phase) {
  const id = `tl-${name}`;
  let li = document.getElementById(id);
  if (!li) {
    li = document.createElement('li');
    li.id = id;
    $('timeline').appendChild(li);
  }
  li.className = `chip ${phase === 'end' ? 'chip-done' : 'chip-run'}`;
  li.textContent = `${phase === 'end' ? '\u2713' : '\u21ba'} ${name}`;
}

function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${isErr ? 'err' : ''}`;
  setTimeout(() => t.classList.add('hidden'), 4000);
}

async function generate() {
  if (state.busy) return;
  state.busy = true;
  state.raw = '';
  state.sections = { changelog: '', announcement: '', migration: '' };
  $('generate').disabled = true;
  $('apply').disabled = true;
  $('live').textContent = '';
  timelineReset();
  render();

  const range = $('range').value.trim();
  let res;
  try {
    res = await fetch('/api/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ range }),
    });
  } catch (e) {
    toast('Request failed: ' + e.message, true);
    $('generate').disabled = false;
    state.busy = false;
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() || '';
    for (const block of blocks) handleEvent(block);
  }

  $('generate').disabled = false;
  state.busy = false;
}

function handleEvent(block) {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;
  let payload;
  try { payload = JSON.parse(data); } catch { return; }

  if (event === 'text') {
    state.raw += payload.delta;
    $('live').textContent = state.raw;
    $('live').scrollTop = $('live').scrollHeight;
    state.sections = parseSections(state.raw);
    render();
  } else if (event === 'tool') {
    timelineTool(payload.name, payload.phase);
  } else if (event === 'sections') {
    state.sections = payload;
    render();
    $('apply').disabled = !state.sections.changelog;
  } else if (event === 'done') {
    toast(`Done \u00b7 range ${payload.range} \u00b7 ${payload.provider}`);
  } else if (event === 'error') {
    toast('Error: ' + payload.message, true);
  } else if (event === 'meta') {
    const badge = $('provider-badge');
    if (payload.isAzure) { badge.textContent = `Azure Foundry \u00b7 ${payload.model}`; badge.className = 'badge badge-azure'; }
  }
}

function openModal() {
  $('modal-preview').textContent = state.sections.changelog.slice(0, 600) + (state.sections.changelog.length > 600 ? '\n\u2026' : '');
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

async function confirmApply() {
  closeModal();
  try {
    const r = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: state.sections.changelog }),
    });
    const out = await r.json();
    if (out.ok) toast(out.result);
    else toast('Apply failed: ' + (out.error || 'unknown'), true);
  } catch (e) {
    toast('Apply failed: ' + e.message, true);
  }
}

function copyCurrent() {
  const text = state.sections[state.tab] || '';
  navigator.clipboard?.writeText(text).then(() => toast('Copied ' + state.tab)).catch(() => toast('Copy failed', true));
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
$('generate').addEventListener('click', generate);
$('range').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
$('apply').addEventListener('click', openModal);
$('modal-cancel').addEventListener('click', closeModal);
$('modal-confirm').addEventListener('click', confirmApply);
$('copy').addEventListener('click', copyCurrent);

loadInfo();
