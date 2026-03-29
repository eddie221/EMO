import { invoke } from 'https://unpkg.com/@tauri-apps/api@2/core.js';

// ── Constants ──────────────────────────────────────────────────────────────
const BOX_COLORS = ['#e85d5d','#e8945d','#e8c85d','#8ad65d','#5db8e8'];

function dayLabel(d) {
  if (d === 1)  return 'Daily';
  if (d === 7)  return 'Weekly';
  if (d === 14) return 'Biweekly';
  if (d === 30) return 'Monthly';
  return `${d}d`;
}

function getBoxes() {
  return state.boxDays.map((days, i) => ({
    box: i + 1, days, color: BOX_COLORS[i], label: dayLabel(days),
  }));
}

// Keep BOXES as a live getter so existing code still works
function getBOXES() { return getBoxes(); }

const BOX_DESCS = [
  'New & difficult cards',
  'Review every 3 days',
  'Review weekly',
  'Review biweekly',
  'Mastered cards',
];

const PARTS_OF_SPEECH = [
  'noun','verb','adjective','adverb','idiom',
];

const USAGE_FREQUENCIES = [
  'very common','common','uncommon','rare','archaic',
];

const icon = name => h('i', { class: `bi bi-${name}`, 'aria-hidden': 'true' });

const CONFLICT_FIELDS = [
  { key: 'lang2',             label: 'Translation'   },
  { key: 'description_lang1', label: 'Description'   },
  { key: 'part_of_speech',    label: 'Part of speech'},
  { key: 'example_sentences', label: 'Examples'      },
  { key: 'usage_frequency',   label: 'Frequency'     },
];

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  cards: [],
  dueCards: [],
  stats: null,
  editCard: null,
  // study
  studySort: 'due',
  studySelected: new Set(),
  studyStarted: false,
  studyPageSize: 25,
  studyPage: 0,
  studyRandomCount: 10,
  studyQueue: [],
  studyIdx: 0,
  studyFlipped: false,
  studyDone: false,
  studyCorrect: 0,
  studyTotal: 0,
  studyAnimating: false,
  studyWrong: [],
  studyResults: {},
  // library
  libSort: 'az',
  libSearch: '',
  libFilterBox: new Set(),
  libFilterPos: new Set(),
  libFilterAcc: null,
  libFilterDue: false,
  libExpanded: null,
  confirmModal: null,
  importConflicts: null,
  libSelected: new Set(),
  libSelectMode: false,
  showImportHelp: false,
  libPageSize: 50,
  libPage: 0,
  // settings
  boxDays: [1, 3, 7, 14, 30],
  // practice
  practiceSort: 'az',
  practiceSelected: new Set(),
  practiceSearch: '',
  practiceFilterBox: null,
  practiceFilterPos: new Set(),
  practiceFilterAcc: null,
  practiceFilterDue: false,
  practicePageSize: 50,
  practiceRandomCount: 20,
  practicePage: 0,
  practiceResults: {},
  practiceMode: 'flip',
  practiceQueue: [],
  practiceIdx: 0,
  practiceFlipped: false,
  practiceDone: false,
  practiceCorrect: 0,
  practiceTotal: 0,
  practiceAnimating: false,
  practiceTyped: '',
  practiceTypedResult: null,
};

// ── API ─────────────────────────────────────────────────────────────────────
const api = {
  getAllCards:  ()            => invoke('get_all_cards'),
  addCard:      (card)       => invoke('add_card',      { card }),
  updateCard:   (id, card)   => invoke('update_card',   { id, card }),
  deleteCard:   (id)         => invoke('delete_card',   { id }),
  reviewCard:   (result)     => invoke('review_card',   { result }),
  keepInBox1:   (cardId)    => invoke('keep_in_box1',  { cardId }),
  resetCard:    (id)         => invoke('reset_card',    { id }),
  moveCard:     (id, box_number) => invoke('move_card', { id, boxNumber: box_number }),
  getSettings:  ()           => invoke('get_settings'),
  saveSettings: (box_days)   => invoke('save_settings', { boxDays: box_days }),
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) { if (v) el.addEventListener(k.slice(2).toLowerCase(), v); }
    else if (v === false || v == null) { /* skip — omitting the attribute is the correct "false" state */ }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function el(selector) { return document.querySelector(selector); }

function boxColor(n) { return getBoxes()[n - 1]?.color ?? '#c8a96e'; }

const POS_CLR  = { noun:'#5db8e8', verb:'#e8c85d', adjective:'#6dd68a', adverb:'#c8a96e', idiom:'#e85d5d' };
const FREQ_CLR = { 'very common':'#6dd68a', 'common':'#5db8e8', 'uncommon':'#e8c85d', 'rare':'#c8a96e', 'archaic':'#e85d5d' };

function posChips(pos) {
  return (pos || 'noun').split('/').map(p => {
    const t = p.trim();
    const clr = POS_CLR[t];
    const c = h('span', { class: `chip${clr ? ' chip-tag' : ''}` }, t);
    if (clr) c.style.setProperty('--tag-clr', clr);
    return c;
  });
}

function freqChip(freq) {
  if (!freq) return null;
  const clr = FREQ_CLR[freq];
  const c = h('span', { class: `chip${clr ? ' chip-tag' : ''}` }, freq);
  if (clr) c.style.setProperty('--tag-clr', clr);
  return c;
}

function boxChip(n) {
  const c = h('span', { class: 'chip chip-box' }, `Box ${n}`);
  c.style.setProperty('--box-clr', boxColor(n));
  return c;
}

function accChip(card) {
  if (!card.total_reviews) return null;
  const pct = Math.round((card.correct_reviews / card.total_reviews) * 100);
  return h('span', { class: 'chip chip-acc' }, `${pct}%`);
}

function accuracy(s) {
  if (!s || !s.total_reviews) return 0;
  return Math.round((s.correct_reviews / s.total_reviews) * 100);
}

function matchAccFilter(card, filter) {
  if (!filter) return true;
  if (filter === 'new')  return card.total_reviews === 0;
  if (card.total_reviews === 0) return false;
  const pct = (card.correct_reviews / card.total_reviews) * 100;
  if (filter === 'low')  return pct < 50;
  if (filter === 'mid')  return pct >= 50 && pct < 80;
  if (filter === 'high') return pct >= 80;
  return true;
}

// ── Refresh ──────────────────────────────────────────────────────────────────
function localNowString() {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function computeDerived() {
  const now = localNowString();
  state.dueCards = state.cards.filter(c => c.next_review <= now);
  const boxCounts = [0, 0, 0, 0, 0];
  let totalReviews = 0, correctReviews = 0;
  for (const c of state.cards) {
    if (c.box_number >= 1 && c.box_number <= 5) boxCounts[c.box_number - 1]++;
    totalReviews   += c.total_reviews   ?? 0;
    correctReviews += c.correct_reviews ?? 0;
  }
  state.stats = {
    total_cards:     state.cards.length,
    box_counts:      boxCounts,
    cards_due_today: state.dueCards.length,
    total_reviews:   totalReviews,
    correct_reviews: correctReviews,
  };
}

// Full refresh: used only at boot (needs settings too)
async function refresh() {
  const [cards, boxDays] = await Promise.all([api.getAllCards(), api.getSettings()]);
  state.cards   = cards;
  state.boxDays = boxDays;
  computeDerived();
}

// Card-only refresh: used after any card mutation (settings unchanged)
async function refreshCards() {
  state.cards = await api.getAllCards();
  computeDerived();
}

// ── Render dispatcher ─────────────────────────────────────────────────────────
function render() {
  // keep sidebar fresh (badges, stats) on every render
  const oldSidebar = el('.sidebar');
  if (oldSidebar) oldSidebar.replaceWith(buildSidebar());

  const main = el('.main');
  if (!main) return;
  main.innerHTML = '';

  switch (state.view) {
    case 'dashboard':       main.appendChild(renderDashboard());      break;
    case 'study':           main.appendChild(renderStudy());          break;
    case 'library':         main.appendChild(renderLibrary());        break;
    case 'add':
    case 'edit':            main.appendChild(renderForm());           break;
    case 'settings':        main.appendChild(renderSettings());       break;
    case 'practice-select': main.appendChild(renderPracticeSelect()); break;
    case 'practice':        main.appendChild(renderPractice());       break;
  }

  // global modals
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  [renderImportHelpModal(), renderConfirmModal(), renderImportConflictModal()]
    .filter(Boolean)
    .forEach(m => document.body.appendChild(m));
}

async function navigate(view) {
  state.view = view;
  render();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const s = state.stats;
  const due = state.dueCards.length;
  const acc = accuracy(s);

  const wrap = h('div', { class: 'dashboard' },
    // header
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Overview'),
        h('p',  { class: 'page-subtitle' }, 'Your learning at a glance'),
      ),
      h('div', { class: 'page-header-actions' },
        state.cards.length > 0
          ? h('button', { class: 'btn-ghost', onClick: () => { state.practiceSelected = new Set(); state.practiceSearch = ''; state.practiceFilterBox = null; state.practiceFilterPos = new Set(); navigate('practice-select'); } }, icon('record-circle'), ' Practice')
          : null,
        due > 0
          ? h('button', { class: 'btn-primary', onClick: () => { state.studyStarted = false; state.studySelected = new Set(); navigate('study'); } },
              icon('book'), ` Study ${due} card${due !== 1 ? 's' : ''} due`)
          : null,
      ),
    ),

    // stat cards
    h('div', { class: 'stats-row' },
      statCard(due,              'Due Today',    'c-red'),
      statCard(s?.total_cards ?? 0, 'Total Cards','c-gold'),
      statCard(`${acc}%`,        'Accuracy',     'c-green'),
      statCard(s?.total_reviews ?? 0, 'Reviews', 'c-blue'),
    ),

    // boxes
    h('div', { class: 'section' },
      h('h2', { class: 'section-title' }, 'The Five Boxes'),
      h('div', { class: 'boxes-grid' },
        ...getBoxes().map((b, i) => {
          const count = s?.box_counts[i] ?? 0;
          const pct   = s?.total_cards > 0 ? (count / s.total_cards) * 100 : 0;
          const card  = h('div', { class: 'box-card', style: { cursor: 'pointer' },
            onClick: () => { state.libFilterBox = new Set([b.box]); navigate('library'); },
          },
            h('div', { class: 'box-hdr' },
              h('span', { class: 'box-num-lbl' },      `Box ${b.box}`),
              h('span', { class: 'box-interval-lbl' }, b.label),
            ),
            h('div', { class: 'box-count' }, String(count)),
            h('div', { class: 'box-bar-bg' },
              h('div', { class: 'box-bar-fill', style: { width: `${Math.max(pct, count > 0 ? 4 : 0)}%` } }),
            ),
            h('div', { class: 'box-desc' }, BOX_DESCS[i]),
          );
          card.style.setProperty('--box-clr', b.color);
          return card;
        }),
      ),
    ),

    // recent
    renderRecent(),
  );

  return wrap;
}

function statCard(val, label, cls) {
  return h('div', { class: `stat-card ${cls}` },
    h('span', { class: 'stat-num'   }, String(val)),
    h('span', { class: 'stat-label' }, label),
  );
}

function renderRecent() {
  const recent = [...state.cards]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  const header = h('div', { class: 'section-header' },
    h('h2', { class: 'section-title' }, 'Recent Cards'),
    h('button', { class: 'btn-link', onClick: () => { state.editCard = null; navigate('add'); } }, '+ Add card'),
  );

  if (recent.length === 0) {
    return h('div', { class: 'section' },
      header,
      h('div', { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon('inbox')),
        h('p',   { class: 'empty-title' }, 'No cards yet'),
        h('p',   { class: 'empty-sub'   }, 'Add your first flashcard to get started'),
        h('button', { class: 'btn-primary', onClick: () => { state.editCard = null; navigate('add'); } }, 'Create first card'),
      ),
    );
  }

  return h('div', { class: 'section' },
    header,
    renderCardList(recent),
  );
}

