/**
 * Monthly Lunch Calendar View & Print Generator (월별 예상 급식인원 캘린더)
 * Generates an A4 Landscape monthly calendar showing daily lunch headcounts,
 * holidays, and monthly totals.
 */

import { RollbookModel } from '../models.js';

export const LunchCalendarView = {
  /**
   * Available months in the academic period: 2026-09 to 2027-01
   */
  getAvailableMonths() {
    return [
      { year: 2026, month: 9, label: '2026년 9월' },
      { year: 2026, month: 10, label: '2026년 10월' },
      { year: 2026, month: 11, label: '2026년 11월' },
      { year: 2026, month: 12, label: '2026년 12월' },
      { year: 2027, month: 1, label: '2027년 1월 (졸업식: 1.6)' }
    ];
  },

  /**
   * Render Monthly Lunch Calendar HTML
   */
  render(allStudents, holidaysMap, selectedYear, selectedMonth) {
    const year = parseInt(selectedYear, 10);
    const month = parseInt(selectedMonth, 10); // 1-12

    // First day and total days in month
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const totalDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sun, 1 = Mon ...

    // Build day data
    let totalFeedingDays = 0;
    let totalMonthlyMeals = 0;
    const daysData = [];

    for (let d = 1; d <= totalDays; d++) {
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeekIdx = dateObj.getDay();
      const dayOfWeekNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayOfWeek = dayOfWeekNames[dayOfWeekIdx];

      const yyyy = year;
      const mm = String(month).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const isWeekend = (dayOfWeekIdx === 0 || dayOfWeekIdx === 6);
      const holidayEvent = holidaysMap.fullDayEvents[dateStr] || '';
      const isGraduation = (dateStr === '2027-01-06');

      let lunchCount = 0;
      let banBreakdown = {};
      let isNoLunch = isWeekend;

      if (!isWeekend) {
        // Check if full-day holiday excludes lunch
        if (holidayEvent && (
          holidayEvent.includes('추석') ||
          holidayEvent.includes('공휴일') ||
          holidayEvent.includes('한글날') ||
          holidayEvent.includes('수능') ||
          holidayEvent.includes('휴업') ||
          holidayEvent.includes('성탄절') ||
          holidayEvent.includes('신정')
        )) {
          isNoLunch = true;
        }

        if (!isNoLunch) {
          // Calculate lunch count for all students for this weekday
          allStudents.forEach(st => {
            if (RollbookModel.isStudentEatingLunch(st, dayOfWeek)) {
              lunchCount++;
              banBreakdown[st.ban] = (banBreakdown[st.ban] || 0) + 1;
            }
          });

          if (lunchCount > 0) {
            totalFeedingDays++;
            totalMonthlyMeals += lunchCount;
          }
        }
      }

      daysData.push({
        day: d,
        dateStr,
        dayOfWeek,
        isWeekend,
        holidayEvent: holidayEvent || (isGraduation ? '졸업식' : ''),
        isNoLunch,
        lunchCount,
        banBreakdown
      });
    }

    // Build Calendar Grid (Weeks)
    const calendarWeeks = [];
    let currentWeek = [];

    // Empty cells before first day of month
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push(null);
    }

    daysData.forEach(day => {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        calendarWeeks.push(currentWeek);
        currentWeek = [];
      }
    });

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      calendarWeeks.push(currentWeek);
    }

    const avgDailyMeals = totalFeedingDays > 0 ? Math.round(totalMonthlyMeals / totalFeedingDays) : 0;

    // Render Calendar Table Rows
    const weeksHtml = calendarWeeks.map(week => {
      const cellsHtml = week.map((cell, idx) => {
        if (!cell) {
          return `<td class="cal-cell cal-empty"></td>`;
        }

        const isSun = idx === 0;
        const isSat = idx === 6;
        let dayClass = 'cal-cell';
        if (isSun) dayClass += ' cal-sunday';
        if (isSat) dayClass += ' cal-saturday';
        if (cell.holidayEvent) dayClass += ' cal-holiday';

        let badgeHtml = '';
        if (cell.isNoLunch) {
          if (cell.holidayEvent) {
            badgeHtml = `<span class="event-tag">${cell.holidayEvent}</span><span class="no-lunch-tag">급식 없음</span>`;
          } else if (!cell.isWeekend) {
            badgeHtml = `<span class="no-lunch-tag">급식 미운영</span>`;
          }
        } else {
          let eventTag = cell.holidayEvent ? `<span class="event-tag">${cell.holidayEvent}</span>` : '';
          badgeHtml = `
            ${eventTag}
            <div class="lunch-badge">
              <span class="lunch-icon">🍱</span>
              <span class="lunch-number">${cell.lunchCount}</span><span class="lunch-unit">명</span>
            </div>
          `;
        }

        return `
          <td class="${dayClass}">
            <div class="cal-cell-inner">
              <div class="cal-day-num">${cell.day}</div>
              <div class="cal-day-content">
                ${badgeHtml}
              </div>
            </div>
          </td>
        `;
      }).join('');

      return `<tr>${cellsHtml}</tr>`;
    }).join('');

    return `
      <div class="print-page a4-landscape lunch-calendar-page">
        <div class="page-header">
          <div class="page-title-group">
            <h2 class="page-title">🍱 ${year}년 ${month}월 예상 급식 인원 캘린더</h2>
            <span class="page-period-tag">고등학교 3학년 급식 식수 현황</span>
          </div>
          <div class="page-meta monthly-summary-meta">
            <span class="meta-item stat-pill">급식 일수: <strong>${totalFeedingDays}일</strong></span>
            <span class="meta-item stat-pill">총 예상 식수: <strong>${totalMonthlyMeals.toLocaleString()}명</strong></span>
            <span class="meta-item stat-pill">일평균 식수: <strong>${avgDailyMeals}명</strong></span>
          </div>
        </div>

        <div class="calendar-table-wrapper">
          <table class="lunch-calendar-table">
            <thead>
              <tr>
                <th class="th-sun">일 (SUN)</th>
                <th>월 (MON)</th>
                <th>화 (TUE)</th>
                <th>수 (WED)</th>
                <th>목 (THU)</th>
                <th>금 (FRI)</th>
                <th class="th-sat">토 (SAT)</th>
              </tr>
            </thead>
            <tbody>
              ${weeksHtml}
            </tbody>
          </table>
        </div>

        <div class="calendar-footer-notes">
          <div class="note-item">※ 집계 기준: P열 비고(순회·자퇴·위탁·전출 제외, 특수·파스 포함), 중식여부 'X' 표기자 제외 산출</div>
          <div class="note-item">※ 담당자 확인: 영양교사 _____________ (인) &nbsp;|&nbsp; 담당부장 _____________ (인)</div>
        </div>
      </div>
    `;
  }
};
