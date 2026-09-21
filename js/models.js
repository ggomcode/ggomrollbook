/**
 * Data Model & Business Logic for ggomrollbook
 */

// ──── Academic Year Configuration ────────────────────────────────────────────
// Change these values each year to reconfigure the system.
export const AcademicConfig = {
  semesterStartDate: new Date(2026, 8, 21), // 2학기 시작 월요일 (Month 0-indexed: 8 = September)
  startWeekNum: 6,                          // 시작 주차
  endWeekNum: 21,                           // 종료 주차 (졸업식 포함)
  graduationDate: '2027-01-06',             // 졸업식 날짜
  passStartDate: '2026-09-22',              // 파스(PASS) 운영 시작일 (화)
  passEndDate: '2026-11-17',                // 파스(PASS) 운영 종료일 (화)
  allRooms: ['3-1','3-2','3-3','3-4','3-5','3-6','3-7','3-8','3-9','3-10','3-11','3-12'],
  allBans: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  periodsPerDay: { '월': 6, '화': 7, '수': 6, '목': 7, '금': 6 },
  // 급식 미운영 키워드 (fullDayEvent에 포함 시 급식 제외)
  noLunchKeywords: ['추석', '공휴일', '한글날', '수능', '휴업', '성탄절', '신정', '대체공휴일', '정기시험'],
  // 급식 운영 행사 (fullDayEvent이지만 급식 운영 — 여기 포함되면 급식 카운트)
  lunchServedKeywords: ['전국연합', '앨범촬영', '가온제']
};

// ──── HTML Escape Utility ────────────────────────────────────────────────────
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => _escMap[c]);
}