// ── Study ─────────────────────────────────────────────────────────────────────
function initStudy(cards) {
  state.studyQueue = [
    ...cards.map(c => ({ ...c, reversed: false })),
    ...cards.map(c => ({ ...c, reversed: true  })),
  ].sort(() => Math.random() - 0.5);
  state.studyIdx       = 0;
  state.studyFlipped   = false;
  state.studyDone      = false;
  state.studyCorrect   = 0;
  state.studyTotal     = 0;
  state.studyAnimating = false;
  state.studyWrong     = [];
  state.studyResults   = {};
  state.studyStarted   = true;
}

function renderStudy() {
  if (!state.studyStarted)                               return renderStudySelect();
  if (state.studyDone)                                   return renderStudyDone();
  if (state.studyQueue.length === 0 && !state.studyDone) return renderStudyEmpty();
  return renderStudyCard();
}

function renderStudySelect() {
  const due        = applySort(state.dueCards, state.studySort);
  const selCount   = state.studySelected.size;
  const allSel     = due.length > 0 && due.every(c => state.studySelected.has(c.id));
  const pageSize   = state.studyPageSize === 0 ? due.length : state.studyPageSize;
  const totalPages = Math.max(1, Math.ceil(due.length / pageSize));
  if (state.studyPage >= totalPages) state.studyPage = totalPages - 1;
  const paged = due.slice(state.studyPage * pageSize, (state.studyPage + 1) * pageSize);

  function startStudy() {
    const cards = due.filter(c => state.studySelected.has(c.id));
    if (!cards.length) return;
    initStudy(cards);
    render();
  }

  return h('div', { class: 'practice-select' },
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Study'),
        h('p',  { class: 'page-subtitle' },
          selCount > 0
            ? `${selCount} card${selCount !== 1 ? 's' : ''} selected · ${due.length} due today`
            : `${due.length} card${due.length !== 1 ? 's' : ''} due today`),
      ),
      h('div', { class: 'study-toolbar' },
        h('div', { class: 'study-toolbar-row1' },
          h('button', { class: 'btn-ghost btn-sm', onClick: () => {
            if (allSel) due.forEach(c => state.studySelected.delete(c.id));
            else        due.forEach(c => state.studySelected.add(c.id));
            render();
          }}, allSel ? 'Deselect all' : 'Select all'),
          (() => {
            const pageSel = paged.length > 0 && paged.every(c => state.studySelected.has(c.id));
            const btn = h('button', { class: 'btn-ghost btn-sm' }, pageSel ? 'Deselect page' : 'Select page');
            btn.addEventListener('click', () => {
              if (pageSel) paged.forEach(c => state.studySelected.delete(c.id));
              else         paged.forEach(c => state.studySelected.add(c.id));
              render();
            });
            return btn;
          })(),
          h('button', {
            class: 'btn-primary btn-sm',
            disabled: selCount === 0,
            onClick: selCount > 0 ? startStudy : null,
          }, icon('book'), selCount > 0 ? ` Study (${selCount})` : ' Study'),
        ),
        h('div', { class: 'study-toolbar-row2' },
          h('div', { class: 'study-random-pick' },
            (() => {
              const inp = h('input', { type: 'number', class: 'study-random-input', min: '1', max: String(due.length), value: String(state.studyRandomCount) });
              inp.addEventListener('change', () => {
                const v = parseInt(inp.value, 10);
                if (!isNaN(v) && v > 0) state.studyRandomCount = v;
              });
              return inp;
            })(),
            (() => {
              const btn = h('button', { class: 'btn-ghost btn-sm' }, icon('shuffle'), ' Random');
              btn.addEventListener('click', () => {
                const n = Math.min(state.studyRandomCount, due.length);
                const shuffled = [...due].sort(() => Math.random() - 0.5).slice(0, n);
                state.studySelected = new Set(shuffled.map(c => c.id));
                render();
              });
              return btn;
            })(),
          ),
          h('div', { class: 'study-divider' }),
          h('span', { class: 'filter-label' }, 'Show'),
          h('div', { class: 'size-toggle' },
            ...[25, 50, 100, 0].map(n => {
              const b = h('button', { class: `size-btn${state.studyPageSize === n ? ' active' : ''}` }, n === 0 ? 'All' : String(n));
              b.addEventListener('click', () => { state.studyPageSize = n; state.studyPage = 0; render(); });
              return b;
            }),
          ),
          h('div', { class: 'study-divider' }),
          sortControl(state.studySort, v => { state.studySort = v; state.studyPage = 0; render(); }),
        ),
      ),
    ),

    due.length === 0
      ? h('div', { class: 'study-done' },
          h('div', { class: 'done-icon' }, icon('stars')),
          h('h2', {}, 'Nothing due right now'),
          h('p',  {}, 'All cards are scheduled for later. Check back soon!'),
          h('button', { class: 'btn-primary', onClick: () => navigate('dashboard') }, 'Back to Overview'),
        )
      : h('div', {},
          h('div', { class: 'card-list' },
            ...paged.map(card => {
              const checked = state.studySelected.has(card.id);
              return h('div', {
                class: `card-row${checked ? ' selected' : ''}`,
                onClick: () => {
                  if (checked) state.studySelected.delete(card.id);
                  else         state.studySelected.add(card.id);
                  render();
                },
              },
                h('div', { class: 'card-row-top' },
                  h('div', { class: `practice-check${checked ? ' checked' : ''}` }, checked ? icon('check-lg') : null),
                  h('div', { class: 'row-words' },
                    h('span', { class: 'row-l1' }, card.lang1),
                    h('span', { class: 'row-sep' }, icon('arrow-right')),
                    h('span', { class: 'row-l2' }, card.lang2),
                  ),
                  h('div', { class: 'row-chips' },
                    ...posChips(card.part_of_speech),
                    freqChip(card.usage_frequency),
                    boxChip(card.box_number),
                    accChip(card),
                  ),
                ),
              );
            }),
          ),
          totalPages > 1
            ? h('div', { class: 'pagination' },
                h('button', { class: 'btn-ghost', disabled: state.studyPage === 0,
                  onClick: () => { state.studyPage--; render(); } }, icon('arrow-left'), ' Prev'),
                h('span', { class: 'page-info' }, `Page ${state.studyPage + 1} of ${totalPages}`),
                h('button', { class: 'btn-ghost', disabled: state.studyPage >= totalPages - 1,
                  onClick: () => { state.studyPage++; render(); } }, 'Next ', icon('arrow-right')),
              )
            : null,
        ),
  );
}

function renderStudyEmpty() {
  return h('div', { class: 'study-done' },
    h('div', { class: 'done-icon' }, icon('stars')),
    h('h2', {}, 'Nothing due right now'),
    h('p',  {}, 'All cards are scheduled for later. Check back soon!'),
    h('button', { class: 'btn-primary', onClick: () => navigate('dashboard') }, 'Back to Overview'),
  );
}

function renderStudyDone() {
  const uniqueTotal  = getUniqueIds(state.studyQueue).length;
  const wrongCount   = state.studyWrong.length;
  const correctCount = uniqueTotal - wrongCount;
  const acc          = uniqueTotal > 0 ? Math.round((correctCount / uniqueTotal) * 100) : 0;

  return h('div', { class: 'study-done' },
    h('div', { class: 'done-icon' }, icon('stars')),
    h('h2', {}, 'Session Complete!'),
    h('div', { class: 'done-stats' },
      doneStatEl(uniqueTotal,   'Reviewed'),
      doneStatEl(correctCount,  'Correct'),
      doneStatEl(`${acc}%`,     'Accuracy'),
    ),
    h('div', { class: 'done-actions' },
      h('button', { class: 'btn-primary', onClick: () => navigate('dashboard') }, 'Back to Overview'),
      wrongCount > 0
        ? h('button', { class: 'btn-ghost', onClick: () => {
            const wc = state.studyWrong;
            state.studyQueue = [
              ...wc.map(c => ({ ...c, reversed: false })),
              ...wc.map(c => ({ ...c, reversed: true  })),
            ].sort(() => Math.random() - 0.5);
            state.studyResults   = {};
            state.studyIdx       = 0;
            state.studyFlipped   = false;
            state.studyDone      = false;
            state.studyCorrect   = 0;
            state.studyTotal     = 0;
            state.studyAnimating = false;
            state.studyWrong     = [];
            render();
          }}, `↺ Retest (${wrongCount})`)
        : null,
    ),
  );
}

function doneStatEl(val, lbl) {
  return h('div', { class: 'done-stat' },
    h('span', { class: 'done-stat-num' }, String(val)),
    h('span', { class: 'done-stat-lbl' }, lbl),
  );
}

function getUniqueIds(queue) {
  const seen = new Set();
  const ids = [];
  for (const item of queue) {
    if (!seen.has(item.id)) { seen.add(item.id); ids.push(item.id); }
  }
  return ids;
}

function cardStatus(id, results) {
  const r = results[id];
  if (!r) return 'pending';
  const fDone = r.forward !== null;
  const rDone = r.reverse !== null;
  if (!fDone && !rDone) return 'pending';
  if (fDone && rDone) return (r.forward && r.reverse) ? 'correct' : 'wrong';
  return (r.forward === false || r.reverse === false) ? 'wrong' : 'partial';
}

function buildStatusStrip(queue, results, currentId) {
  const ids = getUniqueIds(queue);
  return h('div', { class: 'status-strip' },
    ...ids.map(id => h('div', {
      class: `status-dot${id === currentId ? ' current' : ''} ${cardStatus(id, results)}`,
    })),
  );
}

function renderStudyCard() {
  const item        = state.studyQueue[state.studyIdx];
  const total       = state.studyQueue.length;
  const pct         = (state.studyIdx / total) * 100;
  const bInfo       = getBoxes()[item.box_number - 1];
  const uniqueIds   = getUniqueIds(state.studyQueue);
  const uniqueTotal = uniqueIds.length;
  const doneCount   = uniqueIds.filter(id => { const r = state.studyResults[id]; return r && r.forward !== null && r.reverse !== null; }).length;
  const correctCount = uniqueIds.filter(id => { const r = state.studyResults[id]; return r && r.forward === true && r.reverse === true; }).length;

  const wrap = h('div', { class: 'study-wrap' },
    // header
    h('div', { class: 'study-header' },
      h('button', { class: 'back-btn', onClick: () => navigate('dashboard') }, icon('arrow-left'), ' Exit'),
      h('div', { class: 'prog-wrap' },
        h('div', { class: 'prog-bar' }, h('div', { class: 'prog-fill', style: { width: `${pct}%` } })),
        h('span', { class: 'prog-txt' }, `${doneCount} / ${uniqueTotal}`),
      ),
      h('div', { class: 'session-score' },
        h('span', { class: 'score-ok'  }, String(correctCount)),
        h('span', { class: 'score-sep' }, '/'),
        h('span', { class: 'score-tot' }, String(uniqueTotal)),
      ),
    ),

    // direction badge
    h('div', { class: 'study-direction' },
      h('span', { class: `dir-badge${item.reversed ? ' dir-reverse' : ''}` },
        item.reversed ? h('span', {}, icon('arrow-return-left'), ' Recall the word') : h('span', {}, icon('arrow-right'), ' Recall the translation'),
      ),
    ),

    // status strip
    buildStatusStrip(state.studyQueue, state.studyResults, item.id),

    // card stage
    h('div', { class: 'card-stage' },
      buildFlashcard(item, bInfo),
      buildAnswerSection(item),
      !state.studyFlipped
        ? h('p', { class: 'flip-prompt' }, 'Click the card to see the answer')
        : h('span', {}),
    ),

    // navigation
    h('div', { class: 'study-nav' },
      h('button', {
        class: `nav-btn${state.studyIdx === 0 ? ' disabled' : ''}`,
        onClick: () => {
          if (!state.studyAnimating && state.studyIdx > 0) {
            state.studyIdx--;
            state.studyFlipped = false;
            render();
          }
        },
      }, icon('arrow-left'), ' Back'),
      (() => {
        const btn = h('button', { class: 'nav-btn keep-box1-btn' }, icon('pin-angle'), ' Keep in Box 1');
        btn.addEventListener('click', async () => {
          if (state.studyAnimating) return;
          state.studyAnimating = true;
          const id = item.id;
          const updated = await api.keepInBox1(id);
          // replace card in state.cards
          const ci = state.cards.findIndex(c => c.id === id);
          if (ci !== -1) state.cards[ci] = updated;
          computeDerived();
          // remove all queue entries for this card, adjusting idx
          const before = state.studyQueue.slice(0, state.studyIdx).filter(c => c.id !== id).length;
          state.studyQueue = state.studyQueue.filter(c => c.id !== id);
          state.studyIdx = Math.min(before, state.studyQueue.length - 1);
          if (state.studyQueue.length === 0) {
            await batchApplyResults();
            state.studyDone = true;
          }
          state.studyFlipped  = false;
          state.studyAnimating = false;
          render();
        });
        return btn;
      })(),
      h('button', {
        class: `nav-btn${state.studyIdx >= total - 1 ? ' disabled' : ''}`,
        onClick: () => {
          if (!state.studyAnimating && state.studyIdx < total - 1) {
            state.studyIdx++;
            state.studyFlipped = false;
            render();
          }
        },
      }, 'Next ', icon('arrow-right')),
    ),

    // meta bar
    (() => {
      const cardAcc = item.total_reviews > 0
        ? Math.round((item.correct_reviews / item.total_reviews) * 100) : 0;
      return h('div', { class: 'card-meta-bar' },
        `Reviews: ${item.total_reviews}`,
        h('span', {}, ' · '),
        `Accuracy: ${cardAcc}%`,
      );
    })(),
  );

  return wrap;
}

