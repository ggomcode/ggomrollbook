/**
 * Homeroom Rollbook View Generator (원적학급 주간 출석부 1~11반)
 * Generates 1 page per week on A4 Landscape (15mm margins).
 * Mon~Fri 42 Columns with 1-letter period headers ('조', 1~6/7, '종').
 */

import { RollbookModel, AcademicConfig, escapeHtml } from '../models.js';

export const HomeroomRollbookView = {
  /**
   * Render HTML for homeroom weekly rollbooks
   * @param {Array} allStudents
   * @param {Object} holidaysMap
   * @param {Array} selectedBans e.g. [1, 2, 7]
   * @param {Object} weekInfo e.g. { weekNum, label, days: [...] }
   */
  render(allStudents, holidaysMap, selectedBans, weekInfo) {
    if (!selectedBans || selectedBans.length === 0 || !weekInfo) {
      return `<div class="empty-state">선택된 학급 또는 주차가 없습니다.</div>`;
    }

    const pages = [];

    selectedBans.forEach(banNum => {
      const banStudents = allStudents.filter(st => st.ban === banNum);
      // Sort by student number or studentId
      banStudents.sort((a, b) => a.num - b.num);

      pages.push(this.renderBanPage(banNum, banStudents, weekInfo, holidaysMap));
    });

    return pages.join('\n');
  },

  /**
   * Render 1-week page for 1 homeroom class
   */
  renderBanPage(banNum, students, weekInfo, holidaysMap) {
    const days = weekInfo.days; // Mon, Tue, Wed, Thu, Fri

    // Day configs: period count per day from AcademicConfig
    const daySpecs = [
      { day: '월', periods: this._buildPeriodList('월') },
      { day: '화', periods: this._buildPeriodList('화') },
      { day: '수', periods: this._buildPeriodList('수') },
      { day: '목', periods: this._buildPeriodList('목') },
      { day: '금', periods: this._buildPeriodList('금') }
    ];

    // Day header cells
    const dayHeadersHtml = days.map((d, i) => {
      const spec = daySpecs[i];
      const holidayName = holidaysMap.fullDayEvents[d.dateStr];
      const titleExtra = holidayName ? ` <span class="holiday-pill">[${escapeHtml(holidayName)}]</span>` : '';
      return `<th colspan="${spec.periods.length}" class="day-group-header ${holidayName ? 'th-holiday' : ''}">
        ${d.dayOfWeek} (${d.displayDate})${titleExtra}
      </th>`;
    }).join('');

    // Period subheader cells ('조', 1..6/7, '종')
    let periodHeadersHtml = '';
    daySpecs.forEach((spec, i) => {
      const dayInfo = days[i];
      const isHoliday = !!holidaysMap.fullDayEvents[dayInfo.dateStr];

      spec.periods.forEach((p, pIdx) => {
        const isChangche = (spec.day === '수' && (p === 5 || p === 6));
        const pLabel = isChangche ? '창' : p;
        const isDayEnd = (pIdx === spec.periods.length - 1);
        const dayEndClass = isDayEnd ? 'col-day-end' : '';
        periodHeadersHtml += `<th class="period-sub-th ${isHoliday ? 'th-holiday' : ''} ${dayEndClass}">${pLabel}</th>`;
      });
    });

    // Student rows
    const rowsHtml = students.map((st, idx) => {
      const isDarkRow = (st.pRemark.includes('자퇴') || st.pRemark.includes('위탁') || st.pRemark.includes('전출'));
      const darkClass = isDarkRow ? 'row-dark-50' : '';

      let cellsHtml = '';
      daySpecs.forEach((spec, dIdx) => {
        const dayInfo = days[dIdx];
        const isHoliday = !!holidaysMap.fullDayEvents[dayInfo.dateStr];

        spec.periods.forEach((p, pIdx) => {
          let cellText = '';
          let isTint = false;

          if (isHoliday) {
            cellText = '-';
          } else if (p === '조' || p === '종') {
            // 조회/종례: show special student marks only, regular students get checkbox
            const status = this._getSpecialMarkOnly(st);
            cellText = status.text;
            isTint = status.isShaded && !isDarkRow;
          } else if (spec.day === '수' && (p === 5 || p === 6)) {
            cellText = '창';
            isTint = true;
          } else {
            const pNum = (typeof p === 'number') ? p : 0;
            const status = RollbookModel.getStudentPeriodStatus(st, spec.day, pNum);
            cellText = status.text;
            isTint = status.isShaded && !isDarkRow;
          }

          const tintClass = isTint ? 'cell-tint-10' : '';
          const isDayEnd = (pIdx === spec.periods.length - 1);
          const dayEndClass = isDayEnd ? 'col-day-end' : '';
          cellsHtml += `<td class="period-cell ${tintClass} ${dayEndClass}">${escapeHtml(cellText) || '<span class="check-box-sm"></span>'}</td>`;
        });
      });

      return `
        <tr class="homeroom-student-row ${darkClass}">
          <td class="col-seq">${idx + 1}</td>
          <td class="col-num">${st.num}</td>
          <td class="col-id">${escapeHtml(st.studentId)}</td>
          <td class="col-name">${escapeHtml(st.name)}</td>
          <td class="col-remark">${escapeHtml(st.pRemark)}</td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    return `
      <div class="print-page a4-landscape homeroom-page">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">[3학년 ${banNum}반] 주간 출석부</h2>
            <span class="page-period-tag">${escapeHtml(weekInfo.label)}</span>
          </div>
          <div class="page-meta">
            <span class="meta-item">재적: ${students.length}명</span>
            <span class="meta-item">담임 확인: _______ (인)</span>
            <span class="meta-item print-timestamp"></span>
          </div>
        </div>

        <div class="table-wrapper homeroom-table-wrapper">
          <table class="homeroom-table">
            <thead>
              <tr>
                <th rowspan="2" class="col-seq">연번</th>
                <th rowspan="2" class="col-num">번호</th>
                <th rowspan="2" class="col-id">학번</th>
                <th rowspan="2" class="col-name">이름</th>
                <th rowspan="2" class="col-remark">비고</th>
                ${dayHeadersHtml}
              </tr>
              <tr>
                ${periodHeadersHtml}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /**
   * Build period list for a given day: ['조', 1, 2, ..., 6/7, '종']
   */
  _buildPeriodList(day) {
    const maxPeriod = AcademicConfig.periodsPerDay[day] || 6;
    const periods = ['조'];
    for (let i = 1; i <= maxPeriod; i++) periods.push(i);
    periods.push('종');
    return periods;
  },

  /**
   * Get only the special mark (특/파/순/자퇴...) for 조/종 columns
   * without checking period-based attendance
   */
  _getSpecialMarkOnly(student) {
    const pRemark = student.pRemark;
    if (pRemark.includes('자퇴') || pRemark.includes('위탁') || pRemark.includes('전출')) {
      return { text: pRemark, isShaded: true };
    }
    if (pRemark.includes('특수')) return { text: '특', isShaded: true };
    if (pRemark.includes('파스')) return { text: '파', isShaded: true };
    if (pRemark.includes('순회')) return { text: '순', isShaded: true };
    return { text: '', isShaded: false };
  }
};
