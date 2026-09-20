/**
 * Homeroom Rollbook View Generator (원적학급 주간 출석부 1~11반)
 * Generates 1 page per week on A4 Landscape (15mm margins).
 * Mon~Fri 42 Columns with 1-letter period headers ('조', 1~6/7, '종').
 */

import { RollbookModel } from '../models.js';

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

    // Day configs: period count per day
    const daySpecs = [
      { day: '월', count: 8, periods: ['조', 1, 2, 3, 4, 5, 6, '종'] },
      { day: '화', count: 9, periods: ['조', 1, 2, 3, 4, 5, 6, 7, '종'] },
      { day: '수', count: 8, periods: ['조', 1, 2, 3, 4, 5, 6, '종'] },
      { day: '목', count: 9, periods: ['조', 1, 2, 3, 4, 5, 6, 7, '종'] },
      { day: '금', count: 8, periods: ['조', 1, 2, 3, 4, 5, 6, '종'] }
    ];

    // Day header cells
    const dayHeadersHtml = days.map((d, i) => {
      const spec = daySpecs[i];
      const holidayName = holidaysMap.fullDayEvents[d.dateStr];
      const titleExtra = holidayName ? ` <span class="holiday-pill">[${holidayName}]</span>` : '';
      return `<th colspan="${spec.count}" class="day-group-header ${holidayName ? 'th-holiday' : ''}">
        ${d.dayOfWeek} (${d.displayDate})${titleExtra}
      </th>`;
    }).join('');

    // Period subheader cells ('조', 1..6/7, '종')
    let periodHeadersHtml = '';
    daySpecs.forEach((spec, i) => {
      const dayInfo = days[i];
      const isHoliday = !!holidaysMap.fullDayEvents[dayInfo.dateStr];

      spec.periods.forEach(p => {
        const isChangche = (spec.day === '수' && (p === 5 || p === 6));
        const pLabel = isChangche ? '창' : p;
        periodHeadersHtml += `<th class="period-sub-th ${isHoliday ? 'th-holiday' : ''}">${pLabel}</th>`;
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

        spec.periods.forEach(p => {
          let cellText = '';
          let isTint = false;

          if (isHoliday) {
            cellText = '-';
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
          cellsHtml += `<td class="period-cell ${tintClass}">${cellText || '<span class="check-box-sm"></span>'}</td>`;
        });
      });

      return `
        <tr class="homeroom-student-row ${darkClass}">
          <td class="col-seq">${idx + 1}</td>
          <td class="col-num">${st.num}</td>
          <td class="col-id">${st.studentId}</td>
          <td class="col-name">${st.name}</td>
          <td class="col-remark">${st.pRemark || ''}</td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    return `
      <div class="print-page a4-landscape homeroom-page">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">[3학년 ${banNum}반] 주간 출석부</h2>
            <span class="page-period-tag">${weekInfo.label}</span>
          </div>
          <div class="page-meta">
            <span class="meta-item">재적: ${students.length}명</span>
            <span class="meta-item">담임 확인: _______ (인)</span>
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
  }
};
