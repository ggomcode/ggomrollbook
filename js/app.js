/**
 * Main Application Controller for ggomrollbook
 */

import { SheetAPI } from './api.js';
import { RollbookModel, AcademicConfig, escapeHtml } from './models.js';
import { MovingRollbookView } from './views/movingRollbook.js';
import { HomeroomRollbookView } from './views/homeroomRollbook.js';
import { LunchCalendarView } from './views/lunchCalendar.js';
import { StudentFinderView } from './views/studentFinder.js';
import { TodayDashboardView } from './views/todayDashboard.js';
import { AbsenceRegistryView } from './views/absenceRegistry.js';

class App {
  constructor() {
    const autoWeek = RollbookModel.getCurrentWeekNum();
    const autoMonth = RollbookModel.getCurrentLunchMonth();

    this.autoWeek = autoWeek;
    this.todayInfo = RollbookModel.getTodayInfo();

    this.state = {
      view: 'homeroom', // 'moving' | 'homeroom' | 'lunch' | 'finder' | 'today' | 'absence'
      absenceFilters: { grade: '3', ban: '', num: '', name: '', month: '', printStatus: 'all' },
      absenceRegistryRecords: [],
      allStudents: [],
      holidaysMap: { fullDayEvents: {}, periodOverrides: {} },
      weeks: [],
      currentWeekNum: autoWeek,
      selectedDayIdx: 'all', // 'all' or 0 (월), 1 (화), 2 (수), 3 (목), 4 (금)
      selectedRooms: [...AcademicConfig.allRooms],
      selectedBans: [...AcademicConfig.allBans],
      selectedLunchYear: autoMonth.year,
      selectedLunchMonth: autoMonth.month,
      showSpecialStudents: false, // 디폴트: 특수학생 표시하지 않음
      attendanceOverrides: new Map(), // key -> override record
      finderQuery: '',
      isLive: false,
      lastUpdated: null
    };

    this.allRooms = AcademicConfig.allRooms;
    this.allBans = AcademicConfig.allBans;

    // Undo stack for attendance edits
    this.undoStack = [];
    this.activeContextMenuCell = null;
    this._saveQueue = [];
    this._saveTimer = null;
    this._cachedViewBeforePrint = null;

    // AbortController for dynamic event listeners (prevents memory leak)
    this._dynamicAbort = null;
    // Global listeners that only need to be attached once
    this._globalAbort = new AbortController();
  }

  async init() {
    this.state.weeks = RollbookModel.getAcademicWeeks();
    this.updateStatusIndicator();
    this.restoreHashState();
    this.updatePrintOrientation();
    this.setupEventListeners();
    await this.loadData();
    this.renderControls();
    this.renderContent();
  }

  async loadData() {
    this.showLoading(true);
    try {
      const { attendanceCsv, holidaysCsv, recordsCsv, isLive, timestamp } = await SheetAPI.loadAllData();
      const attRows = SheetAPI.parseCsv(attendanceCsv);
      const holRows = SheetAPI.parseCsv(holidaysCsv);
      const recRows = SheetAPI.parseCsv(recordsCsv || '');

      this.state.allStudents = RollbookModel.parseAttendanceData(attRows);
      this.state.holidaysMap = RollbookModel.parseHolidaysData(holRows);
      this.state.attendanceOverrides = RollbookModel.parseAttendanceRecords(recRows);
      this.state.isLive = isLive;
      this.state.lastUpdated = timestamp;

      // 결석계 대장 연동 데이터 (백그라운드 비동기 조회)
      SheetAPI.fetchSubmittedReports().then(reports => {
        this.state.submittedReports = reports || [];
        if (this.state.submittedReports.length > 0) {
          this.applyAbsenceReportBadges();
        }
      }).catch(err => {
        console.warn('결석계 대장 연동 조회 경고:', err);
      });

      this.updateStatusIndicator();
    } catch (err) {
      console.error('Error loading data:', err);
      alert('구글 시트 데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결 또는 구글 시트 권한을 확인해 주세요.');
      this.updateStatusIndicator();
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

    const count = this.state.allStudents ? this.state.allStudents.length : 0;
    if (this.state.isLive) {
      el.className = 'status-badge status-live';
      el.innerHTML = `<span class="status-dot"></span>구글 시트 실시간 연결됨 (${count}명)`;
    } else {
      el.className = 'status-badge status-offline';
      el.innerHTML = `<span class="status-dot"></span>구글 시트 연결 실패`;
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

    // Quick Tip Banner (초보 교사용 직관 안내)
    const tipBanner = document.getElementById('quickTipBanner');
    const closeTipBtn = document.getElementById('closeQuickTipBtn');
    if (tipBanner) {
      if (localStorage.getItem('ggom_hide_quick_tip') === '1') {
        tipBanner.style.display = 'none';
      }
      if (closeTipBtn) {
        closeTipBtn.addEventListener('click', () => {
          tipBanner.style.display = 'none';
          localStorage.setItem('ggom_hide_quick_tip', '1');
        }, { signal });
      }
    }

    // Event delegation for dynamically rendered buttons (e.g., btnGoHomeroomRollbook)
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest('#btnGoHomeroomRollbook')) {
        this.switchView('homeroom');
      }
    }, { signal });

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

