/**
 * Today Attendance Dashboard View Generator (오늘의 출결 현황판)
 * Displays school-wide attendance overview for teachers' room (교무실 현황판).
 */

import { RollbookModel, AcademicConfig, escapeHtml } from '../models.js';

export const TodayDashboardView = {
  /**
   * Render today attendance dashboard
   * @param {Array} allStudents
   * @param {Object} holidaysMap
   * @param {Map} overridesMap
   * @param {Object} todayInfo { year, month, dateStr, dayOfWeek, display, fullDisplayDate, weekNum }
   * @param {Object} options { showSpecialStudents: false }
   */
  render(allStudents, holidaysMap, overridesMap, todayInfo, options = {}) {
    const { dateStr, dayOfWeek, fullDisplayDate, weekNum } = todayInfo;
    const showSpecialStudents = !!options.showSpecialStudents;

    // Check full day holiday / event
    const fullDayEvent = holidaysMap.fullDayEvents[dateStr];

    const totalStudents = allStudents.length;
    const absenceList = [];
    const lateList = [];
    const earlyLeaveList = [];
    const skipList = [];

    // Analyze each student for today
    allStudents.forEach(st => {
      const analysis = RollbookModel.analyzeDailyAttendance(st, dayOfWeek, dateStr, overridesMap, showSpecialStudents);
      if (analysis.isNormal) return;

      const baseInfo = {
        studentId: st.studentId,
        ban: st.ban,
        num: st.num,
        name: st.name,
        pRemark: st.pRemark
      };

      if (analysis.isAbsence) {
        absenceList.push({
          ...baseInfo,
          reason: analysis.absenceReason,
          summary: analysis.summary
        });
      } else {
        if (analysis.isLate) {
          lateList.push({
            ...baseInfo,
            reason: analysis.lateReason,
            summary: `지각(${analysis.lateReason})`
          });
        }
        if (analysis.isEarlyLeave) {
          earlyLeaveList.push({
            ...baseInfo,
            reason: analysis.earlyLeaveReason,
            summary: `조퇴(${analysis.earlyLeaveReason})`
          });
        }
        if (analysis.isClassSkipped) {
          skipList.push({
            ...baseInfo,
            reason: analysis.skipReason,
            summary: `결과(${analysis.skipReason})`
          });
        }
      }
    });

    const presentCount = totalStudents - absenceList.length;
    const attendanceRate = totalStudents > 0 ? ((presentCount / totalStudents) * 100).toFixed(1) : 0;

    // Group by ban (1~11)
    const banGroups = AcademicConfig.allBans.map(b => {
      const banStudents = allStudents.filter(s => s.ban === b);
      const bAbs = absenceList.filter(s => s.ban === b);
      const bLate = lateList.filter(s => s.ban === b);
      const bEarly = earlyLeaveList.filter(s => s.ban === b);
      const bSkip = skipList.filter(s => s.ban === b);

      return {
        ban: b,
        total: banStudents.length,
        present: banStudents.length - bAbs.length,
        absence: bAbs,
        late: bLate,
        early: bEarly,
        skip: bSkip
      };
    });

    // Roster rows for class-by-class summary table
    const banRowsHtml = banGroups.map(bg => {
      const absText = bg.absence.map(s => `${s.num}번 ${s.name}(${s.reason})`).join(', ') || '-';
      const partialArr = [];
      bg.late.forEach(s => partialArr.push(`${s.num}번 ${s.name}[지각:${s.reason}]`));
      bg.early.forEach(s => partialArr.push(`${s.num}번 ${s.name}[조퇴:${s.reason}]`));
      bg.skip.forEach(s => partialArr.push(`${s.num}번 ${s.name}[결과:${s.reason}]`));
      const partialText = partialArr.join(', ') || '-';

      const hasAbs = bg.absence.length > 0;
      const hasPart = partialArr.length > 0;

      return `
        <tr class="${hasAbs ? 'row-has-absence' : ''}">
          <td class="col-ban"><strong>${bg.ban}반</strong></td>
          <td class="col-total">${bg.total}명</td>
          <td class="col-present"><strong>${bg.present}명</strong></td>
          <td class="col-abs-count ${hasAbs ? 'abs-highlight' : ''}">${bg.absence.length}명</td>
          <td class="col-abs-names ${hasAbs ? 'abs-names-active' : ''}">${escapeHtml(absText)}</td>
          <td class="col-partial-names ${hasPart ? 'part-names-active' : ''}">${escapeHtml(partialText)}</td>
          <td class="col-sign">_______</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="print-page a4-landscape today-dashboard-page">
        <!-- Header -->
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">📢 3학년 출결 일일 현황판 (교무실 브리핑)</h2>
            <span class="page-period-tag">${escapeHtml(fullDisplayDate)} (${dayOfWeek}요일) · ${weekNum}주차</span>
            ${fullDayEvent ? `<span class="holiday-pill">${escapeHtml(fullDayEvent)}</span>` : ''}
          </div>
          <div class="page-meta">
            <span class="meta-item">재적: <strong>${totalStudents}명</strong></span>
            <span class="meta-item">현재 출석: <strong>${presentCount}명</strong> (${attendanceRate}%)</span>
            <span class="meta-item print-timestamp"></span>
          </div>
        </div>

        <!-- KPI Metric Cards (On Screen & Print) -->
        <div class="today-kpi-grid">
          <div class="kpi-card kpi-present">
            <div class="kpi-label">예상 등교 출석</div>
            <div class="kpi-value">${presentCount} <span class="kpi-unit">/ ${totalStudents}명</span></div>
            <div class="kpi-sub">출석률 <strong>${attendanceRate}%</strong></div>
          </div>
          <div class="kpi-card kpi-absence ${absenceList.length > 0 ? 'kpi-alert' : ''}">
            <div class="kpi-label">하루 전체 결석</div>
            <div class="kpi-value">${absenceList.length} <span class="kpi-unit">명</span></div>
            <div class="kpi-sub">질병·미인정·인정 포함</div>
          </div>
          <div class="kpi-card kpi-late">
            <div class="kpi-label">지각 / 조퇴</div>
            <div class="kpi-value">${lateList.length + earlyLeaveList.length} <span class="kpi-unit">건</span></div>
            <div class="kpi-sub">지각 ${lateList.length}건 · 조퇴 ${earlyLeaveList.length}건</div>
          </div>
          <div class="kpi-card kpi-skip">
            <div class="kpi-label">수업 중 결과</div>
            <div class="kpi-value">${skipList.length} <span class="kpi-unit">건</span></div>
            <div class="kpi-sub">특정 교시 미참여</div>
          </div>
        </div>

        <!-- Class by Class Summary Table -->
        <div class="table-wrapper today-table-wrapper">
          <table class="today-summary-table">
            <thead>
              <tr>
                <th style="width: 50px;">학급</th>
                <th style="width: 55px;">재적</th>
                <th style="width: 60px;">출석</th>
                <th style="width: 55px;">결석</th>
                <th style="width: 32%;">결석자 명단 (사유)</th>
                <th>지각·조퇴·결과 학생</th>
                <th style="width: 70px;">담임 확인</th>
              </tr>
            </thead>
            <tbody>
              ${banRowsHtml}
            </tbody>
            <tfoot>
              <tr class="today-total-row">
                <th>전체 합계</th>
                <th>${totalStudents}명</th>
                <th>${presentCount}명</th>
                <th class="${absenceList.length > 0 ? 'abs-highlight' : ''}">${absenceList.length}명</th>
                <th colspan="2" class="total-summary-text">
                  총 결석 ${absenceList.length}명 · 지각 ${lateList.length}명 · 조퇴 ${earlyLeaveList.length}명 · 결과 ${skipList.length}명
                </th>
                <th>-</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }
};
