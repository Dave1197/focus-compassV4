/* assets/js/habits.js */
/* ═══════════════════════════════════════════════════════════
   FOCUS COMPASS — Habits Module
   Slot-based habits: 3 renameable slots, each with own habits
   Drag-to-reorder via SortableJS (within each slot)
   ═══════════════════════════════════════════════════════════ */

const Habits = (() => {

  let _listEl        = null;
  let _progressFill  = null;
  let _progressLabel = null;
  let _emptyState    = null;
  let _sortables     = [];     // one SortableJS instance per slot

  let _pressTimer    = null;
  const LONG_PRESS_MS = 500;

  // ── Init ──────────────────────────────────────────────
  function init() {
    _listEl        = document.getElementById('habit-list');
    _progressFill  = document.getElementById('habits-progress-fill');
    _progressLabel = document.getElementById('habits-progress-label');
    _emptyState    = document.getElementById('habits-empty');

    _bindResetButton();
    render();
  }

  function _bindResetButton() {
    document.getElementById('btn-habits-reset')
      ?.addEventListener('click', () => {
        UI.confirm({
          title:   'Reset today\'s habits?',
          message: 'All checkboxes will be cleared. Your habit list stays.',
          confirm: 'Reset',
          danger:  true,
          onConfirm() {
            Storage.resetTodayHabits();
            render();
            UI.toast('Habits reset for today', 'warning');
          }
        });
      });
  }

  // ── Master render ──────────────────────────────────────
  function render() {
    if (!_listEl) return;

    const slots    = Storage.getHabitSlots();
    const todayMap = Storage.getTodayHabits();
    const allNames = Storage.getHabitsList();

    // Empty state — all slots have 0 habits
    if (allNames.length === 0) {
      _listEl.innerHTML = _slotsShellHTML(slots, todayMap, true);
      _bindSlotShell();
      _emptyState?.classList.remove('hidden');
      _updateProgress(0, 0);
      _destroySortables();
      return;
    }

    _emptyState?.classList.add('hidden');
    _listEl.innerHTML = _slotsShellHTML(slots, todayMap, false);
    _bindSlotShell();

    const checked = Object.values(todayMap).filter(Boolean).length;
    _updateProgress(checked, allNames.length);
    _initSortables(slots);
  }

  // ── Build full slots HTML ──────────────────────────────
  function _slotsShellHTML(slots, todayMap) {
    return slots.map(slot => `
      <div class="habit-slot" data-slot-id="${slot.id}">

        <div class="habit-slot-header">
          <span class="habit-slot-name"
                data-slot-id="${slot.id}"
                title="Tap to rename">${_escapeHTML(slot.name)}</span>
          <button class="btn-icon btn-slot-rename"
                  aria-label="Rename ${_escapeAttr(slot.name)}"
                  data-slot-id="${slot.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
            </svg>
          </button>
        </div>

        <div class="habit-slot-list"
             id="slot-list-${slot.id}"
             data-slot-id="${slot.id}">
          ${slot.habits.map(name =>
            _habitItemHTML(name, !!todayMap[name])
          ).join('')}
        </div>

        <form class="add-input-row slot-add-form"
              data-slot-id="${slot.id}"
              novalidate>
          <input class="input-text slot-add-input"
                 type="text"
                 placeholder="Add to ${_escapeAttr(slot.name)}…"
                 maxlength="300"
                 autocomplete="off"
                 autocorrect="off"
                 spellcheck="false" />
          <button class="btn-primary"
                  type="submit"
                  style="flex-shrink:0;padding-inline:var(--space-4);">
            <svg width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </form>

      </div>
    `).join('');
  }

  // ── Bind slot-level events ─────────────────────────────
  function _bindSlotShell() {
    // Add habit forms (one per slot)
    _listEl.querySelectorAll('.slot-add-form').forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const slotId = form.dataset.slotId;
        const input  = form.querySelector('.slot-add-input');
        const name   = input?.value?.trim();
        if (!name) return;

        const result = Storage.addHabit(name, slotId);
        if (result.ok) {
          input.value = '';
          render();
          UI.toast('Habit added', 'success');
        } else {
          UI.toast(result.error, 'warning');
          input.focus();
        }
      });
    });

    // Rename slot buttons
    _listEl.querySelectorAll('.btn-slot-rename').forEach(btn => {
      btn.addEventListener('click', () => {
        _openRenameSlotSheet(btn.dataset.slotId);
      });
    });

    // Tap slot name to rename (double-tap on mobile)
    _listEl.querySelectorAll('.habit-slot-name').forEach(el => {
      el.addEventListener('dblclick', () => {
        _openRenameSlotSheet(el.dataset.slotId);
      });
    });

    // Bind individual habit items
    _listEl.querySelectorAll('.habit-item').forEach(_bindHabitItem);
  }

  // ── Rename slot sheet ──────────────────────────────────
  function _openRenameSlotSheet(slotId) {
    const slot = Storage.getHabitSlots().find(s => s.id === slotId);
    if (!slot) return;

    UI.sheet({
      title: 'Rename slot',
      content: `
        <label class="input-label" for="sheet-slot-input">Slot name</label>
        <input class="input-text"
               id="sheet-slot-input"
               type="text"
               value="${_escapeAttr(slot.name)}"
               autocomplete="off" />`,
      confirmLabel: 'Save',
      onOpen(sheetEl) {
        const inp = sheetEl.querySelector('#sheet-slot-input');
        setTimeout(() => { inp?.focus(); inp?.select(); }, 120);
      },
      onConfirm(sheetEl) {
        const inp     = sheetEl.querySelector('#sheet-slot-input');
        const newName = inp?.value?.trim();
        if (!newName) return false;
        Storage.renameSlot(slotId, newName);
        render();
        UI.toast('Slot renamed', 'success');
        return true;
      }
    });
  }

  // ── Single habit item HTML ─────────────────────────────
  function _habitItemHTML(name, checked) {
    const checkedClass = checked ? 'checked' : '';
    const safeName = _escapeAttr(name);
    return `
      <div class="habit-item ${checkedClass}"
           role="checkbox"
           aria-checked="${checked}"
           aria-label="${safeName}"
           data-habit="${safeName}"
           tabindex="0">

        <span class="habit-drag-handle" aria-hidden="true" title="Hold to reorder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="3" y1="7"  x2="21" y2="7"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="17" x2="21" y2="17"/>
          </svg>
        </span>

        <div class="habit-checkbox" aria-hidden="true">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2,7 5.5,10.5 12,3.5"/>
          </svg>
        </div>

        <span class="habit-name">${_escapeHTML(name)}</span>

        <div class="habit-actions">
          <button class="btn-icon btn-habit-edit"
                  aria-label="Edit ${safeName}"
                  data-habit="${safeName}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
            </svg>
          </button>
          <button class="btn-icon btn-habit-delete"
                  aria-label="Delete ${safeName}"
                  data-habit="${safeName}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }

  // ── Bind events on a habit item ────────────────────────
  function _bindHabitItem(el) {
    const name = el.dataset.habit;

    el.addEventListener('click', e => {
      if (e.target.closest('.habit-actions'))     return;
      if (e.target.closest('.habit-drag-handle')) return;
      _toggleHabit(name, el);
    });

    el.addEventListener('keydown', e => {
      if ((e.key === ' ' || e.key === 'Enter') &&
          !e.target.closest('.habit-actions')) {
        e.preventDefault();
        _toggleHabit(name, el);
      }
    });

    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.habit-drag-handle')) return;
      _pressTimer = setTimeout(() => {
        el.classList.add('show-actions');
        _pressTimer = null;
      }, LONG_PRESS_MS);
    });

    el.addEventListener('pointerup',     _clearPress);
    el.addEventListener('pointercancel', _clearPress);
    el.addEventListener('pointermove',   _clearPress);

    el.querySelector('.btn-habit-edit')?.addEventListener('click', e => {
      e.stopPropagation();
      _openEditSheet(name);
    });

    el.querySelector('.btn-habit-delete')?.addEventListener('click', e => {
      e.stopPropagation();
      _confirmDelete(name);
    });
  }

  function _clearPress() {
    if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
  }

  // ── Toggle checkbox ────────────────────────────────────
  function _toggleHabit(name, el) {
    const newState = Storage.toggleHabit(name);
    if (newState === null) return;

    el.classList.toggle('checked', newState);
    el.setAttribute('aria-checked', String(newState));

    const todayMap = Storage.getTodayHabits();
    const checked  = Object.values(todayMap).filter(Boolean).length;
    const total    = Storage.getHabitsList().length;
    _updateProgress(checked, total);

    if (navigator.vibrate) navigator.vibrate(newState ? 30 : 10);
  }

  // ── Progress bar ───────────────────────────────────────
  function _updateProgress(checked, total) {
    if (!_progressFill || !_progressLabel) return;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
    _progressFill.style.width = `${pct}%`;
    _progressLabel.innerHTML  =
      `<span><strong>${checked}</strong> of ${total} done</span>` +
      `<span>${pct}%</span>`;
    if (checked > 0 && checked === total) {
      UI.toast('🎉 All habits done! Incredible.', 'success');
    }
  }

  // ── Edit habit ─────────────────────────────────────────
  function _openEditSheet(oldName) {
    UI.sheet({
      title: 'Edit habit',
      content: `
        <label class="input-label" for="sheet-habit-input">Habit name</label>
        <input class="input-text"
               id="sheet-habit-input"
               type="text"
               value="${_escapeAttr(oldName)}"
               autocomplete="off" />`,
      confirmLabel: 'Save',
      onOpen(sheetEl) {
        const inp = sheetEl.querySelector('#sheet-habit-input');
        setTimeout(() => { inp?.focus(); inp?.select(); }, 120);
      },
      onConfirm(sheetEl) {
        const inp     = sheetEl.querySelector('#sheet-habit-input');
        const newName = inp?.value?.trim();
        if (!newName) return false;
        if (newName === oldName) return true;
        const ok = Storage.editHabit(oldName, newName);
        if (ok) { render(); UI.toast('Habit updated', 'success'); return true; }
        UI.toast('Name already exists', 'warning');
        return false;
      }
    });
  }

  // ── Delete habit ───────────────────────────────────────
  function _confirmDelete(name) {
    UI.confirm({
      title:   `Delete "${name}"?`,
      message: 'This removes the habit and its history. Cannot be undone.',
      confirm: 'Delete',
      danger:  true,
      onConfirm() {
        Storage.removeHabit(name);
        render();
        UI.toast(`"${name}" deleted`, 'warning');
      }
    });
  }

  // ── SortableJS — one per slot list ─────────────────────
  function _initSortables(slots) {
    _destroySortables();
    if (typeof Sortable === 'undefined') return;

    slots.forEach(slot => {
      const el = document.getElementById(`slot-list-${slot.id}`);
      if (!el) return;

      const s = Sortable.create(el, {
        handle:           '.habit-drag-handle',
        animation:        150,
        delay:            150,
        delayOnTouchOnly: true,
        ghostClass:       'habit-drag-ghost',
        chosenClass:      'habit-drag-chosen',
        onEnd() {
          const newOrder = [];
          el.querySelectorAll('.habit-item[data-habit]').forEach(item => {
            newOrder.push(item.dataset.habit);
          });
          Storage.reorderHabitsInSlot(slot.id, newOrder);
        }
      });
      _sortables.push(s);
    });
  }

  function _destroySortables() {
    _sortables.forEach(s => s.destroy());
    _sortables = [];
  }

  // ── Public ─────────────────────────────────────────────
  function syncNewDay() { render(); }

  function getTodaySummary() {
    const names    = Storage.getHabitsList();
    const todayMap = Storage.getTodayHabits();
    const items    = names.map(name => ({ name, checked: !!todayMap[name] }));
    const checked  = items.filter(i => i.checked).length;
    return {
      items,
      checked,
      total: names.length,
      pct:   names.length > 0 ? Math.round((checked / names.length) * 100) : 0
    };
  }

  function _escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _escapeAttr(str) { return _escapeHTML(str); }

  return { init, render, syncNewDay, getTodaySummary };

})();