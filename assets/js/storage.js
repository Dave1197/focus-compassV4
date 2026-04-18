// assets/js/storage.js
// ─────────────────────────────────────────────────────────────
// Focus Compass — Storage Module
// Single source of truth. All data lives here.
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'focusCompass_v1';

const DEFAULT_STATE = {
  settings: {
    theme: 'dark',
    habitSlots: [
      { id: 'slot1', name: 'Slot 1', habits: ['Morning pages', 'Exercise'] },
      { id: 'slot2', name: 'Slot 2', habits: ['Read 30 min', 'No phone first hour'] },
      { id: 'slot3', name: 'Slot 3', habits: ['Cold shower'] }
    ],
    avoiding: '',
    sequential: '',   // ← add this line
    quotes: '',
    pomodoroGoalHours: 7,
    workMin: 30,
    breakMin: 5,
    longBreakMin: 25,
    longBreakAfter: 4
  },
  today: {
    date: null,
    habits: {},       // { habitName: true|false }
    pomodoros: 0,
    timerState: null,
    feel: 0,
    fear: 0
  },
  history: []
};

const Storage = {

  _data: null,

  // ── Bootstrap ─────────────────────────────────────────

  load() {
    try {
      if (!this._isStorageAvailable()) {
        console.warn('[Storage] localStorage unavailable — running in memory only.');
        this._data = this._deepClone(DEFAULT_STATE);
        this._migrateLegacy();
        this._checkDailyReset();
        return this;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      this._data = raw
        ? JSON.parse(raw)
        : this._deepClone(DEFAULT_STATE);
    } catch (e) {
      console.warn('[Storage] Corrupt data, resetting.', e);
      this._data = this._deepClone(DEFAULT_STATE);
    }
    this._migrateLegacy();
    this._checkDailyReset();
    this.save();
    return this;
  },

  save() {
    if (!this._isStorageAvailable()) return this; // graceful no-op
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.error('[Storage] Save failed — storage blocked or full.', e);
    }
    return this;
  },

  // ADD this new method anywhere in the Storage object:
  _isStorageAvailable() {
    try {
      const test = '__fc_test__';
      localStorage.setItem(test, '1');
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  },

  // ── Daily Reset ────────────────────────────────────────

  _checkDailyReset() {
    const today  = this._todayStr();
    const stored = this._data.today?.date;
    if (!stored) {
      this._initToday(today);
    } else if (stored !== today) {
      this._archiveDay(stored);
      this._initToday(today);
    }
  },

  _archiveDay(date) {
    const t = this._data.today;
    const record = {
      date,
      habits:      { ...t.habits },
      pomodoros:   t.pomodoros || 0,
      hoursWorked: Math.round(((t.pomodoros || 0) * 30 / 60) * 100) / 100,
      feel:        t.feel || 0,
      fear:        t.fear || 0,
      avoiding:    this._data.settings.avoiding || '',
      quotes:      this._data.settings.quotes   || ''
    };
    this._data.history.push(record);
    if (this._data.history.length > 365) {
      this._data.history = this._data.history.slice(-365);
    }
  },

  _initToday(date) {
    const freshHabits = {};
    this._getAllHabitNames().forEach(h => { freshHabits[h] = false; });
    this._data.today = {
      date,
      habits:     freshHabits,
      pomodoros:  0,
      timerState: null,
      feel:       0,
      fear:       0
    };
  },

  // ── Slot Helpers ───────────────────────────────────────

  _getAllHabitNames() {
    const slots = this._data.settings.habitSlots || [];
    return slots.flatMap(s => s.habits || []);
  },

  _getSlotById(slotId) {
    return (this._data.settings.habitSlots || []).find(s => s.id === slotId);
  },

  // ── Getters ────────────────────────────────────────────

  getTheme()            { return this._data.settings.theme || 'dark'; },
  getSettings()         { return this._data.settings; },
  getToday()            { return this._data.today; },
  getHistory()          { return this._data.history; },

  getHabitSlots()       { return this._data.settings.habitSlots || []; },
  getHabitsList()       { return this._getAllHabitNames(); },  // backward compat
  getTodayHabits()      { return this._data.today.habits || {}; },
  getAvoiding()         { return this._data.settings.avoiding || ''; },
  getQuotes()           { return this._data.settings.quotes || ''; },

  getSequential()       { return this._data.settings.sequential || ''; },

    setSequential(text) {
      this._data.settings.sequential = String(text).trim();
      return this.save();
    },

  getPomodoroCount()    { return this._data.today.pomodoros || 0; },
  getPomodoroState()    { return this._data.today.timerState || null; },
  getPomodoroGoal()     { return this._data.settings.pomodoroGoalHours || 7; },
  getPomodoroSettings() {
    const s = this._data.settings;
    return {
      workMin:        s.workMin        || 30,
      breakMin:       s.breakMin       || 5,
      longBreakMin:   s.longBreakMin   || 25,
      longBreakAfter: s.longBreakAfter || 4
    };
  },

  getFeel() { return this._data.today.feel || 0; },
  getFear() { return this._data.today.fear || 0; },

  // ── Setters ────────────────────────────────────────────

  setTheme(theme) {
    this._data.settings.theme = theme;
    return this.save();
  },

  setAvoiding(text) {
    this._data.settings.avoiding = String(text).trim();
    return this.save();
  },

  setQuotes(text) {
    this._data.settings.quotes = String(text).trim();
    return this.save();
  },

  // ── Slot CRUD ──────────────────────────────────────────

  renameSlot(slotId, newName) {
    const slot = this._getSlotById(slotId);
    if (!slot) return false;
    slot.name = String(newName).trim() || slot.name;
    return this.save();
  },

  // ── Habits CRUD (slot-aware) ───────────────────────────

  addHabit(name, slotId) {
    const n = String(name).trim();
    if (!n) return { ok: false, error: 'Name is empty' };
    if (this._getAllHabitNames().includes(n))
      return { ok: false, error: 'Already exists' };

    const slot = this._getSlotById(slotId);
    if (!slot) return { ok: false, error: 'Slot not found' };

    slot.habits.push(n);
    this._data.today.habits[n] = false;
    this.save();
    return { ok: true };
  },

  removeHabit(name) {
    const slots = this._data.settings.habitSlots || [];
    slots.forEach(slot => {
      slot.habits = slot.habits.filter(h => h !== name);
    });
    delete this._data.today.habits[name];
    return this.save();
  },

  editHabit(oldName, newName) {
    const n = String(newName).trim();
    if (!n) return false;
    if (n !== oldName && this._getAllHabitNames().includes(n)) return false;

    const slots = this._data.settings.habitSlots || [];
    let found = false;
    slots.forEach(slot => {
      const idx = slot.habits.indexOf(oldName);
      if (idx !== -1) {
        slot.habits[idx] = n;
        found = true;
      }
    });
    if (!found) return false;

    this._data.today.habits[n] = this._data.today.habits[oldName] || false;
    delete this._data.today.habits[oldName];
    this.save();
    return true;
  },

  reorderHabitsInSlot(slotId, newOrder) {
    const slot = this._getSlotById(slotId);
    if (!slot) return false;
    slot.habits = newOrder;
    return this.save();
  },

  // Keep old reorderHabits for any legacy calls
  reorderHabits(orderedArray) {
    return this.save();
  },

  // ── Daily Habit Checkboxes ─────────────────────────────

  toggleHabit(name) {
    if (!this._data.today.habits.hasOwnProperty(name)) return null;
    this._data.today.habits[name] = !this._data.today.habits[name];
    this.save();
    return this._data.today.habits[name];
  },

  resetTodayHabits() {
    Object.keys(this._data.today.habits).forEach(k => {
      this._data.today.habits[k] = false;
    });
    return this.save();
  },

  // ── Pomodoro ───────────────────────────────────────────

  setPomodoroState(state) {
    this._data.today.timerState = state;
    return this.save();
  },

  completedPomodoro() {
    this._data.today.pomodoros = (this._data.today.pomodoros || 0) + 1;
    this.save();
    return this._data.today.pomodoros;
  },

  resetPomodoros() {
    this._data.today.pomodoros = 0;
    this._data.today.timerState = null;
    return this.save();
  },

  // ── Feel & Fear ────────────────────────────────────────

  setFeel(value) {
    this._data.today.feel = Math.max(1, Math.min(5, parseInt(value, 10)));
    return this.save();
  },

  setFear(value) {
    this._data.today.fear = Math.max(1, Math.min(5, parseInt(value, 10)));
    return this.save();
  },

  // ── History Queries ────────────────────────────────────

  getHistoryRange(days) {
    if (!days) return this._data.history;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return this._data.history.filter(r => r.date >= cutoffStr);
  },

  getHabitStats(days) {
    const records = this.getHistoryRange(days);
    const stats   = {};
    this._getAllHabitNames().forEach(h => {
      stats[h] = { checked: 0, total: 0, rate: 0 };
    });
    records.forEach(record => {
      Object.entries(record.habits || {}).forEach(([h, done]) => {
        if (!stats[h]) stats[h] = { checked: 0, total: 0, rate: 0 };
        stats[h].total++;
        if (done) stats[h].checked++;
      });
    });
    Object.keys(stats).forEach(h => {
      const s = stats[h];
      s.rate = s.total > 0 ? Math.round((s.checked / s.total) * 100) : 0;
    });
    return stats;
  },

  getPomodoroSeries(days) {
    return this.getHistoryRange(days).map(r => ({
      date:      r.date,
      pomodoros: r.pomodoros,
      hours:     r.hoursWorked
    }));
  },

  getMoodSeries(days) {
    return this.getHistoryRange(days)
      .filter(r => r.feel > 0 || r.fear > 0)
      .map(r => ({ date: r.date, feel: r.feel, fear: r.fear }));
  },

  // ── Data Portability ───────────────────────────────────

  exportJSON() {
    return JSON.stringify(this._data, null, 2);
  },

  importJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.settings || !parsed.today || !Array.isArray(parsed.history))
        return { ok: false, error: 'Invalid data format' };
      this._data = parsed;
      this.save();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  nukeAll() {
    localStorage.removeItem(STORAGE_KEY);
    this._data = this._deepClone(DEFAULT_STATE);
    this.save();
  },

  // ── Internal Utilities ─────────────────────────────────

  _todayStr() {
    return new Date().toISOString().split('T')[0];
  },

  _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  _migrateLegacy() {
    // Migrate flat habits array → habitSlots structure
    if (this._data.settings.habits && !this._data.settings.habitSlots) {
      const old = this._data.settings.habits || [];
      const third = Math.ceil(old.length / 3);
      this._data.settings.habitSlots = [
        { id: 'slot1', name: 'Slot 1', habits: old.slice(0, third) },
        { id: 'slot2', name: 'Slot 2', habits: old.slice(third, third * 2) },
        { id: 'slot3', name: 'Slot 3', habits: old.slice(third * 2) }
      ];
      delete this._data.settings.habits;
    }
  }

};

Storage.load();