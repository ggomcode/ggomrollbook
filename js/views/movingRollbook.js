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
   */
  render(allStudents, holidaysMap, selectedRooms, selectedDays) {
    if (!selectedRooms || selectedRooms.length === 0 || !selectedDays || selectedDays.length === 0) {
      return `<div class="empty-state">선택된 학급 또는 날짜가 없습니다.</div>`;
    }

    const pages = [];

    selectedRooms.forEach(roomName => {
      selectedDays.forEach(dayInfo => {
        // Page 1: Periods 1 to 4 (4 columns)
        const p1Rosters = [1, 2, 3, 4].map(p =>
          RollbookModel.getRoomPeriodRoster(allStudents, roomName, dayInfo.dateStr, dayInfo.dayOfWeek, p, holidaysMap)
        );
        pages.push(this.renderPage(roomName, dayInfo, p1Rosters, '오전 (1~4교시)', 4));

        // Determine max periods for the day from config
        const maxPeriods = AcademicConfig.periodsPerDay[dayInfo.dayOfWeek] || 6;
        const p2Start = 5;
        const p2Periods = [];
        for (let p = p2Start; p <= maxPeriods; p++) p2Periods.push(p);

        const p2Rosters = p2Periods.map(p =>
          RollbookModel.getRoomPeriodRoster(allStudents, roomName, dayInfo.dateStr, dayInfo.dayOfWeek, p, holidaysMap)
        );
        pages.push(this.renderPage(roomName, dayInfo, p2Rosters, `오후 (5~${maxPeriods}교시)`, p2Periods.length));
      });
    });

    return pages.join('\n');
  },

  /**
   * Render a single A4 Landscape page containing multiple period columns
   */
  renderPage(roomName, dayInfo, rosters, periodLabel, colCount) {
    // Room display title: e.g. "이동 1반 (3-1교실)"
    const roomNum = roomName.replace('3-', '');
    const titleText = `[이동 ${roomNum}반 / ${escapeHtml(roomName)}교실]  ${escapeHtml(dayInfo.fullDisplayDate)} (${dayInfo.dayOfWeek}요일) 출석부`;

    // Determine maximum student count on this page to set a uniform row height for all columns
    const maxStudentsOnPage = Math.max(
      ...rosters.map(r => (r.students ? r.students.length : 0)),
      1
    );

    // Printable height = 189mm. Overhead (headers, footer, margins) = ~35mm.
    // Available height for student rows = 154mm.
    const targetMax = Math.max(maxStudentsOnPage, 25);
    const rowHeightMm = (154.0 / targetMax).toFixed(2);

    const columnsHtml = rosters.map(roster => this.renderPeriodColumn(roster, dayInfo)).join('');

    return `
      <div class="print-page a4-landscape moving-page col-${colCount}" style="--row-height: ${rowHeightMm}mm;">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">${titleText}</h2>
            <span class="page-period-tag">${periodLabel}</span>
          </div>
          <div class="page-meta">
            <span class="meta-item">학교: 3학년</span>
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
  renderPeriodColumn(roster, dayInfo) {
    const isWednesdayChangche = (dayInfo.dayOfWeek === '수' && (roster.periodNum === 5 || roster.periodNum === 6));
    const isHoliday = roster.status === 'holiday';
    const isCancelled = roster.status === 'cancelled';
    const isActivity = roster.status === 'activity';

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
    const rowsHtml = students.map((st, idx) => {
      const status = RollbookModel.getStudentPeriodStatus(st, dayInfo.dayOfWeek, roster.periodNum);
      const is50Dark = status.is50Dark ? 'row-dark-50' : '';
      const is10Tint = (!status.is50Dark && status.isShaded) ? 'cell-tint-10' : '';

      return `
        <tr class="student-row ${is50Dark}">
          <td class="col-seq">${idx + 1}</td>
          <td class="col-id">${escapeHtml(st.studentId)}</td>
          <td class="col-name">${escapeHtml(st.name)}</td>
          <td class="col-check ${is10Tint}">
            ${escapeHtml(status.text) || '<span class="check-box"></span>'}
          </td>
          <td class="col-remark">${escapeHtml(st.pRemark)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="period-column">
        <div class="period-col-header">
          <div class="period-col-top">
            <span class="period-badge">${headerTitle}</span>
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
            <span class="stat-val highlight">${roster.expectedAttendance}명</span>
            <span class="stat-total">/ 배정 ${roster.totalAssigned}명</span>
          </div>
          <div class="footer-stats-grid">
            <div class="stat-grid-item ${roster.stats?.saenggyeol ? 'has-count' : ''}">
              <span class="sg-label">출석인정(생결):</span>
              <span class="sg-val">${roster.stats ? roster.stats.saenggyeol : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.cheheom ? 'has-count' : ''}">
              <span class="sg-label">출석인정(체험):</span>
              <span class="sg-val">${roster.stats ? roster.stats.cheheom : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.jilbyeong ? 'has-count' : ''}">
              <span class="sg-label">질병:</span>
              <span class="sg-val">${roster.stats ? roster.stats.jilbyeong : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.gita ? 'has-count' : ''}">
              <span class="sg-label">기타:</span>
              <span class="sg-val">${roster.stats ? roster.stats.gita : 0}명</span>
            </div>
            <div class="stat-grid-item ${roster.stats?.miinjeong ? 'has-count' : ''}">
              <span class="sg-label">미인정:</span>
              <span class="sg-val">${roster.stats ? roster.stats.miinjeong : 0}명</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