export const RollbookModel = {
  /**
   * Parse student and timetable data from '출결사항' (or '취합') CSV
   */
  parseAttendanceData(csvRows) {
    if (!csvRows || csvRows.length < 4) return [];

    // Dynamically detect timetable column positions from header rows (Row index 1 or 2)
    const slotColMap = {}; // e.g. '월1' -> 34, '화7' -> 70, '목7' -> 109
    for (let hIdx = 0; hIdx <= 2; hIdx++) {
      const headerRow = csvRows[hIdx];
      if (!headerRow) continue;
      for (let c = 0; c < headerRow.length; c++) {
        const val = (headerRow[c] || '').trim();
        const m = val.match(/^([월화수목금])([1-7])$/);
        if (m) {
          const key = `${m[1]}${m[2]}`;
          if (slotColMap[key] === undefined) {
            slotColMap[key] = c;
          }
        }
      }
    }

    // Fallback timetable column layout if headers are missing or not matched:
    // 월1~6 (34~51), 화1~7 (52~72), 수1~6 (73~90), 목1~7 (91~111), 금1~6 (112~129)
    const fallbackDayPrefixes = [
      { day: '월', startCol: 34, maxPeriod: 6 },
      { day: '화', startCol: 52, maxPeriod: 7 },
      { day: '수', startCol: 73, maxPeriod: 6 },
      { day: '목', startCol: 91, maxPeriod: 7 },
      { day: '금', startCol: 112, maxPeriod: 6 }
    ];

    const students = [];
    // Data starts at row index 3 (0-indexed)
    for (let r = 3; r < csvRows.length; r++) {
      const row = csvRows[r];
      if (!row || row.length < 35) continue;

      const ban = (row[0] || '').trim();
      const num = (row[1] || '').trim();
      const name = (row[2] || '').trim();
      const gender = (row[3] || '').trim();
      if (!ban || !name) continue;

      // Col 15 is Column P ('비고')
      const pRemark = (row[15] || '').trim();

      // Weekly recurring attendance (Cols 16 to 30)
      const weeklyAtt = {
        '월': { type: (row[16] || '').trim(), time: (row[17] || '').trim(), lunch: (row[18] || '').trim() },
        '화': { type: (row[19] || '').trim(), time: (row[20] || '').trim(), lunch: (row[21] || '').trim() },
        '수': { type: (row[22] || '').trim(), time: (row[23] || '').trim(), lunch: (row[24] || '').trim() },
        '목': { type: (row[25] || '').trim(), time: (row[26] || '').trim(), lunch: (row[27] || '').trim() },
        '금': { type: (row[28] || '').trim(), time: (row[29] || '').trim(), lunch: (row[30] || '').trim() }
      };

      const studentId = (row[32] || '').trim() || `${ban}${num.padStart(2, '0')}`;

      // Detect timetable column positions dynamically from header row
      // (Row index 2 contains '월1', '월2', ..., '화7', ..., '목7', etc.)
      const timetable = {};
      const days = ['월', '화', '수', '목', '금'];
      days.forEach(day => {
        const maxPeriod = AcademicConfig.periodsPerDay[day] || 6;
        for (let p = 1; p <= maxPeriod; p++) {
          const key = `${day}${p}`;
          let c = slotColMap[key];
          if (c === undefined) {
            // Fallback calculation: 월(34~51, 6개), 화(52~72, 7개), 수(73~90, 6개), 목(91~111, 7개), 금(112~129, 6개)
            const fallbackDay = fallbackDayPrefixes.find(f => f.day === day);
            if (fallbackDay && p <= fallbackDay.maxPeriod) {
              c = fallbackDay.startCol + (p - 1) * 3;
            }
          }

          if (c !== undefined && c < row.length) {
            let subj = (row[c] || '').trim();
            let teacher = (row[c + 1] || '').trim();
            let room = (row[c + 2] || '').trim();
            room = this.normalizeRoom(room, subj);
            timetable[key] = { subj, teacher, room };
          } else {
            timetable[key] = { subj: '', teacher: '', room: '-' };
          }
        }
      });

      students.push({
        ban: parseInt(ban, 10),
        num: parseInt(num, 10),
        name,
        gender,
        pRemark,
        studentId,
        weeklyAtt,
        timetable
      });
    }

    // Sort students by studentId by default
    students.sort((a, b) => a.studentId.localeCompare(b.studentId));
    return students;
  },

  /**
   * Room name normalization (handles data noise like missing room or subject name in room col)
   */
  normalizeRoom(room, subj) {
    if (!room || room === '-') return '-';
    // Match standard room like 3-1, 3-12
    const m = room.match(/3-\d+/);
    if (m) return m[0];
    return room;
  },

  /**
   * Parse '행사및휴일' sheet CSV
   */
  parseHolidaysData(csvRows) {
    const fullDayEvents = {};   // 'YYYY-MM-DD' -> event name (e.g. '추석연휴')
    const periodOverrides = {}; // 'YYYY-MM-DD.N교시' -> { type: 'cancelled'|'swap'|'activity', value: '...' }

    if (!csvRows || csvRows.length < 2) {
      return { fullDayEvents, periodOverrides };
    }

    // Row 1 onwards (skip header row 0)
    for (let r = 1; r < csvRows.length; r++) {
      const row = csvRows[r];
      if (!row || row.length < 1) continue;

      let a = (row[0] || '').trim();
      let b = (row[1] || '').trim();
      if (!a) continue;

      // Check if A ends with "교시" e.g. "2026.09.22.1교시" or "2026.09.24.6교시"
      const periodMatch = a.match(/^(\d{4})[./-](\d{2})[./-](\d{2})\.(\d)교시$/);
      if (periodMatch) {
        const dateKey = `${periodMatch[1]}-${periodMatch[2]}-${periodMatch[3]}`;
        const periodNum = parseInt(periodMatch[4], 10);
        const key = `${dateKey}.${periodNum}교시`;

        if (!b) {
          // Cancelled / shortened period
          periodOverrides[key] = { type: 'cancelled', value: '수업 없음' };
        } else if (/^[월화수목금][1-7]$/.test(b)) {
          // Timetable swap (e.g. "금1", "화1")
          periodOverrides[key] = { type: 'swap', value: b };
        } else {
          // Special activity (e.g. "봉사", "자율")
          periodOverrides[key] = { type: 'activity', value: b };
        }
        continue;
      }

      // Check if A is a full date e.g. "2026.09.24." or "2026-09-24"
      const dateMatch = a.match(/^(\d{4})[./-](\d{2})[./-](\d{2})\.?$/);
      if (dateMatch) {
        const dateKey = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        if (b) {
          fullDayEvents[dateKey] = b;
        }
      }
    }

    return { fullDayEvents, periodOverrides };
  },

  /**
   * Parse '출결기록' sheet CSV into an override Map
   * Returns: Map<"YYYY-MM-DD_교시_학번", { key, date, period, ban, num, name, room, status, updatedAt }>
   */
  parseAttendanceRecords(csvRows) {
    const overridesMap = new Map();
    if (!csvRows || csvRows.length < 2) return overridesMap;

    // Row 0: Headers (고유키, 날짜, 교시, 반, 번호, 이름, 이동반교실, 출결내용, 수정일시)
    for (let r = 1; r < csvRows.length; r++) {
      const row = csvRows[r];
      if (!row || row.length < 3) continue;

      const key = (row[0] || '').trim();
      const date = (row[1] || '').trim();
      const period = (row[2] || '').trim();
      const ban = (row[3] || '').trim();
      const num = (row[4] || '').trim();
      const name = (row[5] || '').trim();
      const room = (row[6] || '').trim();
      const status = (row[7] || '').trim();
      const updatedAt = (row[8] || '').trim();
      const docSubRaw = (row[9] || '').trim();
      const docSubmitted = docSubRaw === '1' || docSubRaw.toLowerCase() === 'true' || docSubRaw === '제출' || docSubRaw.toUpperCase() === 'Y';

      // If key is present, or construct key: date_period_studentId
      const finalKey = key || `${date}_${period}_${ban}${num.padStart(2, '0')}`;
      if (finalKey && status) {
        overridesMap.set(finalKey, {
          key: finalKey,
          date,
          period: parseInt(period, 10) || period,
          ban,
          num,
          name,
          room,
          status,
          updatedAt,
          docSubmitted
        });
      }
    }

    return overridesMap;
  },

  /**
   * Generate Academic Weeks:
   * 2학기 6주차 ~ 21주차 (설정값 기반 자동 생성)
   */
  getAcademicWeeks() {
    const weeks = [];
    const { semesterStartDate, startWeekNum, endWeekNum } = AcademicConfig;

    const curWeek = this.getCurrentWeekNum();

    for (let w = startWeekNum; w <= endWeekNum; w++) {
      const offsetDays = (w - startWeekNum) * 7;
      const mon = new Date(semesterStartDate.getTime() + offsetDays * 86400000);
      const days = [];

      for (let d = 0; d < 5; d++) {
        const date = new Date(mon.getTime() + d * 86400000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const dayName = dayNames[date.getDay()];

        days.push({
          dateStr: `${yyyy}-${mm}-${dd}`,
          displayDate: `${mm}.${dd}`,
          fullDisplayDate: `${yyyy}년 ${parseInt(mm, 10)}월 ${parseInt(dd, 10)}일`,
          dayOfWeek: dayName,
          dateObj: date
        });
      }

      const isCurrent = (w === curWeek);
      weeks.push({
        weekNum: w,
        label: `2학기 ${w}주차 (${days[0].displayDate} ~ ${days[4].displayDate})${isCurrent ? ' ★ [이번 주]' : ''}`,
        shortLabel: `${w}주차`,
        isCurrent,
        days
      });
    }

    return weeks;
  },

  /**
   * Get formatted info for today's date
   */
  getTodayInfo(customDate = null) {
    const today = customDate ? new Date(customDate) : new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[today.getDay()];
    const currentWeekNum = this.getCurrentWeekNum(today);

    return {
      dateStr: `${yyyy}-${mm}-${dd}`,
      display: `${yyyy}.${mm}.${dd} (${dayName})`,
      currentWeekNum,
      dateObj: today
    };
  },

  /**
   * Auto-detect current academic week from today's date
   */
  getCurrentWeekNum(customDate = null) {
    const { semesterStartDate, startWeekNum, endWeekNum } = AcademicConfig;
    const today = customDate ? new Date(customDate) : new Date();
    today.setHours(0, 0, 0, 0);

    const diffMs = today.getTime() - semesterStartDate.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    const weekOffset = Math.floor(diffDays / 7);
    const detected = startWeekNum + weekOffset;

    // Clamp to valid range
    if (detected < startWeekNum) return startWeekNum;
    if (detected > endWeekNum) return endWeekNum;
    return detected;
  },

  /**
   * Auto-detect current month for lunch calendar
   */
  getCurrentLunchMonth() {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    // Clamp to academic period (2026-09 ~ 2027-01)
    if (y < 2026 || (y === 2026 && m < 9)) return { year: 2026, month: 9 };
    if (y > 2027 || (y === 2027 && m > 1)) return { year: 2027, month: 1 };
    return { year: y, month: m };
  },

  /**
   * Get display text (1 character) for attendance status in narrow cell
   */
  getStatusDisplayText(status) {
    const s = (status || '').trim();
    if (!s || s === '출석') return '';
    if (s.startsWith('인')) return '인'; // 인정 4종(생리, 체험, 경조사, 전염병) 모두 좁은 칸에는 '인'
    return s;
  },

  /**
   * Get remark keyword for attendance status (to display in 비고란)
   */
  getStatusRemarkText(status) {
    const s = (status || '').trim();
    if (s === '인(생리)' || s === '생리') return '생리';
    if (s === '인(체험)' || s === '체험') return '체험';
    if (s === '인(경조사)' || s === '경조사') return '경조사';
    if (s === '인(전염병)' || s === '전염병') return '전염병';
    return '';
  },

  /**
   * Get next attendance status in cycle
   * Standard: '' (출석) -> '미' -> '인(생리)' -> '인(체험)' -> '인(경조사)' -> '인(전염병)' -> '병' -> '기' -> '' (출석)
   * With original value (e.g. '위탁', '특수', '파', '순'):
   * original -> '' (출석) -> '미' -> '인(생리)' -> '인(체험)' -> '인(경조사)' -> '인(전염병)' -> '병' -> '기' -> original
   */
  getNextAttendanceStatus(currentStatus, originalStatus = '') {
    const orig = (originalStatus || '').trim();
    const curr = (currentStatus || '').trim();
    const baseCycle = ['', '미', '인(생리)', '인(체험)', '인(경조사)', '인(전염병)', '병', '기'];
    const cycle = (orig && !baseCycle.includes(orig)) ? [orig, ...baseCycle] : baseCycle;
    const idx = cycle.indexOf(curr);
    if (idx === -1) return cycle[1] || '';
    return cycle[(idx + 1) % cycle.length];
  },

  /**
   * Get previous attendance status in cycle (Shift + Click)
   */
  getPrevAttendanceStatus(currentStatus, originalStatus = '') {
    const orig = (originalStatus || '').trim();
    const curr = (currentStatus || '').trim();
    const baseCycle = ['', '미', '인(생리)', '인(체험)', '인(경조사)', '인(전염병)', '병', '기'];
    const cycle = (orig && !baseCycle.includes(orig)) ? [orig, ...baseCycle] : baseCycle;
    const idx = cycle.indexOf(curr);
    if (idx === -1) return cycle[cycle.length - 1];
    return cycle[(idx - 1 + cycle.length) % cycle.length];
  },

  /**
   * Get category from rawStatus string
   */
  getCategoryFromRawStatus(rawStatus) {
    const s = (rawStatus || '').trim();
    if (!s || s === '출석') return 'present';
    if (s === '인(생리)' || s === '생리') return 'saenggyeol';
    if (s === '인(체험)' || s === '체험') return 'cheheom';
    if (s === '인(경조사)' || s === '경조사') return 'gyeongjosa';
    if (s === '인(전염병)' || s === '전염병') return 'jeonyeom';
    if (s.startsWith('인')) return 'saenggyeol';
    if (s === '병') return 'jilbyeong';
    if (s === '미') return 'miinjeong';
    if (s === '기') return 'gita';
    return 'gita';
  },

  /**
   * Get short reason text from raw status (e.g. '병', '생리', '체험', '경조사', '전염병', '미', '기')
   */
  getShortReasonText(rawStatus) {
    const s = (rawStatus || '').trim();
    if (!s || s === '출석') return '';
    if (s === '인(생리)') return '생리';
    if (s === '인(체험)') return '체험';
    if (s === '인(경조사)') return '경조사';
    if (s === '인(전염병)') return '전염병';
    return s;
  },

  /**
   * Get special student / pass / itinerant mark for morning/afternoon sessions ('조', '종')
   */
  getSpecialMarkOnly(student, dateStr = null, showSpecialStudent = false) {
    const pRemark = student ? (student.pRemark || '') : '';
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
  },

  /**
   * Check if two attendance statuses are equivalent
   */
  isStatusEquivalent(statusA, statusB) {
    const a = (statusA || '').trim();
    const b = (statusB || '').trim();
    if (a === b) return true;

    const isPresentA = (!a || a === '출석');
    const isPresentB = (!b || b === '출석');
    if (isPresentA && isPresentB) return true;
    if (isPresentA !== isPresentB) return false;

    const normalize = (s) => {
      if (s === '병' || s === '질병' || s === '병결') return '병';
      if (s === '미' || s === '미인정' || s === '무단') return '미';
      if (s === '기' || s === '기타') return '기';
      if (s === '생' || s === '생리' || s === '생결' || s === '인(생리)') return '생리';
      if (s === '체' || s === '체험' || s === '인(체험)') return '체험';
      if (s === '경' || s === '경조사' || s === '인(경조사)') return '경조사';
      if (s === '전' || s === '전염병' || s === '인(전염병)') return '전염병';
      if (s === '특' || s.includes('특수')) return '특';
      if (s === '파' || s.includes('파스') || s.includes('패스')) return '파';
      if (s === '순' || s.includes('순회')) return '순';
      return s;
    };

    return normalize(a) === normalize(b);
  },

  /**
   * Get effective status taking overridesMap into account
   */
  getEffectiveStudentPeriodStatus(student, dayOfWeek, periodNum, dateStr = null, showSpecialStudent = false, overridesMap = null) {
    const def = this.getStudentPeriodStatus(student, dayOfWeek, periodNum, dateStr, showSpecialStudent);
    const key = `${dateStr}_${periodNum}_${student.studentId}`;
    if (overridesMap && overridesMap.has(key)) {
      const rec = overridesMap.get(key);
      const rawStatus = (rec.status || '').trim();

      // If override value matches the student's original status, it is not an override
      if (this.isStatusEquivalent(rawStatus, def.text)) {
        return { ...def, rawStatus: def.text, remarkText: '', isOverridden: false, docSubmitted: false };
      }

      if (!rawStatus || rawStatus === '출석') {
        return { text: '', rawStatus: '', remarkText: '', isShaded: false, is50Dark: false, isPresent: true, category: 'present', isOverridden: true };
      }
      const displayText = this.getStatusDisplayText(rawStatus);
      const remarkText = this.getStatusRemarkText(rawStatus);
      const cat = this.getCategoryFromRawStatus(rawStatus);

      return {
        text: displayText,
        rawStatus,
        remarkText,
        isShaded: true,
        is50Dark: false,
        isPresent: false,
        category: cat,
        isOverridden: true,
        docSubmitted: !!rec.docSubmitted
      };
    }
    return { ...def, rawStatus: def.text, remarkText: '', isOverridden: false, docSubmitted: false };
  },

  /**
   * Analyze student daily attendance across whole day:
   * Sessions: ['조', 1, 2, ..., maxPeriod, '종']
   * Classifies into:
   * - 결석: 조례, 1~최종교시, 종례까지 모두 출석이 아닌 경우
   * - 지각: 앞부분 불참 후 출석
   * - 조퇴: 출석 후 뒷부분~종례 불참
   * - 결과: 앞뒤 출석 중 중간 교시 불참
   */
  analyzeDailyAttendance(student, dayOfWeek, dateStr, overridesMap = null, showSpecialStudent = false) {
    const maxPeriod = AcademicConfig.periodsPerDay[dayOfWeek] || 6;
    const periods = ['조'];
    for (let p = 1; p <= maxPeriod; p++) periods.push(p);
    periods.push('종');

    const sessionResults = periods.map(p => {
      const key = `${dateStr}_${p}_${student.studentId}`;
      let isPresent = true;
      let rawStatus = '';
      let category = 'present';

      if (p === '조' || p === '종') {
        if (overridesMap && overridesMap.has(key)) {
          const rec = overridesMap.get(key);
          rawStatus = (rec.status || '').trim();
          if (rawStatus && rawStatus !== '출석') {
            isPresent = false;
            category = this.getCategoryFromRawStatus(rawStatus);
          }
        } else {
          const sp = this.getSpecialMarkOnly(student, dateStr, showSpecialStudent);
          if (sp.text && (sp.text.includes('자퇴') || sp.text.includes('위탁') || sp.text.includes('전출'))) {
            isPresent = false;
            rawStatus = sp.text;
            category = 'drop';
          }
        }
      } else {
        const st = this.getEffectiveStudentPeriodStatus(student, dayOfWeek, p, dateStr, showSpecialStudent, overridesMap);
        isPresent = st.isPresent;
        rawStatus = st.rawStatus || st.text;
        category = st.category || 'present';
      }

      return { period: p, isPresent, rawStatus, category };
    });

    const absentSessions = sessionResults.filter(s => !s.isPresent);
    const totalCount = sessionResults.length;

    // 1. All sessions present
    if (absentSessions.length === 0) {
      return {
        isNormal: true,
        isAbsence: false,
        isLate: false,
        isEarlyLeave: false,
        isClassSkipped: false,
        summary: '',
        sessions: sessionResults
      };
    }

    // Helper: find main reason keyword
    const getMainReason = (list) => {
      const counts = {};
      list.forEach(s => {
        const r = this.getShortReasonText(s.rawStatus) || s.rawStatus || '기';
        counts[r] = (counts[r] || 0) + 1;
      });
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
    };

    // 2. Full Day Absence: ALL sessions (조례, 1~max, 종례) are absent
    if (absentSessions.length === totalCount) {
      const mainReason = getMainReason(absentSessions);
      return {
        isNormal: false,
        isAbsence: true,
        isLate: false,
        isEarlyLeave: false,
        isClassSkipped: false,
        absenceReason: mainReason,
        summary: `결석(${mainReason})`,
        sessions: sessionResults
      };
    }

    // 3. Partial Attendance: classify into 지각, 조퇴, 결과
    let firstPresentIdx = -1;
    let lastPresentIdx = -1;

    for (let i = 0; i < totalCount; i++) {
      if (sessionResults[i].isPresent) {
        if (firstPresentIdx === -1) firstPresentIdx = i;
        lastPresentIdx = i;
      }
    }

    // 지각: starting sessions up to first present are absent
    const isLate = firstPresentIdx > 0;
    const lateSessions = isLate ? sessionResults.slice(0, firstPresentIdx) : [];
    const lateReason = isLate ? getMainReason(lateSessions) : '';

    // 조퇴: sessions after last present up to end are absent
    const isEarlyLeave = lastPresentIdx < totalCount - 1;
    const earlyLeaveSessions = isEarlyLeave ? sessionResults.slice(lastPresentIdx + 1) : [];
    const earlyLeaveReason = isEarlyLeave ? getMainReason(earlyLeaveSessions) : '';

    // 결과: middle sessions between first present and last present that are absent
    const skippedSessions = [];
    if (firstPresentIdx !== -1 && lastPresentIdx !== -1) {
      for (let i = firstPresentIdx + 1; i < lastPresentIdx; i++) {
        if (!sessionResults[i].isPresent) {
          skippedSessions.push(sessionResults[i]);
        }
      }
    }
    const isClassSkipped = skippedSessions.length > 0;
    const skipReason = isClassSkipped ? getMainReason(skippedSessions) : '';
    const skipPeriods = skippedSessions.map(s => s.period).join(',');

    // Formulate concise summary text
    const parts = [];
    if (isLate) parts.push(`지각(${lateReason})`);
    if (isEarlyLeave) parts.push(`조퇴(${earlyLeaveReason})`);
    if (isClassSkipped) parts.push(`결과(${skipReason} ${skipPeriods}T)`);

    return {
      isNormal: false,
      isAbsence: false,
      isLate,
      isEarlyLeave,
      isClassSkipped,
      lateReason,
      earlyLeaveReason,
      skipReason,
      summary: parts.join('·'),
      sessions: sessionResults
    };
  },

  getShortReasonText(rawStatus) {
    if (!rawStatus) return '';
    const s = String(rawStatus).trim();
    if (s.includes('체험')) return '체험';
    if (s.includes('경조사')) return '경조사';
    if (s.includes('전염병')) return '전염병';
    if (s.includes('생리')) return '생리';
    if (s.includes('병')) return '병';
    if (s.includes('기')) return '기';
    if (s.includes('인')) return '인';
    return s;
  },

  /**
   * Convert daily attendance analysis into an official Absence Report record object
   */
  createAbsenceReportFromRollbook(student, dayOfWeek, dateStr, overridesMap = null) {
    const analysis = this.analyzeDailyAttendance(student, dayOfWeek, dateStr, overridesMap);
    if (analysis.isNormal) {
      return null;
    }

    let cat = '결석';
    let rawReason = '';
    let startPeriod = '';
    let endPeriod = '';

    if (analysis.isAbsence) {
      cat = '결석';
      rawReason = analysis.absenceReason;
      startPeriod = 1;
      const numPeriods = analysis.sessions.filter(s => typeof s.period === 'number');
      endPeriod = numPeriods.length > 0 ? numPeriods[numPeriods.length - 1].period : '';
    } else if (analysis.isLate) {
      cat = '지각';
      rawReason = analysis.lateReason;
      const lateSessions = analysis.sessions.filter(s => !s.isPresent && typeof s.period === 'number');
      if (lateSessions.length > 0) {
        startPeriod = lateSessions[0].period;
        endPeriod = lateSessions[lateSessions.length - 1].period;
      }
    } else if (analysis.isEarlyLeave) {
      cat = '조퇴';
      rawReason = analysis.earlyLeaveReason;
      const earlySessions = analysis.sessions.filter(s => !s.isPresent && typeof s.period === 'number');
      if (earlySessions.length > 0) {
        startPeriod = earlySessions[0].period;
        endPeriod = earlySessions[earlySessions.length - 1].period;
      }
    } else if (analysis.isClassSkipped) {
      cat = '결과';
      rawReason = analysis.skipReason;
      const skipSessions = analysis.sessions.filter(s => !s.isPresent && typeof s.period === 'number');
      if (skipSessions.length > 0) {
        startPeriod = skipSessions[0].period;
        endPeriod = skipSessions[skipSessions.length - 1].period;
      }
    }

    // Type & subType mapping
    let type = '질병';
    let subType = '';
    let reasonText = '';

    const r = (rawReason || '').trim();
    if (r === '병' || r.includes('질병') || r.includes('감기') || r.includes('병원')) {
      type = '질병';
      reasonText = '질병으로 인한 근태 (치료 및 안정)';
    } else if (r.includes('생리')) {
      type = '생리통';
      subType = '생리통';
      reasonText = '생리통으로 인한 안정';
    } else if (r.includes('체험')) {
      type = '출석인정';
      subType = '교외체험학습';
      reasonText = '학교장 허가 교외체험학습 참여';
    } else if (r.includes('경조사')) {
      type = '출석인정';
      subType = '경조사';
      reasonText = '가족 경조사 참석';
    } else if (r.includes('전염병') || r.includes('격리') || r.includes('코로나') || r.includes('독감')) {
      type = '출석인정';
      subType = '전염병';
      reasonText = '법정 전염병 격리 치료';
    } else if (r.startsWith('인')) {
      type = '출석인정';
      subType = '출석인정';
      reasonText = '출석인정 사유 발생';
    } else if (r === '기' || r.includes('기타')) {
      type = '기타';
      reasonText = '개인 사정으로 인한 사유';
    } else {
      type = '질병';
      reasonText = r || '건강상의 사유로 인한 근태';
    }

    return {
      grade: '3',
      ban: student.ban,
      num: student.num,
      name: student.name,
      studentId: student.studentId,
      cat,
      type,
      subType,
      startDate: dateStr,
      endDate: dateStr,
      startPeriod,
      endPeriod,
      totalDays: '1일간',
      reason: reasonText,
      parentName: '학부모',
      writeDate: dateStr,
      studentSigUrl: '',
      parentSigUrl: '',
      printedAt: ''
    };
  },

  /**
   * @param {Object} student
   * @param {string} dayOfWeek '월' | '화' | '수' | '목' | '금'
   * @param {number} periodNum 1 to 7
   * @param {string} dateStr 'YYYY-MM-DD'
   * @param {boolean} showSpecialStudent Whether to show special student marks
   */
  getStudentPeriodStatus(student, dayOfWeek, periodNum, dateStr = null, showSpecialStudent = false) {
    const pRemark = student.pRemark;

    // 1. 자퇴 / 위탁 / 전출 -> 50% dark shading for entire row, not present
    if (pRemark.includes('자퇴') || pRemark.includes('위탁') || pRemark.includes('전출')) {
      return { text: pRemark, isShaded: true, is50Dark: true, isPresent: false, category: 'drop' };
    }

    // 2. 특수 -> '특' (10% tint) (showSpecialStudent가 true일 때만 '특'으로 표시)
    if (showSpecialStudent && pRemark.includes('특수')) {
      return { text: '특', isShaded: true, is50Dark: false, isPresent: false, category: 'special' };
    }

    // 3. 파스 -> '파' (10% tint) - 9/22(화) ~ 11/17(화) 운영 기간 중에만 적용
    if (pRemark.includes('파스') || pRemark.includes('패스')) {
      const isPassActive = !dateStr || (dateStr >= AcademicConfig.passStartDate && dateStr <= AcademicConfig.passEndDate);
      if (isPassActive) {
        return { text: '파', isShaded: true, is50Dark: false, isPresent: false, category: 'special' };
      }
    }

    // 4. 순회 -> '순' (10% tint)
    if (pRemark.includes('순회')) {
      return { text: '순', isShaded: true, is50Dark: false, isPresent: false, category: 'special' };
    }

    // 5. Weekly recurring absence/early departure
    const att = student.weeklyAtt ? student.weeklyAtt[dayOfWeek] : null;
    if (att && att.type) {
      const type = att.type.trim();
      const time = (att.time || '').trim();
      const pMatch = time.match(/(\d)교시/);
      const isApplicable = time.includes('결석') || (pMatch && periodNum >= parseInt(pMatch[1], 10)) || !time;

      if (isApplicable) {
        // 출석인정(생결)
        if (type.includes('생결') || type.includes('생리')) {
          return { text: '생', isShaded: true, is50Dark: false, isPresent: false, category: 'saenggyeol' };
        }
        // 출석인정(체험)
        if (type.includes('체험')) {
          return { text: '체', isShaded: true, is50Dark: false, isPresent: false, category: 'cheheom' };
        }
        // 질병
        if (type.includes('질병') || type.includes('병결') || type.includes('병')) {
          return { text: '병', isShaded: true, is50Dark: false, isPresent: false, category: 'jilbyeong' };
        }
        // 기타
        if (type.includes('기타')) {
          return { text: '기', isShaded: true, is50Dark: false, isPresent: false, category: 'gita' };
        }
        // 미인정
        if (type.includes('미인정') || type.includes('무단')) {
          return { text: '미', isShaded: true, is50Dark: false, isPresent: false, category: 'miinjeong' };
        }
        // 기타 출석인정 / 공결
        if (type.includes('인정') || type.includes('공결')) {
          return { text: '인', isShaded: true, is50Dark: false, isPresent: false, category: 'saenggyeol' };
        }
      }
    }

    // Check pRemark for attendance keywords if not in weeklyAtt
    if (pRemark.includes('생결') || pRemark.includes('생리')) {
      return { text: '생', isShaded: true, is50Dark: false, isPresent: false, category: 'saenggyeol' };
    }
    if (pRemark.includes('체험')) {
      return { text: '체', isShaded: true, is50Dark: false, isPresent: false, category: 'cheheom' };
    }
    if (pRemark.includes('기타')) {
      return { text: '기', isShaded: true, is50Dark: false, isPresent: false, category: 'gita' };
    }

    // Default: Regular student present (blank box for pen checking)
    return { text: '', isShaded: false, is50Dark: false, isPresent: true, category: 'present' };
  },

  /**
   * Filter remark text based on operational date (e.g. hide '파스' outside PASS operating period)
   * and special student display toggle
   * @param {string} pRemark
   * @param {string|Object|Array} dateOrDays - 'YYYY-MM-DD', dayInfo object, or array of days
   * @param {boolean} showSpecialStudent - Whether to display '특수' mark in remarks
   */
  getDisplayRemark(pRemark, dateOrDays, showSpecialStudent = false) {
    if (!pRemark) return '';
    let result = pRemark;

    // 특수학생 표시 토글이 OFF(false)인 경우 '특수' 문구 제거
    if (!showSpecialStudent && result.includes('특수')) {
      result = result
        .replace(/특수/g, '')
        .replace(/^[,\s/]+|[,\s/]+$/g, '')
        .trim();
    }

    if (!dateOrDays) return result;
    let isPassActive = false;
    if (Array.isArray(dateOrDays)) {
      isPassActive = dateOrDays.some(d => {
        const dStr = typeof d === 'string' ? d : (d && d.dateStr);
        return dStr && dStr >= AcademicConfig.passStartDate && dStr <= AcademicConfig.passEndDate;
      });
    } else {
      const dStr = typeof dateOrDays === 'string' ? dateOrDays : (dateOrDays && dateOrDays.dateStr);
      isPassActive = dStr && dStr >= AcademicConfig.passStartDate && dStr <= AcademicConfig.passEndDate;
    }
    if (!isPassActive && (result.includes('파스') || result.includes('패스'))) {
      result = result
        .replace(/파스|패스/g, '')
        .replace(/^[,\s/]+|[,\s/]+$/g, '')
        .trim();
    }
    return result;
  },

  /**
   * Get effective display remark combining base remark and attendance override remarks/daily summaries
   */
  getEffectiveDisplayRemark(pRemark, studentId, dateOrDays, overridesMap = null, showSpecialStudent = false, student = null) {
    const base = this.getDisplayRemark(pRemark, dateOrDays, showSpecialStudent);
    if (!overridesMap || !studentId || !dateOrDays) return base;

    const dayList = Array.isArray(dateOrDays)
      ? dateOrDays
      : [dateOrDays];

    const dailySummaries = [];
    const extraRemarks = new Set();

    dayList.forEach(dayItem => {
      const dStr = typeof dayItem === 'string' ? dayItem : (dayItem && dayItem.dateStr);
      const dayOfWeek = (dayItem && dayItem.dayOfWeek) || (dStr ? AcademicConfig.getDayOfWeek(dStr) : '');
      if (!dStr) return;

      if (student && dayOfWeek) {
        const analysis = this.analyzeDailyAttendance(student, dayOfWeek, dStr, overridesMap, showSpecialStudent);
        if (!analysis.isNormal && analysis.summary) {
          const prefix = dayList.length > 1 ? `${dayOfWeek}:` : '';
          dailySummaries.push(`${prefix}${analysis.summary}`);
          return;
        }
      }

      // Fallback: check session-level overrides for remark text ('생리', '체험', '경조사', '전염병')
      const checkPeriods = ['조', 1, 2, 3, 4, 5, 6, 7, '종'];
      checkPeriods.forEach(p => {
        const key = `${dStr}_${p}_${studentId}`;
        if (overridesMap.has(key)) {
          const rec = overridesMap.get(key);
          const rText = this.getStatusRemarkText(rec.status);
          if (rText) extraRemarks.add(rText);
        }
      });
    });

    const combinedExtra = [];
    if (dailySummaries.length > 0) {
      combinedExtra.push(...dailySummaries);
    } else if (extraRemarks.size > 0) {
      combinedExtra.push(Array.from(extraRemarks).join(', '));
    }

    if (combinedExtra.length > 0) {
      const extraStr = combinedExtra.join(', ');
      if (base) {
        if (base.includes(extraStr)) return base;
        return `${base}, ${extraStr}`;
      }
      return extraStr;
    }

    return base;
  },

  /**
   * Check if a student is eligible for lunch on a specific day
   */
  isStudentEatingLunch(student, dayOfWeek) {
    const pRemark = student.pRemark;

    // 순회, 자퇴, 위탁, 전출 -> Always excluded from lunch
    if (pRemark.includes('순회') || pRemark.includes('자퇴') || pRemark.includes('위탁') || pRemark.includes('전출')) {
      return false;
    }

    const att = student.weeklyAtt[dayOfWeek];
    // If lunch is explicitly 'X', excluded regardless of absence type
    if (att && att.lunch && att.lunch.trim().toUpperCase() === 'X') {
      return false;
    }

    // 파스, 특수 -> included unless lunch is 'X'
    // General student -> included unless lunch is 'X'
    return true;
  },

  /**
   * Resolve period details for a classroom on a specific date:
   * Returns { subj, teacher, room, status: 'normal'|'cancelled'|'swap'|'activity'|'holiday', activityTitle, students }
   */
  getRoomPeriodRoster(allStudents, roomName, dateStr, dayOfWeek, periodNum, holidaysMap, overridesMap = null) {
    const fullDayEvent = holidaysMap.fullDayEvents[dateStr];
    if (fullDayEvent) {
      return {
        room: roomName,
        periodNum,
        status: 'holiday',
        title: fullDayEvent,
        students: []
      };
    }

    const overrideKey = `${dateStr}.${periodNum}교시`;
    const override = holidaysMap.periodOverrides[overrideKey];

    // Cancelled period
    if (override && override.type === 'cancelled') {
      return {
        room: roomName,
        periodNum,
        status: 'cancelled',
        title: '수업 없음 (단축)',
        students: []
      };
    }

    // Special activity period (e.g. '봉사', '자율')
    if (override && override.type === 'activity') {
      return {
        room: roomName,
        periodNum,
        status: 'activity',
        title: `${override.value}활동`,
        students: []
      };
    }

    // Determine target schedule key: default is `${dayOfWeek}${periodNum}` (e.g. '월1')
    let scheduleKey = `${dayOfWeek}${periodNum}`;
    let isSwap = false;
    if (override && override.type === 'swap') {
      scheduleKey = override.value; // e.g. '금1'
      isSwap = true;
    }

    // Find all students whose timetable has this room at this schedule key
    const assignedStudents = [];
    let subject = '';
    let teacher = '';

    allStudents.forEach(st => {
      const slot = st.timetable[scheduleKey];
      if (slot && slot.room === roomName) {
        assignedStudents.push(st);
        if (!subject && slot.subj) subject = slot.subj;
        if (!teacher && slot.teacher) teacher = slot.teacher;
      }
    });

    // Sort students by studentId (학번순)
    assignedStudents.sort((a, b) => a.studentId.localeCompare(b.studentId));

    // Calculate expected attendance and absence categories for this period
    let expectedAttendance = 0;
    const stats = {
      saenggyeol: 0, // 인정(생리)
      cheheom: 0,    // 인정(체험)
      gyeongjosa: 0, // 인정(경조사)
      jeonyeom: 0,   // 인정(전염병)
      jilbyeong: 0,  // 질병
      gita: 0,       // 기타
      miinjeong: 0   // 미인정
    };

    assignedStudents.forEach(st => {
      const status = this.getEffectiveStudentPeriodStatus(st, dayOfWeek, periodNum, dateStr, false, overridesMap);
      if (status.isPresent) {
        expectedAttendance++;
      } else if (status.category && stats[status.category] !== undefined) {
        stats[status.category]++;
      }
    });

    return {
      room: roomName,
      periodNum,
      scheduleKey,
      isSwap,
      subject: subject || (dayOfWeek === '수' && (periodNum === 5 || periodNum === 6) ? '창체' : '-'),
      teacher: teacher || '-',
      status: 'normal',
      students: assignedStudents,
      expectedAttendance,
      stats,
      totalAssigned: assignedStudents.length
    };
  },

  /**
   * Calculate NEIS Monthly Attendance Summary for a homeroom class
   * Used by 담임교사 to close monthly attendance in NEIS without manual counting
   */
  calculateNeisMonthlySummary(allStudents, banNum, year, month, overridesMap = null, showSpecialStudents = false) {
    const banStudents = (allStudents || []).filter(s => s.ban === banNum);
    banStudents.sort((a, b) => a.num - b.num);

    // Generate all dates in the selected month
    const daysInMonth = new Date(year, month, 0).getDate();
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      const mStr = String(month).padStart(2, '0');
      const dateStr = `${year}-${mStr}-${dayStr}`;
      const dayOfWeek = AcademicConfig.getDayOfWeek(dateStr);
      if (dayOfWeek !== '토' && dayOfWeek !== '일') {
        dates.push({ dateStr, dayOfWeek, d });
      }
    }

    const classifyReason = (reason) => {
      const r = (reason || '').trim();
      if (r === '병' || r.includes('질병')) return 'ill';
      if (r === '미' || r.includes('미인정') || r.includes('무단')) return 'unrec';
      if (r.startsWith('인') || r === '생리' || r === '체험' || r === '경조사' || r === '전염병' || r.includes('인정')) return 'rec';
      return 'etc';
    };

    const studentsSummary = banStudents.map(st => {
      const summary = {
        num: st.num,
        studentId: st.studentId,
        name: st.name,
        absence: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
        late: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
        earlyLeave: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
        classSkipped: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
        details: []
      };

      dates.forEach(dInfo => {
        const analysis = this.analyzeDailyAttendance(st, dInfo.dayOfWeek, dInfo.dateStr, overridesMap, showSpecialStudents);
        if (analysis.isNormal) return;

        if (analysis.isAbsence) {
          const type = classifyReason(analysis.absenceReason);
          summary.absence[type]++;
          summary.absence.total++;
          summary.details.push(`${dInfo.d}일:결석(${analysis.absenceReason})`);
        } else {
          if (analysis.isLate) {
            const type = classifyReason(analysis.lateReason);
            summary.late[type]++;
            summary.late.total++;
            summary.details.push(`${dInfo.d}일:지각(${analysis.lateReason})`);
          }
          if (analysis.isEarlyLeave) {
            const type = classifyReason(analysis.earlyLeaveReason);
            summary.earlyLeave[type]++;
            summary.earlyLeave.total++;
            summary.details.push(`${dInfo.d}일:조퇴(${analysis.earlyLeaveReason})`);
          }
          if (analysis.isClassSkipped) {
            const type = classifyReason(analysis.skipReason);
            summary.classSkipped[type]++;
            summary.classSkipped.total++;
            summary.details.push(`${dInfo.d}일:결과(${analysis.skipReason})`);
          }
        }
      });

      return summary;
    });

    // Calculate class totals
    const totals = {
      absence: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
      late: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
      earlyLeave: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 },
      classSkipped: { ill: 0, unrec: 0, rec: 0, etc: 0, total: 0 }
    };

    studentsSummary.forEach(s => {
      ['absence', 'late', 'earlyLeave', 'classSkipped'].forEach(cat => {
        ['ill', 'unrec', 'rec', 'etc', 'total'].forEach(sub => {
          totals[cat][sub] += s[cat][sub];
        });
      });
    });

    return {
      banNum,
      year,
      month,
      datesCount: dates.length,
      studentCount: banStudents.length,
      studentsData: studentsSummary,
      totals
    };
  }
};
