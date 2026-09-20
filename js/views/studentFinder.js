/**
 * Quick Student & Schedule Finder View
 * Allows teachers to search any student or teacher and view their weekly timetable and attendance notes.
 */

export const StudentFinderView = {
  render(allStudents, query = '') {
    const q = query.trim().toLowerCase();
    let results = [];

    if (q) {
      results = allStudents.filter(st =>
        st.name.toLowerCase().includes(q) ||
        st.studentId.includes(q) ||
        String(st.ban) === q ||
        (st.pRemark && st.pRemark.toLowerCase().includes(q))
      );
    }

    const countText = q ? `검색 결과: ${results.length}명` : `전체 학생: ${allStudents.length}명 (이름이나 학번을 입력하세요)`;

    const cardsHtml = results.slice(0, 10).map(st => {
      const days = ['월', '화', '수', '목', '금'];
      let scheduleRows = '';

      for (let p = 1; p <= 6; p++) {
        let periodCells = `<td>${p}교시</td>`;
        days.forEach(d => {
          const slot = st.timetable[`${d}${p}`];
          if (slot && slot.subj && slot.subj !== '-') {
            periodCells += `<td><div class="finder-subj">${slot.subj}</div><div class="finder-room">${slot.room} (${slot.teacher}T)</div></td>`;
          } else {
            periodCells += `<td class="finder-empty">-</td>`;
          }
        });
        scheduleRows += `<tr>${periodCells}</tr>`;
      }

      // Weekly attendance badges
      const attBadges = days.map(d => {
        const att = st.weeklyAtt[d];
        if (att && att.type) {
          return `<span class="finder-badge ${att.type === '질병' ? 'badge-ill' : 'badge-unrec'}">${d}: ${att.type} (${att.time || '결석'}) 중식:${att.lunch || 'O'}</span>`;
        }
        return '';
      }).filter(Boolean).join(' ');

      return `
        <div class="student-card">
          <div class="student-card-header">
            <div class="student-main-info">
              <span class="st-id">${st.studentId}</span>
              <span class="st-name">${st.name}</span>
              <span class="st-ban">(${st.ban}반 ${st.num}번 / ${st.gender})</span>
              ${st.pRemark ? `<span class="st-remark-tag">${st.pRemark}</span>` : ''}
            </div>
            <div class="student-att-badges">
              ${attBadges || '<span class="text-muted">특이 출결 없음 (정상 등교)</span>'}
            </div>
          </div>
          <div class="student-schedule-table-wrapper">
            <table class="finder-schedule-table">
              <thead>
                <tr>
                  <th>교시</th>
                  <th>월</th>
                  <th>화</th>
                  <th>수</th>
                  <th>목</th>
                  <th>금</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="finder-container">
        <div class="finder-search-bar">
          <input type="text" id="finderSearchInput" class="finder-input" placeholder="학생 이름, 학번(예: 30102), 반 번호로 검색..." value="${query}" autofocus />
          <span class="finder-count">${countText}</span>
        </div>
        <div class="finder-results-list">
          ${cardsHtml || (q ? '<div class="finder-no-results">일치하는 학생을 찾을 수 없습니다.</div>' : '<div class="finder-help">위 검색창에 학생 이름(예: 고윤, 김가온)이나 학번(예: 30705)을 입력하여 실시간 시간표와 교실을 확인하세요.</div>')}
        </div>
      </div>
    `;
  }
};
