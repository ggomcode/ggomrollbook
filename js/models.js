/**
 * Data Model & Business Logic for ggomrollbook
 */

export const RollbookModel = {
  /**
   * Parse student and timetable data from '출결사항' (or '취합') CSV
   */
  parseAttendanceData(csvRows) {
    if (!csvRows || csvRows.length < 4) return [];

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

      // Timetable: 월1~월6 (cols 34-51), 화1~화6 (cols 52-69), 수1~수6 (cols 70-87), 목1~목6 (cols 88-105), 금1~금6 (cols 106-123)
      const timetable = {};
      const dayPrefixes = [
        { day: '월', startCol: 34, maxPeriod: 6 },
        { day: '화', startCol: 52, maxPeriod: 6 },
        { day: '수', startCol: 70, maxPeriod: 6 },
        { day: '목', startCol: 88, maxPeriod: 6 },
        { day: '금', startCol: 106, maxPeriod: 6 }
      ];

      dayPrefixes.forEach(({ day, startCol, maxPeriod }) => {
        for (let p = 1; p <= maxPeriod; p++) {
          const c = startCol + (p - 1) * 3;
          let subj = (row[c] || '').trim();
          let teacher = (row[c + 1] || '').trim();
          let room = (row[c + 2] || '').trim();

          // Normalization: clean classroom string e.g. "3-1", "3-12"
          room = this.normalizeRoom(room, subj);

          timetable[`${day}${p}`] = { subj, teacher, room };
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
   * Generate Academic Weeks:
   * 2학기 6주차 (2026.09.21 월) ~ 21주차 (2027.01.06 수 졸업식 / 2027.01.08 금)
   */
  getAcademicWeeks() {
    const weeks = [];
    // Start date: 2026-09-21 (Monday of Week 6)
    const baseStart = new Date(2026, 8, 21); // Month is 0-indexed (8 = September)

    for (let w = 6; w <= 21; w++) {
      const offsetDays = (w - 6) * 7;
      const mon = new Date(baseStart.getTime() + offsetDays * 86400000);
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

      weeks.push({
        weekNum: w,
        label: `2학기 ${w}주차 (${days[0].displayDate} ~ ${days[4].displayDate})`,
        shortLabel: `${w}주차`,
        days
      });
    }

    return weeks;
  },

  /**
   * Determine student's attendance cell mark and shading for a specific period:
   * Returns: { text: '', isShaded: boolean, is50Dark: boolean, isPresent: boolean }
   */
  getStudentPeriodStatus(student, dayOfWeek, periodNum) {
    const pRemark = student.pRemark;

    // 1. 자퇴 / 위탁 / 전출 -> 50% dark shading for entire row, not present
    if (pRemark.includes('자퇴') || pRemark.includes('위탁') || pRemark.includes('전출')) {
      return { text: pRemark, isShaded: true, is50Dark: true, isPresent: false };
    }

    // 2. 특수 -> '특' (10% tint)
    if (pRemark.includes('특수')) {
      return { text: '특', isShaded: true, is50Dark: false, isPresent: false };
    }

    // 3. 파스 -> '파' (10% tint)
    if (pRemark.includes('파스')) {
      return { text: '파', isShaded: true, is50Dark: false, isPresent: false };
    }

    // 4. 순회 -> '순' (10% tint)
    if (pRemark.includes('순회')) {
      return { text: '순', isShaded: true, is50Dark: false, isPresent: false };
    }

    // 5. Weekly recurring absence/early departure
    const att = student.weeklyAtt[dayOfWeek];
    if (att && att.type) {
      // 미인정 결석
      if (att.type.includes('미인정')) {
        if (att.time.includes('결석')) {
          return { text: '미', isShaded: true, is50Dark: false, isPresent: false };
        }
        // 미인정 N교시 조퇴
        const pMatch = att.time.match(/(\d)교시/);
        if (pMatch && periodNum >= parseInt(pMatch[1], 10)) {
          return { text: '미', isShaded: true, is50Dark: false, isPresent: false };
        }
      }

      // 질병 결석 or 조퇴
      if (att.type.includes('질병')) {
        if (att.time.includes('결석')) {
          return { text: '병', isShaded: true, is50Dark: false, isPresent: false };
        }
        const pMatch = att.time.match(/(\d)교시/);
        if (pMatch && periodNum >= parseInt(pMatch[1], 10)) {
          return { text: '병', isShaded: true, is50Dark: false, isPresent: false };
        }
      }
    }

    // Default: Regular student present (blank box for pen checking)
    return { text: '', isShaded: false, is50Dark: false, isPresent: true };
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
  getRoomPeriodRoster(allStudents, roomName, dateStr, dayOfWeek, periodNum, holidaysMap) {
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

    // Calculate expected attendance for this period
    let expectedAttendance = 0;
    assignedStudents.forEach(st => {
      const status = this.getStudentPeriodStatus(st, dayOfWeek, periodNum);
      if (status.isPresent) expectedAttendance++;
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
      totalAssigned: assignedStudents.length
    };
  }
};
