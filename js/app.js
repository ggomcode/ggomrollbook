/**
 * Main Application Controller for ggomrollbook
 */

import { SheetAPI } from './api.js';
import { RollbookModel, AcademicConfig, escapeHtml } from './models.js';
import { MovingRollbookView } from './views/movingRollbook.js';
import { HomeroomRollbookView } from './views/homeroomRollbook.js';
import { LunchCalendarView } from './views/lunchCalendar.js';
import { StudentFinderView } from './views/studentFinder.js';

class App {
  constructor() {
    const autoWeek = RollbookModel.getCurrentWeekNum();
    const autoMonth = RollbookModel.getCurrentLunchMonth();

    this.autoWeek = autoWeek;
    this.todayInfo = RollbookModel.getTodayInfo();

    this.state = {
      view: 'moving', // 'moving' | 'homeroom' | 'lunch' | 'finder'
      allStudents: [],
      holidaysMap: { fullDayEvents: {}, periodOverrides: {} },
      weeks: [],
      currentWeekNum: autoWeek,
      selectedDayIdx: 'all', // 'all' or 0 (월), 1 (화), 2 (수), 3 (목), 4 (금)
      selectedRooms: [...AcademicConfig.allRooms],
      selectedBans: [...AcademicConfig.allBans],
      selectedLunchYear: autoMonth.year,
      selectedLunchMonth: autoMonth.month,
      finderQuery: '',
      isLive: false,
      lastUpdated: null
    };

    this.allRooms = AcademicConfig.allRooms;
    this.allBans = AcademicConfig.allBans;

    // AbortController for dynamic event listeners (prevents memory leak)
    this._dynamicAbort = null;
    // Global listeners that only need to be attached once
    this._globalAbort = new AbortController();
  }

  async init() {
    this.state.weeks = RollbookModel.getAcademicWeeks();
    this.updateStatusIndicator();
    this.restoreHashState();
    this.setupEventListeners();
    await this.loadData();
    this.renderControls();
    this.renderContent();
  }

  async loadData() {
    this.showLoading(true);
    try {
      const { attendanceCsv, holidaysCsv, isLive, timestamp } = await SheetAPI.loadAllData();
      const attRows = SheetAPI.parseCsv(attendanceCsv);
      const holRows = SheetAPI.parseCsv(holidaysCsv);

      this.state.allStudents = RollbookModel.parseAttendanceData(attRows);
      this.state.holidaysMap = RollbookModel.parseHolidaysData(holRows);
      this.state.isLive = isLive;
      this.state.lastUpdated = timestamp;

      this.updateStatusIndicator();
    } catch (err) {
      console.error('Error loading data:', err);
      alert('데이터를 불러오는 중 오류가 발생했습니다. 오프라인 기본 데이터를 사용합니다.');
    } finally {
      this.showLoading(false);
    }
  }

  updateStatusIndicator() {
    const todayEl = document.getElementById('todayBadge');
    if (todayEl) {
      todayEl.innerHTML = `<span>📅</span> 오늘: <strong>${this.todayInfo.display}</strong> <span class="badge-sub">(${this.autoWeek}주차 자동 선택)</span>`;
    }

    const el = document.getElementById('syncStatus');
    if (!el) return;

    const count = this.state.allStudents.length;
    if (this.state.isLive) {
      el.className = 'status-badge status-live';
      el.innerHTML = `<span class="status-dot"></span>구글 시트 실시간 연결됨 (${count}명)`;
    } else {
      el.className = 'status-badge status-offline';
      el.innerHTML = `<span class="status-dot"></span>캐시 데이터 사용 중 (${count}명)`;
    }
  }

