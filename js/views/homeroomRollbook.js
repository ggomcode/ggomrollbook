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
   * @param {Object} options e.g. { showSpecialStudents: false }
   */
  render(allStudents, holidaysMap, selectedBans, weekInfo, options = {}) {
    if (!selectedBans || selectedBans.length === 0 || !weekInfo) {
      return `<div class="empty-state">선택된 학급 또는 주차가 없습니다.</div>`;
    }

    const pages = [];

    selectedBans.forEach(banNum => {
      const banStudents = allStudents.filter(st => st.ban === banNum);
      // Sort by student number or studentId
      banStudents.sort((a, b) => a.num - b.num);

      pages.push(this.renderBanPage(banNum, banStudents, weekInfo, holidaysMap, options));
    });

    return pages.join('\n');
  },

  /**
   * Render 1-week page for 1 homeroom class
   */
  renderBanPage(banNum, students, weekInfo, holidaysMap, options = {}) {
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
    const showSpecialStudents = !!options.showSpecialStudents;
    const overridesMap = options.overridesMap || null;
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
          let isOverridden = false;
          let overrideCat = '';
          let origStatusText = '';
          let currentStatusText = '';
          let rawStatusValue = '';
          let isDocSubmitted = '';

          const periodKey = p; // '조', 1..7, '종'
          const overrideKey = `${dayInfo.dateStr}_${periodKey}_${st.studentId}`;

          if (isHoliday) {
            cellText = '-';
          } else if (p === '조' || p === '종') {
            const origStatus = RollbookModel.getStudentPeriodStatus(st, spec.day, p, dayInfo.dateStr, showSpecialStudents);
            origStatusText = origStatus.text || '';

            const status = RollbookModel.getEffectiveStudentPeriodStatus(st, spec.day, p, dayInfo.dateStr, showSpecialStudents, overridesMap);
            cellText = status.text;
            rawStatusValue = status.rawStatus || cellText;
            isTint = status.isShaded && !isDarkRow;
            isOverridden = status.isOverridden;
            overrideCat = status.category || '';
            if (status.docSubmitted) isDocSubmitted = 'doc-submitted';
          } else if (spec.day === '수' && (p === 5 || p === 6)) {
            const origStatus = RollbookModel.getStudentPeriodStatus(st, spec.day, p, dayInfo.dateStr, showSpecialStudents);
            const status = RollbookModel.getEffectiveStudentPeriodStatus(st, spec.day, p, dayInfo.dateStr, showSpecialStudents, overridesMap);

            if (origStatus.is50Dark || !origStatus.isPresent) {
              origStatusText = origStatus.text || '';
              cellText = status.text;
              rawStatusValue = status.rawStatus || cellText;
              isTint = status.isShaded && !isDarkRow;
              isOverridden = status.isOverridden;
              overrideCat = status.category || '';
              if (status.docSubmitted) isDocSubmitted = 'doc-submitted';
            } else if (overridesMap && overridesMap.has(overrideKey)) {
              const rec = overridesMap.get(overrideKey);
              rawStatusValue = (rec.status || '').trim();
              if (rawStatusValue === '출석') rawStatusValue = '';
              cellText = RollbookModel.getStatusDisplayText(rawStatusValue);
              isTint = !!rawStatusValue && !isDarkRow;
              isOverridden = true;
              overrideCat = RollbookModel.getCategoryFromRawStatus(rawStatusValue);
              if (rec.docSubmitted) isDocSubmitted = 'doc-submitted';
            } else {
              origStatusText = '창';
              cellText = '창';
              rawStatusValue = '창';
              isTint = true;
            }
          } else {
            const pNum = (typeof p === 'number') ? p : 0;
            const origStatus = RollbookModel.getStudentPeriodStatus(st, spec.day, pNum, dayInfo.dateStr, showSpecialStudents);
            origStatusText = origStatus.text || '';

            const status = RollbookModel.getEffectiveStudentPeriodStatus(st, spec.day, pNum, dayInfo.dateStr, showSpecialStudents, overridesMap);
            cellText = status.text;
            rawStatusValue = status.rawStatus || cellText;
            isTint = status.isShaded && !isDarkRow;
            isOverridden = status.isOverridden;
            overrideCat = status.category || '';
            if (status.docSubmitted) isDocSubmitted = 'doc-submitted';
          }

          const tintClass = isTint ? 'cell-tint-10' : '';
          const isDayEnd = (pIdx === spec.periods.length - 1);
          const dayEndClass = isDayEnd ? 'col-day-end' : '';
          const overriddenClass = isOverridden ? `cell-overridden status-${overrideCat}` : '';

          cellsHtml += `
            <td class="period-cell interactive-cell ${tintClass} ${dayEndClass} ${overriddenClass} ${isDocSubmitted}"
                data-action="attendance-cell"
                data-student-id="${escapeHtml(st.studentId)}"
                data-date="${escapeHtml(dayInfo.dateStr)}"
                data-period="${p}"
                data-ban="${escapeHtml(st.ban)}"
                data-num="${escapeHtml(st.num)}"
                data-name="${escapeHtml(st.name)}"
                data-room="${st.ban}반"
                data-original-status="${escapeHtml(origStatusText)}"
                data-current-status="${escapeHtml(rawStatusValue)}"
                title="좌클릭: 출결 순환 | Shift+클릭: 역순환 | 우클릭: 직접 선택/전교시 일괄">
              ${escapeHtml(cellText) || '<span class="check-box-sm"></span>'}
            </td>`;
        });
      });

      const displayRemark = RollbookModel.getEffectiveDisplayRemark(st.pRemark, st.studentId, days, overridesMap, showSpecialStudents, st);
      const baseRemark = RollbookModel.getDisplayRemark(st.pRemark, days, showSpecialStudents);

      return `
        <tr class="homeroom-student-row ${darkClass}">
          <td class="col-seq">${idx + 1}</td>
          <td class="col-num">${st.num}</td>
          <td class="col-id">${escapeHtml(st.studentId)}</td>
          <td class="col-name">${escapeHtml(st.name)}</td>
          <td class="col-remark" data-student-id="${escapeHtml(st.studentId)}" data-base-remark="${escapeHtml(baseRemark)}">${escapeHtml(displayRemark)}</td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    // Daily summary tfoot rows
    const presenceRowHtml = daySpecs.map((spec, dIdx) => {
      const stats = this._calcDailyStats(students, spec.day, days[dIdx].dateStr, overridesMap, showSpecialStudents);
      return `<td colspan="${spec.periods.length}" class="col-day-end stat-presence-cell" data-date="${days[dIdx].dateStr}">
        <span class="stat-main-num">${stats.present}명</span> <span class="stat-sub">/ ${students.length}명</span>
      </td>`;
    }).join('');

    const absenceRowHtml = daySpecs.map((spec, dIdx) => {
      const stats = this._calcDailyStats(students, spec.day, days[dIdx].dateStr, overridesMap, showSpecialStudents);
      const text = `결석 ${stats.absence} · 지각 ${stats.late} · 조퇴 ${stats.earlyLeave} · 결과 ${stats.classSkipped}`;
      const hasAny = (stats.absence + stats.late + stats.earlyLeave + stats.classSkipped) > 0;
      return `<td colspan="${spec.periods.length}" class="col-day-end stat-absence-cell ${hasAny ? 'has-absence' : ''}" data-date="${days[dIdx].dateStr}">
        ${text}
      </td>`;
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
          <table class="homeroom-table" data-ban="${banNum}">
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
            <tfoot class="homeroom-stats">
              <tr class="homeroom-stat-row stat-row-presence">
                <th colspan="5" class="stat-header">출석 인원</th>
                ${presenceRowHtml}
              </tr>
              <tr class="homeroom-stat-row stat-row-absence">
                <th colspan="5" class="stat-header">출결 변동 (결·지·퇴·과)</th>
                ${absenceRowHtml}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  },

  /**
   * Calculate daily attendance statistics for a homeroom class on a specific date
   */
  _calcDailyStats(students, dayOfWeek, dateStr, overridesMap, showSpecialStudents) {
    let present = 0;
    let absence = 0;
    let late = 0;
    let earlyLeave = 0;
    let classSkipped = 0;

    (students || []).forEach(st => {
      const analysis = RollbookModel.analyzeDailyAttendance(st, dayOfWeek, dateStr, overridesMap, showSpecialStudents);
      if (analysis.isNormal) {
        present++;
      } else {
        if (analysis.isAbsence) absence++;
        if (analysis.isLate) late++;
        if (analysis.isEarlyLeave) earlyLeave++;
        if (analysis.isClassSkipped) classSkipped++;
        if (!analysis.isAbsence) present++;
      }
    });

    return { present, absence, late, earlyLeave, classSkipped };
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
   * @param {Object} student
   * @param {string} dateStr
   * @param {boolean} showSpecialStudent
   */
  _getSpecialMarkOnly(student, dateStr = null, showSpecialStudent = false) {
    const pRemark = student.pRemark;
    if (pRemark.includes('자퇴') || pRemark.includes('위탁') || pRemark.includes('전출')) {
      return { text: pRemark, isShaded: true };
    }
    if (showSpecialStudent && pRemark.includes('특수')) return { text: '특', isShaded: true };
    if (pRemark.includes('파스') || pRemark.includes('패스')) {
      const isPassActive = !dateStr || (dateStr >= AcademicConfig.passStartDate && dateStr <= AcademicConfig.passEndDate);
      if (isPassActive) {
        return { text: '파', isShaded: true };
      }
      return { text: '', isShaded: false };
    }
    if (pRemark.includes('순회')) return { text: '순', isShaded: true };
    return { text: '', isShaded: false };
  }
};
