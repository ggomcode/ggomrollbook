/**
 * Main Application Controller for ggomrollbook
 */

import { SheetAPI } from './api.js';
import { RollbookModel } from './models.js';
import { MovingRollbookView } from './views/movingRollbook.js';
import { HomeroomRollbookView } from './views/homeroomRollbook.js';
import { LunchCalendarView } from './views/lunchCalendar.js';
import { StudentFinderView } from './views/studentFinder.js';

class App {
  constructor() {
    this.state = {
      view: 'moving', // 'moving' | 'homeroom' | 'lunch' | 'finder'
      allStudents: [],
      holidaysMap: { fullDayEvents: {}, periodOverrides: {} },
      weeks: [],
      currentWeekNum: 6, // Default 6주차 (2026.09.21)
      selectedDayIdx: 'all', // 'all' or 0 (월), 1 (화), 2 (수), 3 (목), 4 (금)
      selectedRooms: ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6', '3-7', '3-8', '3-9', '3-10', '3-11', '3-12'],
      selectedBans: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      selectedLunchYear: 2026,
      selectedLunchMonth: 9,
      finderQuery: '',
      isLive: false,
      lastUpdated: null
    };

    this.allRooms = ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6', '3-7', '3-8', '3-9', '3-10', '3-11', '3-12'];
    this.allBans = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }

  async init() {
    this.state.weeks = RollbookModel.getAcademicWeeks();
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
    const el = document.getElementById('syncStatus');
    if (!el) return;

    if (this.state.isLive) {
      el.className = 'status-badge status-live';
      el.innerHTML = `<span class="status-dot"></span>구글 시트 실시간 연결됨 (${this.state.allStudents.length}명)`;
    } else {
      el.className = 'status-badge status-offline';
      el.innerHTML = `<span class="status-dot"></span>캐시 데이터 사용 중 (${this.state.allStudents.length}명)`;
    }
  }

  setupEventListeners() {
    // View Switcher Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        this.switchView(view);
      });
    });

    // Refresh Data Button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('spinning');
        await this.loadData();
        refreshBtn.classList.remove('spinning');
        this.renderContent();
      });
    }

    // Print Button
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }
  }

  switchView(view) {
    this.state.view = view;
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    this.renderControls();
    this.renderContent();
  }

  renderControls() {
    const container = document.getElementById('toolbarControls');
    if (!container) return;

    const { view, weeks, currentWeekNum, selectedDayIdx, selectedLunchYear, selectedLunchMonth } = this.state;
    let html = '';

    if (view === 'moving') {
      // 1. Week Dropdown
      const weekOptions = weeks.map(w =>
        `<option value="${w.weekNum}" ${w.weekNum === currentWeekNum ? 'selected' : ''}>${w.label}</option>`
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
          <select id="weekSelect" class="styled-select">${weekOptions}</select>
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
        `<option value="${w.weekNum}" ${w.weekNum === currentWeekNum ? 'selected' : ''}>${w.label}</option>`
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
          <select id="weekSelect" class="styled-select">${weekOptions}</select>
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
        `<option value="${m.year}-${m.month}" ${m.year === selectedLunchYear && m.month === selectedLunchMonth ? 'selected' : ''}>${m.label}</option>`
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
    // Week select
    const weekSelect = document.getElementById('weekSelect');
    if (weekSelect) {
      weekSelect.addEventListener('change', (e) => {
        this.state.currentWeekNum = parseInt(e.target.value, 10);
        this.renderContent();
      });
    }

    // Day pills
    const dayPillGroup = document.getElementById('dayPillGroup');
    if (dayPillGroup) {
      dayPillGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.pill-btn');
        if (!btn) return;
        const d = btn.dataset.day;
        this.state.selectedDayIdx = (d === 'all') ? 'all' : parseInt(d, 10);
        this.renderControls();
        this.renderContent();
      });
    }

    // Room filter dropdown
    const roomToggle = document.getElementById('roomFilterToggle');
    const roomMenu = document.getElementById('roomFilterMenu');
    if (roomToggle && roomMenu) {
      roomToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        roomMenu.style.display = roomMenu.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', (e) => {
        if (!roomMenu.contains(e.target) && e.target !== roomToggle) {
          roomMenu.style.display = 'none';
        }
      });

      const selectAll = document.getElementById('selectAllRooms');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => {
          this.state.selectedRooms = e.target.checked ? [...this.allRooms] : [];
          this.renderControls();
          this.renderContent();
        });
      }

      document.querySelectorAll('.room-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = Array.from(document.querySelectorAll('.room-cb:checked')).map(el => el.value);
          this.state.selectedRooms = checked;
          this.renderControls();
          this.renderContent();
        });
      });
    }

    // Ban filter dropdown
    const banToggle = document.getElementById('banFilterToggle');
    const banMenu = document.getElementById('banFilterMenu');
    if (banToggle && banMenu) {
      banToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        banMenu.style.display = banMenu.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', (e) => {
        if (!banMenu.contains(e.target) && e.target !== banToggle) {
          banMenu.style.display = 'none';
        }
      });

      const selectAll = document.getElementById('selectAllBans');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => {
          this.state.selectedBans = e.target.checked ? [...this.allBans] : [];
          this.renderControls();
          this.renderContent();
        });
      }

      document.querySelectorAll('.ban-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const checked = Array.from(document.querySelectorAll('.ban-cb:checked')).map(el => parseInt(el.value, 10));
          this.state.selectedBans = checked;
          this.renderControls();
          this.renderContent();
        });
      });
    }

    // Month select
    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
      monthSelect.addEventListener('change', (e) => {
        const [y, m] = e.target.value.split('-').map(Number);
        this.state.selectedLunchYear = y;
        this.state.selectedLunchMonth = m;
        this.renderContent();
      });
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