    // Print Button -> Open Custom Print Modal
    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
      printBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.openPrintModal();
      }, { signal });
    }

    // GAS Settings Button
    const gasSettingsBtn = document.getElementById('gasSettingsBtn');
    if (gasSettingsBtn) {
      gasSettingsBtn.addEventListener('click', () => {
        this.openGasSettingsModal();
      }, { signal });
    }

    // NEIS Report Button
    const neisReportBtn = document.getElementById('neisReportBtn');
    if (neisReportBtn) {
      neisReportBtn.addEventListener('click', () => {
        this.openNeisReportModal();
      }, { signal });
    }

    // Absence Report Button (결석계 대장 조회 및 인쇄)
    const absenceReportBtn = document.getElementById('absenceReportBtn');
    if (absenceReportBtn) {
      absenceReportBtn.addEventListener('click', () => {
        this.switchView('absence');
      }, { signal });
    }

    // Global Keydown: Ctrl+P (Print modal), Ctrl+Z (Undo), Esc (Close modal/menu)
    window.addEventListener('keydown', (e) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.openPrintModal();
      } else if (isCtrlOrMeta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.handleUndo();
      } else if (e.key === 'Escape') {
        this.closeAllModals();
        this.closeContextMenu();
      }
    }, { signal });

    // Document click to close context menu
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('attendanceContextMenu');
      if (menu && !menu.contains(e.target)) {
        this.closeContextMenu();
      }
    }, { signal });

    // Hash change listener for browser back/forward
    window.addEventListener('hashchange', () => {
      this.restoreHashState();
      this.renderControls();
      this.renderContent();
    }, { signal });

    // Attendance Interactive Cell Listeners
    this.setupAttendanceInteractionListeners();
    // Modal Listeners
    this.setupPrintModalListeners();
    this.setupGasSettingsListeners();
    this.setupNeisReportListeners();
  }

  updatePrintOrientation() {
    let styleEl = document.getElementById('printPageOrientationStyle');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'printPageOrientationStyle';
      document.head.appendChild(styleEl);
    }
    if (this.state.view === 'absence') {
      styleEl.textContent = `@page { size: A4 portrait; margin: 15mm; }`;
    } else {
      styleEl.textContent = `@page { size: A4 landscape; margin: 10mm 15mm; }`;
    }
  }

  switchView(view) {
    this.state.view = view;
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    if (view === 'absence' && (!this.state.absenceRegistryRecords || this.state.absenceRegistryRecords.length === 0)) {
      this.loadAbsenceRegistryData();
    }

    this.updatePrintOrientation();
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
      if (this.state.showSpecialStudents) params.set('sp', '1');
    } else if (view === 'homeroom') {
      params.set('w', currentWeekNum);
      if (selectedBans.length !== this.allBans.length) {
        params.set('b', selectedBans.join(','));
      }
      if (this.state.showSpecialStudents) params.set('sp', '1');
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
      if (view && ['moving', 'homeroom', 'lunch', 'finder', 'today'].includes(view)) {
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

      const sp = params.get('sp');
      if (sp !== null) {
        this.state.showSpecialStudents = (sp === '1');
      }
    } catch (e) {
      console.warn('Failed to restore hash state:', e);
    }
  }

  // ── Print Modal & Custom Print Execution ──────────────────────────────
  openPrintModal() {
    const modal = document.getElementById('printModal');
    if (!modal) return;

    const { view, weeks, currentWeekNum, selectedDayIdx, selectedRooms, selectedBans } = this.state;
    const weekObj = weeks.find(w => w.weekNum === currentWeekNum) || weeks[0];

    // 1. View badge
    const viewBadge = document.getElementById('printModalViewBadge');
    if (viewBadge) {
      if (view === 'moving') viewBadge.textContent = '이동수업 출석부 (1~12반 교실)';
      else if (view === 'homeroom') viewBadge.textContent = '원적학급 주간 출석부 (1~11반)';
      else if (view === 'lunch') viewBadge.textContent = '월별 예상 급식 캘린더';
      else if (view === 'finder') viewBadge.textContent = '학생·시간표 검색 결과';
    }

    // 2. Week select
    const weekSelect = document.getElementById('printModalWeekSelect');
    if (weekSelect) {
      weekSelect.innerHTML = weeks.map(w =>
        `<option value="${w.weekNum}" ${w.weekNum === currentWeekNum ? 'selected' : ''}>${escapeHtml(w.label)}</option>`
      ).join('');
    }

    // 3. Day checkboxes (Mon~Fri)
    const dayContainer = document.getElementById('printModalDayCheckboxes');
    if (dayContainer && weekObj) {
      const days = ['월', '화', '수', '목', '금'];
      dayContainer.innerHTML = days.map((d, idx) => {
        const isChecked = (selectedDayIdx === 'all' || selectedDayIdx === idx);
        const dayInfo = weekObj.days[idx];
        return `
          <label class="day-pill-check">
            <input type="checkbox" class="print-day-cb" value="${idx}" ${isChecked ? 'checked' : ''} />
            <span>${d}요일 (${dayInfo ? dayInfo.displayDate : ''})</span>
          </label>
        `;
      }).join('');
    }

    // 4. Target classes / rooms grid
    const targetLabel = document.getElementById('printModalTargetLabel');
    const targetGrid = document.getElementById('printModalTargetGrid');
    const selectAllTargets = document.getElementById('printModalSelectAllTargets');

    if (targetGrid) {
      if (view === 'moving') {
        if (targetLabel) targetLabel.textContent = '인쇄 대상 교실 선택 (1~12반):';
        targetGrid.innerHTML = this.allRooms.map(r => `
          <label class="target-check-card">
            <input type="checkbox" class="print-target-cb" value="${r}" ${selectedRooms.includes(r) ? 'checked' : ''} />
            <span>${r}</span>
          </label>
        `).join('');
      } else if (view === 'homeroom') {
        if (targetLabel) targetLabel.textContent = '인쇄 대상 학급 선택 (1~11반):';
        targetGrid.innerHTML = this.allBans.map(b => `
          <label class="target-check-card">
            <input type="checkbox" class="print-target-cb" value="${b}" ${selectedBans.includes(b) ? 'checked' : ''} />
            <span>${b}반</span>
          </label>
        `).join('');
      } else {
        if (targetLabel) targetLabel.textContent = '인쇄 대상:';
        targetGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 10px; color: var(--text-muted); font-size: 13px;">현재 화면(1페이지)이 인쇄됩니다.</div>`;
      }
    }

    if (selectAllTargets) {
      selectAllTargets.checked = true;
    }

    this.calculatePrintModalEstimate();
    modal.style.display = 'flex';
  }

  setupPrintModalListeners() {
    const modal = document.getElementById('printModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closePrintModalBtn');
    const cancelBtn = document.getElementById('cancelPrintModalBtn');
    const confirmBtn = document.getElementById('confirmPrintModalBtn');
    const selectAllTargets = document.getElementById('printModalSelectAllTargets');
    const weekSelect = document.getElementById('printModalWeekSelect');

    const closeModal = () => { modal.style.display = 'none'; };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    if (weekSelect) {
      weekSelect.addEventListener('change', () => {
        this.updatePrintModalDayLabels();
        this.calculatePrintModalEstimate();
      });
    }

    if (selectAllTargets) {
      selectAllTargets.addEventListener('change', (e) => {
        document.querySelectorAll('.print-target-cb').forEach(cb => {
          cb.checked = e.target.checked;
        });
        this.calculatePrintModalEstimate();
      });
    }

    modal.addEventListener('change', (e) => {
      if (e.target.classList.contains('print-day-cb') || e.target.classList.contains('print-target-cb')) {
        this.calculatePrintModalEstimate();
      }
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.executeModalPrint();
      });
    }
  }

  updatePrintModalDayLabels() {
    const weekSelect = document.getElementById('printModalWeekSelect');
    if (!weekSelect) return;
    const weekNum = parseInt(weekSelect.value, 10);
    const weekObj = this.state.weeks.find(w => w.weekNum === weekNum);
    if (!weekObj) return;

    const days = ['월', '화', '수', '목', '금'];
    document.querySelectorAll('.day-pill-check').forEach((label, idx) => {
      const span = label.querySelector('span');
      const dayInfo = weekObj.days[idx];
      if (span && dayInfo) {
        span.textContent = `${days[idx]}요일 (${dayInfo.displayDate})`;
      }
    });
  }

  calculatePrintModalEstimate() {
    const { view } = this.state;
    const countEl = document.getElementById('printModalPageCount');
    const summaryEl = document.getElementById('printModalSummary');
    if (!countEl) return;

    const checkedDays = Array.from(document.querySelectorAll('.print-day-cb:checked')).map(el => parseInt(el.value, 10));
    const checkedTargets = Array.from(document.querySelectorAll('.print-target-cb:checked')).map(el => el.value);

    let estimate = 0;
    let summaryText = '';

    if (view === 'moving') {
      estimate = checkedTargets.length * checkedDays.length * 2;
      summaryText = `교실 ${checkedTargets.length}개 × 선택 요일 ${checkedDays.length}일 × 오전/오후 2장 = 약 ${estimate}장`;
    } else if (view === 'homeroom') {
      estimate = checkedTargets.length;
      summaryText = `선택 학급 ${checkedTargets.length}개 × 주간 출석부 1장 = 약 ${estimate}장`;
    } else {
      estimate = 1;
      summaryText = `A4 가로 1장`;
    }

    countEl.textContent = `${estimate}장`;
    if (summaryEl) summaryEl.textContent = summaryText;
  }

  executeModalPrint() {
    const modal = document.getElementById('printModal');
    if (modal) modal.style.display = 'none';

    const { view, allStudents, holidaysMap, weeks, showSpecialStudents, attendanceOverrides } = this.state;
    const container = document.getElementById('appOutput');
    if (!container) return;

    const weekSelect = document.getElementById('printModalWeekSelect');
    const targetWeekNum = weekSelect ? parseInt(weekSelect.value, 10) : this.state.currentWeekNum;
    const weekObj = weeks.find(w => w.weekNum === targetWeekNum) || weeks[0];

    const checkedDayIdxs = Array.from(document.querySelectorAll('.print-day-cb:checked')).map(el => parseInt(el.value, 10));
    const targetDays = checkedDayIdxs.map(idx => weekObj.days[idx]).filter(Boolean);

    const checkedTargets = Array.from(document.querySelectorAll('.print-target-cb:checked')).map(el => el.value);

    // Save current screen view HTML to restore after printing
    this._cachedViewBeforePrint = container.innerHTML;

    // Render print view
    let printHtml = '';
    if (view === 'moving') {
      printHtml = MovingRollbookView.render(allStudents, holidaysMap, checkedTargets, targetDays, {
        showSpecialStudents,
        overridesMap: attendanceOverrides
      });
    } else if (view === 'homeroom') {
      const bansToPrint = checkedTargets.map(Number);
      printHtml = HomeroomRollbookView.render(allStudents, holidaysMap, bansToPrint, weekObj, {
        showSpecialStudents,
        overridesMap: attendanceOverrides
      });
    } else {
      printHtml = container.innerHTML;
    }

    container.innerHTML = printHtml;
    this.updatePrintOrientation();

    // Trigger print dialog
    setTimeout(() => {
      window.print();

      // Cleanly restore screen view after print dialog closes
      const restoreScreen = () => {
        if (this._cachedViewBeforePrint) {
          container.innerHTML = this._cachedViewBeforePrint;
          this._cachedViewBeforePrint = null;
        }
      };

      window.addEventListener('afterprint', restoreScreen, { once: true });
      // Fallback timer if afterprint doesn't fire
      setTimeout(restoreScreen, 1500);
    }, 150);
  }

  // ── GAS Web App Settings Modal ──────────────────────────────────────────
  openGasSettingsModal() {
    const modal = document.getElementById('gasSettingsModal');
    const input = document.getElementById('gasUrlInput');
    const keyInput = document.getElementById('teacherAuthKeyInput');
    if (input) input.value = SheetAPI.getGasUrl();
    if (keyInput) keyInput.value = localStorage.getItem('teacher_auth_key') || 'teacher2026';
    if (modal) modal.style.display = 'flex';
  }

  setupGasSettingsListeners() {
    const modal = document.getElementById('gasSettingsModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closeGasSettingsBtn');
    const cancelBtn = document.getElementById('cancelGasSettingsBtn');
    const saveBtn = document.getElementById('saveGasSettingsBtn');
    const input = document.getElementById('gasUrlInput');

    const closeModal = () => { modal.style.display = 'none'; };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const url = (input ? input.value : '').trim();
        const keyInput = document.getElementById('teacherAuthKeyInput');
        const teacherKey = (keyInput ? keyInput.value : '').trim() || 'teacher2026';
        SheetAPI.setGasUrl(url);
        localStorage.setItem('teacher_auth_key', teacherKey);
        closeModal();
        this.updateSaveIndicator(url ? 'GAS 연결됨' : 'GAS 해제됨', false);
      });
    }
  }

  // ── NEIS Monthly Attendance Summary Report Modal ─────────────────────────
  openNeisReportModal() {
    const modal = document.getElementById('neisReportModal');
    if (!modal) return;

    // 1. Populate Ban Select (1~11반)
    const banSelect = document.getElementById('neisBanSelect');
    if (banSelect && banSelect.children.length === 0) {
      banSelect.innerHTML = this.allBans.map(b => `<option value="${b}">${b}반</option>`).join('');
      if (this.state.view === 'homeroom' && this.state.selectedBans.length > 0) {
        banSelect.value = String(this.state.selectedBans[0]);
      }
    }

    // 2. Populate Month Select (3월 ~ 8월 1학기)
    const monthSelect = document.getElementById('neisMonthSelect');
    if (monthSelect && monthSelect.children.length === 0) {
      const currentYear = this.todayInfo.year || 2026;
      const currentMonth = this.todayInfo.month || 3;
      const months = [3, 4, 5, 6, 7, 8];
      monthSelect.innerHTML = months.map(m =>
        `<option value="${currentYear}-${m}" ${m === currentMonth ? 'selected' : ''}>${currentYear}년 ${m}월</option>`
      ).join('');
    }

    this.renderNeisReportTable();
    modal.style.display = 'flex';
  }

  setupNeisReportListeners() {
    const modal = document.getElementById('neisReportModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closeNeisReportBtn');
    const footerCloseBtn = document.getElementById('closeNeisReportFooterBtn');
    const banSelect = document.getElementById('neisBanSelect');
    const monthSelect = document.getElementById('neisMonthSelect');
    const copyBtn = document.getElementById('copyNeisClipboardBtn');
    const downloadCsvBtn = document.getElementById('downloadNeisCsvBtn');
    const printBtn = document.getElementById('printNeisReportBtn');

    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (footerCloseBtn) footerCloseBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    if (banSelect) banSelect.addEventListener('change', () => this.renderNeisReportTable());
    if (monthSelect) monthSelect.addEventListener('change', () => this.renderNeisReportTable());

    if (copyBtn) copyBtn.addEventListener('click', () => this.copyNeisClipboard());
    if (downloadCsvBtn) downloadCsvBtn.addEventListener('click', () => this.downloadNeisCsv());
    if (printBtn) printBtn.addEventListener('click', () => this.printNeisReport());
  }

  renderNeisReportTable() {
    const container = document.getElementById('neisTableContainer');
    const badgesContainer = document.getElementById('neisSummaryBadges');
    const banSelect = document.getElementById('neisBanSelect');
    const monthSelect = document.getElementById('neisMonthSelect');
    if (!container || !banSelect || !monthSelect) return;

    const banNum = parseInt(banSelect.value, 10) || 1;
    const [yearStr, monthStr] = monthSelect.value.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const report = RollbookModel.calculateNeisMonthlySummary(
      this.state.allStudents,
      banNum,
      year,
      month,
      this.state.attendanceOverrides,
      this.state.showSpecialStudents
    );

    this._lastNeisReport = report;

    // Badges summary
    if (badgesContainer) {
      const totAbs = report.totals.absence.total;
      const totLate = report.totals.late.total;
      const totEarly = report.totals.earlyLeave.total;
      const totSkip = report.totals.classSkipped.total;
      badgesContainer.innerHTML = `
        <span class="badge-item">재적: <strong>${report.studentCount}명</strong></span>
        <span class="badge-item">수업일수(평일): <strong>${report.datesCount}일</strong></span>
        <span class="badge-item ${totAbs > 0 ? 'badge-highlight' : ''}">총 결석: <strong>${totAbs}건</strong></span>
        <span class="badge-item ${totLate > 0 ? 'badge-highlight' : ''}">총 지각: <strong>${totLate}건</strong></span>
        <span class="badge-item ${totEarly > 0 ? 'badge-highlight' : ''}">총 조퇴: <strong>${totEarly}건</strong></span>
        <span class="badge-item ${totSkip > 0 ? 'badge-highlight' : ''}">총 결과: <strong>${totSkip}건</strong></span>
      `;
    }

    // Render Table
    const rowsHtml = report.studentsData.map(s => {
      const hasAny = s.absence.total > 0 || s.late.total > 0 || s.earlyLeave.total > 0 || s.classSkipped.total > 0;
      const rowClass = hasAny ? 'neis-row-active' : '';
      const detailsText = s.details.join(', ');

      return `
        <tr class="${rowClass}">
          <td class="col-num">${s.num}</td>
          <td class="col-id">${escapeHtml(s.studentId)}</td>
          <td class="col-name">${escapeHtml(s.name)}</td>
          <!-- 결석 -->
          <td class="col-val ${s.absence.ill ? 'num-active' : ''}">${s.absence.ill || ''}</td>
          <td class="col-val ${s.absence.unrec ? 'num-active unrec' : ''}">${s.absence.unrec || ''}</td>
          <td class="col-val ${s.absence.rec ? 'num-active rec' : ''}">${s.absence.rec || ''}</td>
          <td class="col-val ${s.absence.etc ? 'num-active' : ''}">${s.absence.etc || ''}</td>
          <td class="col-val subtotal ${s.absence.total ? 'subtotal-active' : ''}">${s.absence.total || '0'}</td>
          <!-- 지각 -->
          <td class="col-val ${s.late.ill ? 'num-active' : ''}">${s.late.ill || ''}</td>
          <td class="col-val ${s.late.unrec ? 'num-active unrec' : ''}">${s.late.unrec || ''}</td>
          <td class="col-val ${s.late.rec ? 'num-active rec' : ''}">${s.late.rec || ''}</td>
          <td class="col-val ${s.late.etc ? 'num-active' : ''}">${s.late.etc || ''}</td>
          <td class="col-val subtotal ${s.late.total ? 'subtotal-active' : ''}">${s.late.total || '0'}</td>
          <!-- 조퇴 -->
          <td class="col-val ${s.earlyLeave.ill ? 'num-active' : ''}">${s.earlyLeave.ill || ''}</td>
          <td class="col-val ${s.earlyLeave.unrec ? 'num-active unrec' : ''}">${s.earlyLeave.unrec || ''}</td>
          <td class="col-val ${s.earlyLeave.rec ? 'num-active rec' : ''}">${s.earlyLeave.rec || ''}</td>
          <td class="col-val ${s.earlyLeave.etc ? 'num-active' : ''}">${s.earlyLeave.etc || ''}</td>
          <td class="col-val subtotal ${s.earlyLeave.total ? 'subtotal-active' : ''}">${s.earlyLeave.total || '0'}</td>
          <!-- 결과 -->
          <td class="col-val ${s.classSkipped.ill ? 'num-active' : ''}">${s.classSkipped.ill || ''}</td>
          <td class="col-val ${s.classSkipped.unrec ? 'num-active unrec' : ''}">${s.classSkipped.unrec || ''}</td>
          <td class="col-val ${s.classSkipped.rec ? 'num-active rec' : ''}">${s.classSkipped.rec || ''}</td>
          <td class="col-val ${s.classSkipped.etc ? 'num-active' : ''}">${s.classSkipped.etc || ''}</td>
          <td class="col-val subtotal ${s.classSkipped.total ? 'subtotal-active' : ''}">${s.classSkipped.total || '0'}</td>
          <!-- 상세 사유 요약 (NEIS 출결 특기사항 참고용) -->
          <td class="col-details" title="${escapeHtml(detailsText)}">${escapeHtml(detailsText) || '-'}</td>
        </tr>
      `;
    }).join('');

    const t = report.totals;

    container.innerHTML = `
      <table class="neis-report-table">
        <thead>
          <tr>
            <th rowspan="2" class="th-fixed">번호</th>
            <th rowspan="2" class="th-fixed">학번</th>
            <th rowspan="2" class="th-fixed">이름</th>
            <th colspan="5" class="th-group th-abs">결석</th>
            <th colspan="5" class="th-group th-late">지각</th>
            <th colspan="5" class="th-group th-early">조퇴</th>
            <th colspan="5" class="th-group th-skip">결과</th>
            <th rowspan="2" class="th-fixed th-details">상세 일자 및 사유 (특기사항 참고)</th>
          </tr>
          <tr class="th-sub">
            <!-- 결석 -->
            <th>질병</th><th>미인정</th><th>인정</th><th>기타</th><th class="th-subtotal">계</th>
            <!-- 지각 -->
            <th>질병</th><th>미인정</th><th>인정</th><th>기타</th><th class="th-subtotal">계</th>
            <!-- 조퇴 -->
            <th>질병</th><th>미인정</th><th>인정</th><th>기타</th><th class="th-subtotal">계</th>
            <!-- 결과 -->
            <th>질병</th><th>미인정</th><th>인정</th><th>기타</th><th class="th-subtotal">계</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr class="neis-total-row">
            <th colspan="3">학급 합계</th>
            <td>${t.absence.ill || '0'}</td><td>${t.absence.unrec || '0'}</td><td>${t.absence.rec || '0'}</td><td>${t.absence.etc || '0'}</td><td class="subtotal">${t.absence.total}</td>
            <td>${t.late.ill || '0'}</td><td>${t.late.unrec || '0'}</td><td>${t.late.rec || '0'}</td><td>${t.late.etc || '0'}</td><td class="subtotal">${t.late.total}</td>
            <td>${t.earlyLeave.ill || '0'}</td><td>${t.earlyLeave.unrec || '0'}</td><td>${t.earlyLeave.rec || '0'}</td><td>${t.earlyLeave.etc || '0'}</td><td class="subtotal">${t.earlyLeave.total}</td>
            <td>${t.classSkipped.ill || '0'}</td><td>${t.classSkipped.unrec || '0'}</td><td>${t.classSkipped.rec || '0'}</td><td>${t.classSkipped.etc || '0'}</td><td class="subtotal">${t.classSkipped.total}</td>
            <td>-</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  copyNeisClipboard() {
    if (!this._lastNeisReport) return;
    const r = this._lastNeisReport;
    const header = ['번호', '학번', '이름', '결석(질병)', '결석(미인정)', '결석(인정)', '결석(기타)', '결석(계)', '지각(질병)', '지각(미인정)', '지각(인정)', '지각(기타)', '지각(계)', '조퇴(질병)', '조퇴(미인정)', '조퇴(인정)', '조퇴(기타)', '조퇴(계)', '결과(질병)', '결과(미인정)', '결과(인정)', '결과(기타)', '결과(계)', '특기사항'];
    const lines = [header.join('\t')];

    r.studentsData.forEach(s => {
      const row = [
        s.num, s.studentId, s.name,
        s.absence.ill, s.absence.unrec, s.absence.rec, s.absence.etc, s.absence.total,
        s.late.ill, s.late.unrec, s.late.rec, s.late.etc, s.late.total,
        s.earlyLeave.ill, s.earlyLeave.unrec, s.earlyLeave.rec, s.earlyLeave.etc, s.earlyLeave.total,
        s.classSkipped.ill, s.classSkipped.unrec, s.classSkipped.rec, s.classSkipped.etc, s.classSkipped.total,
        s.details.join(', ')
      ];
      lines.push(row.join('\t'));
    });

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      alert('클립보드에 복사되었습니다! 엑셀(Excel)에 [붙여넣기]하시면 표로 바로 들어갑니다.');
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
      alert('클립보드 복사에 실패했습니다.');
    });
  }

  downloadNeisCsv() {
    if (!this._lastNeisReport) return;
    const r = this._lastNeisReport;
    const header = ['번호', '학번', '이름', '결석(질병)', '결석(미인정)', '결석(인정)', '결석(기타)', '결석(계)', '지각(질병)', '지각(미인정)', '지각(인정)', '지각(기타)', '지각(계)', '조퇴(질병)', '조퇴(미인정)', '조퇴(인정)', '조퇴(기타)', '조퇴(계)', '결과(질병)', '결과(미인정)', '결과(인정)', '결과(기타)', '결과(계)', '특기사항'];
    const lines = [header.join(',')];

    r.studentsData.forEach(s => {
      const detailsEscaped = `"${s.details.join(', ').replace(/"/g, '""')}"`;
      const row = [
        s.num, s.studentId, `"${s.name}"`,
        s.absence.ill, s.absence.unrec, s.absence.rec, s.absence.etc, s.absence.total,
        s.late.ill, s.late.unrec, s.late.rec, s.late.etc, s.late.total,
        s.earlyLeave.ill, s.earlyLeave.unrec, s.earlyLeave.rec, s.earlyLeave.etc, s.earlyLeave.total,
        s.classSkipped.ill, s.classSkipped.unrec, s.classSkipped.rec, s.classSkipped.etc, s.classSkipped.total,
        detailsEscaped
      ];
      lines.push(row.join(','));
    });

    // Add UTF-8 BOM for Korean Excel compatibility
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NEIS_출결마감_3학년${r.banNum}반_${r.year}년${r.month}월.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  printNeisReport() {
    if (!this._lastNeisReport) return;
    const r = this._lastNeisReport;
    const container = document.getElementById('appOutput');
    const tableContainer = document.getElementById('neisTableContainer');
    const modal = document.getElementById('neisReportModal');
    if (!container || !tableContainer || !modal) return;

    modal.style.display = 'none';
    this._cachedViewBeforePrint = container.innerHTML;

    container.innerHTML = `
      <div class="print-page a4-landscape neis-print-page">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">[3학년 ${r.banNum}반] NEIS 출결 마감 집계표 (${r.year}년 ${r.month}월)</h2>
            <span class="page-period-tag">수업일수: ${r.datesCount}일 / 재적: ${r.studentCount}명</span>
          </div>
          <div class="page-meta">
            <span class="meta-item">담임 확인: _______ (인)</span>
          </div>
        </div>
        ${tableContainer.innerHTML}
      </div>
    `;

    setTimeout(() => {
      window.print();
      const restore = () => {
        if (this._cachedViewBeforePrint) {
          container.innerHTML = this._cachedViewBeforePrint;
          this._cachedViewBeforePrint = null;
        }
      };
      window.addEventListener('afterprint', restore, { once: true });
      setTimeout(restore, 1500);
    }, 150);
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => {
      m.style.display = 'none';
    });
  }

  // ── Attendance Interactive Cells (Click, Right-Click, Undo) ──────────────
  setupAttendanceInteractionListeners() {
    const container = document.getElementById('appOutput');
    if (!container) return;

    // 1. Left Click: Cycle Attendance Status or Mark All Present Button
    container.addEventListener('click', (e) => {
      // Button: Mark All Present in Column
      const allPresentBtn = e.target.closest('.btn-all-present');
      if (allPresentBtn) {
        const col = allPresentBtn.closest('.period-column');
        if (col) this.markAllPresentInColumn(col);
        return;
      }

      const cell = e.target.closest('.interactive-cell');
      if (!cell) return;

      const currentStatus = cell.dataset.currentStatus || '';
      const originalStatus = cell.dataset.originalStatus || '';

      const nextStatus = e.shiftKey
        ? RollbookModel.getPrevAttendanceStatus(currentStatus, originalStatus)
        : RollbookModel.getNextAttendanceStatus(currentStatus, originalStatus);

      this.applyAttendanceChange(cell, nextStatus);
    });

    // 2. Right Click: Context Menu
    container.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('.interactive-cell');
      if (!cell) return;

      e.preventDefault();
      this.openContextMenu(e, cell);
    });

    // 3. Context Menu Actions
    const menu = document.getElementById('attendanceContextMenu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item || !this.activeContextMenuCell) return;

        if (item.id === 'toggleDocSubmittedItem') {
          this.toggleDocSubmitted(this.activeContextMenuCell);
        } else if (item.id === 'applyAllPeriodsItem') {
          // Apply to all periods of the day for this student
          const targetStatus = this.activeContextMenuCell.dataset.currentStatus || '병';
          this.applyBatchAttendance(this.activeContextMenuCell, targetStatus);
        } else {
          const status = item.dataset.status !== undefined ? item.dataset.status : '';
          this.applyAttendanceChange(this.activeContextMenuCell, status);
        }

        this.closeContextMenu();
      });
    }
  }

  openContextMenu(e, cellEl) {
    const menu = document.getElementById('attendanceContextMenu');
    const title = document.getElementById('contextMenuTitle');
    if (!menu) return;

    this.activeContextMenuCell = cellEl;
    const name = cellEl.dataset.name || '';
    const num = cellEl.dataset.num || '';
    const ban = cellEl.dataset.ban || '';
    const period = cellEl.dataset.period || '';
    const date = cellEl.dataset.date || '';

    if (title) {
      title.textContent = `${ban}반 ${num}번 ${name} (${date} ${period}교시)`;
    }

    const docTextEl = document.getElementById('docSubmittedText');
    if (docTextEl) {
      const key = `${date}_${period}_${cellEl.dataset.studentId}`;
      const rec = this.state.attendanceOverrides.get(key);
      const isSub = rec && rec.docSubmitted;
      docTextEl.textContent = isSub ? '증빙서류 미제출로 변경 (취소)' : '증빙서류 제출 완료 체크 (📎)';
    }

    const reportItem = document.getElementById('viewAbsenceReportPdfItem');
    const report = this.findSubmittedReport(cellEl.dataset.studentId, date);
    if (reportItem) {
      if (report && report.pdfUrl) {
        reportItem.style.display = 'flex';
        const textEl = document.getElementById('viewAbsenceReportPdfText');
        if (textEl) {
          textEl.textContent = `결석계 원본 PDF 보기 (${report.cat}-${report.type})`;
        }
        reportItem.onclick = () => {
          window.open(report.pdfUrl, '_blank');
          this.closeContextMenu();
        };
      } else {
        reportItem.style.display = 'none';
      }
    }

    const genReportItem = document.getElementById('generateAbsenceReportItem');
    if (genReportItem) {
      genReportItem.style.display = 'flex';
      genReportItem.onclick = () => {
        this.openAbsenceQuickEditModal(cellEl);
        this.closeContextMenu();
      };
    }

    // Position menu within viewport
    let x = e.clientX;
    let y = e.clientY;
    const menuWidth = 220;
    const menuHeight = 340;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
  }

  closeContextMenu() {
    const menu = document.getElementById('attendanceContextMenu');
    if (menu) menu.style.display = 'none';
    this.activeContextMenuCell = null;
  }

  openAbsenceQuickEditModal(cellEl) {
    const modal = document.getElementById('absenceQuickEditModal');
    if (!modal) return;

    const studentId = cellEl.dataset.studentId || '';
    const date = cellEl.dataset.date || '';
    const ban = cellEl.dataset.ban || '';
    const num = cellEl.dataset.num || '';
    const name = cellEl.dataset.name || '';

    const student = this.state.allStudents.find(s => String(s.studentId) === String(studentId)) || {
      studentId, ban, num, name
    };

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dObj = new Date(date);
    const dayOfWeek = isNaN(dObj.getDay()) ? '월' : dayNames[dObj.getDay()];

    const autoReport = RollbookModel.findContiguousAbsenceRange(
      student,
      date,
      this.state.attendanceOverrides,
      this.state.holidaysMap
    ) || RollbookModel.createAbsenceReportFromRollbook(
      student,
      dayOfWeek,
      date,
      this.state.attendanceOverrides
    );

    const report = autoReport || {
      grade: '3',
      ban,
      num,
      name,
      studentId,
      cat: '결석',
      type: '질병',
      subType: '',
      startDate: date,
      endDate: date,
      startPeriod: 1,
      endPeriod: 6,
      totalDays: '1일간',
      reason: '건강상의 사유로 인한 결석',
      parentName: '학부모'
    };

    const streakNoticeEl = document.getElementById('aqeStreakNotice');
    const printModeWrapEl = document.getElementById('aqePrintModeWrap');
    const modeCombinedEl = document.getElementById('aqeModeCombined');
    const modeIndividualEl = document.getElementById('aqeModeIndividual');
    const modeCombinedLabel = document.getElementById('aqeModeCombinedLabel');
    const modeIndividualLabel = document.getElementById('aqeModeIndividualLabel');
    const modeCombinedDesc = document.getElementById('aqeModeCombinedDesc');
    const modeIndividualDesc = document.getElementById('aqeModeIndividualDesc');

    const studentInfoEl = document.getElementById('aqeStudentInfo');
    const catEl = document.getElementById('aqeCat');
    const typeEl = document.getElementById('aqeType');
    const subTypeEl = document.getElementById('aqeSubType');
    const startDateEl = document.getElementById('aqeStartDate');
    const endDateEl = document.getElementById('aqeEndDate');
    const totalDaysEl = document.getElementById('aqeTotalDays');
    const periodsEl = document.getElementById('aqePeriods');
    const reasonEl = document.getElementById('aqeReason');
    const parentNameEl = document.getElementById('aqeParentName');
    const printBtn = document.getElementById('printAqeBtn');

    if (studentInfoEl) studentInfoEl.value = `3학년 ${report.ban}반 ${report.num}번 ${report.name}`;
    if (catEl) catEl.value = report.cat;
    if (typeEl) typeEl.value = report.type;
    if (subTypeEl) subTypeEl.value = report.subType || '';
    if (startDateEl) {
      startDateEl.value = report.startDate || date;
      startDateEl.disabled = false;
    }
    if (endDateEl) {
      endDateEl.value = report.endDate || report.startDate || date;
      endDateEl.disabled = false;
    }
    if (totalDaysEl) {
      totalDaysEl.value = report.totalDays || '1일간';
      totalDaysEl.disabled = false;
    }

    const hasStreak = report.schoolDaysCount && report.schoolDaysCount > 1;

    const updateModeUI = () => {
      const isIndividual = modeIndividualEl && modeIndividualEl.checked;
      if (modeCombinedLabel) modeCombinedLabel.style.background = !isIndividual ? '#eff6ff' : 'transparent';
      if (modeIndividualLabel) modeIndividualLabel.style.background = isIndividual ? '#eff6ff' : 'transparent';

      if (isIndividual) {
        if (startDateEl) { startDateEl.value = `${report.schoolDays[0]} 외`; startDateEl.disabled = true; }
        if (endDateEl) { endDateEl.value = `${report.schoolDays[report.schoolDays.length - 1]}`; endDateEl.disabled = true; }
        if (totalDaysEl) { totalDaysEl.value = `각 1일간 (총 ${report.schoolDaysCount}장)`; totalDaysEl.disabled = true; }
        if (printBtn) printBtn.innerHTML = `🖨️ 결석계 총 ${report.schoolDaysCount}장 분할 인쇄`;
      } else {
        if (startDateEl) { startDateEl.value = report.startDate || date; startDateEl.disabled = false; }
        if (endDateEl) { endDateEl.value = report.endDate || report.startDate || date; endDateEl.disabled = false; }
        if (totalDaysEl) { totalDaysEl.value = report.totalDays || '1일간'; totalDaysEl.disabled = false; }
        if (printBtn) {
          printBtn.innerHTML = hasStreak
            ? `🖨️ 결석계 1장 통합 인쇄 (${report.totalDays || report.schoolDaysCount + '일간'})`
            : `🖨️ 결석계 인쇄`;
        }
      }
    };

    if (hasStreak) {
      if (streakNoticeEl) {
        streakNoticeEl.style.display = 'block';
        streakNoticeEl.innerHTML = `✨ <strong>연속 출결 감지:</strong> 주말 및 공휴일을 제외한 동일 사유 연속 출결(총 <strong>${report.schoolDaysCount}일간</strong>)이 감지되었습니다. 1장으로 통합 인쇄할지 여러 장으로 나눠서 인쇄할지 아래에서 선택해주세요.`;
      }
      if (printModeWrapEl) printModeWrapEl.style.display = 'block';
      if (modeCombinedEl) modeCombinedEl.checked = true;
      if (modeCombinedDesc) {
        modeCombinedDesc.textContent = `${report.startDate} ~ ${report.endDate} (${report.totalDays}) → 1장으로 묶어서 출력`;
      }
      if (modeIndividualDesc) {
        const daysPreview = (report.schoolDays && report.schoolDays.length <= 4)
          ? report.schoolDays.join(', ')
          : `${report.schoolDays[0]} ~ ${report.schoolDays[report.schoolDays.length - 1]} (${report.schoolDaysCount}일)`;
        modeIndividualDesc.textContent = `${daysPreview} → 날짜별로 1장씩 총 ${report.schoolDaysCount}장 분할 출력`;
      }

      if (modeCombinedEl) modeCombinedEl.onchange = updateModeUI;
      if (modeIndividualEl) modeIndividualEl.onchange = updateModeUI;
      updateModeUI();
    } else {
      if (streakNoticeEl) streakNoticeEl.style.display = 'none';
      if (printModeWrapEl) printModeWrapEl.style.display = 'none';
      if (modeCombinedEl) modeCombinedEl.checked = true;
      if (printBtn) printBtn.innerHTML = '🖨️ 결석계 인쇄';
    }

    if (periodsEl) {
      periodsEl.value = (report.startPeriod && report.endPeriod)
        ? `${report.startPeriod}교시 ~ ${report.endPeriod}교시`
        : (report.startPeriod ? `${report.startPeriod}교시` : '');
    }
    if (reasonEl) reasonEl.value = report.reason;
    if (parentNameEl) parentNameEl.value = report.parentName || '학부모';

    // SubType visibility sync
    const syncSubTypeWrap = () => {
      const wrap = document.getElementById('aqeSubTypeWrap');
      if (wrap) {
        wrap.style.display = (typeEl && typeEl.value === '출석인정') ? 'block' : 'none';
      }
    };
    syncSubTypeWrap();
    if (typeEl) {
      typeEl.onchange = syncSubTypeWrap;
    }

    const closeModal = () => {
      if (startDateEl) startDateEl.disabled = false;
      if (endDateEl) endDateEl.disabled = false;
      if (totalDaysEl) totalDaysEl.disabled = false;
      modal.style.display = 'none';
    };
    const closeBtn = document.getElementById('closeAqeModalBtn');
    const cancelBtn = document.getElementById('cancelAqeModalBtn');
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    if (printBtn) {
      printBtn.onclick = () => {
        let sp = '';
        let ep = '';
        if (periodsEl && periodsEl.value) {
          const m = periodsEl.value.match(/(\d+)/g);
          if (m && m.length >= 2) {
            sp = m[0]; ep = m[1];
          } else if (m && m.length === 1) {
            sp = m[0]; ep = m[0];
          }
        }

        const isIndividual = hasStreak && modeIndividualEl && modeIndividualEl.checked;

        if (isIndividual) {
          // 날짜별로 1장씩 분할 인쇄
          const records = (report.schoolDays || [date]).map(dStr => ({
            grade: '3',
            ban: report.ban,
            num: report.num,
            name: report.name,
            cat: catEl ? catEl.value : report.cat,
            type: typeEl ? typeEl.value : report.type,
            subType: subTypeEl ? subTypeEl.value.trim() : '',
            startDate: dStr,
            endDate: dStr,
            startPeriod: sp,
            endPeriod: ep,
            totalDays: '1일간',
            reason: reasonEl ? reasonEl.value.trim() : '',
            parentName: parentNameEl ? (parentNameEl.value.trim() || '학부모') : '학부모',
            writeDate: dStr,
            studentSigUrl: '',
            parentSigUrl: ''
          }));

          closeModal();
          this.printAbsenceRecords(records);
        } else {
          // 1장으로 통합 인쇄
          const sDateVal = (startDateEl && !startDateEl.disabled) ? startDateEl.value : (report.startDate || date);
          const eDateVal = (endDateEl && !endDateEl.disabled) ? endDateEl.value : (report.endDate || sDateVal);

          const finalRecord = {
            grade: '3',
            ban: report.ban,
            num: report.num,
            name: report.name,
            cat: catEl ? catEl.value : report.cat,
            type: typeEl ? typeEl.value : report.type,
            subType: subTypeEl ? subTypeEl.value.trim() : '',
            startDate: sDateVal,
            endDate: eDateVal,
            startPeriod: sp,
            endPeriod: ep,
            totalDays: (totalDaysEl && !totalDaysEl.disabled) ? totalDaysEl.value.trim() : (report.totalDays || '1일간'),
            reason: reasonEl ? reasonEl.value.trim() : '',
            parentName: parentNameEl ? (parentNameEl.value.trim() || '학부모') : '학부모',
            writeDate: eDateVal || sDateVal || date,
            studentSigUrl: '',
            parentSigUrl: ''
          };

          closeModal();
          this.printAbsenceRecords([finalRecord]);
        }
      };
    }

    modal.style.display = 'flex';
  }

  toggleDocSubmitted(cellEl) {
    if (!cellEl) return;
    const { studentId, date, period, ban, num, name, room, originalStatus, currentStatus } = cellEl.dataset;
    const key = `${date}_${period}_${studentId}`;
    let rec = this.state.attendanceOverrides.get(key);

    if (!rec) {
      const statusToSet = currentStatus || originalStatus || '';
      if (!statusToSet || statusToSet === '출석') {
        alert('출석인정 또는 결석 사유가 있는 셀에만 증빙서류를 체크할 수 있습니다.');
        return;
      }
      rec = {
        key,
        date,
        period: parseInt(period, 10) || period,
        studentId,
        ban,
        num,
        name,
        room: room || '',
        status: statusToSet,
        docSubmitted: true,
        updatedAt: new Date().toISOString()
      };
      this.state.attendanceOverrides.set(key, rec);
    } else {
      rec.docSubmitted = !rec.docSubmitted;
      rec.updatedAt = new Date().toISOString();
    }

    cellEl.classList.toggle('doc-submitted', !!rec.docSubmitted);
    this.updateRemarkDom(studentId);
    this.scheduleSaveToGas(rec);
  }

  applyAttendanceChange(cellEl, nextStatus) {
    const { studentId, date, period, ban, num, name, room, originalStatus, currentStatus } = cellEl.dataset;
    const key = `${date}_${period}_${studentId}`;

    // Push to undo stack
    this.undoStack.push({
      type: 'single',
      key,
      prevStatus: currentStatus || '',
      nextStatus: nextStatus || '',
      cellInfo: { studentId, date, period, ban, num, name, room, originalStatus }
    });
    if (this.undoStack.length > 50) this.undoStack.shift();

    const isBackToOriginal = RollbookModel.isStatusEquivalent(nextStatus, originalStatus);

    // Update memory map
    if (isBackToOriginal) {
      this.state.attendanceOverrides.delete(key);
    } else {
      this.state.attendanceOverrides.set(key, {
        key,
        date,
        period: parseInt(period, 10) || period,
        studentId,
        ban,
        num,
        name,
        room: room || '',
        status: nextStatus,
        updatedAt: new Date().toISOString()
      });
    }

    // Instant DOM update (zero lag)
    this.updateCellDom(cellEl, nextStatus, originalStatus);
    this.updateRemarkDom(studentId);
    this.updateStatsDom(cellEl);

    // Schedule background GAS save / delete
    if (isBackToOriginal) {
      this.scheduleSaveToGas({
        key,
        date,
        period,
        studentId,
        ban,
        num,
        name,
        room,
        status: '',
        action: 'delete'
      });
    } else {
      this.scheduleSaveToGas({
        key,
        date,
        period,
        studentId,
        ban,
        num,
        name,
        room,
        status: nextStatus
      });
    }
  }

  applyBatchAttendance(cellEl, targetStatus) {
    const { studentId, date, ban, num, name } = cellEl.dataset;
    if (!studentId || !date) return;

    // Find all cells for this student on this date currently rendered
    const cells = Array.from(document.querySelectorAll(`.interactive-cell[data-student-id="${studentId}"][data-date="${date}"]`));
    if (cells.length === 0) return;

    const undoBatch = [];
    const recordsToSave = [];

    cells.forEach(c => {
      const period = c.dataset.period;
      const key = `${date}_${period}_${studentId}`;
      const prevStatus = c.dataset.currentStatus || '';
      const origStatus = c.dataset.originalStatus || '';

      undoBatch.push({
        key,
        prevStatus,
        nextStatus: targetStatus,
        cellInfo: { ...c.dataset }
      });

      const isBackToOriginal = RollbookModel.isStatusEquivalent(targetStatus, origStatus);

      if (isBackToOriginal) {
        this.state.attendanceOverrides.delete(key);
        recordsToSave.push({
          key,
          date,
          period,
          studentId,
          ban,
          num,
          name,
          room: c.dataset.room || '',
          status: '',
          action: 'delete'
        });
      } else {
        this.state.attendanceOverrides.set(key, {
          key,
          date,
          period: parseInt(period, 10) || period,
          studentId,
          ban,
          num,
          name,
          room: c.dataset.room || '',
          status: targetStatus,
          updatedAt: new Date().toISOString()
        });
        recordsToSave.push({
          key,
          date,
          period,
          studentId,
          ban,
          num,
          name,
          room: c.dataset.room || '',
          status: targetStatus
        });
      }

      this.updateCellDom(c, targetStatus, origStatus);
    });

    this.updateRemarkDom(studentId);
    this.updateStatsDom(cellEl);

    this.undoStack.push({ type: 'batch', records: undoBatch });
    if (this.undoStack.length > 50) this.undoStack.shift();

    this.scheduleSaveToGas(recordsToSave);
  }

  markAllPresentInColumn(columnEl) {
    if (!columnEl) return;
    const cells = Array.from(columnEl.querySelectorAll('.interactive-cell'));
    if (cells.length === 0) return;

    // Filter cells that are currently NOT present
    const cellsToChange = cells.filter(c => {
      const curr = (c.dataset.currentStatus || '').trim();
      return curr !== '' && curr !== '출석';
    });

    if (cellsToChange.length === 0) {
      alert('이미 이 교시의 모든 학생이 출석 상태입니다.');
      return;
    }

    const undoBatch = [];
    const recordsToSave = [];
    const changedStudentIds = new Set();

    cellsToChange.forEach(c => {
      const { studentId, date, period, ban, num, name, room, originalStatus, currentStatus } = c.dataset;
      const key = `${date}_${period}_${studentId}`;

      undoBatch.push({
        key,
        prevStatus: currentStatus || '',
        nextStatus: '',
        cellInfo: { ...c.dataset }
      });

      const isBackToOriginal = RollbookModel.isStatusEquivalent('', originalStatus);
      if (isBackToOriginal) {
        this.state.attendanceOverrides.delete(key);
        recordsToSave.push({
          key,
          date,
          period,
          studentId,
          ban,
          num,
          name,
          room: room || '',
          status: '',
          action: 'delete'
        });
      } else {
        this.state.attendanceOverrides.set(key, {
          key,
          date,
          period: parseInt(period, 10) || period,
          studentId,
          ban,
          num,
          name,
          room: room || '',
          status: '',
          updatedAt: new Date().toISOString()
        });
        recordsToSave.push({
          key,
          date,
          period,
          studentId,
          ban,
          num,
          name,
          room: room || '',
          status: ''
        });
      }

      this.updateCellDom(c, '', originalStatus);
      changedStudentIds.add(studentId);
    });

    // Update remarks for all changed students
    changedStudentIds.forEach(stId => this.updateRemarkDom(stId));

    // Update column footer stats
    this.updateStatsDom(cellsToChange[0]);

    // Push to undo stack
    this.undoStack.push({ type: 'batch', records: undoBatch });
    if (this.undoStack.length > 50) this.undoStack.shift();

    // Schedule save to GAS
    this.scheduleSaveToGas(recordsToSave);
  }

  updateCellDom(cellEl, statusText, originalStatus) {
    cellEl.dataset.currentStatus = statusText;
    const isOverridden = !RollbookModel.isStatusEquivalent(statusText, originalStatus);

    cellEl.classList.toggle('cell-overridden', isOverridden);

    // Remove all old category classes
    cellEl.classList.remove('status-jilbyeong', 'status-miinjeong', 'status-saenggyeol', 'status-cheheom', 'status-gyeongjosa', 'status-jeonyeom', 'status-gita', 'status-present');

    if (isOverridden) {
      const cat = RollbookModel.getCategoryFromRawStatus(statusText);
      if (cat === 'jilbyeong') cellEl.classList.add('status-jilbyeong');
      else if (cat === 'miinjeong') cellEl.classList.add('status-miinjeong');
      else if (cat === 'saenggyeol') cellEl.classList.add('status-saenggyeol');
      else if (cat === 'cheheom') cellEl.classList.add('status-cheheom');
      else if (cat === 'gyeongjosa') cellEl.classList.add('status-gyeongjosa');
      else if (cat === 'jeonyeom') cellEl.classList.add('status-jeonyeom');
      else if (cat === 'gita') cellEl.classList.add('status-gita');
      else if (cat === 'present') cellEl.classList.add('status-present');
    }

    // Determine 10% tint shading
    const isPresent = (!statusText || statusText === '출석');
    const orig = (originalStatus || '').trim();
    const isOriginalShaded = !!(orig && orig !== '출석');
    const shouldBeShaded = isOverridden ? !isPresent : isOriginalShaded;
    cellEl.classList.toggle('cell-tint-10', shouldBeShaded);

    // Narrow cell displays 1 character (e.g. '인' for '인(생리)', '인(체험)', etc.)
    const displayText = RollbookModel.getStatusDisplayText(statusText);
    const isSm = cellEl.classList.contains('period-cell');
    const boxClass = isSm ? 'check-box-sm' : 'check-box';
    cellEl.innerHTML = displayText ? escapeHtml(displayText) : `<span class="${boxClass}"></span>`;

    const key = `${cellEl.dataset.date}_${cellEl.dataset.period}_${cellEl.dataset.studentId}`;
    const rec = this.state.attendanceOverrides.get(key);
    cellEl.classList.toggle('doc-submitted', !!(rec && rec.docSubmitted));
  }

  updateRemarkDom(studentId) {
    if (!studentId) return;
    const student = this.state.allStudents.find(s => s.studentId === studentId);
    const remarkCells = document.querySelectorAll(`td.col-remark[data-student-id="${studentId}"]`);
    remarkCells.forEach(cell => {
      const baseRemark = cell.dataset.baseRemark || '';
      const tr = cell.closest('tr');

      // 1. Moving Rollbook view (single period column): keep it clean and period-specific
      const periodCol = cell.closest('.period-column');
      if (periodCol) {
        const periodCell = tr ? tr.querySelector('.interactive-cell[data-period]') : null;
        const currentStatus = periodCell ? (periodCell.dataset.currentStatus || '') : '';
        const periodRemark = RollbookModel.getStatusRemarkText(currentStatus);
        cell.textContent = (baseRemark && periodRemark) ? `${baseRemark}, ${periodRemark}` : (periodRemark || baseRemark);
        return;
      }

      // 2. Multi-period / Homeroom view:
      const dateCells = tr ? tr.querySelectorAll('.interactive-cell[data-date]') : [];
      const dates = Array.from(new Set(Array.from(dateCells).map(c => c.dataset.date))).filter(Boolean);

      const newRemark = RollbookModel.getEffectiveDisplayRemark(
        baseRemark,
        studentId,
        dates,
        this.state.attendanceOverrides,
        this.state.showSpecialStudents,
        student
      );
      cell.textContent = newRemark;
    });
  }

  updateStatsDom(cellEl) {
    if (!cellEl) return;

    // 1. Moving Rollbook View: Update footer stats of .period-column
    const columnEl = cellEl.closest('.period-column');
    if (columnEl) {
      const cells = Array.from(columnEl.querySelectorAll('.interactive-cell'));
      let presentCount = 0;
      const stats = {
        saenggyeol: 0,
        cheheom: 0,
        gyeongjosa: 0,
        jeonyeom: 0,
        jilbyeong: 0,
        gita: 0,
        miinjeong: 0
      };

      cells.forEach(c => {
        const curr = (c.dataset.currentStatus || '').trim();
        const cat = RollbookModel.getCategoryFromRawStatus(curr);
        if (cat === 'present') {
          presentCount++;
        } else if (stats[cat] !== undefined) {
          stats[cat]++;
        }
      });

      const expEl = columnEl.querySelector('.stat-val.expected-count');
      if (expEl) expEl.textContent = `${presentCount}명`;

      const assignEl = columnEl.querySelector('.stat-total .assigned-count');
      if (assignEl) assignEl.textContent = `${cells.length}`;

      Object.keys(stats).forEach(k => {
        const itemEl = columnEl.querySelector(`.stat-grid-item[data-stat-key="${k}"]`);
        if (itemEl) {
          const valEl = itemEl.querySelector('.sg-val');
          const count = stats[k];
          if (valEl) valEl.textContent = `${count}명`;
          itemEl.classList.toggle('has-count', count > 0);
        }
      });
    }

    // 2. Homeroom Rollbook View: Update tfoot daily stats of .homeroom-table
    const tableEl = cellEl.closest('.homeroom-table');
    const dateStr = cellEl.dataset.date;
    if (tableEl && dateStr) {
      const banNum = parseInt(tableEl.dataset.ban, 10);
      const students = this.state.allStudents.filter(s => s.ban === banNum);
      const dayOfWeek = AcademicConfig.getDayOfWeek(dateStr);
      const stats = HomeroomRollbookView._calcDailyStats(
        students,
        dayOfWeek,
        dateStr,
        this.state.attendanceOverrides,
        this.state.showSpecialStudents
      );

      const presCell = tableEl.querySelector(`.stat-presence-cell[data-date="${dateStr}"]`);
      if (presCell) {
        presCell.innerHTML = `<span class="stat-main-num">${stats.present}명</span> <span class="stat-sub">/ ${students.length}명</span>`;
      }

      const absCell = tableEl.querySelector(`.stat-absence-cell[data-date="${dateStr}"]`);
      if (absCell) {
        const text = `결석 ${stats.absence} · 지각 ${stats.late} · 조퇴 ${stats.earlyLeave} · 결과 ${stats.classSkipped}`;
        const hasAny = (stats.absence + stats.late + stats.earlyLeave + stats.classSkipped) > 0;
        absCell.textContent = text;
        absCell.classList.toggle('has-absence', hasAny);
      }
    }
  }

  handleUndo() {
    if (!this.undoStack.length) {
      alert('더 이상 되돌릴 변경 사항이 없습니다.');
      return;
    }

    const item = this.undoStack.pop();
    const recordsToRevert = [];

    if (item.type === 'single') {
      const { key, prevStatus, cellInfo } = item;
      const isBackToOriginal = RollbookModel.isStatusEquivalent(prevStatus, cellInfo.originalStatus);

      if (isBackToOriginal) {
        this.state.attendanceOverrides.delete(key);
        recordsToRevert.push({
          key,
          date: cellInfo.date,
          period: cellInfo.period,
          studentId: cellInfo.studentId,
          ban: cellInfo.ban,
          num: cellInfo.num,
          name: cellInfo.name,
          room: cellInfo.room,
          status: '',
          action: 'delete'
        });
      } else {
        this.state.attendanceOverrides.set(key, {
          key,
          date: cellInfo.date,
          period: parseInt(cellInfo.period, 10) || cellInfo.period,
          studentId: cellInfo.studentId,
          ban: cellInfo.ban,
          num: cellInfo.num,
          name: cellInfo.name,
          room: cellInfo.room,
          status: prevStatus,
          updatedAt: new Date().toISOString()
        });
        recordsToRevert.push({
          key,
          date: cellInfo.date,
          period: cellInfo.period,
          studentId: cellInfo.studentId,
          ban: cellInfo.ban,
          num: cellInfo.num,
          name: cellInfo.name,
          room: cellInfo.room,
          status: prevStatus
        });
      }

      // Update visible cell if currently rendered
      const cellEl = document.querySelector(`.interactive-cell[data-student-id="${cellInfo.studentId}"][data-date="${cellInfo.date}"][data-period="${cellInfo.period}"]`);
      if (cellEl) {
        this.updateCellDom(cellEl, prevStatus, cellInfo.originalStatus);
        this.updateStatsDom(cellEl);
      }
      this.updateRemarkDom(cellInfo.studentId);
    } else if (item.type === 'batch') {
      let studentIdToUpdate = null;
      let lastCell = null;
      item.records.forEach(rec => {
        const { key, prevStatus, cellInfo } = rec;
        studentIdToUpdate = cellInfo.studentId;
        const isBackToOriginal = RollbookModel.isStatusEquivalent(prevStatus, cellInfo.originalStatus);

        if (isBackToOriginal) {
          this.state.attendanceOverrides.delete(key);
          recordsToRevert.push({
            key,
            date: cellInfo.date,
            period: cellInfo.period,
            studentId: cellInfo.studentId,
            ban: cellInfo.ban,
            num: cellInfo.num,
            name: cellInfo.name,
            room: cellInfo.room,
            status: '',
            action: 'delete'
          });
        } else {
          this.state.attendanceOverrides.set(key, {
            key,
            date: cellInfo.date,
            period: parseInt(cellInfo.period, 10) || cellInfo.period,
            studentId: cellInfo.studentId,
            ban: cellInfo.ban,
            num: cellInfo.num,
            name: cellInfo.name,
            room: cellInfo.room,
            status: prevStatus,
            updatedAt: new Date().toISOString()
          });
          recordsToRevert.push({
            key,
            date: cellInfo.date,
            period: cellInfo.period,
            studentId: cellInfo.studentId,
            ban: cellInfo.ban,
            num: cellInfo.num,
            name: cellInfo.name,
            room: cellInfo.room,
            status: prevStatus
          });
        }

        const cellEl = document.querySelector(`.interactive-cell[data-student-id="${cellInfo.studentId}"][data-date="${cellInfo.date}"][data-period="${cellInfo.period}"]`);
        if (cellEl) {
          this.updateCellDom(cellEl, prevStatus, cellInfo.originalStatus);
          lastCell = cellEl;
        }
      });

      if (studentIdToUpdate) {
        this.updateRemarkDom(studentIdToUpdate);
      }
      if (lastCell) {
        this.updateStatsDom(lastCell);
      }
    }

    this.scheduleSaveToGas(recordsToRevert);
  }

  scheduleSaveToGas(recordOrRecords) {
    const list = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
    this._saveQueue.push(...list);

    this.updateSaveIndicator('저장 중... ☁️', true);

    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      const recordsToSend = [...this._saveQueue];
      this._saveQueue = [];
      try {
        const res = await SheetAPI.saveAttendanceRecords(recordsToSend);
        if (res && res.status === 'no_gas_url') {
          this.updateSaveIndicator('GAS URL 미설정', false);
        } else {
          this.updateSaveIndicator('저장 완료 ✅', false);
          setTimeout(() => {
            const badge = document.getElementById('saveStatus');
            if (badge) badge.style.display = 'none';
          }, 3000);
        }
      } catch (err) {
        console.error('Save to GAS failed:', err);
        this.updateSaveIndicator('저장 실패 ⚠️', false);
      }
    }, 600);
  }

  updateSaveIndicator(text, isSaving) {
    const badge = document.getElementById('saveStatus');
    const textEl = document.getElementById('saveStatusText');
    if (!badge || !textEl) return;

    badge.style.display = 'inline-flex';
    textEl.textContent = text;
    badge.className = `status-badge ${isSaving ? 'status-saving' : 'status-saved'}`;
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

      const specialToggleHtml = `
        <div class="control-group toggle-group special-toggle-group">
          <label class="toggle-switch-label" for="specialStudentToggle" title="출석부 체크박스와 비고란에 특수학생 표시 여부를 전환합니다 (기본값: OFF)">
            <span class="toggle-title">특수학생 표시:</span>
            <span class="toggle-switch">
              <input type="checkbox" id="specialStudentToggle" class="toggle-input" ${this.state.showSpecialStudents ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </span>
            <span class="toggle-badge ${this.state.showSpecialStudents ? 'badge-on' : 'badge-off'}">
              ${this.state.showSpecialStudents ? 'ON' : 'OFF'}
            </span>
          </label>
        </div>
      `;

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

        ${specialToggleHtml}
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

      const specialToggleHtml = `
        <div class="control-group toggle-group special-toggle-group">
          <label class="toggle-switch-label" for="specialStudentToggle" title="출석부 체크박스와 비고란에 특수학생 표시 여부를 전환합니다 (기본값: OFF)">
            <span class="toggle-title">특수학생 표시:</span>
            <span class="toggle-switch">
              <input type="checkbox" id="specialStudentToggle" class="toggle-input" ${this.state.showSpecialStudents ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </span>
            <span class="toggle-badge ${this.state.showSpecialStudents ? 'badge-on' : 'badge-off'}">
              ${this.state.showSpecialStudents ? 'ON' : 'OFF'}
            </span>
          </label>
        </div>
      `;

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

        ${specialToggleHtml}
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
    } else if (view === 'today') {
      const specialToggleHtml = `
        <div class="control-group toggle-group special-toggle-group">
          <label class="toggle-switch-label" for="specialStudentToggle" title="출석부 체크박스와 비고란에 특수학생 표시 여부를 전환합니다 (기본값: OFF)">
            <span class="toggle-title">특수학생 표시:</span>
            <span class="toggle-switch">
              <input type="checkbox" id="specialStudentToggle" class="toggle-input" ${this.state.showSpecialStudents ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </span>
            <span class="toggle-badge ${this.state.showSpecialStudents ? 'badge-on' : 'badge-off'}">
              ${this.state.showSpecialStudents ? 'ON' : 'OFF'}
            </span>
          </label>
        </div>
      `;

      html = `
        <div class="control-hint">
          <span>※ 오늘 날짜(${this.todayInfo.display}) 기준 3학년 전체 교무실 출결 브리핑 및 학급별 현황판입니다.</span>
        </div>
        ${specialToggleHtml}
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

    // Special student toggle
    const specialToggle = document.getElementById('specialStudentToggle');
    if (specialToggle) {
      specialToggle.addEventListener('change', (e) => {
        this.state.showSpecialStudents = e.target.checked;
        this.pushHashState();
        this.renderControls();
        this.renderContent();
      }, { signal });
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

    const { view, allStudents, holidaysMap, weeks, currentWeekNum, selectedDayIdx, selectedRooms, selectedBans, selectedLunchYear, selectedLunchMonth, finderQuery, showSpecialStudents } = this.state;
    const weekObj = weeks.find(w => w.weekNum === currentWeekNum) || weeks[0];

    let html = '';

    if (view === 'moving') {
      // Determine days to render
      let targetDays = weekObj.days;
      if (selectedDayIdx !== 'all') {
        targetDays = [weekObj.days[selectedDayIdx]];
      }

      html = MovingRollbookView.render(allStudents, holidaysMap, selectedRooms, targetDays, {
        showSpecialStudents,
        overridesMap: this.state.attendanceOverrides
      });
    } else if (view === 'homeroom') {
      html = HomeroomRollbookView.render(allStudents, holidaysMap, selectedBans, weekObj, {
        showSpecialStudents,
        overridesMap: this.state.attendanceOverrides
      });
    } else if (view === 'lunch') {
      html = LunchCalendarView.render(allStudents, holidaysMap, selectedLunchYear, selectedLunchMonth);
    } else if (view === 'finder') {
      html = StudentFinderView.render(allStudents, finderQuery);
    } else if (view === 'today') {
      html = TodayDashboardView.render(allStudents, holidaysMap, this.state.attendanceOverrides, this.todayInfo, {
        showSpecialStudents
      });
    } else if (view === 'absence') {
      html = AbsenceRegistryView.render(this.state.absenceRegistryRecords || [], this.state.absenceFilters || {});
    }

    container.innerHTML = html;
    this.applyAbsenceReportBadges();

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
    } else if (view === 'absence') {
      this.setupAbsenceRegistryEvents();
    }
  }

  showLoading(show) {
    const el = document.getElementById('loadingOverlay');
    if (el) {
      el.style.display = show ? 'flex' : 'none';
    }
  }

  findSubmittedReport(studentIdOrStudent, dateStr) {
    if (!this.state.submittedReports || !Array.isArray(this.state.submittedReports)) return null;
    let ban, num, name;
    if (typeof studentIdOrStudent === 'object' && studentIdOrStudent !== null) {
      ban = Number(studentIdOrStudent.ban);
      num = Number(studentIdOrStudent.num);
      name = (studentIdOrStudent.name || '').trim();
    } else {
      const st = this.state.allStudents ? this.state.allStudents.find(s => s.studentId === studentIdOrStudent) : null;
      if (st) {
        ban = Number(st.ban);
        num = Number(st.num);
        name = (st.name || '').trim();
      }
    }

    return this.state.submittedReports.find(r => {
      const matchStudent = (ban && num && Number(r.classNum) === ban && Number(r.studentNum) === num) ||
                            (name && r.name && r.name.trim() === name);
      if (!matchStudent) return false;
      const start = r.startDate || '';
      const end = r.endDate || start;
      if (!start) return false;
      return dateStr >= start && dateStr <= end;
    }) || null;
  }

  applyAbsenceReportBadges() {
    if (!this.state.submittedReports || this.state.submittedReports.length === 0) return;
    const cells = document.querySelectorAll('.interactive-cell');
    cells.forEach(cell => {
      const studentId = cell.dataset.studentId;
      const date = cell.dataset.date;
      if (!studentId || !date) return;
      const report = this.findSubmittedReport(studentId, date);
      if (report) {
        cell.classList.add('has-absence-report');
        const reasonStr = report.reason ? ` (${report.reason})` : '';
        const curTitle = cell.title || '';
        if (!curTitle.includes('결석계')) {
          cell.title = (curTitle ? `${curTitle} | ` : '') + `📄 결석계 접수: ${report.cat}(${report.type})${reasonStr}`;
        }
      }
    });
  }

  setupAbsenceRegistryEvents() {
    const chkAll = document.getElementById('chkSelectAllAbsence');
    if (chkAll) {
      chkAll.addEventListener('change', (e) => {
        document.querySelectorAll('.chk-absence-row').forEach(c => {
          c.checked = e.target.checked;
        });
      });
    }

    const mSel = document.getElementById('registryMonthSelect');
    if (mSel) {
      mSel.addEventListener('change', (e) => {
        this.state.absenceFilters.month = e.target.value;
        this.renderContent();
      });
    }

    const bSel = document.getElementById('registryBanSelect');
    if (bSel) {
      bSel.addEventListener('change', (e) => {
        this.state.absenceFilters.ban = e.target.value;
        this.renderContent();
      });
    }

    const pSel = document.getElementById('registryPrintStatusSelect');
    if (pSel) {
      pSel.addEventListener('change', (e) => {
        this.state.absenceFilters.printStatus = e.target.value;
        this.renderContent();
      });
    }

    const nameInput = document.getElementById('registryNameInput');
    const btnSearch = document.getElementById('btnRegistrySearch');
    const doSearch = () => {
      if (nameInput) {
        this.state.absenceFilters.name = nameInput.value.trim();
        this.renderContent();
      }
    };
    if (btnSearch) btnSearch.addEventListener('click', doSearch);
    if (nameInput) {
      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }

    const btnRefresh = document.getElementById('btnRefreshAbsenceRegistry');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.loadAbsenceRegistryData();
      });
    }

    const btnBulk = document.getElementById('btnBulkPrintAbsence');
    if (btnBulk) {
      btnBulk.addEventListener('click', () => {
        const checkedBoxes = Array.from(document.querySelectorAll('.chk-absence-row:checked'));
        if (checkedBoxes.length === 0) {
          alert('인쇄할 결석계 항목을 1건 이상 체크해 주세요.');
          return;
        }
        const selectedNos = checkedBoxes.map(c => c.dataset.no);
        const selectedRecords = (this.state.absenceRegistryRecords || []).filter(r => selectedNos.includes(String(r.no)));
        this.printAbsenceRecords(selectedRecords);
      });
    }

    document.querySelectorAll('.btn-print-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const no = e.target.dataset.no;
        const record = (this.state.absenceRegistryRecords || []).find(r => String(r.no) === String(no));
        if (record) {
          this.printAbsenceRecords([record]);
        }
      });
    });
  }

  async loadAbsenceRegistryData() {
    this.showLoading(true);
    try {
      const csv = await SheetAPI.fetchSheetByName('대장');
      this.state.absenceRegistryRecords = AbsenceRegistryView.parseRegistryCsv(csv);
      if (this.state.view === 'absence') {
        this.renderContent();
      }
    } catch (e) {
      console.warn('대장 시트 실시간 조회 실패:', e);
    } finally {
      this.showLoading(false);
    }
  }

  printAbsenceRecords(records) {
    if (!records || records.length === 0) {
      alert('인쇄할 항목이 없습니다.');
      return;
    }

    const printSection = document.getElementById('absencePrintSection');
    if (!printSection) return;

    const parseDate = (dStr) => {
      if (!dStr) return { y: '', m: '', d: '' };
      const parts = String(dStr).split('-');
      if (parts.length >= 3) {
        return { y: parts[0], m: String(parseInt(parts[1], 10)), d: String(parseInt(parts[2], 10)) };
      }
      return { y: '', m: '', d: '' };
    };

    let html = '';
    records.forEach(r => {
      const sDate = parseDate(r.startDate);
      const eDate = parseDate(r.endDate);
      const wDate = parseDate(r.writeDate || new Date().toISOString().substring(0, 10));

      const isGyeol = r.cat === '결석';
      const isJi = r.cat === '지각';
      const isJo = r.cat === '조퇴';
      const isGwa = r.cat === '결과';

      const isDisease = r.type === '질병';
      const isPeriod = r.type === '생리통' || (r.subType && r.subType.includes('생리'));
      const isRecognized = r.type === '출석인정';
      const isOther = r.type === '기타';

      const sPeriodStr = r.startPeriod ? `${r.startPeriod}교시` : '';
      const ePeriodStr = r.endPeriod ? `${r.endPeriod}교시` : '';

      let periodFullText = '';
      if (sDate.y && eDate.y) {
        if (r.startDate === r.endDate) {
          const pStr = (sPeriodStr && ePeriodStr)
            ? `${sPeriodStr} ~ ${ePeriodStr}`
            : (sPeriodStr || ePeriodStr || '');
          periodFullText = `${sDate.y}년 ${sDate.m}월 ${sDate.d}일 ${pStr ? pStr + ' ' : ''}( ${r.totalDays || '1일간'} )`;
        } else {
          const pStr = (r.cat !== '결석' && sPeriodStr && ePeriodStr) ? ` ${sPeriodStr} ~ ${ePeriodStr}` : '';
          periodFullText = `${sDate.y}년 ${sDate.m}월 ${sDate.d}일 ~ ${eDate.y}년 ${eDate.m}월 ${eDate.d}일${pStr} ( ${r.totalDays || '1일간'} )`;
        }
      } else {
        periodFullText = `${r.startDate || ''} ~ ${r.endDate || ''} ( ${r.totalDays || '1일간'} )`;
      }

      html += `
        <div class="absence-sheet-page" style="width: 100%; max-width: 190mm; margin: 0 auto 20px auto; padding: 8mm 10mm; box-sizing: border-box; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; color: #000; line-height: 1.35; background: #fff; page-break-after: always;">
          <!-- 1. 상단 제목 -->
          <div style="text-align: center; margin-bottom: 12px;">
            <h1 style="font-size: 18pt; font-weight: bold; letter-spacing: 2px; margin: 0; display: inline-block; border-bottom: 2px solid #000; padding-bottom: 2px;">
              ( ${isGyeol ? '∨ 결석' : '결석'} / ${isJi ? '∨ 지각' : '지각'} / ${isJo ? '∨ 조퇴' : '조퇴'} / ${isGwa ? '∨ 결과' : '결과'} ) 신고서
            </h1>
          </div>

          <!-- 2. 구분 및 인적사항 박스 -->
          <div style="border: 1.5px solid #000; display: flex; margin-bottom: 10px;">
            <div style="flex: 1.3; padding: 6px 10px; border-right: 1.5px solid #000; font-size: 10pt;">
              <div style="font-weight: bold; margin-bottom: 4px; font-size: 9.5pt;">해당란에 ∨표시</div>
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <div>${isDisease ? '☑' : '☐'} 질병</div>
                <div>${(isRecognized || isPeriod) ? '☑' : '☐'} 출석인정(생리통, 경조사, 전염병 등)</div>
                <div>${isOther ? '☑' : '☐'} 기타</div>
              </div>
            </div>
            <div style="flex: 1; padding: 8px 12px; display: flex; flex-direction: column; justify-content: center; font-size: 11pt;">
              <div style="margin-bottom: 6px;"><strong>${r.grade || '3'}</strong> 학년 &nbsp; <strong>${r.ban || r.class || ''}</strong> 반 &nbsp; <strong>${r.num || r.number || ''}</strong> 번</div>
              <div>성명 : <strong style="font-size: 12pt;">${r.name || ''}</strong></div>
            </div>
          </div>

          <!-- 3. 신고 본문 -->
          <div style="font-size: 10.5pt; text-align: justify; margin-bottom: 10px; line-height: 1.5;">
            본인은 포곡고 학업성적관리규정 24조 및 25조에 의거 &nbsp;
            ( ${isGyeol ? '<strong>[∨]결석</strong>' : '[ ]결석'} / ${isJi ? '<strong>[∨]지각</strong>' : '[ ]지각'} / ${isJo ? '<strong>[∨]조퇴</strong>' : '[ ]조퇴'} / ${isGwa ? '<strong>[∨]결과</strong>' : '[ ]결과'} )
            하였기에 보호자 연서로 신고합니다.
          </div>

          <!-- 4. 기간 및 사유 -->
          <div style="border: 1px solid #000; padding: 8px 12px; margin-bottom: 10px; font-size: 10pt;">
            <div style="margin-bottom: 6px; display: flex;">
              <span style="font-weight: bold; width: 65px;">1. 기 간 :</span>
              <span>${periodFullText}</span>
            </div>
            <div style="display: flex;">
              <span style="font-weight: bold; width: 65px;">2. 사 유 :</span>
              <span style="flex: 1; min-height: 28px;">${r.reason || ''} ${r.subType ? '(' + r.subType + ')' : ''}</span>
            </div>
          </div>

          <!-- 5. 신고 일자 및 서명 -->
          <div style="text-align: center; margin: 10px 0; font-size: 11pt;">
            ${wDate.y}년 &nbsp; ${wDate.m}월 &nbsp; ${wDate.d}일
          </div>

          <div style="display: flex; justify-content: flex-end; margin-bottom: 10px; font-size: 10.5pt; padding-right: 15px;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                <span>학 &nbsp; 생 : <strong>${r.name || ''}</strong></span>
                <span style="display: inline-block; width: 70px; height: 32px; text-align: center; vertical-align: middle;">
                  ${r.studentSigUrl ? `<img src="${r.studentSigUrl}" style="max-height: 32px; max-width: 65px;">` : '(인)'}
                </span>
              </div>
              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                <span>보호자 : <strong>${r.parentName || '학부모'}</strong></span>
                <span style="display: inline-block; width: 70px; height: 32px; text-align: center; vertical-align: middle;">
                  ${r.parentSigUrl ? `<img src="${r.parentSigUrl}" style="max-height: 32px; max-width: 65px;">` : '(인)'}
                </span>
              </div>
            </div>
          </div>

          <div style="text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 4px; margin-bottom: 12px;">
            포 곡 고 등 학 교 장 &nbsp; 귀 하
          </div>

          <!-- 절취선 / 구분선 -->
          <div style="border-top: 1.5px dashed #444; margin: 10px 0 8px 0; position: relative; text-align: center;">
            <span style="position: absolute; top: -9px; background: #fff; padding: 0 10px; font-size: 8.5pt; color: #555;">위 신고 내용이 사실과 틀림없음을 확인함.</span>
          </div>

          <!-- 6. 하단 내용 확인 및 결재 영역 -->
          <div style="border: 1.5px solid #000; padding: 8px 10px; font-size: 9pt;">
            <div style="text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 6px; margin-bottom: 6px;">
              내 &nbsp; 용 &nbsp; 확 &nbsp; 인
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px dotted #999; padding-bottom: 4px;">
              <div><strong>확 인 일 :</strong> &nbsp; ${wDate.y}년 &nbsp; ${wDate.m}월 &nbsp; ${wDate.d}일</div>
              <div>
                <strong>확인방법 :</strong> &nbsp;
                ☐ 가정방문 &nbsp; ☑ 전화연락 &nbsp; ☐ 학부모내교 &nbsp; ☐ 기타 ( &nbsp; )
              </div>
            </div>

            <div style="margin-bottom: 6px; border-bottom: 1px dotted #999; padding-bottom: 4px;">
              <strong>확인내용 :</strong> &nbsp; <span style="color: #444;">학부모 유선 통화 및 학생 건강 상태 확인 완료</span>
            </div>

            <div style="margin-bottom: 6px;">
              <div style="font-weight: bold; margin-bottom: 3px;">첨 &nbsp; 부 :</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 8.2pt;" border="1" bordercolor="#ccc">
                <tr>
                  <td style="width: 18%; font-weight: bold; background: #f8f9fa; padding: 3px 5px;">1. 질병</td>
                  <td style="padding: 3px 5px;">
                    ${isDisease ? '☑' : '☐'} 의사진단서, 소견서, 진료확인서, 처방전, 약봉투(병명, 진료 기간 등이 기록된 증빙서류)<br>
                    ☐ 담임교사 확인서 &nbsp; | &nbsp; ☐ 학부모 의견서 (※ 2일 이내 질병 근태)
                  </td>
                </tr>
                <tr>
                  <td style="font-weight: bold; background: #f8f9fa; padding: 3px 5px;">2. 생리통</td>
                  <td style="padding: 3px 5px;">
                    ${isPeriod ? '☑' : '☐'} 의사진단서, 소견서, 진료확인서 (※ 시험 기간 질병 처리 필수 서류임.)
                  </td>
                </tr>
                <tr>
                  <td style="font-weight: bold; background: #f8f9fa; padding: 3px 5px;">3. 출석인정</td>
                  <td style="padding: 3px 5px;">
                    ${(isRecognized && !isPeriod) ? '☑' : '☐'} 의사진단서, 소견서(질병명 포함) &nbsp; | &nbsp; ☐ 경조사 증빙서류
                  </td>
                </tr>
                <tr>
                  <td style="font-weight: bold; background: #f8f9fa; padding: 3px 5px;">4. 기타</td>
                  <td style="padding: 3px 5px;">${isOther ? '☑' : '☐'} 기타 증빙 자료</td>
                </tr>
              </table>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px;">
              <div style="font-size: 9.5pt;">
                <div>위와 같이 확인하였습니다.</div>
                <div style="margin-top: 4px;">${wDate.y}년 &nbsp; ${wDate.m}월 &nbsp; ${wDate.d}일</div>
                <div style="margin-top: 6px;">담임교사 : &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (인)</div>
              </div>

              <!-- 결재 테이블 -->
              <table style="border-collapse: collapse; text-align: center; font-size: 8.5pt;" border="1" bordercolor="#000">
                <tr>
                  <th rowspan="2" style="width: 22px; padding: 4px 2px; background: #f1f3f5;">결<br>재</th>
                  <th style="width: 75px; padding: 3px;">학년부장</th>
                  <th style="width: 75px; padding: 3px;">교 감</th>
                </tr>
                <tr>
                  <td style="height: 40px; vertical-align: bottom; padding-bottom: 2px; font-size: 8pt; color: #555;">(전결)</td>
                  <td style="height: 40px;"></td>
                </tr>
              </table>
            </div>

            <div style="font-size: 7.5pt; color: #444; margin-top: 6px; border-top: 1px solid #ddd; padding-top: 4px; line-height: 1.25;">
              ※ 질병 및 생리통 관련은 학년부장 전결 / 출석인정, 기타 및 정기고사 기간 중 질병, 생리통 관련은 교감 전결<br>
              ※ 시험 기간의 경우 질병코드 또는 질병명과 날짜(기간)가 기재된 의사 진단서, 소견서, 진료확인서가 필수임.
            </div>
          </div>
        </div>
      `;
    });

    printSection.innerHTML = html;
    document.body.classList.add('printing-absence');

    const gasUrl = SheetAPI.getGasUrl();
    if (gasUrl) {
      fetch(gasUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'mark_printed', rowNos: records.map(r => r.no) })
      }).catch(() => {});
    }

    const nowTime = new Date().toISOString().substring(0, 16).replace('T', ' ');
    records.forEach(r => { r.printedAt = nowTime; });

    window.print();

    setTimeout(() => {
      document.body.classList.remove('printing-absence');
      printSection.innerHTML = '';
      if (this.state.view === 'absence') {
        this.renderContent();
      }
    }, 1000);
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.appInstance = app;
  app.init();
});
