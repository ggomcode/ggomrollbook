/**
 * Moving Class Rollbook View Generator (이동수업 출석부 1~12반)
 * Generates 2 pages per day on A4 Landscape (15mm margins).
 * Page 1: 1~4 Periods (4 Columns)
 * Page 2: 5~7 Periods (2 or 3 Columns)
 */

import { RollbookModel, AcademicConfig, escapeHtml } from '../models.js';

export const MovingRollbookView = {
  /**
   * Render HTML for moving class rollbook
   * @param {Array} allStudents
   * @param {Object} holidaysMap
   * @param {Array} selectedRooms e.g. ['3-1', '3-2']
   * @param {Array} selectedDays e.g. [{ dateStr, dayOfWeek, displayDate, fullDisplayDate }]
   * @param {Object} options e.g. { showSpecialStudents: false }
   */
  render(allStudents, holidaysMap, selectedRooms, selectedDays, options = {}) {
    if (!selectedRooms || selectedRooms.length === 0 || !selectedDays || selectedDays.length === 0) {
      return `<div class="empty-state">선택된 학급 또는 날짜가 없습니다.</div>`;
    }

    const pages = [];

    selectedRooms.forEach(roomName => {
      selectedDays.forEach(dayInfo => {
        // Page 1: Periods 1 to 4 (4 columns)
        const p1Rosters = [1, 2, 3, 4].map(p =>
          RollbookModel.getRoomPeriodRoster(allStudents, roomName, dayInfo.dateStr, dayInfo.dayOfWeek, p, holidaysMap, options.overridesMap)
        );
        pages.push(this.renderPage(roomName, dayInfo, p1Rosters, '오전 (1~4교시)', 4, options));

        // Determine max periods for the day from config
        const maxPeriods = AcademicConfig.periodsPerDay[dayInfo.dayOfWeek] || 6;
        const p2Start = 5;
        const p2Periods = [];
        for (let p = p2Start; p <= maxPeriods; p++) p2Periods.push(p);

        const p2Rosters = p2Periods.map(p =>
          RollbookModel.getRoomPeriodRoster(allStudents, roomName, dayInfo.dateStr, dayInfo.dayOfWeek, p, holidaysMap, options.overridesMap)
        );
        pages.push(this.renderPage(roomName, dayInfo, p2Rosters, `오후 (5~${maxPeriods}교시)`, p2Periods.length, options));
      });
    });

    return pages.join('\n');
  },

  /**
   * Render a single A4 Landscape page containing multiple period columns
   */
  renderPage(roomName, dayInfo, rosters, periodLabel, colCount, options = {}) {
    // Room display title: e.g. "이동 1반 (3-1교실)"
    const roomNum = roomName.replace('3-', '');
    const titleText = `[이동 ${roomNum}반 / ${escapeHtml(roomName)}교실]  ${escapeHtml(dayInfo.fullDisplayDate)} (${dayInfo.dayOfWeek}요일) 출석부`;

    // Determine maximum student count on this page to set a uniform row height for all columns
    const maxStudentsOnPage = Math.max(
      ...rosters.map(r => (r.students ? r.students.length : 0)),
      1
    );

    // Guaranteed 1-page fit on both screen and print (fits up to 40+ students without clipping):
    // 140.0mm available height for tbody rows / targetMax ensures all rows fit completely
    const targetMax = Math.max(maxStudentsOnPage, 25);
    const rowHeightMm = (140.0 / targetMax).toFixed(2);

    const columnsHtml = rosters.map(roster => this.renderPeriodColumn(roster, dayInfo, options)).join('');

    return `
      <div class="print-page a4-landscape moving-page col-${colCount}" style="--row-height: ${rowHeightMm}mm;">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">${titleText}</h2>
            <span class="page-period-tag">${periodLabel}</span>
          </div>
          <div class="page-meta">
            <span class="meta-item">3학년 출석부</span>
            <span class="meta-item print-timestamp"></span>
          </div>
        </div>

        <div class="period-columns-container">
          ${columnsHtml}
        </div>
      </div>
    `;
  },

  /**
   * Render a single period column (단)
   */
  renderPeriodColumn(roster, dayInfo, options = {}) {
    const isWednesdayChangche = (dayInfo.dayOfWeek === '수' && (roster.periodNum === 5 || roster.periodNum === 6));
    const isHoliday = roster.status === 'holiday';
    const isCancelled = roster.status === 'cancelled';
    const isActivity = roster.status === 'activity';
    const showSpecialStudents = !!options.showSpecialStudents;

    // Header title
    let headerTitle = `${roster.periodNum}교시`;
    let subTitle = `${escapeHtml(roster.subject)} (${escapeHtml(roster.teacher)}T)`;

    if (roster.isSwap) {
      headerTitle += ` [${escapeHtml(roster.scheduleKey)} 수업]`;
    }

    if (isWednesdayChangche) {
      subTitle = '창의적 체험활동 (원적학급)';
    } else if (isHoliday) {
      subTitle = `공휴일/행사: ${escapeHtml(roster.title)}`;
    } else if (isCancelled) {
      subTitle = escapeHtml(roster.title);
    } else if (isActivity) {
      subTitle = escapeHtml(roster.title);
    }

    // If holiday or cancelled, display shaded notification banner
    if (isHoliday || isCancelled) {
      return `
        <div class="period-column special-column">
          <div class="period-col-header">
            <div class="period-col-title">${headerTitle}</div>
            <div class="period-col-sub">${subTitle}</div>
          </div>
          <div class="special-period-message">
            <div class="special-icon">${isHoliday ? '🎌' : '⏱️'}</div>
            <div class="special-text">${subTitle}</div>
            <div class="special-subtext">출석 체크 대상 수업이 없습니다.</div>
          </div>
        </div>
      `;
    }

    // Render student table rows (up to 35 rows)
    const students = roster.students || [];
    const overridesMap = options.overridesMap || null;

    const rowsHtml = students.map((st, idx) => {
      const origStatus = RollbookModel.getStudentPeriodStatus(st, dayInfo.dayOfWeek, roster.periodNum, dayInfo.dateStr, showSpecialStudents);
      const status = RollbookModel.getEffectiveStudentPeriodStatus(st, dayInfo.dayOfWeek, roster.periodNum, dayInfo.dateStr, showSpecialStudents, overridesMap);

      const is50Dark = status.is50Dark ? 'row-dark-50' : '';
      const is10Tint = (!status.is50Dark && status.isShaded) ? 'cell-tint-10' : '';
      const isOverriddenClass = status.isOverridden ? `cell-overridden status-${status.category}` : '';
      const isDocSubmitted = status.docSubmitted ? 'doc-submitted' : '';
      const displayRemark = RollbookModel.getEffectiveDisplayRemark(st.pRemark, st.studentId, dayInfo, overridesMap, showSpecialStudents, st);
      const baseRemark = RollbookModel.getDisplayRemark(st.pRemark, dayInfo.dateStr, showSpecialStudents);

      const currentStatusText = status.text || '';
      const rawStatusValue = status.rawStatus || currentStatusText;
      const originalStatusText = origStatus.text || '';

      return `
        <tr class="student-row ${is50Dark}">
          <td class="col-seq">${idx + 1}</td>
          <td class="col-id">${escapeHtml(st.studentId)}</td>
          <td class="col-name">${escapeHtml(st.name)}</td>
          <td class="col-check interactive-cell ${is10Tint} ${isOverriddenClass} ${isDocSubmitted}"
              data-action="attendance-cell"
              data-student-id="${escapeHtml(st.studentId)}"
              data-date="${escapeHtml(dayInfo.dateStr)}"
              data-period="${roster.periodNum}"
              data-ban="${escapeHtml(st.ban)}"
              data-num="${escapeHtml(st.num)}"
              data-name="${escapeHtml(st.name)}"
              data-room="${escapeHtml(roster.room || '')}"
              data-original-status="${escapeHtml(originalStatusText)}"
              data-current-status="${escapeHtml(rawStatusValue)}"
              title="좌클릭: 출결 순환 | Shift+클릭: 역순환 | 우클릭: 직접 선택/전교시 일괄">
            ${escapeHtml(status.text) || '<span class="check-box"></span>'}
          </td>
          <td class="col-remark" data-student-id="${escapeHtml(st.studentId)}" data-base-remark="${escapeHtml(baseRemark)}">${escapeHtml(displayRemark)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="period-column" data-date="${escapeHtml(dayInfo.dateStr)}" data-period="${roster.periodNum}" data-room="${escapeHtml(roster.room || '')}">
        <div class="period-col-header">
          <div class="period-col-top">
            <span class="period-badge">${headerTitle}</span>
            <button class="btn-all-present no-print" type="button" title="이 교시 모든 학생을 출석으로 일괄 처리">전원 출석</button>
            <span class="signature-box">서명: _______</span>
          </div>
          <div class="period-col-sub" title="${subTitle}">${subTitle}</div>
        </div>

        <div class="table-wrapper">
          <table class="roster-table">
            <thead>
              <tr>
                <th class="col-seq">연번</th>
                <th class="col-id">학번</th>
                <th class="col-name">이름</th>
                <th class="col-check">체크</th>
                <th class="col-remark">비고</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="5" class="no-students">수강 학생 없음</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="period-col-footer">
          <div class="footer-stat">
            <span class="stat-label">예상 출석:</span>
            <span class="stat-val highlight expected-count">${roster.expectedAttendance}명</span>
            <span class="stat-total">/ 배정 <span class="assigned-count">${roster.totalAssigned}</span>명</span>
          </div>
          <div class="footer-stats-grid">
            <div class="stat-grid-item ${roster.stats?.saenggyeol ? 'has-count' : ''}" data-stat-key="saenggyeol">
              <span class="sg-label">출석인정(생리):</span>
              <span class="sg-val">${roster.stats ? roster.stats.saenggyeol : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.cheheom ? 'has-count' : ''}" data-stat-key="cheheom">
              <span class="sg-label">출석인정(체험):</span>
              <span class="sg-val">${roster.stats ? roster.stats.cheheom : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.gyeongjosa ? 'has-count' : ''}" data-stat-key="gyeongjosa">
              <span class="sg-label">출석인정(경조사):</span>
              <span class="sg-val">${roster.stats ? roster.stats.gyeongjosa : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.jeonyeom ? 'has-count' : ''}" data-stat-key="jeonyeom">
              <span class="sg-label">출석인정(전염병):</span>
              <span class="sg-val">${roster.stats ? roster.stats.jeonyeom : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.jilbyeong ? 'has-count' : ''}" data-stat-key="jilbyeong">
              <span class="sg-label">질병:</span>
              <span class="sg-val">${roster.stats ? roster.stats.jilbyeong : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.gita ? 'has-count' : ''}" data-stat-key="gita">
              <span class="sg-label">기타:</span>
              <span class="sg-val">${roster.stats ? roster.stats.gita : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.miinjeong ? 'has-count' : ''}" data-stat-key="miinjeong">
              <span class="sg-label">미인정:</span>
              <span class="sg-val">${roster.stats ? roster.stats.miinjeong : 0}명</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