  setupEventListeners() {
    const signal = this._globalAbort.signal;

    // View Switcher Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        this.switchView(view);
      }, { signal });
    });

    // Refresh Data Button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('spinning');
        await this.loadData();
        refreshBtn.classList.remove('spinning');
        this.renderContent();
      }, { signal });
    }

    // Print Button — with confirmation dialog
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        this.showPrintDialog();
      }, { signal });
    }

    // Hash change listener for browser back/forward
    window.addEventListener('hashchange', () => {
      this.restoreHashState();
      this.renderControls();
      this.renderContent();
    }, { signal });
  }

  switchView(view) {
    this.state.view = view;
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    this.pushHashState();
    this.renderControls();
    this.renderContent();
  }

  // ── URL Hash State ──────────────────────────────────────────────────────
  pushHashState() {
    const { view, currentWeekNum, selectedDayIdx, selectedRooms, selectedBans, selectedLunchYear, selectedLunchMonth } = this.state;
    const params = new URLSearchParams();
    params.set('v', view);

    if (view === 'moving') {
      params.set('w', currentWeekNum);
      if (selectedDayIdx !== 'all') params.set('d', selectedDayIdx);
      if (selectedRooms.length !== this.allRooms.length) {
        params.set('r', selectedRooms.join(','));
      }
    } else if (view === 'homeroom') {
      params.set('w', currentWeekNum);
      if (selectedBans.length !== this.allBans.length) {
        params.set('b', selectedBans.join(','));
      }
    } else if (view === 'lunch') {
      params.set('y', selectedLunchYear);
      params.set('m', selectedLunchMonth);
    }

    const hash = '#' + params.toString();
    if (window.location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  restoreHashState() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    try {
      const params = new URLSearchParams(hash);
      const view = params.get('v');
      if (view && ['moving', 'homeroom', 'lunch', 'finder'].includes(view)) {
        this.state.view = view;
        document.querySelectorAll('.nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.view === view);
        });
      }

      const w = parseInt(params.get('w'), 10);
      if (!isNaN(w) && w >= AcademicConfig.startWeekNum && w <= AcademicConfig.endWeekNum) {
        this.state.currentWeekNum = w;
      }

      const d = params.get('d');
      if (d !== null) {
        this.state.selectedDayIdx = d === 'all' ? 'all' : parseInt(d, 10);
      }

      const r = params.get('r');
      if (r) this.state.selectedRooms = r.split(',').filter(v => this.allRooms.includes(v));

      const b = params.get('b');
      if (b) this.state.selectedBans = b.split(',').map(Number).filter(v => this.allBans.includes(v));

      const ly = parseInt(params.get('y'), 10);
      const lm = parseInt(params.get('m'), 10);
      if (!isNaN(ly)) this.state.selectedLunchYear = ly;
      if (!isNaN(lm)) this.state.selectedLunchMonth = lm;
    } catch (e) {
      console.warn('Failed to restore hash state:', e);
    }
  }

  // ── Print Confirmation ──────────────────────────────────────────────────
  showPrintDialog() {
    const { view, currentWeekNum, selectedRooms, selectedBans, selectedDayIdx, selectedLunchYear, selectedLunchMonth } = this.state;
    const weekObj = this.state.weeks.find(w => w.weekNum === currentWeekNum);

    let summary = '';
    let pageEstimate = 0;

    if (view === 'moving') {
      const dayCount = selectedDayIdx === 'all' ? 5 : 1;
      pageEstimate = selectedRooms.length * dayCount * 2;
      summary = `이동수업 출석부\n• ${weekObj?.label || ''}\n• ${selectedDayIdx === 'all' ? '월~금 전체' : ['월','화','수','목','금'][selectedDayIdx] + '요일'}\n• 교실: ${selectedRooms.length}개 (${selectedRooms.join(', ')})`;
    } else if (view === 'homeroom') {
      pageEstimate = selectedBans.length;
      summary = `원적학급 주간 출석부\n• ${weekObj?.label || ''}\n• 학급: ${selectedBans.length}개 (${selectedBans.map(b => b + '반').join(', ')})`;
    } else if (view === 'lunch') {
      pageEstimate = 1;
      summary = `월별 예상 급식 캘린더\n• ${selectedLunchYear}년 ${selectedLunchMonth}월`;
    } else if (view === 'finder') {
      pageEstimate = 1;
      summary = `학생·시간표 검색 결과`;
    }

    const msg = `📄 인쇄 확인\n\n${summary}\n\n📊 예상 인쇄 매수: 약 ${pageEstimate}장 (A4 가로)\n\n인쇄를 진행하시겠습니까?`;

    if (confirm(msg)) {
      window.print();
    }
  }

  // ── Controls Rendering ──────────────────────────────────────────────────
  renderControls() {
    const container = document.getElementById('toolbarControls');
    if (!container) return;

    // Abort previous dynamic listeners
    if (this._dynamicAbort) this._dynamicAbort.abort();
    this._dynamicAbort = new AbortController();

    const { view, weeks, currentWeekNum, selectedDayIdx, selectedLunchYear, selectedLunchMonth } = this.state;
    let html = '';

    if (view === 'moving') {
      // 1. Week Dropdown
      const weekOptions = weeks.map(w =>
        `<option value="${w.weekNum}" ${w.weekNum === currentWeekNum ? 'selected' : ''}>${escapeHtml(w.label)}</option>`
      ).join('');

      // 2. Day selector
      const days = ['월', '화', '수', '목', '금'];
      const dayPills = `
        <button class="pill-btn ${selectedDayIdx === 'all' ? 'active' : ''}" data-day="all">한 주 전체(월~금)</button>
        ${days.map((d, idx) => `
          <button class="pill-btn ${selectedDayIdx === idx ? 'active' : ''}" data-day="${idx}">${d}요일</button>
        `).join('')}
      `;

      // 3. Room selector
      const allSelected = this.state.selectedRooms.length === this.allRooms.length;
      const roomCheckboxes = this.allRooms.map(r => `
        <label class="check-label">
          <input type="checkbox" class="room-cb" value="${r}" ${this.state.selectedRooms.includes(r) ? 'checked' : ''} />
          ${r}
        </label>
      `).join('');

      html = `
        <div class="control-group">
          <label class="control-label">주차 선택:</label>
          <div class="week-select-container">
            <select id="weekSelect" class="styled-select">${weekOptions}</select>
            <button type="button" id="resetTodayWeekBtn" class="pill-btn ${currentWeekNum === this.autoWeek ? 'pill-today-active' : 'pill-today-jump'}" title="오늘에 해당하는 ${this.autoWeek}주차로 바로 이동">
              🎯 오늘 (${this.autoWeek}주차)
            </button>
          </div>
        </div>

        <div class="control-group">
          <label class="control-label">요일:</label>
          <div class="pill-group" id="dayPillGroup">${dayPills}</div>
        </div>

        <div class="control-group filter-dropdown-group">
          <button class="filter-dropdown-btn" id="roomFilterToggle">
            교실 필터 (${this.state.selectedRooms.length}개 선택) ▾
          </button>
          <div class="filter-dropdown-menu" id="roomFilterMenu" style="display: none;">
            <div class="filter-header">
              <label><input type="checkbox" id="selectAllRooms" ${allSelected ? 'checked' : ''} /> 전체 선택</label>
            </div>
            <div class="filter-grid">${roomCheckboxes}</div>
          </div>
        </div>
      `;
    } else if (view === 'homeroom') {
      // Week Dropdown
      const weekOptions = weeks.map(w =>
        `<option value="${w.weekNum}" ${w.weekNum === currentWeekNum ? 'selected' : ''}>${escapeHtml(w.label)}</option>`
      ).join('');

      // Ban selector
      const allSelected = this.state.selectedBans.length === this.allBans.length;
      const banCheckboxes = this.allBans.map(b => `
        <label class="check-label">
          <input type="checkbox" class="ban-cb" value="${b}" ${this.state.selectedBans.includes(b) ? 'checked' : ''} />
          ${b}반
        </label>
      `).join('');

      html = `
        <div class="control-group">
          <label class="control-label">주차 선택:</label>
          <div class="week-select-container">
            <select id="weekSelect" class="styled-select">${weekOptions}</select>
            <button type="button" id="resetTodayWeekBtn" class="pill-btn ${currentWeekNum === this.autoWeek ? 'pill-today-active' : 'pill-today-jump'}" title="오늘에 해당하는 ${this.autoWeek}주차로 바로 이동">
              🎯 오늘 (${this.autoWeek}주차)
            </button>
          </div>
        </div>

        <div class="control-group filter-dropdown-group">
          <button class="filter-dropdown-btn" id="banFilterToggle">
            학급 선택 (${this.state.selectedBans.length}개 선택) ▾
          </button>
          <div class="filter-dropdown-menu" id="banFilterMenu" style="display: none;">
            <div class="filter-header">
              <label><input type="checkbox" id="selectAllBans" ${allSelected ? 'checked' : ''} /> 전체 선택</label>
            </div>
            <div class="filter-grid">${banCheckboxes}</div>
          </div>
        </div>
      `;
    } else if (view === 'lunch') {
      const monthOptions = LunchCalendarView.getAvailableMonths().map(m =>
        `<option value="${m.year}-${m.month}" ${m.year === selectedLunchYear && m.month === selectedLunchMonth ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
      ).join('');

      html = `
        <div class="control-group">
          <label class="control-label">월 선택:</label>
          <select id="monthSelect" class="styled-select">${monthOptions}</select>
        </div>
        <div class="control-hint">
          <span>※ A4 가로 1면에 월간 급식 인원 캘린더를 인쇄합니다.</span>
        </div>
      `;
    } else if (view === 'finder') {
      html = `
        <div class="control-hint">
          <span>※ 학생 또는 교사 이름을 검색하여 실시간 교실과 시간표를 조회합니다.</span>
        </div>
      `;
    }

    container.innerHTML = html;
    this.attachDynamicControlEvents();
  }

  attachDynamicControlEvents() {
    const signal = this._dynamicAbort.signal;

    // Week select
    const weekSelect = document.getElementById('weekSelect');
    if (weekSelect) {
      weekSelect.addEventListener('change', (e) => {
        this.state.currentWeekNum = parseInt(e.target.value, 10);
        this.pushHashState();
        this.renderControls();
        this.renderContent();
      }, { signal });
    }

    // Jump to today's week button
    const resetTodayBtn = document.getElementById('resetTodayWeekBtn');
    if (resetTodayBtn) {
      resetTodayBtn.addEventListener('click', () => {
        this.state.currentWeekNum = this.autoWeek;
        this.pushHashState();
        this.renderControls();
        this.renderContent();
      }, { signal });
    }

    // Day pills
    const dayPillGroup = document.getElementById('dayPillGroup');
    if (dayPillGroup) {
      dayPillGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill-btn');
        if (!btn) return;
        const d = btn.dataset.day;
        this.state.selectedDayIdx = (d === 'all') ? 'all' : parseInt(d, 10);
        this.pushHashState();
        this.renderControls();
        this.renderContent();
      }, { signal });
    }

    // Room filter dropdown
    const roomToggle = document.getElementById('roomFilterToggle');
    const roomMenu = document.getElementById('roomFilterMenu');
    if (roomToggle && roomMenu) {
      roomToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        roomMenu.style.display = roomMenu.style.display === 'none' ? 'block' : 'none';
      }, { signal });

      // Use signal-based listener to avoid leak
      document.addEventListener('click', (e) => {
        if (!roomMenu.contains(e.target) && e.target !== roomToggle) {
          roomMenu.style.display = 'none';
        }
      }, { signal });

      const selectAll = document.getElementById('selectAllRooms');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => {
          this.state.selectedRooms = e.target.checked ? [...this.allRooms] : [];
          this.pushHashState();
          this.renderControls();
          this.renderContent();
        }, { signal });
      }

      document.querySelectorAll('.room-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = Array.from(document.querySelectorAll('.room-cb:checked')).map(el => el.value);
          this.state.selectedRooms = checked;
          this.pushHashState();
          this.renderControls();
          this.renderContent();
        }, { signal });
      });
    }

    // Ban filter dropdown
    const banToggle = document.getElementById('banFilterToggle');
    const banMenu = document.getElementById('banFilterMenu');
    if (banToggle && banMenu) {
      banToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        banMenu.style.display = banMenu.style.display === 'none' ? 'block' : 'none';
      }, { signal });

      document.addEventListener('click', (e) => {
        if (!banMenu.contains(e.target) && e.target !== banToggle) {
          banMenu.style.display = 'none';
        }
      }, { signal });

      const selectAll = document.getElementById('selectAllBans');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => {
          this.state.selectedBans = e.target.checked ? [...this.allBans] : [];
          this.pushHashState();
          this.renderControls();
          this.renderContent();
        }, { signal });
      }

      document.querySelectorAll('.ban-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = Array.from(document.querySelectorAll('.ban-cb:checked')).map(el => parseInt(el.value, 10));
          this.state.selectedBans = checked;
          this.pushHashState();
          this.renderControls();
          this.renderContent();
        }, { signal });
      });
    }

    // Month select
    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
      monthSelect.addEventListener('change', (e) => {
        const [y, m] = e.target.value.split('-').map(Number);
        this.state.selectedLunchYear = y;
        this.state.selectedLunchMonth = m;
        this.pushHashState();
        this.renderContent();
      }, { signal });
    }
  }

  renderContent() {
    const container = document.getElementById('appOutput');
    if (!container) return;

    const { view, allStudents, holidaysMap, weeks, currentWeekNum, selectedDayIdx, selectedRooms, selectedBans, selectedLunchYear, selectedLunchMonth, finderQuery } = this.state;
    const weekObj = weeks.find(w => w.weekNum === currentWeekNum) || weeks[0];

    let html = '';

    if (view === 'moving') {
      // Determine days to render
      let targetDays = weekObj.days;
      if (selectedDayIdx !== 'all') {
        targetDays = [weekObj.days[selectedDayIdx]];
      }

      html = MovingRollbookView.render(allStudents, holidaysMap, selectedRooms, targetDays);
    } else if (view === 'homeroom') {
      html = HomeroomRollbookView.render(allStudents, holidaysMap, selectedBans, weekObj);
    } else if (view === 'lunch') {
      html = LunchCalendarView.render(allStudents, holidaysMap, selectedLunchYear, selectedLunchMonth);
    } else if (view === 'finder') {
      html = StudentFinderView.render(allStudents, finderQuery);
    }

    container.innerHTML = html;

    // Attach student finder input event
    if (view === 'finder') {
      const searchInput = document.getElementById('finderSearchInput');
      if (searchInput) {
        searchInput.focus();
        searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
        searchInput.addEventListener('input', (e) => {
          this.state.finderQuery = e.target.value;
          this.renderContent();
        });
      }
    }
  }

  showLoading(show) {
    const el = document.getElementById('loadingOverlay');
    if (el) {
      el.style.display = show ? 'flex' : 'none';
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.appInstance = app;
  app.init();
});