function buildFlashcard(card, bInfo) {
  const tag = h('div', { class: 'card-box-tag' }, `Box ${card.box_number} · ${bInfo.label}`);
  tag.style.setProperty('--box-clr', bInfo.color);

  const reversed   = card.reversed;
  const frontWord  = reversed ? card.lang2 : card.lang1;
  const backWord   = reversed ? card.lang1 : card.lang2;

  const posLine = () => h('div', { class: 'card-pos' }, card.part_of_speech.split('/').map(p => p.trim()).join(' · '));

  const front = h('div', { class: 'card-face card-front' },
    tag.cloneNode(true),
    h('div', { class: 'card-word' }, frontWord),
    posLine(),
    card.usage_frequency
      ? h('div', { class: 'card-freq' }, h('span', { class: 'freq-dot' }), card.usage_frequency)
      : null,
    reversed && card.description_lang1
      ? h('div', { class: 'card-section', style: { marginTop: '12px' } },
          h('span', { class: 'card-sec-label' }, 'Hint'),
          h('p',    { class: 'card-sec-body'  }, card.description_lang1),
        )
      : null,
    h('div', { class: 'card-hint' }, 'tap to reveal →'),
  );

  const backChildren = [
    tag.cloneNode(true),
    h('div', { class: reversed ? 'card-word' : 'card-translation' }, backWord),
    posLine(),
  ];

  if (card.description_lang1) {
    backChildren.push(
      h('hr', { class: 'card-divider' }),
      h('div', { class: 'card-section' },
        h('span', { class: 'card-sec-label' }, 'Definition'),
        h('p',    { class: 'card-sec-body'  }, card.description_lang1),
      ),
    );
  }

  const exLines = card.example_sentences.split('\n').filter(Boolean);
  if (exLines.length) {
    backChildren.push(
      h('hr', { class: 'card-divider' }),
      h('div', { class: 'card-section' },
        h('span', { class: 'card-sec-label' }, 'Examples'),
        h('div', { class: 'examples-list' },
          ...exLines.map(ex => h('p', { class: 'example-item' }, `"${ex}"`)),
        ),
      ),
    );
  }

  const back  = h('div', { class: 'card-face card-back' }, ...backChildren.filter(Boolean));
  const inner = h('div', { class: 'card-inner' }, front, back);
  const fc    = h('div', {
    class: `flashcard${state.studyFlipped ? ' flipped' : ''}`,
    onClick: () => {
      if (!state.studyAnimating) {
        state.studyFlipped = !state.studyFlipped;
        render();
      }
    },
  }, inner);

  return fc;
}

function buildAnswerSection(_card) {
  if (!state.studyFlipped) return h('span', {});

  return h('div', { class: 'answer-btns' },
    h('button', { class: 'answer-btn wrong', onClick: () => doReview(false) },
      h('span', { class: 'answer-icon' }, icon('x-lg')),
      h('span', {}, 'Again'),
    ),
    h('button', { class: 'answer-btn correct', onClick: () => doReview(true) },
      h('span', { class: 'answer-icon' }, icon('check-lg')),
      h('span', {}, 'Got it'),
    ),
  );
}

async function doReview(correct) {
  if (state.studyAnimating) return;
  state.studyAnimating = true;

  const item = state.studyQueue[state.studyIdx];

  // trigger exit animation
  const fc = el('.flashcard');
  if (fc) fc.classList.add('exit');

  // record result (no API call yet)
  if (!state.studyResults[item.id]) state.studyResults[item.id] = { forward: null, reverse: null };
  if (item.reversed) state.studyResults[item.id].reverse = correct;
  else               state.studyResults[item.id].forward = correct;

  state.studyTotal += 1;
  if (correct) state.studyCorrect += 1;

  await new Promise(r => setTimeout(r, 300));

  const nextIdx = state.studyIdx + 1;
  if (nextIdx >= state.studyQueue.length) {
    await batchApplyResults();
    state.studyDone = true;
  } else {
    state.studyIdx     = nextIdx;
    state.studyFlipped = false;
  }

  state.studyAnimating = false;
  render();
}

async function batchApplyResults() {
  const seen  = new Set();
  const wrong = [];
  for (const item of state.studyQueue) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const r = state.studyResults[item.id] || {};
    const bothCorrect = r.forward === true && r.reverse === true;
    await api.reviewCard({ card_id: item.id, correct: bothCorrect });
    if (!bothCorrect) {
      const orig = state.cards.find(c => c.id === item.id) || item;
      wrong.push(orig);
    }
  }
  state.studyWrong = wrong;
  await refreshCards();
}

// ── Library ────────────────────────────────────────────────────────────────────
const SORT_OPTS = [
  { key: 'az',    label: 'A→Z'    },
  { key: 'za',    label: 'Z→A'    },
  { key: 'box_asc',  label: 'Box ↑'  },
  { key: 'box_desc', label: 'Box ↓'  },
  { key: 'due',   label: 'Due'    },
  { key: 'acc_asc',  label: 'Acc ↑'  },
  { key: 'acc_desc', label: 'Acc ↓'  },
];

function applySort(cards, sortKey) {
  const acc = c => c.total_reviews > 0 ? c.correct_reviews / c.total_reviews : -1;
  return [...cards].sort((a, b) => {
    switch (sortKey) {
      case 'za':       return b.lang1.localeCompare(a.lang1);
      case 'box_asc':  return a.box_number - b.box_number;
      case 'box_desc': return b.box_number - a.box_number;
      case 'due':      return a.next_review.localeCompare(b.next_review);
      case 'acc_asc':  return acc(a) - acc(b);
      case 'acc_desc': return acc(b) - acc(a);
      default:         return a.lang1.localeCompare(b.lang1); // az
    }
  });
}

function sortControl(sortKey, onChange) {
  const sel = h('select', { class: 'sort-select' });
  SORT_OPTS.forEach(({ key, label }) => {
    const opt = h('option', { value: key }, label);
    if (key === sortKey) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'sort-control' },
    h('span', { class: 'filter-label' }, 'Sort'),
    sel,
  );
}

function getFiltered() {
  const dueSet = state.libFilterDue ? new Set(state.dueCards.map(c => c.id)) : null;
  const filtered = state.cards.filter(c => {
    const q = state.libSearch.toLowerCase();
    const matchSearch = !q
      || c.lang1.toLowerCase().includes(q)
      || c.lang2.toLowerCase().includes(q)
      || c.description_lang1.toLowerCase().includes(q);
    const matchBox = state.libFilterBox.size === 0 || state.libFilterBox.has(c.box_number);
    const cardPos  = c.part_of_speech.split('/').map(p => p.trim());
    const matchPos = state.libFilterPos.size === 0 || cardPos.some(p => state.libFilterPos.has(p));
    const matchAcc = matchAccFilter(c, state.libFilterAcc);
    const matchDue = !dueSet || dueSet.has(c.id);
    return matchSearch && matchBox && matchPos && matchAcc && matchDue;
  });
  return applySort(filtered, state.libSort);
}

