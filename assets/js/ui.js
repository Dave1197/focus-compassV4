/* assets/js/ui.js */
/* ═══════════════════════════════════════════════════════════
   FOCUS COMPASS — UI Module
   Handles:
   - View switching + bottom nav active state
   - Theme toggle (dark ↔ light) + persistence
   - Toast notification system
   - Bottom sheet (confirm + custom)
   - Confirm dialog (destructive actions)
   - Morning setup auto-save
   - Review screen full render
   - Header date + greeting
   Depends on: storage.js (must load first)
   ═══════════════════════════════════════════════════════════ */

const UI = (() => {

  // ── View registry ─────────────────────────────────────────
  const VIEWS = {
    morning:   'view-morning',
    habits:    'view-habits',
    pomodoro:  'view-pomodoro',
    review:    'view-review',
    dashboard: 'view-dashboard'
  };

  let _currentView   = 'morning';
  let _toastQueue    = [];
  let _sheetStack    = [];
  let _autoSaveTimer = null;

  // ── Init ──────────────────────────────────────────────────
  function init() {
    _applyTheme(Storage.getTheme());
    _renderHeaderDate();
    _bindNav();
    _bindThemeToggle();
    _bindMorningButtons();
    _bindDisciplineTabs();
    _ensureToastContainer();
    _navigateTo('morning', false);

    // Push a dummy history entry so Android back button hits this first
    history.pushState({ appHome: true }, '');

    window.addEventListener('popstate', function _appBackHandler(e) {
      // If a paper sheet handled its own popstate, ignore
      if (history.state?.paperSheet) return;
      // Re-push so next back press is also caught
      history.pushState({ appHome: true }, '');
      UI.confirm({
        title:   'Leave Focus Compass?',
        message: 'You\'ll lose any unsaved notes if you navigate away.',
        confirm: 'Leave',
        danger:  true,
        onConfirm() {
          window.removeEventListener('popstate', _appBackHandler);
          history.back();
          history.back();
        }
      });
    });
  }

  // ─────────────────────────────────────────────────────────
  // THEME
  // ─────────────────────────────────────────────────────────

  function _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    _updateThemeIcon(theme);
  }

  function _updateThemeIcon(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    btn.setAttribute('aria-label',
      theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );
    btn.innerHTML = theme === 'dark'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true">
           <circle cx="12" cy="12" r="5"/>
           <line x1="12" y1="1"  x2="12" y2="3"/>
           <line x1="12" y1="21" x2="12" y2="23"/>
           <line x1="4.22" y1="4.22"  x2="5.64"  y2="5.64"/>
           <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="1"  y1="12" x2="3"  y2="12"/>
           <line x1="21" y1="12" x2="23" y2="12"/>
           <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
           <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
         </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true">
           <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
         </svg>`;
  }

  function _bindThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    btn?.addEventListener('click', () => {
      const current = Storage.getTheme();
      const next    = current === 'dark' ? 'light' : 'dark';
      Storage.setTheme(next);
      _applyTheme(next);
      if (typeof Dashboard !== 'undefined') Dashboard.onThemeChange();
      if (navigator.vibrate) navigator.vibrate(15);
    });
  }

  // ─────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────

  function _bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) _navigateTo(view);
      });
    });
  }

  function _navigateTo(viewKey, animate = true) {
    if (viewKey === _currentView && animate) return;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    const targetEl = document.getElementById(VIEWS[viewKey]);
    if (targetEl) {
      targetEl.classList.add('active');
      if (animate) {
        targetEl.style.animation = 'none';
        requestAnimationFrame(() => { targetEl.style.animation = ''; });
      }
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewKey);
    });

    _updateHeaderTitle(viewKey);
    const prev = _currentView;
    _currentView = viewKey;
    _onViewEnter(viewKey, prev);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function _onViewEnter(viewKey, prevView) {
    switch (viewKey) {
      case 'morning': {
        const greetEl = document.getElementById('morning-greeting-text');
        if (greetEl) greetEl.textContent = _getGreeting() + '.';
        _updateMorningPreview('preview-avoiding',   Storage.getAvoiding());
        _updateMorningPreview('preview-quotes',     Storage.getQuotes());
        _updateMorningPreview('preview-sequential', Storage.getSequential());
        break;
      }
      case 'habits':
        if (typeof Habits !== 'undefined') Habits.render();
        break;
      case 'pomodoro':
        if (typeof Pomodoro !== 'undefined') Pomodoro.onViewEnter();
        break;
      case 'review':
        _renderReviewView();
        break;
      case 'dashboard':
        if (typeof Dashboard !== 'undefined') Dashboard.onViewEnter();
        break;
    }
  }

  function _updateHeaderTitle(viewKey) {
    const titles = {
      morning:   'Morning',
      habits:    'Habits',
      pomodoro:  'Focus',
      review:    'Review',
      dashboard: 'Dashboard'
    };
    const el = document.getElementById('header-view-title');
    if (el) el.textContent = titles[viewKey] || 'Focus Compass';
  }

  // ─────────────────────────────────────────────────────────
  // HEADER DATE + GREETING
  // ─────────────────────────────────────────────────────────

  function _renderHeaderDate() {
    const el = document.getElementById('header-date');
    if (!el) return;
    const now  = new Date();
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    el.textContent = now.toLocaleDateString('en-IN', opts);
  }

  function _getGreeting() {
    const h = new Date().getHours();
    if (h < 5)  return 'Up late?';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Winding down?';
  }

  // ─────────────────────────────────────────────────────────
  // MORNING VIEW
  // ─────────────────────────────────────────────────────────

  function _bindMorningButtons() {
    document.getElementById('btn-open-avoiding')
      ?.addEventListener('click', () => _openPaperSheet('avoiding'));
    document.getElementById('btn-open-quotes')
      ?.addEventListener('click', () => _openPaperSheet('quotes'));
    document.getElementById('btn-open-sequential')
      ?.addEventListener('click', () => _openPaperSheet('sequential'));
  }

  function _openPaperSheet(type) {
    const config = {
      avoiding: {
        title:       'What I am avoiding',
        getValue:    () => Storage.getAvoiding(),
        setValue:    v  => Storage.setAvoiding(v),
        previewId:   'preview-avoiding',
        placeholder: 'What fears or rejections are you avoiding today?'
      },
      quotes: {
        title:       'Quotations & Ideas',
        getValue:    () => Storage.getQuotes(),
        setValue:    v  => Storage.setQuotes(v),
        previewId:   'preview-quotes',
        placeholder: 'Ideas, quotes, and things that inspire you\u2026'
      },
      sequential: {
        title:       'Sequential-Compounding Tasks',
        getValue:    () => Storage.getSequential(),
        setValue:    v  => Storage.setSequential(v),
        previewId:   'preview-sequential',
        placeholder: 'Where should your 7 hours go today? Direct your curiosity with intention\u2026'
      }
    };

    const { title, getValue, setValue, previewId, placeholder } = config[type];
    let saveTimer = null;

    function _toHTML(raw) {
      if (!raw) return '';
      if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
      return raw.split('\n').map(l => _escapeHTML(l)).join('<br>');
    }

    function _htmlToPlain(html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return (tmp.textContent || tmp.innerText || '').trim();
    }

    const overlay = document.createElement('div');
    overlay.className = 'paper-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    overlay.innerHTML = `
      <div class="paper-card" role="document">
        <div class="paper-header">
          <span class="paper-title">${_escapeHTML(title)}</span>
          <button class="paper-close" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="paper-body">
          <div class="paper-editor"
               id="paper-editor-${type}"
               data-placeholder="${_escapeHTML(placeholder)}"
               contenteditable="false"
               spellcheck="true"
               role="textbox"
               aria-multiline="true"
               aria-label="${_escapeHTML(title)}"></div>
          <span class="paper-edit-hint" id="paper-hint-${type}">Tap to edit</span>
        </div>

        <div class="paper-toolbar">
          <button class="paper-toolbar-btn" data-cmd="bold" aria-label="Bold"><b>B</b></button>
          <button class="paper-toolbar-btn" data-cmd="italic" aria-label="Italic"><i>I</i></button>
          <button class="paper-toolbar-btn" data-cmd="underline" aria-label="Underline">
            <span style="text-decoration:underline">U</span>
          </button>
          <div class="paper-toolbar-sep"></div>
          <button class="paper-toolbar-btn" data-cmd="heading" aria-label="Heading">H</button>
          <button class="paper-toolbar-btn" data-cmd="insertUnorderedList" aria-label="Bullet list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="9" y1="6"  x2="20" y2="6"/>
              <line x1="9" y1="12" x2="20" y2="12"/>
              <line x1="9" y1="18" x2="20" y2="18"/>
              <circle cx="4" cy="6"  r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          <button class="paper-toolbar-btn" data-cmd="insertOrderedList" aria-label="Numbered list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="10" y1="6"  x2="21" y2="6"/>
              <line x1="10" y1="12" x2="21" y2="12"/>
              <line x1="10" y1="18" x2="21" y2="18"/>
              <text x="2" y="8"  font-size="7" fill="currentColor" stroke="none" font-family="serif">1</text>
              <text x="2" y="14" font-size="7" fill="currentColor" stroke="none" font-family="serif">2</text>
              <text x="2" y="20" font-size="7" fill="currentColor" stroke="none" font-family="serif">3</text>
            </svg>
          </button>
          <span class="paper-saved-inline" id="paper-saved-${type}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Saved
          </span>
          <button class="paper-toolbar-done" id="paper-done-${type}">Done</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => overlay.classList.add('open'))
    );

    const editor   = overlay.querySelector(`#paper-editor-${type}`);
    const hint     = overlay.querySelector(`#paper-hint-${type}`);
    const savedEl  = overlay.querySelector(`#paper-saved-${type}`);
    const doneBtn  = overlay.querySelector(`#paper-done-${type}`);
    const closeBtn = overlay.querySelector('.paper-close');

    editor.innerHTML = _toHTML(getValue());

    function _enableEditing() {
      if (editor.contentEditable === 'true') return;
      editor.contentEditable = 'true';
      hint.classList.add('hidden');
      editor.focus();
    }

    editor.addEventListener('click', _enableEditing);

    overlay.querySelectorAll('.paper-toolbar-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        if (editor.contentEditable !== 'true') _enableEditing();
        const cmd = btn.dataset.cmd;
        if (cmd === 'heading') {
          const sel    = window.getSelection();
          const parent = sel?.rangeCount > 0
            ? sel.getRangeAt(0).commonAncestorContainer : null;
          const inH1   = parent?.nodeName === 'H1' ||
                         parent?.parentElement?.nodeName === 'H1';
          document.execCommand('formatBlock', false, inH1 ? 'div' : 'h1');
        } else {
          document.execCommand(cmd, false, null);
        }
        editor.focus();
        _triggerSave();
      });
    });

    function _triggerSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const html = editor.innerHTML;
        setValue(html);
        _updateMorningPreview(previewId, _htmlToPlain(html));
        savedEl.style.opacity = '1';
        setTimeout(() => { savedEl.style.opacity = '0'; }, 1800);
      }, 600);
    }

    editor.addEventListener('input', _triggerSave);

    const closeSheet = (popHistory = true) => {
      window.removeEventListener('popstate', _onPopState);
      if (popHistory && history.state?.paperSheet === type) {
        history.back();
      }
      clearTimeout(saveTimer);
      setValue(editor.innerHTML);
      _updateMorningPreview(previewId, _htmlToPlain(editor.innerHTML));
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 240);
      if (navigator.vibrate) navigator.vibrate(10);
    };

    closeBtn.addEventListener('click', () => closeSheet());
    doneBtn.addEventListener('click',  () => closeSheet());
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

    history.pushState({ paperSheet: type }, '');
    const _onPopState = () => closeSheet(false);
    window.addEventListener('popstate', _onPopState, { once: true });
  }

  // ─────────────────────────────────────────────────────────
  // MORNING PREVIEW
  // ─────────────────────────────────────────────────────────

  function _updateMorningPreview(previewId, value) {
    const el = document.getElementById(previewId);
    if (!el) return;
    // Strip HTML tags to get plain text
    const tmp = document.createElement('div');
    tmp.innerHTML = value;
    const plainText = (tmp.textContent || tmp.innerText || '').trim();
    const firstLine = plainText.split('\n')[0].trim();
    if (firstLine) {
      el.textContent = firstLine.length > 40
        ? firstLine.slice(0, 40) + '\u2026'
        : firstLine;
      el.classList.remove('empty');
    } else {
      el.textContent = 'Tap to write\u2026';
      el.classList.add('empty');
    }
  }

  // ─────────────────────────────────────────────────────────
  // REVIEW VIEW
  // ─────────────────────────────────────────────────────────

  function _renderReviewView() {
    _renderStoicThought();

    const today    = Storage.getToday();
    const settings = Storage.getSettings();

    const badgeEl = document.getElementById('review-date-badge');
    if (badgeEl) {
      const now  = new Date();
      const opts = { weekday: 'long', month: 'long', day: 'numeric' };
      badgeEl.textContent = now.toLocaleDateString('en-IN', opts);
    }

    const pomSummary = typeof Pomodoro !== 'undefined'
      ? Pomodoro.getTodaySummary()
      : { pomodoros: today.pomodoros || 0,
          hoursWorked: ((today.pomodoros || 0) * 0.5).toFixed(1),
          goalPct: 0 };

    _setText('review-stat-pomos',    pomSummary.pomodoros);
    _setText('review-stat-hours',    pomSummary.hoursWorked + 'h');
    _setText('review-stat-goal-pct', pomSummary.goalPct + '%');

    const habitSummary = _buildHabitSummaryFromStorage();
    _setText('review-stat-habits', `${habitSummary.checked}/${habitSummary.total}`);

    const habitListEl = document.getElementById('review-habit-list');
    if (habitListEl) {
      if (habitSummary.items.length === 0) {
        habitListEl.innerHTML = `
          <p style="color:var(--color-text-faint);font-size:var(--text-sm);
                    padding:var(--space-3) 0;">No habits added yet.</p>`;
      } else {
        habitListEl.innerHTML = habitSummary.items.map(item => `
          <div class="review-habit-item ${item.checked ? 'done' : ''}">
            <div class="review-habit-dot"></div>
            <span class="review-habit-name"
                  style="font-size:var(--text-sm);
                         color:${item.checked ? 'var(--color-text-muted)' : 'var(--color-text)'}">
              ${_escapeHTML(item.name)}
            </span>
            <span style="margin-left:auto;font-size:var(--text-xs);
                         color:${item.checked ? 'var(--color-success)' : 'var(--color-text-faint)'}">
              ${item.checked ? '\u2713' : '\u25CB'}
            </span>
          </div>`).join('');
      }
    }

    const feel = today.feel || 0;
    const fear = today.fear || 0;
    _setText('review-feel-value', feel > 0 ? `${feel}/5` : '\u2014');
    _setText('review-fear-value', fear > 0 ? `${fear}/5` : '\u2014');
    _setText('review-feel-desc',  feel > 0 ? _feelDesc(feel)  : 'Not rated yet');
    _setText('review-fear-desc',  fear > 0 ? _fearDesc(fear) : 'Not rated yet');

    const avoiding  = Storage.getAvoiding();
    const avoidEl   = document.getElementById('review-avoiding');
    if (avoidEl) {
      // Strip HTML for review display
      const tmp = document.createElement('div');
      tmp.innerHTML = avoiding;
      avoidEl.textContent   = tmp.textContent || tmp.innerText || 'Nothing noted yet.';
      avoidEl.style.opacity = avoiding ? '1' : '0.5';
    }

    const quotes   = Storage.getQuotes();
    const quotesEl = document.getElementById('review-quotes');
    if (quotesEl) {
      const tmp = document.createElement('div');
      tmp.innerHTML = quotes;
      quotesEl.textContent   = tmp.textContent || tmp.innerText || 'No quotes noted today.';
      quotesEl.style.opacity = quotes ? '1' : '0.5';
    }

    _renderMomentumMessage(pomSummary, habitSummary, feel, fear);
  }

  function _renderMomentumMessage(pomSummary, habitSummary, feel, fear) {
    const el = document.getElementById('review-momentum');
    if (!el) return;
    let msg = '';
    const pomos    = pomSummary.pomodoros;
    const habitPct = habitSummary.pct;

    if (pomos === 0 && habitPct === 0) {
      msg = 'Day just started \u2014 or nothing logged yet. Tomorrow is a fresh page.';
    } else if (pomSummary.goalPct >= 100) {
      msg = '\uD83C\uDFC6 You hit your 7-hour goal today. That\'s rare. Own it.';
    } else if (pomos >= 8) {
      msg = `\uD83D\uDCAA ${pomos} pomodoros. Solid focused work today.`;
    } else if (habitPct === 100) {
      msg = '\u2705 Every habit checked. Consistency compounds.';
    } else if (feel >= 4 && fear <= 2) {
      msg = '\uD83D\uDE04 High energy, low resistance \u2014 you were in the zone today.';
    } else if (fear >= 4) {
      msg = '\uD83E\uDEB4 High resistance today. Showing up anyway is the whole game.';
    } else if (feel <= 2) {
      msg = '\uD83D\uDE36 Going through the motions is still motion. Rest if you need it.';
    } else {
      msg = `${pomos} pomodoro${pomos !== 1 ? 's' : ''} done. ` +
            `${habitPct}% habits complete. Keep the streak alive.`;
    }
    el.textContent = msg;
  }

  function _buildHabitSummaryFromStorage() {
    const today     = Storage.getToday();
    const habitsObj = today.habits || {};
    const names     = Object.keys(habitsObj);
    const items     = names.map(name => ({ name, checked: habitsObj[name] === true }));
    const checked   = items.filter(i => i.checked).length;
    return {
      items,
      total:   items.length,
      checked,
      pct:     items.length > 0 ? Math.round((checked / items.length) * 100) : 0
    };
  }

  // ─────────────────────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────────────────────

  function _ensureToastContainer() {
    if (!document.getElementById('toast-container')) {
      const el = document.createElement('div');
      el.id        = 'toast-container';
      el.className = 'toast-container';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
  }

  const TOAST_ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94
                         a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9"  x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9"  y2="15"/>
                <line x1="9"  y1="9" x2="15" y2="15"/>
              </svg>`
  };

  function toast(message, type = 'success', duration = 2800) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.success}
      <span>${_escapeHTML(String(message))}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
    el.addEventListener('click', () => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    });
  }

  // ─────────────────────────────────────────────────────────
  // BOTTOM SHEET
  // ─────────────────────────────────────────────────────────

  function sheet(opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', opts.title || 'Dialog');

    overlay.innerHTML = `
      <div class="bottom-sheet" role="document">
        <div class="sheet-handle" aria-hidden="true"></div>
        <h2 class="sheet-title">${_escapeHTML(opts.title || '')}</h2>
        <div class="sheet-body">${opts.content || ''}</div>
        <div class="sheet-actions">
          <button class="btn-secondary btn-sheet-cancel">
            ${_escapeHTML(opts.cancelLabel || 'Cancel')}
          </button>
          <button class="btn-primary btn-sheet-confirm">
            ${_escapeHTML(opts.confirmLabel || 'Save')}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _sheetStack.push(overlay);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('open'));
    });

    const sheetEl  = overlay.querySelector('.bottom-sheet');
    const closeBtn = overlay.querySelector('.btn-sheet-cancel');
    const confBtn  = overlay.querySelector('.btn-sheet-confirm');

    if (typeof opts.onOpen === 'function') {
      setTimeout(() => opts.onOpen(sheetEl), 80);
    }

    confBtn.addEventListener('click', () => {
      if (typeof opts.onConfirm === 'function') {
        const keepOpen = opts.onConfirm(sheetEl) === false;
        if (!keepOpen) _closeSheet(overlay);
      } else {
        _closeSheet(overlay);
      }
    });

    closeBtn.addEventListener('click', () => {
      if (typeof opts.onCancel === 'function') opts.onCancel();
      _closeSheet(overlay);
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        if (typeof opts.onCancel === 'function') opts.onCancel();
        _closeSheet(overlay);
      }
    });

    return () => _closeSheet(overlay);
  }

  function _closeSheet(overlay) {
    overlay.classList.remove('open');
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      _sheetStack = _sheetStack.filter(s => s !== overlay);
    }, { once: true });
  }

  // ─────────────────────────────────────────────────────────
  // CONFIRM DIALOG
  // ─────────────────────────────────────────────────────────

  function confirm(opts = {}) {
    const isDanger = opts.danger !== false;
    sheet({
      title:        opts.title   || 'Are you sure?',
      confirmLabel: opts.confirm || 'Confirm',
      cancelLabel:  'Cancel',
      content: `
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);
                  line-height:1.6;margin-bottom:var(--space-2);">
          ${_escapeHTML(opts.message || '')}
        </p>`,
      onOpen(sheetEl) {
        const btn = sheetEl.querySelector('.btn-sheet-confirm');
        if (isDanger && btn) {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-danger');
        }
      },
      onConfirm() {
        if (typeof opts.onConfirm === 'function') opts.onConfirm();
        return true;
      },
      onCancel: opts.onCancel
    });
  }

  // ─────────────────────────────────────────────────────────
  // MOOD BARS (Feel / Fear)
  // ─────────────────────────────────────────────────────────

  function initMoodBars() {
    _initStarBar('feel-stars', val => {
      Storage.setFeel(val);
      _updateMoodDesc('feel-description', val, 'feel');
    }, Storage.getFeel());

    _initStarBar('fear-stars', val => {
      Storage.setFear(val);
      _updateMoodDesc('fear-description', val, 'fear');
    }, Storage.getFear());

    _updateMoodDesc('feel-description', Storage.getFeel(), 'feel');
    _updateMoodDesc('fear-description', Storage.getFear(), 'fear');
  }

  function _initStarBar(containerId, onChange, initialValue) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = [1, 2, 3, 4, 5].map(i => `
      <button class="star-btn ${initialValue >= i ? 'active' : ''}"
              data-value="${i}"
              aria-label="Rate ${i} out of 5"
              aria-pressed="${initialValue >= i}">
        ${i}
      </button>`).join('');

    container.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val     = parseInt(btn.dataset.value, 10);
        const current = parseInt(
          container.querySelector('.star-btn.active:last-of-type')?.dataset.value || '0', 10
        );
        const newVal  = current === val ? 0 : val;

        container.querySelectorAll('.star-btn').forEach(b => {
          const bVal = parseInt(b.dataset.value, 10);
          const on   = newVal > 0 && bVal <= newVal;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on);
        });

        onChange(newVal);
        if (navigator.vibrate) navigator.vibrate(12);
      });
    });
  }

  function _updateMoodDesc(elId, val, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = val > 0
      ? (type === 'feel' ? _feelDesc(val) : _fearDesc(val))
      : '';
  }

  // ─────────────────────────────────────────────────────────
  // SETTINGS SHEET
  // ─────────────────────────────────────────────────────────

  function openSettingsSheet() {
    sheet({
      title: 'Settings & Data',
      content: `
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Export data</div>
            <div class="settings-row-sub">Download all your data as JSON</div>
          </div>
          <button class="btn-secondary" id="btn-export-data"
                  style="flex-shrink:0;font-size:var(--text-xs);">Export</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Import data</div>
            <div class="settings-row-sub">Restore from a previous export</div>
          </div>
          <button class="btn-secondary" id="btn-import-trigger"
                  style="flex-shrink:0;font-size:var(--text-xs);">Import</button>
        </div>
        <input type="file" id="import-file-input" accept=".json"
               class="hidden" aria-hidden="true"/>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Pomodoro lengths</div>
            <div class="settings-row-sub">Work \u00B7 Break \u00B7 Long break</div>
          </div>
          <span style="font-size:var(--text-xs);color:var(--color-text-faint);">
            30 \u00B7 5 \u00B7 25 min
          </span>
        </div>
        <div class="settings-row" style="margin-top:var(--space-4);">
          <div>
            <div class="settings-row-label" style="color:var(--color-danger);">
              Clear all data
            </div>
            <div class="settings-row-sub">Permanent. Cannot be undone.</div>
          </div>
          <button class="btn-danger" id="btn-nuke"
                  style="flex-shrink:0;font-size:var(--text-xs);">Clear</button>
        </div>`,
      confirmLabel: 'Done',
      cancelLabel:  '',
      onOpen(sheetEl) {
        const cancel = sheetEl.querySelector('.btn-sheet-cancel');
        if (cancel) cancel.style.display = 'none';

        sheetEl.querySelector('#btn-export-data')
          ?.addEventListener('click', _exportData);

        const importBtn = sheetEl.querySelector('#btn-import-trigger');
        const fileInput = sheetEl.querySelector('#import-file-input');
        importBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', e => {
          _importData(e.target.files?.[0]);
        });

        sheetEl.querySelector('#btn-nuke')
          ?.addEventListener('click', () => {
            confirm({
              title:   'Delete everything?',
              message: 'All habits, history, pomodoros, and settings will be erased permanently.',
              confirm: 'Delete All',
              danger:  true,
              onConfirm() {
                Storage.nukeAll();
                location.reload();
              }
            });
          });
      },
      onConfirm: () => true
    });
  }

  function _exportData() {
    const json    = Storage.exportJSON();
    const blob    = new Blob([json], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href        = url;
    a.download    = `focus-compass-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Data exported!', 'success');
  }

  function _importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const result = Storage.importJSON(e.target.result);
      if (result.ok) {
        toast('Data imported! Reloading\u2026', 'success');
        setTimeout(() => location.reload(), 1200);
      } else {
        toast('Import failed: ' + result.error, 'error');
      }
    };
    reader.readAsText(file);
  }

  // ─────────────────────────────────────────────────────────
  // DISCIPLINE TABS + STOIC THOUGHT
  // ─────────────────────────────────────────────────────────

  function _bindDisciplineTabs() {
    document.querySelectorAll('.discipline-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.discipline-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const d = tab.dataset.discipline;
        Storage.setDiscipline(d);
        _updateDisciplineDesc(d);
      });
    });
  }

  function _updateDisciplineDesc(discipline) {
    const descs = {
      desire: 'What you want and fear \u2014 desiring only what is truly in your control.',
      action: 'How you act in the world \u2014 with effort, reservation, and care for others.',
      assent: 'How you judge impressions \u2014 not every thought deserves your agreement.'
    };
    const el = document.getElementById('discipline-desc');
    if (el) el.textContent = descs[discipline] || '';
  }

  function _renderStoicThought() {
    if (typeof STOIC_THOUGHTS === 'undefined') return;
    const day  = _getDayOfYear();
    const r    = day % 3;
    const disc = r === 1 ? 'desire' : r === 2 ? 'action' : 'assent';
    const idx  = Math.floor((day - 1) / 3) % 122;

    const thought = STOIC_THOUGHTS[disc]?.[idx] || STOIC_THOUGHTS.desire[0];

    const labels = { desire: '\u25C8 Desire', action: '\u25C7 Action', assent: '\u25CB Assent' };
    _setText('stoic-discipline-badge', labels[disc]);
    _setText('stoic-thought-text',     thought.text);
    _setText('stoic-source',           '\u2014 ' + thought.source);

    document.querySelectorAll('.discipline-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.discipline === disc);
    });
    _updateDisciplineDesc(disc);
  }

  function _getDayOfYear() {
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / (1000 * 60 * 60 * 24));
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _escapeHTML(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  function _feelDesc(v) {
    return ['', 'Robotic, going through motions',
                'Disconnected, low energy',
                'Neutral, functioning',
                'Engaged, present',
                'Fully alive, deeply connected'][v] || '';
  }

  function _fearDesc(v) {
    return ['', 'Zero hesitation, fully clear',
                'Slight resistance',
                'Moderate hesitation',
                'Strong resistance, avoiding hard tasks',
                'Paralysed, can\'t start'][v] || '';
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────
  return {
    init,
    initMoodBars,
    navigateTo:       _navigateTo,
    toast,
    sheet,
    confirm,
    openSettingsSheet,
    renderReview:     _renderReviewView,
  };

})();
