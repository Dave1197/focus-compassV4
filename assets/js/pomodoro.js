/* assets/js/pomodoro.js */
/* ═══════════════════════════════════════════════════════════
   FOCUS COMPASS — Pomodoro Timer Engine
   Phases:  work (30m) → break (5m) → [×4] → longBreak (25m)
   Goal:    7 hours/day = 14 pomodoros
   Key design: uses Date.now() deltas, NOT interval counting.
   ═══════════════════════════════════════════════════════════ */

const Pomodoro = (() => {

  // ── Constants ───────────────────────────────────────────
  const PHASES = {
    work:      'work',
    break:     'break',
    longBreak: 'longBreak',
    idle:      'idle'
  };

  const PHASE_LABELS = {
    work:      'Focus Time',
    break:     'Short Break',
    longBreak: 'Long Break',
    idle:      'Ready'
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 110;

  // ── State ────────────────────────────────────────────────
  let _ticker        = null;
  let _phase         = PHASES.idle;
  let _startTime     = null;
  let _pausedAt      = null;
  let _pausedElapsed = 0;
  let _sessionCount  = 0;
  let _isRunning     = false;
  let _audioCtx      = null;   // Web Audio context (lazy init)

  // ── DOM refs ─────────────────────────────────────────────
  let _ringProgress  = null;
  let _timeDisplay   = null;
  let _sessionLabel  = null;
  let _phaseLabel    = null;
  let _dotsWrap      = null;
  let _btnMain       = null;
  let _btnSkip       = null;
  let _btnReset      = null;
  let _statPomodoros = null;
  let _statHours     = null;
  let _statGoalPct   = null;
  let _goalFill      = null;
  let _goalHeader    = null;

  // ── Initialise ───────────────────────────────────────────
  function init() {
    _ringProgress  = document.getElementById('pomo-ring-progress');
    _timeDisplay   = document.getElementById('pomo-time-display');
    _sessionLabel  = document.getElementById('pomo-session-count');
    _phaseLabel    = document.getElementById('pomo-phase-label');
    _dotsWrap      = document.getElementById('pomo-dots');
    _btnMain       = document.getElementById('btn-pomo-main');
    _btnSkip       = document.getElementById('btn-pomo-skip');
    _btnReset      = document.getElementById('btn-pomo-reset');
    _statPomodoros = document.getElementById('pomo-stat-pomodoros');
    _statHours     = document.getElementById('pomo-stat-hours');
    _statGoalPct   = document.getElementById('pomo-stat-goal-pct');
    _goalFill      = document.getElementById('pomo-goal-fill');
    _goalHeader    = document.getElementById('pomo-goal-header-val');

    _bindControls();
    _restoreState();
    _renderStats();
    _requestNotificationPermission();
  }

  // ── Web Audio API ────────────────────────────────────────
  function _getAudioCtx() {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if browser suspended it (autoplay policy)
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  // Play a single tone: freq (Hz), startSec (offset), duration (s), volume
  function _tone(freq, startSec, duration = 0.35, volume = 0.4) {
    try {
      const ctx  = _getAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type      = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startSec);

      // Smooth fade-in / fade-out to avoid clicking
      gain.gain.setValueAtTime(0, ctx.currentTime + startSec);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startSec + 0.05);
      gain.gain.setValueAtTime(volume, ctx.currentTime + startSec + duration - 0.08);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startSec + duration);

      osc.start(ctx.currentTime + startSec);
      osc.stop(ctx.currentTime + startSec + duration);
    } catch (e) { /* silent fail */ }
  }

  // Work ends  → 3 calm descending bells
  function _soundWorkEnd() {
    _tone(880, 0.0);
    _tone(660, 0.45);
    _tone(523, 0.90);
  }

  // Break ends → 2 ascending energising tones
  function _soundBreakEnd() {
    _tone(523, 0.0);
    _tone(784, 0.40);
  }

  // Long break ends → triple gentle chime
  function _soundLongBreakEnd() {
    _tone(523, 0.0,  0.4, 0.35);
    _tone(659, 0.45, 0.4, 0.35);
    _tone(784, 0.90, 0.5, 0.35);
  }

  // ── Prompt Modal (bottom sheet) ──────────────────────────
  // Reuses your existing .modal-overlay / .bottom-sheet structure
  function _showPhaseEndModal({ title, message, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
    // Reuse existing confirm modal from UI if available, else build inline
    if (typeof UI !== 'undefined' && UI.confirm) {
      UI.confirm({
        title,
        message,
        confirm:   primaryLabel,
        cancel:    secondaryLabel,
        danger:    false,
        onConfirm: onPrimary,
        onCancel:  onSecondary
      });
    } else {
      // Fallback: native confirm
      const result = window.confirm(`${title}\n${message}\n\nPress OK to "${primaryLabel}" or Cancel to "${secondaryLabel}"`);
      result ? onPrimary() : onSecondary();
    }
  }

  // ── Restore persisted timer state ────────────────────────
  function _restoreState() {
    const saved = Storage.getPomodoroState();
    if (!saved || saved.phase === PHASES.idle) {
      _setIdle();
      return;
    }

    _phase         = saved.phase;
    _startTime     = saved.startTime;
    _pausedAt      = saved.pausedAt;
    _pausedElapsed = saved.pausedElapsed || 0;
    _sessionCount  = saved.pomodorosThisSession || 0;

    if (_pausedAt) {
      _isRunning = false;
      const elapsed = _pausedElapsed + (_pausedAt - _startTime);
      _renderFrame(elapsed);
      _renderPhaseUI();
      _setMainBtnState('paused');
    } else {
      _isRunning = true;
      _startTicker();
      _renderPhaseUI();
      _setMainBtnState('running');
    }

    _renderDots();
  }

  // ── Bind control buttons ─────────────────────────────────
  function _bindControls() {
    _btnMain?.addEventListener('click', () => {
      // Unlocks AudioContext on first user gesture (browser policy)
      _getAudioCtx();

      if (!_isRunning && _phase === PHASES.idle) {
        _startPhase(PHASES.work);
      } else if (_isRunning) {
        _pause();
      } else {
        _resume();
      }
    });

    _btnSkip?.addEventListener('click', () => {
      if (_phase === PHASES.idle) return;
      UI.confirm({
        title:   'Skip this phase?',
        message: _phase === PHASES.work
          ? 'Skipping work phase — pomodoro won\'t be counted.'
          : 'Skip to next focus session?',
        confirm: 'Skip',
        danger:  false,
        onConfirm() {
          _phase === PHASES.work
            ? _advancePhase(false)
            : _advancePhase(true);
        }
      });
    });

    _btnReset?.addEventListener('click', () => {
      if (_phase === PHASES.idle) return;
      UI.confirm({
        title:   'Reset timer?',
        message: 'Current session progress will be cleared.',
        confirm: 'Reset',
        danger:  true,
        onConfirm: _fullReset
      });
    });
  }

  // ── Start a phase ────────────────────────────────────────
  function _startPhase(phase) {
    _phase         = phase;
    _startTime     = Date.now();
    _pausedAt      = null;
    _pausedElapsed = 0;
    _isRunning     = true;

    _saveState();
    _renderPhaseUI();
    _setMainBtnState('running');
    _startTicker();
    _renderDots();

    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
  }

  // ── Pause ────────────────────────────────────────────────
  function _pause() {
    if (!_isRunning) return;
    _pausedAt  = Date.now();
    _isRunning = false;
    clearInterval(_ticker);
    _ticker = null;
    _saveState();
    _setMainBtnState('paused');
  }

  // ── Resume ───────────────────────────────────────────────
  function _resume() {
    if (_isRunning || !_pausedAt) return;
    _pausedElapsed += (_pausedAt - _startTime);
    _startTime  = Date.now();
    _pausedAt   = null;
    _isRunning  = true;
    _saveState();
    _setMainBtnState('running');
    _startTicker();
  }

  // ── Ticker ───────────────────────────────────────────────
  function _startTicker() {
    clearInterval(_ticker);
    _ticker = setInterval(_tick, 1000);
    _tick();
  }

  function _tick() {
    if (!_isRunning) return;
    const elapsed   = _pausedElapsed + (Date.now() - _startTime);
    const totalMs   = _getPhaseDurationMs(_phase);
    const remaining = Math.max(0, totalMs - elapsed);

    _renderFrame(elapsed);

    if (remaining <= 0) {
      _onPhaseComplete();
    }
  }

  // ── Render one timer frame ───────────────────────────────
  function _renderFrame(elapsedMs) {
    const totalMs   = _getPhaseDurationMs(_phase);
    const remaining = Math.max(0, totalMs - elapsedMs);
    const progress  = Math.min(1, elapsedMs / totalMs);

    if (_timeDisplay) _timeDisplay.textContent = _formatTime(remaining);

    if (_ringProgress) {
      const offset = RING_CIRCUMFERENCE * (1 - progress);
      _ringProgress.style.strokeDashoffset = offset.toFixed(2);

      const colorMap = {
        [PHASES.work]:      'var(--color-phase-work)',
        [PHASES.break]:     'var(--color-phase-break)',
        [PHASES.longBreak]: 'var(--color-phase-longbreak)',
        [PHASES.idle]:      'var(--color-phase-work)'
      };
      _ringProgress.style.stroke = colorMap[_phase] || colorMap[PHASES.work];
    }

    if (_goalFill && _phase === PHASES.work) {
      _goalFill.classList.add('active');
    }
  }

  // ── Phase complete — STOP and ask user ───────────────────
  function _onPhaseComplete() {
    clearInterval(_ticker);
    _ticker    = null;
    _isRunning = false;
    _setMainBtnState('paused');

    // Render the ring fully complete (avoid rounding gaps)
    if (_ringProgress) {
      _ringProgress.style.strokeDashoffset = '0';
    }
    if (_timeDisplay) {
      _timeDisplay.textContent = '00:00';
    }

    if (_phase === PHASES.work) {
      // ── Work session ended ──────────────────────────────
      const total = Storage.completedPomodoro();
      _sessionCount++;
      _renderStats();
      _renderDots();

      const settings  = Storage.getPomodoroSettings();
      const isLong    = (_sessionCount % settings.longBreakAfter === 0);
      const nextPhase = isLong ? PHASES.longBreak : PHASES.break;
      const breakLabel = isLong ? 'Long Break (25 min)' : 'Short Break (5 min)';

      // Sound + vibration
      _soundWorkEnd();
      if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 100]);
      _sendNotification(
        `Pomodoro ${total} complete! 🎯`,
        `Time for a ${isLong ? 'long' : 'short'} break. Well done.`
      );

      // Ask user
      _showPhaseEndModal({
        title:          `Session ${_sessionCount} Complete! 🎯`,
        message:        `Great focus. Start your ${breakLabel}?`,
        primaryLabel:   `Start ${breakLabel}`,
        secondaryLabel: 'Skip Break',
        onPrimary:  () => _startPhase(nextPhase),
        onSecondary:() => {
          UI.toast('Break skipped — straight to next session.', 'warning');
          _startPhase(PHASES.work);
        }
      });

    } else {
      // ── Break ended ─────────────────────────────────────
      const isLong = _phase === PHASES.longBreak;

      isLong ? _soundLongBreakEnd() : _soundBreakEnd();
      if (navigator.vibrate) navigator.vibrate([30, 20, 80]);
      _sendNotification(
        isLong ? 'Long break over 💪' : 'Break over 💪',
        'Ready for your next focus session?'
      );

      // Ask user
      _showPhaseEndModal({
        title:          isLong ? 'Long Break Complete 🏆' : 'Break Over ⏰',
        message:        isLong
          ? `${_sessionCount} pomodoros done this cycle! Start a new cycle?`
          : 'Break time is up. Ready to focus?',
        primaryLabel:   'Start Focus Session',
        secondaryLabel: 'Stop for Now',
        onPrimary:  () => _startPhase(PHASES.work),
        onSecondary:() => {
          UI.toast('Timer stopped. Good work today!', 'success');
          _fullReset();
        }
      });
    }
  }

  // ── Advance to next phase (used by Skip button) ──────────
  function _advancePhase(counted, targetPhase) {
    const settings = Storage.getPomodoroSettings();
    let next;
    if (targetPhase) {
      next = targetPhase;
    } else if (_phase === PHASES.work) {
      next = (_sessionCount % settings.longBreakAfter === 0)
        ? PHASES.longBreak
        : PHASES.break;
    } else {
      next = PHASES.work;
    }
    setTimeout(() => _startPhase(next), 400);
  }

  // ── Full reset ───────────────────────────────────────────
  function _fullReset() {
    clearInterval(_ticker);
    _ticker       = null;
    _sessionCount = 0;
    _setIdle();
    UI.toast('Timer reset', 'warning');
  }

  function _setIdle() {
    _phase         = PHASES.idle;
    _startTime     = null;
    _pausedAt      = null;
    _pausedElapsed = 0;
    _isRunning     = false;

    Storage.setPomodoroState({ phase: PHASES.idle });
    _renderPhaseUI();
    _setMainBtnState('idle');
    _renderDots();

    if (_ringProgress) {
      _ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE.toFixed(2);
    }
    if (_timeDisplay) {
      const settings = Storage.getPomodoroSettings();
      _timeDisplay.textContent = _formatTime(settings.workMin * 60 * 1000);
    }
    _goalFill?.classList.remove('active');
  }

  // ── Render phase label ───────────────────────────────────
  function _renderPhaseUI() {
    if (_phaseLabel) {
      _phaseLabel.textContent   = PHASE_LABELS[_phase] || 'Ready';
      _phaseLabel.dataset.phase = _phase;
    }
    if (_sessionLabel) {
      _sessionLabel.textContent =
        _sessionCount > 0
          ? `Session ${_sessionCount + 1}`
          : 'Start your first session';
    }
  }

  // ── Render dots ──────────────────────────────────────────
  function _renderDots() {
    if (!_dotsWrap) return;
    const settings    = Storage.getPomodoroSettings();
    const cycleSize   = settings.longBreakAfter;
    const doneInCycle = _sessionCount % cycleSize;

    let html = '';
    for (let i = 0; i < cycleSize; i++) {
      if (i < doneInCycle) {
        html += '<div class="pomo-dot done" aria-hidden="true"></div>';
      } else if (i === doneInCycle && _phase === PHASES.work && _isRunning) {
        html += '<div class="pomo-dot current" aria-hidden="true"></div>';
      } else {
        html += '<div class="pomo-dot" aria-hidden="true"></div>';
      }
    }
    _dotsWrap.innerHTML = html;
  }

  // ── Render stats ─────────────────────────────────────────
  function _renderStats() {
    const count     = Storage.getPomodoroCount();
    const goalHours = Storage.getPomodoroGoal();
    const goalPomos = goalHours * 2;
    const hours     = (count * 0.5).toFixed(1);
    const goalPct   = Math.min(100, Math.round((count / goalPomos) * 100));

    if (_statPomodoros) _statPomodoros.textContent = count;
    if (_statHours)     _statHours.textContent     = hours;
    if (_statGoalPct)   _statGoalPct.textContent   = `${goalPct}%`;
    if (_goalFill)      _goalFill.style.width       = `${goalPct}%`;
    if (_goalHeader)    _goalHeader.textContent     =
      `${hours}h / ${goalHours}h (${count} pomodoros)`;
  }

  // ── Main button icon state ───────────────────────────────
  function _setMainBtnState(state) {
    if (!_btnMain) return;
    const icons = {
      idle: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>`,
      running: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
      paused: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>`
    };
    _btnMain.innerHTML = icons[state] || icons.idle;
    _btnMain.setAttribute('aria-label',
      state === 'running' ? 'Pause timer' : 'Start timer'
    );
  }

  // ── Save state ───────────────────────────────────────────
  function _saveState() {
    Storage.setPomodoroState({
      phase:                _phase,
      startTime:            _startTime,
      pausedAt:             _pausedAt,
      pausedElapsed:        _pausedElapsed,
      pomodorosThisSession: _sessionCount
    });
  }

  // ── Helpers ──────────────────────────────────────────────
  function _getPhaseDurationMs(phase) {
    const s = Storage.getPomodoroSettings();
    const map = {
      [PHASES.work]:      s.workMin      * 60 * 1000,
      [PHASES.break]:     s.breakMin     * 60 * 1000,
      [PHASES.longBreak]: s.longBreakMin * 60 * 1000,
      [PHASES.idle]:      s.workMin      * 60 * 1000
    };
    return map[phase] || map[PHASES.work];
  }

  function _formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Notifications ────────────────────────────────────────
  function _requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      // Asked lazily on first timer start via _getAudioCtx click
    }
  }

  function _sendNotification(title, body) {
    if (!('Notification' in window)) return;
    const send = () => {
      if (Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body,
            icon:     './assets/images/logo.svg',
            tag:      'focus-compass-pomo',
            renotify: true,
            silent:   false
          });
        } catch (e) {}
      }
    };
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(send);
    } else {
      send();
    }
  }

  // ── Public ───────────────────────────────────────────────
  function onViewEnter() {
    if (_isRunning) _tick();
    _renderStats();
    _renderDots();
  }

  function getTodaySummary() {
    const count     = Storage.getPomodoroCount();
    const goalHours = Storage.getPomodoroGoal();
    const goalPomos = goalHours * 2;
    return {
      pomodoros:   count,
      hoursWorked: parseFloat((count * 0.5).toFixed(1)),
      goalHours,
      goalPomos,
      goalPct: Math.min(100, Math.round((count / goalPomos) * 100))
    };
  }

  return {
    init,
    onViewEnter,
    getTodaySummary,
    renderStats: _renderStats
  };

})();