function renderLibrary() {
  const filtered = getFiltered();
  const sel = state.libSelectMode;
  const selCount = state.libSelected.size;

  // pagination
  const pageSize = state.libPageSize === 0 ? filtered.length : state.libPageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (state.libPage >= totalPages) state.libPage = totalPages - 1;
  const paged = filtered.slice(state.libPage * pageSize, (state.libPage + 1) * pageSize);

  function resetPage() { state.libPage = 0; }

  return h('div', { class: 'library' },
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title'    }, 'Library'),
        h('p',  { class: 'page-subtitle' }, `${state.cards.length} cards · ${filtered.length} shown`),
      ),
      h('div', { class: 'page-header-actions' },
        h('button', { class: `btn-select${sel ? ' active' : ''}`, onClick: () => {
          state.libSelectMode = !sel;
          state.libSelected.clear();
          render();
        }},
          h('span', { class: 'select-icon' }, sel ? icon('x-lg') : icon('square')),
          sel ? 'Cancel' : 'Select',
        ),
        filtered.length > 0
          ? h('div', { class: 'split-btn' },
              h('button', { class: 'split-btn-main', onClick: () => exportCSV(filtered) },
                icon('upload'),
                state.libFilterBox.size === 1 ? ` Export Box ${[...state.libFilterBox][0]}` : ' Export CSV'),
            )
          : null,
        h('div', { class: 'split-btn' },
          h('button', { class: 'split-btn-main csv-import-btn', onClick: triggerImport }, icon('download'), ' Import CSV'),
          h('button', { class: 'split-btn-help', onClick: () => { state.showImportHelp = true; render(); }, title: 'CSV format help' }, '?'),
        ),
        h('button', { class: 'btn-primary btn-sm', onClick: () => { state.editCard = null; navigate('add'); } }, '+ New Card'),
      ),
    ),

    // filters
    h('div', { class: 'filters-bar' },
      h('div', { class: 'search-wrap' },
        h('span', { class: 'search-icon' }, '⌕'),
        (() => {
          const inp = h('input', { class: 'search-input', type: 'text', placeholder: 'Search cards…', value: state.libSearch });
          inp.addEventListener('input', e => {
            const pos = e.target.selectionStart;
            state.libSearch = e.target.value;
            resetPage();
            render();
            const ni = el('.search-input');
            if (ni) { ni.focus(); ni.setSelectionRange(pos, pos); }
          });
          return inp;
        })(),
        state.libSearch
          ? h('button', { class: 'search-clear', onClick: () => { state.libSearch = ''; resetPage(); render(); } }, icon('x'))
          : null,
      ),
      // row 1: box filter + due today
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'Box'),
        h('div', { class: 'filter-group' },
          (() => {
            const b = h('button', { class: `filter-chip${state.libFilterBox.size === 0 ? ' active' : ''}` }, 'All');
            b.addEventListener('click', () => { state.libFilterBox.clear(); resetPage(); render(); });
            return b;
          })(),
          ...getBoxes().map(box => {
            const active = state.libFilterBox.has(box.box);
            const b = h('button', { class: `filter-chip${active ? ' active' : ''}` }, `Box ${box.box}`);
            if (active) b.style.setProperty('--box-clr', box.color);
            b.addEventListener('click', () => {
              if (state.libFilterBox.has(box.box)) state.libFilterBox.delete(box.box);
              else state.libFilterBox.add(box.box);
              resetPage(); render();
            });
            return b;
          }),
        ),
        (() => {
          const b = h('button', { class: `filter-chip${state.libFilterDue ? ' active due-chip' : ''}` }, icon('clock'), ' Due Today');
          b.addEventListener('click', () => { state.libFilterDue = !state.libFilterDue; resetPage(); render(); });
          return b;
        })(),
      ),
      // row 2: POS chips + page-size control
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'POS'),
        h('div', { class: 'filter-group' },
          (() => {
            const b = h('button', { class: `filter-chip${state.libFilterPos.size === 0 ? ' active' : ''}` }, 'All');
            b.addEventListener('click', () => { state.libFilterPos.clear(); resetPage(); render(); });
            return b;
          })(),
          ...PARTS_OF_SPEECH.map(pos => {
            const label = { noun: 'Noun', verb: 'Verb', adjective: 'Adj', adverb: 'Adv', idiom: 'Idiom' }[pos];
            const active = state.libFilterPos.has(pos);
            const b = h('button', { class: `filter-chip${active ? ' active' : ''}` }, label);
            b.addEventListener('click', () => {
              if (state.libFilterPos.has(pos)) state.libFilterPos.delete(pos);
              else state.libFilterPos.add(pos);
              resetPage(); render();
            });
            return b;
          }),
        ),
        h('div', { class: 'size-control' },
          h('span', { class: 'filter-label' }, 'Show'),
          h('div', { class: 'size-toggle' },
            ...[25, 50, 100, 0].map(n => {
              const b = h('button', { class: `size-btn${state.libPageSize === n ? ' active' : ''}` }, n === 0 ? 'All' : String(n));
              b.addEventListener('click', () => { state.libPageSize = n; resetPage(); render(); });
              return b;
            }),
          ),
        ),
      ),
      // row 3: accuracy filter + due today
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'Accuracy'),
        h('div', { class: 'filter-group' },
          ...[
            { key: null,   label: 'All'    },
            { key: 'new',  label: 'New'    },
            { key: 'low',  label: '< 50%'  },
            { key: 'mid',  label: '50–80%' },
            { key: 'high', label: '≥ 80%'  },
          ].map(({ key, label }) => {
            const b = h('button', { class: `filter-chip${state.libFilterAcc === key ? ' active' : ''}` }, label);
            b.addEventListener('click', () => { state.libFilterAcc = key; resetPage(); render(); });
            return b;
          }),
        ),
        sortControl(state.libSort, v => { state.libSort = v; resetPage(); render(); }),
      ),
    ),

    // batch action bar
    state.libSelectMode
      ? h('div', { class: 'batch-bar' },
          // left: count + selection controls
          h('span', { class: 'batch-count' },
            selCount > 0 ? `${selCount} selected` : 'None selected',
          ),
          h('span', { class: 'batch-div' }),
          h('div', { class: 'batch-sel-group' },
            h('button', { class: 'btn-ghost btn-sm', onClick: () => {
              paged.forEach(c => state.libSelected.add(c.id)); render();
            }}, 'Select page'),
            h('button', { class: 'btn-ghost btn-sm', onClick: () => {
              filtered.forEach(c => state.libSelected.add(c.id)); render();
            }}, 'Select all'),
            selCount > 0
              ? h('button', { class: 'btn-ghost btn-sm', onClick: () => { state.libSelected.clear(); render(); }}, 'Deselect all')
              : null,
          ),
          // right: actions
          selCount > 0
            ? h('div', { class: 'batch-actions' },
                h('div', { class: 'batch-move' },
                    h('span', { class: 'batch-move-label' }, 'Move to'),
                    h('div', { class: 'batch-move-boxes' },
                      ...getBoxes().map(box => {
                        const b = h('button', { class: 'batch-box-btn' }, String(box.box));
                        b.style.setProperty('--box-clr', box.color);
                        b.addEventListener('click', async () => {
                          const ids = [...state.libSelected];
                          await Promise.all(ids.map(id => api.moveCard(id, box.box)));
                          state.libSelected.clear();
                          await refreshCards(); render();
                        });
                        return b;
                      }),
                    ),
                  ),
                h('button', { class: 'batch-delete-btn', onClick: () => {
                  showConfirm(
                    `Delete ${selCount} card${selCount !== 1 ? 's' : ''}?`,
                    'This action cannot be undone.',
                    'Yes, delete',
                    async () => {
                      const ids = [...state.libSelected];
                      await Promise.all(ids.map(id => api.deleteCard(id)));
                      state.libSelected.clear();
                      await refreshCards(); render();
                    }
                  );
                }}, icon('trash'), ` Delete (${selCount})`),
              )
            : null,
        )
      : null,

    filtered.length === 0
      ? renderLibraryEmpty()
      : h('div', {},
          renderCardList(paged),
          totalPages > 1
            ? h('div', { class: 'pagination' },
                h('button', { class: 'btn-ghost', disabled: state.libPage === 0,
                  onClick: () => { state.libPage--; render(); } }, icon('arrow-left'), ' Prev'),
                h('span', { class: 'page-info' }, `Page ${state.libPage + 1} of ${totalPages}`),
                h('button', { class: 'btn-ghost', disabled: state.libPage >= totalPages - 1,
                  onClick: () => { state.libPage++; render(); } }, 'Next ', icon('arrow-right')),
              )
            : null,
        ),
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function showConfirm(title, detail, confirmLabel, onConfirm) {
  state.confirmModal = { title, detail, confirmLabel, onConfirm };
  render();
}

function renderConfirmModal() {
  if (!state.confirmModal) return null;
  const { title, detail, confirmLabel, onConfirm } = state.confirmModal;
  function close() { state.confirmModal = null; render(); }
  return h('div', { class: 'modal-overlay', onClick: close },
    h('div', { class: 'modal confirm-modal', onClick: e => e.stopPropagation() },
      h('div', { class: 'modal-header' },
        h('h2', { class: 'modal-title' }, title),
        h('button', { class: 'modal-close', onClick: close }, icon('x')),
      ),
      h('div', { class: 'modal-body' },
        h('p', { class: 'confirm-detail' }, detail),
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn-ghost', onClick: close }, 'Cancel'),
          h('button', { class: 'btn-danger', onClick: async () => { close(); await onConfirm(); } }, confirmLabel),
        ),
      ),
    ),
  );
}

// ── Import Conflict Modal ──────────────────────────────────────────────────────
function conflictRender() {
  // Re-render while preserving the modal body scroll position
  const body = document.querySelector('.conflict-modal .modal-body');
  const top  = body ? body.scrollTop : 0;
  render();
  const newBody = document.querySelector('.conflict-modal .modal-body');
  if (newBody) newBody.scrollTop = top;
}

function renderImportConflictModal() {
  if (!state.importConflicts) return null;
  const { newCards, conflicts } = state.importConflicts;
  function close() { state.importConflicts = null; render(); }

  async function applyImport() {
    const conf = state.importConflicts;
    state.importConflicts = null;
    let imported = 0, skipped = 0;
    for (const card of conf.newCards) {
      try { await api.addCard(card); imported++; } catch { skipped++; }
    }
    for (const conflict of conf.conflicts) {
      const hasChange = CONFLICT_FIELDS.some(f => {
        const ev = (conflict.existing[f.key] ?? '').trim();
        const iv = (conflict.incoming[f.key] ?? '').trim();
        const c  = conflict.fieldChoices[f.key];
        return ev !== iv && (c === 'incoming' || c === 'combine');
      });
      if (!hasChange) continue;
      const merged = { lang1: conflict.existing.lang1 };
      for (const f of CONFLICT_FIELDS) {
        const ev = (conflict.existing[f.key] ?? '').trim();
        const iv = (conflict.incoming[f.key] ?? '').trim();
        const c  = conflict.fieldChoices[f.key];
        merged[f.key] = c === 'incoming' ? iv
                       : c === 'combine'  ? [ev, iv].filter(Boolean).join(', ')
                       : ev;
      }
      try { await api.updateCard(conflict.existing.id, merged); imported++; } catch { skipped++; }
    }
    await refreshCards();
    showToast(
      imported > 0
        ? `Imported ${imported} card${imported !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`
        : 'No cards imported',
      imported > 0 ? 'success' : 'error'
    );
    render();
  }

  return h('div', { class: 'modal-overlay' },
    h('div', { class: 'modal conflict-modal', onClick: e => e.stopPropagation() },
      h('div', { class: 'modal-header' },
        h('h2', { class: 'modal-title' }, icon('exclamation-triangle'), ` ${conflicts.length} Duplicate Word${conflicts.length !== 1 ? 's' : ''} Found`),
        h('button', { class: 'modal-close', onClick: close }, icon('x')),
      ),
      h('div', { class: 'modal-body' },
        h('p', { class: 'conflict-note' },
          `${newCards.length} new card${newCards.length !== 1 ? 's' : ''} will be imported. ` +
          `Click a cell to choose which value to keep, or combine both with a comma:`
        ),
        h('div', { class: 'conflict-list' },
          ...conflicts.map((conflict, i) => {
            const { existing, incoming, fieldChoices } = conflict;

            function setAll(source) {
              CONFLICT_FIELDS.forEach(f => { state.importConflicts.conflicts[i].fieldChoices[f.key] = source; });
              conflictRender();
            }

            function pick(fKey, source) {
              state.importConflicts.conflicts[i].fieldChoices[fKey] = source;
              conflictRender();
            }

            // Only show fields that actually differ
            const diffFields = CONFLICT_FIELDS.filter(f =>
              (existing[f.key] ?? '').trim() !== (incoming[f.key] ?? '').trim()
            );

            return h('div', { class: 'conflict-item' },
              // ── Header ──
              h('div', { class: 'conflict-item-header' },
                h('span', { class: 'conflict-word-title' }, icon('card-text'), ` ${existing.lang1}`),
                h('div', { class: 'conflict-quick' },
                  h('button', { class: 'conflict-quick-btn', onClick: () => setAll('existing') }, 'Keep all existing'),
                  h('button', { class: 'conflict-quick-btn', onClick: () => setAll('incoming') }, 'Use all imported'),
                  h('button', { class: 'conflict-quick-btn', onClick: () => setAll('combine')  }, 'Combine all'),
                ),
              ),
              diffFields.length === 0
                ? h('div', { class: 'conflict-no-diff' }, icon('check-circle'), ' All fields are identical — no changes needed.')
                : h('div', {},
                    // ── Column headers ──
                    h('div', { class: 'conflict-grid-header' },
                      h('div', { class: 'conflict-grid-label' }),
                      h('div', { class: 'conflict-col-head' }, icon('archive'),           ' Existing'),
                      h('div', { class: 'conflict-col-head' }, icon('box-arrow-in-down'), ' Imported'),
                      h('div', { class: 'conflict-col-head' }, icon('intersect'),         ' Combined'),
                    ),
                    // ── Field rows (differing fields only) ──
                    h('div', { class: 'conflict-fields' },
                      ...diffFields.map(f => {
                        const ev     = (existing[f.key] ?? '').trim();
                        const iv     = (incoming[f.key] ?? '').trim();
                        const comb   = [ev, iv].filter(Boolean).join(', ');
                        const chosen = fieldChoices[f.key];

                        const cell = (val, source, extra) => h('div', {
                          class: `conflict-val${chosen === source ? ' chosen' : ''}${extra ? ` ${extra}` : ''}`,
                          onClick: () => pick(f.key, source),
                        },
                          h('span', { class: `conflict-val-text${!val ? ' conflict-empty' : ''}` }, val || '—'),
                          chosen === source ? h('span', { class: 'conflict-check' }, icon('check-lg')) : null,
                        );

                        return h('div', { class: 'conflict-field-row' },
                          h('div', { class: 'conflict-grid-label' }, f.label),
                          cell(ev,   'existing'),
                          cell(iv,   'incoming'),
                          cell(comb, 'combine',  'conflict-val-combine'),
                        );
                      }),
                    ),
                  ),
            );
          }),
        ),
      ),
      h('div', { class: 'modal-footer' },
        h('button', { class: 'btn-ghost', onClick: close }, 'Cancel'),
        h('button', { class: 'btn-primary', onClick: applyImport }, 'Apply'),
      ),
    ),
  );
}

function renderImportHelpModal() {
  if (!state.showImportHelp) return null;
  function close() { state.showImportHelp = false; render(); }

  const COLS = [
    {
      name: 'lang1',
      req: true,
      desc: 'The word or phrase in Language 1 (the language you are learning from).',
      values: 'Any text.',
    },
    {
      name: 'lang2',
      req: true,
      desc: 'The word or phrase in Language 2 (the target language).',
      values: 'Any text.',
    },
    {
      name: 'description_lang1',
      req: false,
      desc: 'A definition or explanation written in Language 1.',
      values: 'Any text.',
    },
    {
      name: 'part_of_speech',
      req: false,
      desc: 'Grammatical category. Multiple values separated by /.',
      values: 'noun (n) · verb (v) · adjective (adj) · adverb (adv) · idiom (id)',
    },
    {
      name: 'example_sentences',
      req: false,
      desc: 'One or more example sentences.',
      values: 'Any text; use line breaks to separate multiple sentences.',
    },
    {
      name: 'usage_frequency',
      req: false,
      desc: 'How common the word is in everyday use.',
      values: 'archaic (1) · rare (2) · uncommon (3) · common (4) · very common (5)',
    },
    {
      name: 'box_number',
      req: false,
      desc: 'Starting Leitner box. Defaults to Box 1 if omitted.',
      values: '1 · 2 · 3 · 4 · 5',
    },
  ];

  return h('div', { class: 'modal-overlay', onClick: close },
    h('div', { class: 'modal import-help-modal', onClick: e => e.stopPropagation() },
      h('div', { class: 'modal-header' },
        h('h2', { class: 'modal-title' }, 'CSV Import Format'),
        h('button', { class: 'modal-close', onClick: close }, icon('x')),
      ),
      h('div', { class: 'modal-body' },
        h('p', { class: 'help-note' },
          'The first row is treated as a header when it contains recognised column names (case-insensitive, any order). ' +
          'Without a header, columns must appear in the order listed below — except ',
          h('code', {}, 'box_number'),
          ', which requires a named header.',
        ),
        h('table', { class: 'help-table' },
          h('thead', {},
            h('tr', {},
              h('th', {}, 'Column'),
              h('th', {}, 'Required'),
              h('th', {}, 'Description'),
              h('th', {}, 'Accepted values'),
            ),
          ),
          h('tbody', {},
            ...COLS.map(col =>
              h('tr', {},
                h('td', {}, h('code', {}, col.name)),
                h('td', { class: col.req ? 'req-yes' : 'req-no' }, col.req ? '✓' : '—'),
                h('td', {}, col.desc),
                h('td', { class: 'help-values' }, col.values),
              ),
            ),
          ),
        ),
        h('p', { class: 'help-note help-note-sm' },
          'Tip: export your existing cards to see a ready-made example of the format.',
        ),
      ),
    ),
  );
}

function renderLibraryEmpty() {
  const noCards = state.cards.length === 0;
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon('inbox')),
    h('p', { class: 'empty-title' }, noCards ? 'No cards yet' : 'No matches'),
    h('p', { class: 'empty-sub'   }, noCards ? 'Add your first flashcard to get started' : 'Try adjusting your search or filters'),
    noCards
      ? h('button', { class: 'btn-primary', onClick: () => { state.editCard = null; navigate('add'); } }, 'Create first card')
      : null,
  );
}

function renderCardList(cards) {
  return h('div', { class: 'card-list' },
    ...cards.map(card => {
      const isOpen    = state.libExpanded === card.id;
      const isChecked = state.libSelected.has(card.id);
      const sel       = state.libSelectMode;

      const row = h('div', { class: `card-row${isOpen ? ' open' : ''}${isChecked ? ' selected' : ''}` },
        h('div', { class: 'card-row-top', onClick: () => {
          if (sel) {
            if (isChecked) state.libSelected.delete(card.id);
            else           state.libSelected.add(card.id);
          } else {
            state.libExpanded = isOpen ? null : card.id;
          }
          render();
        }},
          sel ? h('div', { class: `practice-check${isChecked ? ' checked' : ''}` }, isChecked ? icon('check-lg') : null) : null,
          h('div', { class: 'row-words' },
            h('span', { class: 'row-l1'  }, card.lang1),
            h('span', { class: 'row-sep' }, icon('arrow-right')),
            h('span', { class: 'row-l2'  }, card.lang2),
          ),
          h('div', { class: 'row-chips' },
            ...posChips(card.part_of_speech),
            freqChip(card.usage_frequency),
            boxChip(card.box_number),
            accChip(card),
          ),
          h('span', { class: 'row-arrow' }, isOpen ? '▲' : '▼'),
        ),
        isOpen ? renderCardDetail(card) : null,
      );
      return row;
    }),
  );
}

function renderCardDetail(card) {
  const sections = [];

  if (card.description_lang1) sections.push(
    h('div', { class: 'detail-sec' },
      h('span', { class: 'detail-lbl'  }, 'Definition'),
      h('p',    { class: 'detail-body' }, card.description_lang1),
    ),
  );

  const exLines = card.example_sentences.split('\n').filter(Boolean);
  if (exLines.length) sections.push(
    h('div', { class: 'detail-sec' },
      h('span', { class: 'detail-lbl' }, 'Examples'),
      ...exLines.map(ex => h('p', { class: 'detail-ex' }, `"${ex}"`)),
    ),
  );

  const nextDate = new Date(card.next_review).toLocaleDateString();

  return h('div', { class: 'card-detail' },
    ...sections,
    h('div', { class: 'detail-meta' },
      `Reviews: ${card.total_reviews} `,
      `Correct: ${card.correct_reviews} `,
      `Next review: ${nextDate} `,
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'action-btn edit', onClick: () => {
        state.editCard = card;
        navigate('edit');
      }}, icon('pencil'), ' Edit'),
      h('button', { class: 'action-btn reset-btn', onClick: async () => {
        await api.resetCard(card.id);
        await refreshCards();
        render();
      }}, '↺ Reset to Box 1'),
      h('button', { class: 'action-btn delete-btn', onClick: () => {
        showConfirm(
          'Delete card?',
          `"${card.lang1}" will be permanently removed.`,
          'Delete',
          async () => {
            await api.deleteCard(card.id);
            state.libExpanded = null;
            await refreshCards();
            render();
          }
        );
      }}, icon('trash'), ' Delete'),
    ),
  );
}

// ── Form ────────────────────────────────────────────────────────────────────────
function renderForm() {
  const isEdit = state.view === 'edit' && state.editCard;
  const form = isEdit ? { ...state.editCard } : {
    lang1: '', lang2: '', description_lang1: '',
    part_of_speech: 'noun', example_sentences: '', usage_frequency: 'common',
  };

  const errors = {};

  function fieldInput(key, placeholder, autofocus = false) {
    const wrapper = h('div', { class: 'field', id: `field-${key}` },
      h('label', { class: 'field-label' },
        key === 'lang1' ? h('span', {}, 'Language 1', h('span', { class: 'req' }, ' *')) :
        key === 'lang2' ? h('span', {}, 'Language 2', h('span', { class: 'req' }, ' *')) :
        h('span', {}, ({
          description_lang1: 'Definition (Language 1)',
          example_sentences: 'Example Sentences (one per line)',
        })[key] || key),
      ),
    );

    const isArea = ['description_lang1','example_sentences'].includes(key);
    const inputEl = isArea
      ? h('textarea', {
          class: 'field-input field-textarea',
          placeholder,
          rows: key === 'example_sentences' ? '4' : '3',
        })
      : h('input', { class: 'field-input', type: 'text', placeholder });

    inputEl.value = form[key] ?? '';
    if (autofocus && !isEdit) setTimeout(() => inputEl.focus(), 50);
    inputEl.addEventListener('input', e => { form[key] = e.target.value; });
    wrapper.appendChild(inputEl);

    const errEl = h('span', { class: 'field-err', style: { display: 'none' } });
    wrapper.appendChild(errEl);
    return wrapper;
  }

  function selectField(key, options, label) {
    const sel = h('select', { class: 'field-input' },
      ...options.map(o => {
        const opt = h('option', { value: o }, o);
        if (o === form[key]) opt.setAttribute('selected', 'selected');
        return opt;
      }),
    );
    sel.value = form[key];
    sel.addEventListener('change', e => { form[key] = e.target.value; });
    return h('div', { class: 'field' },
      h('label', { class: 'field-label' }, label),
      sel,
    );
  }

  async function handleSubmit() {
    // validate
    let valid = true;
    ['lang1','lang2'].forEach(k => {
      const wrapper = el(`#field-${k}`);
      const errEl   = wrapper?.querySelector('.field-err');
      if (!form[k]?.trim()) {
        wrapper?.classList.add('error');
        if (errEl) { errEl.textContent = 'Required'; errEl.style.display = ''; }
        valid = false;
      } else {
        wrapper?.classList.remove('error');
        if (errEl) errEl.style.display = 'none';
      }
    });
    if (!valid) return;

    const btn = el('#submit-btn');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    const payload = {
      lang1:             form.lang1.trim(),
      lang2:             form.lang2.trim(),
      description_lang1: form.description_lang1?.trim() ?? '',
      part_of_speech:    form.part_of_speech    ?? 'noun',
      example_sentences: form.example_sentences?.trim() ?? '',
      usage_frequency:   form.usage_frequency   ?? 'common',
    };

    try {
      if (isEdit) {
        await api.updateCard(state.editCard.id, payload);
      } else {
        await api.addCard(payload);
      }
      await refreshCards();
      state.editCard = null;
      navigate('library');
    } catch (err) {
      console.error(err);
      if (btn) { btn.textContent = isEdit ? 'Save Changes' : 'Add Card'; btn.disabled = false; }
    }
  }

  return h('div', { class: 'card-form-page' },
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title'    }, isEdit ? 'Edit Card' : 'New Card'),
        h('p',  { class: 'page-subtitle' }, isEdit ? 'Update this flashcard' : 'Add a new word to your deck'),
      ),
    ),

    h('div', { class: 'form-layout' },
      // col 1 — word pair
      h('div', { class: 'form-col' },
        h('div', { class: 'form-sec-title' }, 'Word Pair'),
        h('div', { class: 'field-row' },
          fieldInput('lang1', 'e.g. ephemeral', true),
          h('div', { class: 'field-arrow' }, icon('arrow-right')),
          fieldInput('lang2', 'e.g. 短暂的'),
        ),
        h('div', { class: 'field-row' },
          (() => {
            const selected = new Set(
              (form.part_of_speech || 'noun').split('/').map(p => p.trim()).filter(p => PARTS_OF_SPEECH.includes(p))
            );
            if (selected.size === 0) selected.add('noun');
            function sync() { form.part_of_speech = [...selected].join('/'); }
            sync();
            const POS_LABELS = { noun: 'Noun', verb: 'Verb', adjective: 'Adj', adverb: 'Adv', idiom: 'Idiom' };
            const chips = PARTS_OF_SPEECH.map(pos => {
              const b = h('button', { class: `filter-chip${selected.has(pos) ? ' active' : ''}`, type: 'button' }, POS_LABELS[pos]);
              b.addEventListener('click', () => {
                if (selected.has(pos)) {
                  if (selected.size > 1) { selected.delete(pos); b.className = 'filter-chip'; }
                } else {
                  selected.add(pos); b.className = 'filter-chip active';
                }
                sync();
              });
              return b;
            });
            return h('div', { class: 'field' },
              h('label', { class: 'field-label' }, 'Part of Speech'),
              h('div', { class: 'pos-picker' }, ...chips),
            );
          })(),
          selectField('usage_frequency', USAGE_FREQUENCIES, 'Usage Frequency'),
        ),
      ),

      // col 2 — details
      h('div', { class: 'form-col' },
        h('div', { class: 'form-sec-title' }, 'Details'),
        fieldInput('description_lang1', 'A definition in the source language…'),
      ),

      // full width — examples
      h('div', { class: 'form-col-full' },
        h('div', { class: 'form-sec-title' }, 'Example Sentences'),
        fieldInput('example_sentences', 'One example per line…'),
      ),
    ),

    h('div', { class: 'form-actions' },
      h('button', { class: 'btn-ghost', onClick: () => navigate(isEdit ? 'library' : 'dashboard') }, 'Cancel'),
      h('button', { class: 'btn-primary', id: 'submit-btn', onClick: handleSubmit },
        isEdit ? 'Save Changes' : 'Add Card'),
    ),
  );
}


// ── Toast ────────────────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'success') {
  let toast = document.querySelector('.csv-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'csv-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className   = `csv-toast csv-toast-${type} csv-toast-show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = 'csv-toast'; }, 3000);
}

// ── CSV Export / Import ────────────────────────────────────────────────────────────────────
const CSV_HEADERS = ['lang1','lang2','description_lang1','part_of_speech','example_sentences','usage_frequency','box_number'];
// Positional fallback (no header row) — box_number is omitted since it's optional metadata
const CSV_POSITIONAL = ['lang1','lang2','description_lang1','part_of_speech','example_sentences','usage_frequency'];

const POS_ALIASES = {
  n: 'noun', noun: 'noun',
  v: 'verb', verb: 'verb',
  adj: 'adjective', adjective: 'adjective',
  adv: 'adverb', adverb: 'adverb',
  id: 'idiom', idiom: 'idiom',
};

const FREQ_BY_NUMBER = { 1: 'archaic', 2: 'rare', 3: 'uncommon', 4: 'common', 5: 'very common' };
const FREQ_TO_NUMBER = Object.fromEntries(Object.entries(FREQ_BY_NUMBER).map(([n, v]) => [v, Number(n)]));

function normalizePos(raw) {
  const parts = raw.split('/').map(p => POS_ALIASES[p.toLowerCase().trim()]).filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)].join('/') : null;
}

function normalizeFreq(raw) {
  const n = parseInt(raw, 10);
  if (!isNaN(n) && FREQ_BY_NUMBER[n]) return FREQ_BY_NUMBER[n];
  const s = raw.toLowerCase().trim();
  return USAGE_FREQUENCIES.includes(s) ? s : null;
}

function escapeCSV(val) {
  const s = String(val ?? '').replace(/\r\n|\r/g, '\n');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCSV(cards = state.cards, boxNum = null) {
  const rows   = [CSV_HEADERS.join(',')];
  for (const c of cards) {
    rows.push(CSV_HEADERS.map(k => {
      if (k === 'usage_frequency') return escapeCSV(FREQ_TO_NUMBER[c[k]] ?? c[k]);
      return escapeCSV(c[k]);
    }).join(','));
  }
  const suffix   = boxNum != null ? `-box${boxNum}` : '';
  const filename = `emo-flashcards${suffix}-${new Date().toISOString().slice(0,10)}.csv`;
  try {
    const savedPath = await invoke('save_csv', { csv: rows.join('\n'), filename });
    showToast(`Saved to ${savedPath}`, 'success');
  } catch (err) {
    showToast(`Export failed: ${err}`, 'error');
  }
}

function parseCSV(text) {
  const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
  const results = [];

  function parseField(line, pos) {
    if (line[pos] === '"') {
      let val = '', p = pos + 1;
      while (p < line.length) {
        if (line[p] === '"' && line[p+1] === '"') { val += '"'; p += 2; }
        else if (line[p] === '"') { p++; break; }
        else { val += line[p++]; }
      }
      return [val, p + 1];
    }
    const end = line.indexOf(',', pos);
    if (end === -1) return [line.slice(pos), line.length + 1];
    return [line.slice(pos, end), end + 1];
  }

  function parseLine(line) {
    const fields = [];
    let pos = 0;
    while (pos <= line.length) {
      const [val, next] = parseField(line, pos);
      fields.push(val);
      pos = next;
    }
    return fields;
  }

  const firstFields = parseLine(lines[0] || '');
  const hasHeader   = firstFields.some(f => CSV_HEADERS.includes(f.toLowerCase()));

  // Build column-name → field-index map from header row (case-insensitive).
  // Falls back to positional order (without box_number) when no header is present.
  const colIndex = {};
  if (hasHeader) {
    firstFields.forEach((name, idx) => { colIndex[name.toLowerCase()] = idx; });
  } else {
    CSV_POSITIONAL.forEach((name, idx) => { colIndex[name] = idx; });
  }

  const startLine = hasHeader ? 1 : 0;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    const card = {};
    for (const key of CSV_HEADERS) {
      const idx = colIndex[key] ?? colIndex[key.toLowerCase()];
      card[key] = idx !== undefined ? (fields[idx] ?? '') : '';
    }
    if (!card.lang1 || !card.lang2) continue;
    card.part_of_speech  = normalizePos(card.part_of_speech)   ?? 'noun';
    card.usage_frequency = normalizeFreq(card.usage_frequency) ?? 'common';
    const bn = parseInt(card.box_number, 10);
    card.box_number = (!isNaN(bn) && bn >= 1 && bn <= 5) ? bn : 1;
    results.push(card);
  }
  return results;
}

async function importCSV(file) {
  const text = await file.text();
  const parsed = parseCSV(text);
  if (parsed.length === 0) return { imported: 0, skipped: 0 };

  const existingLang1 = new Map(state.cards.map(c => [c.lang1.toLowerCase().trim(), c]));
  const conflicts = [];
  const newCards  = [];

  for (const card of parsed) {
    const key = card.lang1.toLowerCase().trim();
    if (existingLang1.has(key)) {
      conflicts.push({
        existing:     existingLang1.get(key),
        incoming:     card,
        fieldChoices: Object.fromEntries(CONFLICT_FIELDS.map(f => [f.key, 'existing'])),
      });
    } else {
      newCards.push(card);
    }
  }
  
  if (conflicts.length > 0) {
    state.importConflicts = { newCards, conflicts };
    render();
    return null;
  }

  let imported = 0, skipped = 0;
  for (const card of newCards) {
    try { await api.addCard(card); imported++; }
    catch { skipped++; }
  }
  await refreshCards();
  return { imported, skipped };
}

function triggerImport() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.csv,text/csv';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async e => {
    document.body.removeChild(input);
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.querySelector('.csv-import-btn');
    if (btn) { btn.textContent = 'Importing…'; btn.disabled = true; }
    const result = await importCSV(file);
    if (result === null) { render(); return; }
    const { imported, skipped } = result;
    showToast(
      imported > 0
        ? `Imported ${imported} card${imported !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`
        : 'No valid cards found in file',
      imported > 0 ? 'success' : 'error'
    );
    render();
  };
  input.click();
}

// ── Practice ──────────────────────────────────────────────────────────────────
function renderPracticeSelect() {
  const practiceDueSet = state.practiceFilterDue ? new Set(state.dueCards.map(c => c.id)) : null;
  const filtered = applySort(state.cards.filter(c => {
    const q = state.practiceSearch.toLowerCase();
    const matchSearch = !q
      || c.lang1.toLowerCase().includes(q)
      || c.lang2.toLowerCase().includes(q)
      || c.description_lang1.toLowerCase().includes(q);
    const matchBox = state.practiceFilterBox === null || c.box_number === state.practiceFilterBox;
    const cardPos  = c.part_of_speech.split('/').map(p => p.trim());
    const matchPos = state.practiceFilterPos.size === 0 || cardPos.some(p => state.practiceFilterPos.has(p));
    const matchAcc = matchAccFilter(c, state.practiceFilterAcc);
    const matchDue = !practiceDueSet || practiceDueSet.has(c.id);
    return matchSearch && matchBox && matchPos && matchAcc && matchDue;
  }), state.practiceSort);

  function resetPracticePage() { state.practicePage = 0; }
  const pageSize    = state.practicePageSize === 0 ? filtered.length : state.practicePageSize;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (state.practicePage >= totalPages) state.practicePage = totalPages - 1;
  const paged = filtered.slice(state.practicePage * pageSize, (state.practicePage + 1) * pageSize);

  const selCount = state.practiceSelected.size;
  const allVisibleSelected = filtered.length > 0 && filtered.every(c => state.practiceSelected.has(c.id));

  return h('div', { class: 'practice-select' },
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Practice'),
        h('p',  { class: 'page-subtitle' },
          selCount > 0
            ? `${selCount} card${selCount !== 1 ? 's' : ''} selected · ${filtered.length} shown`
            : `${state.cards.length} cards · ${filtered.length} shown`),
      ),
      h('div', { class: 'practice-header-actions' },
        h('div', { class: 'practice-header-row1' },
          h('div', { class: 'mode-toggle' },
            h('button', {
              class: `mode-toggle-btn${state.practiceMode === 'flip' ? ' active' : ''}`,
              onClick: () => { state.practiceMode = 'flip'; render(); },
            }, icon('record-circle'), ' Flashcard'),
            h('button', {
              class: `mode-toggle-btn${state.practiceMode === 'type' ? ' active' : ''}`,
              onClick: () => { state.practiceMode = 'type'; render(); },
            }, icon('pencil'), ' Word'),
          ),
          h('button', {
            class: 'btn-primary btn-sm',
            disabled: selCount === 0,
            onClick: selCount > 0 ? startPractice : null,
          }, icon('play-fill'), selCount > 0 ? ` Start (${selCount})` : ' Start'),
        ),
        h('div', { class: 'practice-header-row2' },
          h('button', { class: 'btn-ghost btn-sm', onClick: () => {
            if (allVisibleSelected) filtered.forEach(c => state.practiceSelected.delete(c.id));
            else                    filtered.forEach(c => state.practiceSelected.add(c.id));
            render();
          }}, allVisibleSelected ? 'Deselect all' : 'Select all'),
          h('div', { class: 'random-pick' },
            (() => {
              const inp = h('input', {
                class: 'random-pick-input',
                type: 'number', min: '1', max: String(filtered.length || 1),
                value: String(Math.min(state.practiceRandomCount, filtered.length || 1)),
              });
              inp.addEventListener('change', e => {
                const v = Math.max(1, parseInt(e.target.value) || 1);
                state.practiceRandomCount = v;
                render();
              });
              return inp;
            })(),
            h('button', {
              class: 'btn-ghost btn-sm',
              disabled: filtered.length === 0,
              onClick: () => {
                const n = Math.min(state.practiceRandomCount, filtered.length);
                const shuffled = [...filtered].sort(() => Math.random() - 0.5).slice(0, n);
                state.practiceSelected = new Set(shuffled.map(c => c.id));
                render();
              },
            }, icon('shuffle'), ' Random'),
          ),
        ),
      ),
    ),

    h('div', { class: 'filters-bar' },
      h('div', { class: 'search-wrap' },
        h('span', { class: 'search-icon' }, '⌕'),
        (() => {
          const inp = h('input', { class: 'search-input', type: 'text', placeholder: 'Search cards…', value: state.practiceSearch });
          inp.addEventListener('input', e => {
            const pos = e.target.selectionStart;
            state.practiceSearch = e.target.value;
            render();
            const ni = el('.search-input');
            if (ni) { ni.focus(); ni.setSelectionRange(pos, pos); }
          });
          return inp;
        })(),
        state.practiceSearch
          ? h('button', { class: 'search-clear', onClick: () => { state.practiceSearch = ''; render(); } }, icon('x'))
          : null,
      ),
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'Box'),
        h('div', { class: 'filter-group' },
          (() => {
            const b = h('button', { class: `filter-chip${state.practiceFilterBox === null ? ' active' : ''}` }, 'All');
            b.addEventListener('click', () => { state.practiceFilterBox = null; render(); });
            return b;
          })(),
          ...getBoxes().map(box => {
            const b = h('button', { class: `filter-chip${state.practiceFilterBox === box.box ? ' active' : ''}` }, `Box ${box.box}`);
            if (state.practiceFilterBox === box.box) b.style.setProperty('--box-clr', box.color);
            b.addEventListener('click', () => {
              state.practiceFilterBox = state.practiceFilterBox === box.box ? null : box.box;
              render();
            });
            return b;
          }),
        ),
        (() => {
          const b = h('button', { class: `filter-chip${state.practiceFilterDue ? ' active due-chip' : ''}` }, icon('clock'), ' Due Today');
          b.addEventListener('click', () => { state.practiceFilterDue = !state.practiceFilterDue; render(); });
          return b;
        })(),
      ),
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'POS'),
        h('div', { class: 'filter-group' },
          (() => {
            const b = h('button', { class: `filter-chip${state.practiceFilterPos.size === 0 ? ' active' : ''}` }, 'All');
            b.addEventListener('click', () => { state.practiceFilterPos.clear(); resetPracticePage(); render(); });
            return b;
          })(),
          ...PARTS_OF_SPEECH.map(pos => {
            const label = { noun: 'Noun', verb: 'Verb', adjective: 'Adj', adverb: 'Adv', idiom: 'Idiom' }[pos];
            const active = state.practiceFilterPos.has(pos);
            const b = h('button', { class: `filter-chip${active ? ' active' : ''}` }, label);
            b.addEventListener('click', () => {
              if (state.practiceFilterPos.has(pos)) state.practiceFilterPos.delete(pos);
              else state.practiceFilterPos.add(pos);
              resetPracticePage(); render();
            });
            return b;
          }),
        ),
        h('div', { class: 'size-control' },
          h('span', { class: 'filter-label' }, 'Show'),
          h('div', { class: 'size-toggle' },
            ...[25, 50, 100, 0].map(n => {
              const b = h('button', { class: `size-btn${state.practicePageSize === n ? ' active' : ''}` }, n === 0 ? 'All' : String(n));
              b.addEventListener('click', () => { state.practicePageSize = n; resetPracticePage(); render(); });
              return b;
            }),
          ),
        ),
      ),
      h('div', { class: 'filter-row' },
        h('span', { class: 'filter-label' }, 'Accuracy'),
        h('div', { class: 'filter-group' },
          ...[
            { key: null,   label: 'All'    },
            { key: 'new',  label: 'New'    },
            { key: 'low',  label: '< 50%'  },
            { key: 'mid',  label: '50–80%' },
            { key: 'high', label: '≥ 80%'  },
          ].map(({ key, label }) => {
            const b = h('button', { class: `filter-chip${state.practiceFilterAcc === key ? ' active' : ''}` }, label);
            b.addEventListener('click', () => { state.practiceFilterAcc = key; resetPracticePage(); render(); });
            return b;
          }),
        ),
        sortControl(state.practiceSort, v => { state.practiceSort = v; resetPracticePage(); render(); }),
      ),
    ),

    filtered.length === 0
      ? h('div', { class: 'empty' },
          h('div', { class: 'empty-icon' }, icon('inbox')),
          h('p', { class: 'empty-title' }, state.cards.length === 0 ? 'No cards yet' : 'No matches'),
          h('p', { class: 'empty-sub' }, state.cards.length === 0 ? 'Add some cards first' : 'Try adjusting your filters'),
        )
      : h('div', {},
          h('div', { class: 'practice-pick-list' },
          ...paged.map(card => {
            const checked = state.practiceSelected.has(card.id);
            const row = h('div', {
              class: `practice-pick-row${checked ? ' selected' : ''}`,
              onClick: () => {
                if (checked) state.practiceSelected.delete(card.id);
                else         state.practiceSelected.add(card.id);
                render();
              },
            },
              h('div', { class: `practice-check${checked ? ' checked' : ''}` }, checked ? icon('check-lg') : null),
              h('div', { class: 'row-words' },
                h('span', { class: 'row-l1' }, card.lang1),
                h('span', { class: 'row-sep' }, icon('arrow-right')),
                h('span', { class: 'row-l2' }, card.lang2),
              ),
              h('div', { class: 'row-chips' },
                ...posChips(card.part_of_speech),
                freqChip(card.usage_frequency),
                boxChip(card.box_number),
                accChip(card),
              ),
            );
            return row;
          }),
        ),
          totalPages > 1
            ? h('div', { class: 'pagination' },
                h('button', { class: 'btn-ghost', disabled: state.practicePage === 0,
                  onClick: () => { state.practicePage--; render(); } }, icon('arrow-left'), ' Prev'),
                h('span', { class: 'page-info' }, `Page ${state.practicePage + 1} of ${totalPages}`),
                h('button', { class: 'btn-ghost', disabled: state.practicePage >= totalPages - 1,
                  onClick: () => { state.practicePage++; render(); } }, 'Next ', icon('arrow-right')),
              )
            : null,
        ),
  );
}

function startPractice() {
  const ids = state.practiceSelected;
  const picked = state.cards.filter(c => ids.has(c.id));
  const entries = state.practiceMode === 'flip'
    ? [
        ...picked.map(c => ({ ...c, reversed: false })),
        ...picked.map(c => ({ ...c, reversed: true  })),
      ]
    : picked.map(c => ({ ...c, reversed: false }));
  state.practiceQueue       = entries.sort(() => Math.random() - 0.5);
  state.practiceIdx         = 0;
  state.practiceFlipped     = false;
  state.practiceDone        = false;
  state.practiceCorrect     = 0;
  state.practiceTotal       = 0;
  state.practiceAnimating   = false;
  state.practiceTyped       = '';
  state.practiceTypedResult = null;
  state.practiceResults     = {};
  navigate('practice');
}

function renderPractice() {
  if (state.practiceDone) return renderPracticeDone();
  return state.practiceMode === 'type' ? renderPracticeTypeCard() : renderPracticeCard();
}

function renderPracticeDone() {
  const uniqueIds    = getUniqueIds(state.practiceQueue);
  const uniqueTotal  = uniqueIds.length;
  const isFlip       = state.practiceMode === 'flip';
  const correctCount = uniqueIds.filter(id => {
    const r = state.practiceResults[id];
    if (!r) return false;
    return isFlip ? (r.forward === true && r.reverse === true) : r.forward === true;
  }).length;
  const acc = uniqueTotal > 0 ? Math.round((correctCount / uniqueTotal) * 100) : 0;

  return h('div', { class: 'study-done' },
    h('div', { class: 'done-icon' }, icon('stars')),
    h('h2', {}, 'Practice Complete!'),
    h('div', { class: 'done-stats' },
      doneStatEl(uniqueTotal,   'Reviewed'),
      doneStatEl(correctCount,  'Correct'),
      doneStatEl(`${acc}%`,     'Accuracy'),
    ),
    h('div', { class: 'done-actions' },
      h('button', { class: 'btn-ghost', onClick: () => navigate('practice-select') }, icon('arrow-left'), ' Back to selection'),
      h('button', { class: 'btn-primary', onClick: () => {
        state.practiceQueue     = [...state.practiceQueue].sort(() => Math.random() - 0.5);
        state.practiceIdx       = 0;
        state.practiceFlipped   = false;
        state.practiceDone      = false;
        state.practiceCorrect   = 0;
        state.practiceTotal     = 0;
        state.practiceAnimating = false;
        state.practiceResults   = {};
        render();
      }}, '↺ Practice again'),
    ),
  );
}

function renderPracticeCard() {
  const card         = state.practiceQueue[state.practiceIdx];
  const total        = state.practiceQueue.length;
  const pct          = (state.practiceIdx / total) * 100;
  const bInfo        = getBoxes()[card.box_number - 1];
  const uniqueIds    = getUniqueIds(state.practiceQueue);
  const uniqueTotal  = uniqueIds.length;
  const doneCount    = uniqueIds.filter(id => { const r = state.practiceResults[id]; return r && r.forward !== null && r.reverse !== null; }).length;
  const correctCount = uniqueIds.filter(id => { const r = state.practiceResults[id]; return r && r.forward === true && r.reverse === true; }).length;

  return h('div', { class: 'study-wrap' },
    h('div', { class: 'study-header' },
      h('button', { class: 'back-btn', onClick: () => navigate('practice-select') }, icon('arrow-left'), ' Exit'),
      h('div', { class: 'prog-wrap' },
        h('div', { class: 'prog-bar' }, h('div', { class: 'prog-fill', style: { width: `${pct}%` } })),
        h('span', { class: 'prog-txt' }, `${doneCount} / ${uniqueTotal}`),
      ),
      h('div', { class: 'session-score' },
        h('span', { class: 'score-ok'  }, String(correctCount)),
        h('span', { class: 'score-sep' }, '/'),
        h('span', { class: 'score-tot' }, String(uniqueTotal)),
      ),
    ),

    h('div', { class: 'study-direction' },
      h('span', { class: `dir-badge${card.reversed ? ' dir-reverse' : ''}` },
        card.reversed ? h('span', {}, icon('arrow-return-left'), ' Recall the word') : h('span', {}, icon('arrow-right'), ' Recall the translation'),
      ),
    ),

    buildStatusStrip(state.practiceQueue, state.practiceResults, card.id),

    h('div', { class: 'card-stage' },
      buildPracticeFlashcard(card, bInfo),
      buildPracticeAnswerSection(),
      !state.practiceFlipped
        ? h('p', { class: 'flip-prompt' }, 'Click the card to see the answer')
        : h('span', {}),
    ),

    h('div', { class: 'study-nav' },
      h('button', {
        class: `nav-btn${state.practiceIdx === 0 ? ' disabled' : ''}`,
        onClick: () => {
          if (!state.practiceAnimating && state.practiceIdx > 0) {
            state.practiceIdx--;
            state.practiceFlipped = false;
            render();
          }
        },
      }, icon('arrow-left'), ' Back'),
      h('button', {
        class: `nav-btn${state.practiceIdx >= total - 1 ? ' disabled' : ''}`,
        onClick: () => {
          if (!state.practiceAnimating && state.practiceIdx < total - 1) {
            state.practiceIdx++;
            state.practiceFlipped = false;
            render();
          }
        },
      }, 'Next ', icon('arrow-right')),
    ),

    (() => {
      const cardAcc = card.total_reviews > 0
        ? Math.round((card.correct_reviews / card.total_reviews) * 100) : 0;
      return h('div', { class: 'card-meta-bar' },
        `Reviews: ${card.total_reviews}`,
        h('span', {}, ' · '),
        `Accuracy: ${cardAcc}%`,
        h('span', {}, ' · '),
        h('span', { style: { color: 'var(--text-3)', fontStyle: 'italic' } }, 'Practice mode · no box changes'),
      );
    })(),
  );
}

function buildPracticeFlashcard(card, bInfo) {
  const tag = h('div', { class: 'card-box-tag' }, `Box ${card.box_number} · ${bInfo.label}`);
  tag.style.setProperty('--box-clr', bInfo.color);

  const frontWord = card.reversed ? card.lang2 : card.lang1;
  const backWord  = card.reversed ? card.lang1 : card.lang2;

  const front = h('div', { class: 'card-face card-front' },
    tag.cloneNode(true),
    h('div', { class: 'card-word' }, frontWord),
    h('div', { class: 'card-pos'  }, card.part_of_speech.split('/').map(p => p.trim()).join(' · ')),
    card.usage_frequency
      ? h('div', { class: 'card-freq' }, h('span', { class: 'freq-dot' }), card.usage_frequency)
      : null,
    card.reversed && card.description_lang1
      ? h('div', { class: 'card-section', style: { marginTop: '12px' } },
          h('span', { class: 'card-sec-label' }, 'Definition'),
          h('p',    { class: 'card-sec-body'  }, card.description_lang1),
        )
      : null,
    h('div', { class: 'card-hint' }, 'tap to reveal →'),
  );

  const backChildren = [
    tag.cloneNode(true),
    h('div', { class: 'card-translation' }, backWord),
    h('div', { class: 'card-pos' }, card.part_of_speech.split('/').map(p => p.trim()).join(' · ')),
  ];
  if (card.description_lang1) backChildren.push(
    h('hr', { class: 'card-divider' }),
    h('div', { class: 'card-section' },
      h('span', { class: 'card-sec-label' }, 'Definition'),
      h('p',    { class: 'card-sec-body'  }, card.description_lang1),
    ),
  );
  if (card.example_sentences) backChildren.push(
    h('hr', { class: 'card-divider' }),
    h('div', { class: 'card-section' },
      h('span', { class: 'card-sec-label' }, 'Examples'),
      h('p',    { class: 'card-sec-body'  }, card.example_sentences),
    ),
  );

  const back  = h('div', { class: 'card-face card-back' }, ...backChildren.filter(Boolean));
  const inner = h('div', { class: 'card-inner' }, front, back);
  return h('div', {
    class: `flashcard${state.practiceFlipped ? ' flipped' : ''}`,
    onClick: () => {
      if (!state.practiceAnimating) { state.practiceFlipped = !state.practiceFlipped; render(); }
    },
  }, inner);
}

function buildPracticeAnswerSection() {
  if (!state.practiceFlipped) return h('span', {});
  return h('div', { class: 'answer-btns' },
    h('button', { class: 'answer-btn wrong',   onClick: () => doPractice(false) },
      h('span', { class: 'answer-icon' }, icon('x-lg')),
      h('span', {}, 'Again'),
    ),
    h('button', { class: 'answer-btn correct', onClick: () => doPractice(true) },
      h('span', { class: 'answer-icon' }, icon('check-lg')),
      h('span', {}, 'Got it'),
    ),
  );
}

async function doPractice(correct) {
  if (state.practiceAnimating) return;
  state.practiceAnimating = true;

  const card = state.practiceQueue[state.practiceIdx];
  const fc = el('.flashcard');
  if (fc) fc.classList.add('exit');

  if (!state.practiceResults[card.id]) state.practiceResults[card.id] = { forward: null, reverse: null };
  if (card.reversed) state.practiceResults[card.id].reverse = correct;
  else               state.practiceResults[card.id].forward = correct;

  state.practiceTotal += 1;
  if (correct) state.practiceCorrect += 1;

  await new Promise(r => setTimeout(r, 300));

  const nextIdx = state.practiceIdx + 1;
  if (nextIdx >= state.practiceQueue.length) {
    state.practiceDone = true;
  } else {
    state.practiceIdx     = nextIdx;
    state.practiceFlipped = false;
  }

  state.practiceAnimating = false;
  render();
}

function renderPracticeTypeCard() {
  const card  = state.practiceQueue[state.practiceIdx];
  const total = state.practiceQueue.length;
  const pct   = (state.practiceIdx / total) * 100;
  const bInfo = getBoxes()[card.box_number - 1];
  const result = state.practiceTypedResult;

  const tag = h('div', { class: 'card-box-tag' }, `Box ${card.box_number} · ${bInfo.label}`);
  tag.style.setProperty('--box-clr', bInfo.color);

  function submitAnswer() {
    if (result !== null) return;
    const correct = state.practiceTyped.trim().toLowerCase() === card.lang1.trim().toLowerCase();
    state.practiceTypedResult = correct ? 'correct' : 'wrong';
    state.practiceTotal  += 1;
    if (correct) state.practiceCorrect += 1;
    render();
  }

  function advance() {
    const nextIdx = state.practiceIdx + 1;
    if (nextIdx >= state.practiceQueue.length) {
      state.practiceDone = true;
    } else {
      state.practiceIdx = nextIdx;
    }
    state.practiceTyped       = '';
    state.practiceTypedResult = null;
    render();
  }

  const inputEl = (() => {
    const inp = h('input', {
      class: `type-input${result === 'correct' ? ' correct' : result === 'wrong' ? ' wrong' : ''}`,
      type: 'text',
      placeholder: 'Type the word…',
    });
    inp.value = state.practiceTyped;
    inp.disabled = result !== null;
    inp.addEventListener('input', e => { state.practiceTyped = e.target.value; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });
    if (result === null) setTimeout(() => inp.focus(), 50);
    return inp;
  })();

  return h('div', { class: 'study-wrap' },
    h('div', { class: 'study-header' },
      h('button', { class: 'back-btn', onClick: () => navigate('practice-select') }, icon('arrow-left'), ' Exit'),
      h('div', { class: 'prog-wrap' },
        h('div', { class: 'prog-bar' }, h('div', { class: 'prog-fill', style: { width: `${pct}%` } })),
        h('span', { class: 'prog-txt' }, `${state.practiceIdx + 1} / ${total}`),
      ),
      h('div', { class: 'session-score' },
        h('span', { class: 'score-ok'  }, String(state.practiceCorrect)),
        h('span', { class: 'score-sep' }, '/'),
        h('span', { class: 'score-tot' }, String(state.practiceTotal)),
      ),
    ),

    h('div', { class: 'card-stage' },
      h('div', { class: 'type-card' },
        tag,
        h('div', { class: 'card-translation type-prompt' }, card.lang2),
        h('div', { class: 'card-pos' }, card.part_of_speech.split('/').map(p => p.trim()).join(' · ')),
        card.description_lang1
          ? h('div', { class: 'card-section', style: { marginTop: '12px' } },
              h('span', { class: 'card-sec-label' }, 'Definition'),
              h('p',    { class: 'card-sec-body'  }, card.description_lang1),
            )
          : null,
        h('div', { class: 'type-answer-row' },
          inputEl,
          result === null
            ? h('button', { class: 'btn-primary', onClick: submitAnswer }, 'Check')
            : null,
        ),
        result !== null
          ? h('div', { class: `type-result ${result}` },
              result === 'correct'
                ? h('span', {}, icon('check-lg'), ' Correct!')
                : h('span', {}, icon('x-lg'), ` Answer: ${card.lang1}`),
              h('button', { class: 'btn-primary', style: { marginLeft: '12px' }, onClick: advance },
                state.practiceIdx + 1 >= total ? 'Finish' : h('span', {}, 'Next ', icon('arrow-right'))),
            )
          : null,
      ),
    ),

    h('div', { class: 'card-meta-bar' },
      `Reviews: ${card.total_reviews}`,
      h('span', {}, ' · '),
      `Accuracy: ${card.total_reviews ? Math.round((card.correct_reviews / card.total_reviews) * 100) : 0}%`,
      h('span', {}, ' · '),
      h('span', { style: { color: 'var(--text-3)', fontStyle: 'italic' } }, 'Practice mode · no box changes'),
    ),
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  // local draft — copy so we don't mutate state until Save
  const draft = [...state.boxDays];
  const errMsgs = ['', '', '', '', ''];

  function validate() {
    let ok = true;
    for (let i = 0; i < 5; i++) {
      const v = draft[i];
      if (!Number.isInteger(v) || v < 1) {
        errMsgs[i] = 'Must be a whole number ≥ 1';
        ok = false;
      } else if (i > 0 && v <= draft[i - 1]) {
        errMsgs[i] = `Must be greater than Box ${i} (${draft[i - 1]}d)`;
        ok = false;
      } else {
        errMsgs[i] = '';
      }
    }
    return ok;
  }

  function rebuildRows() {
    for (let i = 0; i < 5; i++) {
      const inp = el(`#box-days-${i}`);
      const err = el(`#box-days-err-${i}`);
      if (inp) inp.value = draft[i];
      if (err) { err.textContent = errMsgs[i]; err.style.display = errMsgs[i] ? '' : 'none'; }
    }
    const lbl = el('#settings-interval-preview');
    if (lbl) lbl.textContent = draft.map((d, i) => `Box ${i+1}: ${d}d`).join('  ·  ');
  }

  async function handleSave() {
    validate();
    rebuildRows();
    if (errMsgs.some(Boolean)) return;

    const btn = el('#settings-save-btn');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      await api.saveSettings(draft);
      state.boxDays = [...draft];
      showToast('Settings saved', 'success');
      render();
    } catch (err) {
      showToast(`Error: ${err}`, 'error');
      if (btn) { btn.textContent = 'Save Settings'; btn.disabled = false; }
    }
  }

  const rows = getBoxes().map((b, i) => {
    const inp = h('input', {
      class: 'field-input settings-day-input',
      id: `box-days-${i}`,
      type: 'number',
      min: '1',
      value: String(draft[i]),
    });
    inp.addEventListener('input', e => {
      draft[i] = parseInt(e.target.value, 10) || 0;
      validate();
      rebuildRows();
    });

    const errEl = h('span', {
      class: 'field-err',
      id: `box-days-err-${i}`,
      style: { display: 'none' },
    });

    return h('div', { class: 'settings-box-row' },
      h('div', { class: 'settings-box-badge', style: { '--box-clr': b.color } },
        `Box ${b.box}`,
      ),
      h('div', { class: 'settings-box-input-wrap' },
        inp,
        h('span', { class: 'settings-day-unit' }, 'days'),
      ),
      errEl,
    );
  });

  return h('div', { class: 'settings-page' },
    h('div', { class: 'page-header' },
      h('div', {},
        h('h1', { class: 'page-title' }, 'Settings'),
        h('p',  { class: 'page-subtitle' }, 'Customise your Leitner box review intervals'),
      ),
    ),

    h('div', { class: 'settings-card' },
      h('h2', { class: 'settings-section-title' }, 'Review Intervals'),
      h('p',  { class: 'settings-section-sub' },
        'Set how many days after a correct answer each box waits before the card is due again. ',
        'Each box must be longer than the one before it.',
      ),
      h('div', { class: 'settings-rows' }, ...rows),
      h('div', { class: 'settings-preview', id: 'settings-interval-preview' },
        draft.map((d, i) => `Box ${i+1}: ${d}d`).join('  ·  '),
      ),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn-ghost', onClick: () => navigate('dashboard') }, 'Cancel'),
        h('button', { class: 'btn-primary', id: 'settings-save-btn', onClick: handleSave }, 'Save Settings'),
      ),
    ),
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function buildSidebar() {
  const navItems = [
    { view: 'dashboard',       label: 'Overview', icon: 'house'          },
    { view: 'study',           label: 'Study',    icon: 'book',   badge: true },
    { view: 'practice-select', label: 'Practice', icon: 'record-circle'  },
    { view: 'library',         label: 'Library',  icon: 'collection'     },
    { view: 'settings',        label: 'Settings', icon: 'gear'           },
  ];

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('i', { class: 'brand-icon bi bi-hexagon' }),
      h('div', {},
        h('span', { class: 'brand-name' }, 'EMO'),
        h('span', { class: 'brand-sub'  }, '5-Box System'),
      ),
    ),
    ...navItems.map(item => {
      const isPracticeItem = item.view === 'practice-select';
      const isActive = state.view === item.view
        || (isPracticeItem && state.view === 'practice');
      const btn = h('button', {
        class: `nav-item${isActive ? ' active' : ''}`,
        'data-view': item.view,
        onClick: () => {
          if (item.view === 'study') { state.studyStarted = false; state.studySelected = new Set(); }
          if (isPracticeItem) { state.practiceSelected = new Set(); state.practiceSearch = ''; state.practiceFilterBox = null; state.practiceFilterPos = new Set(); }
          navigate(item.view);
        },
      },
        h('i', { class: `nav-icon bi bi-${item.icon}` }),
        h('span', {}, item.label),
        item.badge && state.dueCards.length > 0
          ? h('span', { class: 'nav-badge' }, String(state.dueCards.length))
          : null,
      );
      return btn;
    }),
    h('button', {
      class: 'add-card-btn',
      onClick: () => { state.editCard = null; navigate('add'); },
    }, '+ New Card'),

    h('div', { class: 'sidebar-footer' },
      h('div', { class: 'stat-mini' },
        h('span', { class: 'stat-mini-val'   }, String(state.stats?.total_cards ?? 0)),
        h('span', { class: 'stat-mini-label' }, 'cards'),
      ),
      h('div', { class: 'stat-mini-div' }),
      h('div', { class: 'stat-mini' },
        h('span', { class: 'stat-mini-val'   }, `${accuracy(state.stats)}%`),
        h('span', { class: 'stat-mini-label' }, 'accuracy'),
      ),
    ),
  );

  return sidebar;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    await refresh();
  } catch (e) {
    console.error('Failed to load data:', e);
  }

  const app = document.getElementById('app');
  app.innerHTML = '';

  const shell = h('div', { class: 'shell' },
    buildSidebar(),
    h('main', { class: 'main' }),
  );

  app.appendChild(shell);

  render();
}

boot();