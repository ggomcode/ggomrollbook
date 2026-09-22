/**
 * AbsenceRegistryView - 교사용 결석계 대장 조회 및 브라우저 즉시 인쇄 뷰
 * 구글 시트('대장')를 gviz/tq로 직접 실시간 조회하여 0초 만에 대장을 표시하고 브라우저로 직접 A4 출력합니다.
 */

export const AbsenceRegistryView = {
  /**
   * Parse CSV data from '대장' sheet
   */
  parseRegistryCsv(csvText) {
    if (!csvText) return [];
    const lines = [];
    let row = [''];
    let inQuotes = false;
    let i = 0;

    while (i < csvText.length) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          row[row.length - 1] += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push('');
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        lines.push(row);
        row = [''];
      } else {
        row[row.length - 1] += char;
      }
      i++;
    }
    if (row.length > 1 || row[0] !== '') {
      lines.push(row);
    }

    if (lines.length <= 1) return [];

    // Header row is index 0
    const records = [];
    for (let r = 1; r < lines.length; r++) {
      const line = lines[r];
      if (!line[0] && !line[4]) continue;

      const cat = line[5] === 'TRUE' || line[5] === 'true' || line[5] === '결석' ? '결석' :
                  line[6] === 'TRUE' || line[6] === 'true' || line[6] === '지각' ? '지각' :
                  line[7] === 'TRUE' || line[7] === 'true' || line[7] === '조퇴' ? '조퇴' :
                  line[8] === 'TRUE' || line[8] === 'true' || line[8] === '결과' ? '결과' : (line[5] || '-');

      const type = line[9] === 'TRUE' || line[9] === 'true' || line[9] === '질병' ? '질병' :
                   line[10] === 'TRUE' || line[10] === 'true' || line[10] === '생리통' ? '생리통' :
                   line[11] === 'TRUE' || line[11] === 'true' || line[11] === '출석인정' ? '출석인정' :
                   line[12] === 'TRUE' || line[12] === 'true' || line[12] === '기타' ? '기타' : (line[9] || '-');

      records.push({
        no: line[0] || String(r),
        grade: line[1] || '3',
        ban: line[2] || '',
        num: line[3] || '',
        name: line[4] || '',
        cat,
        type,
        startDate: line[13] || '',
        startPeriod: line[14] || '',
        endDate: line[15] || '',
        endPeriod: line[16] || '',
        totalDays: line[17] || '1일간',
        reason: line[18] || '',
        writeDate: line[19] || '',
        parentName: line[20] || '',
        studentSigUrl: line[33] || '',
        parentSigUrl: line[34] || '',
        pdfUrl: line[35] || '',
        printedAt: line[38] || '',
        subType: (line[37] && !line[37].startsWith('#') && line[37] !== 'TRUE' && line[37] !== 'FALSE') ? line[37].trim() : ''
      });
    }

    return records;
  },

  /**
   * Render Main View HTML
   */
  render(records, filters = {}) {
    const { grade = '', ban = '', num = '', name = '', month = '', printStatus = 'all' } = filters;

    // Filter records
    const filtered = records.filter(r => {
      if (grade && String(r.grade) !== String(grade)) return false;
      if (ban && String(r.ban) !== String(ban)) return false;
      if (num && String(r.num) !== String(num)) return false;
      if (name && !r.name.toLowerCase().includes(name.toLowerCase())) return false;
      if (month && (!r.startDate.startsWith(month) && !r.endDate.startsWith(month))) return false;
      if (printStatus === 'printed' && !r.printedAt) return false;
      if (printStatus === 'unprinted' && r.printedAt) return false;
      return true;
    });

    // Month select options (2026-03 to 2027-02)
    const months = [
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
      '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'
    ];
    const monthOpts = months.map(m => {
      const [y, mm] = m.split('-');
      const sel = (month === m) ? 'selected' : '';
      return `<option value="${m}" ${sel}>${y}년 ${parseInt(mm, 10)}월</option>`;
    }).join('');

    return `
      <div class="absence-registry-view no-print">
        <div class="view-header-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px;">
          <div>
            <h2 style="font-size: 20px; color: var(--text-dark, #212529); margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
              <span>📋</span> 결석계 접수 대장 및 인쇄 관리
            </h2>
            <p style="font-size: 13px; color: #6c757d;">구글 시트 '대장'과 실시간 직통 연동되어 브라우저에서 즉시 검색 및 A4 고속 인쇄가 가능합니다.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button type="button" class="btn btn-primary" id="btnBulkPrintAbsence" style="background: #20c997; border-color: #20c997;">
              🖨️ 선택 일괄 인쇄
            </button>
            <button type="button" class="btn btn-secondary" id="btnRefreshAbsenceRegistry">
              🔄 대장 새로고침
            </button>
          </div>
        </div>

        <!-- 초보 교사용 직관 가이드 배너 -->
        <div class="guidance-tip-box" style="background: #eef4ff; border: 1px solid #c9dafc; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: #1e40af; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <div>
            💡 <strong>출결 연동 Tip:</strong> 원적학급 출석부에서 학생 셀을 <strong>우클릭</strong>하시면 출결 사유(질병/생리통/체험 등)가 자동 분석된 결석계를 1초 만에 바로 출력하실 수 있습니다.
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btnGoHomeroomRollbook" style="font-size: 12px; padding: 5px 12px; background: #2563eb; border: none; border-radius: 6px; color: white; cursor: pointer; white-space: nowrap;">
            🏫 원적학급 출석부로 이동
          </button>
        </div>

        <!-- 필터 검색 바 -->
        <div class="registry-filter-card" style="background: white; padding: 18px 20px; border-radius: 10px; border: 1px solid #dee2e6; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <div style="display: flex; gap: 15px; flex-wrap: wrap; align-items: center;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-weight: bold; font-size: 13px;">조회 월:</label>
              <select id="registryMonthSelect" class="styled-select" style="padding: 6px 12px; font-size: 13px;">
                <option value="">전체 기간</option>
                ${monthOpts}
              </select>
            </div>

            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-weight: bold; font-size: 13px;">학급:</label>
              <select id="registryBanSelect" class="styled-select" style="padding: 6px 12px; font-size: 13px;">
                <option value="">전체 반</option>
                ${[1,2,3,4,5,6,7,8,9,10,11].map(b => `<option value="${b}" ${ban == b ? 'selected' : ''}>${b}반</option>`).join('')}
              </select>
            </div>

            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-weight: bold; font-size: 13px;">출력상태:</label>
              <select id="registryPrintStatusSelect" class="styled-select" style="padding: 6px 12px; font-size: 13px;">
                <option value="all" ${printStatus === 'all' ? 'selected' : ''}>전체</option>
                <option value="unprinted" ${printStatus === 'unprinted' ? 'selected' : ''}>미출력만</option>
                <option value="printed" ${printStatus === 'printed' ? 'selected' : ''}>출력완료만</option>
              </select>
            </div>

            <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px;">
              <input type="text" id="registryNameInput" class="styled-input" placeholder="학생 성명 검색" value="${escapeHtml(name)}" style="padding: 6px 12px; font-size: 13px;">
              <button type="button" class="btn btn-secondary" id="btnRegistrySearch" style="padding: 6px 15px; font-size: 13px;">검색</button>
            </div>
          </div>
        </div>

        <!-- 결과 테이블 -->
        <div class="table-card" style="background: white; border-radius: 10px; border: 1px solid #dee2e6; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <div style="padding: 12px 18px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; font-size: 13px; font-weight: bold; color: #495057;">
            총 <span style="color: #4A86E8;">${filtered.length}</span>건의 결석계 기록
          </div>
          <div style="overflow-x: auto;">
            <table class="styled-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: #f1f3f5; color: #495057; text-align: center;">
                  <th style="width: 40px; padding: 10px;"><input type="checkbox" id="chkSelectAllAbsence"></th>
                  <th style="width: 60px; padding: 10px;">순번</th>
                  <th style="width: 110px; padding: 10px;">학번</th>
                  <th style="width: 90px; padding: 10px;">성명</th>
                  <th style="width: 80px; padding: 10px;">구분</th>
                  <th style="width: 110px; padding: 10px;">종류</th>
                  <th style="width: 140px; padding: 10px;">기간</th>
                  <th style="padding: 10px; text-align: left;">사유</th>
                  <th style="width: 110px; padding: 10px;">출력상태</th>
                  <th style="width: 120px; padding: 10px;">작업</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length === 0 ? `
                  <tr>
                    <td colspan="10" style="padding: 40px; text-align: center; color: #868e96;">
                      접수된 결석계 기록이 없거나 검색 조건에 일치하는 항목이 없습니다.
                    </td>
                  </tr>
                ` : filtered.map((r, idx) => {
                  const printBadge = r.printedAt ?
                    `<span class="badge-print-done" style="background: #e6fcf5; color: #0ca678; border: 1px solid #20c997; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold;">🖨️ 완료 (${r.printedAt.substring(5, 10)})</span>` :
                    `<span class="badge-print-none" style="background: #fff4e6; color: #f76707; border: 1px solid #ffa94d; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold;">⏳ 미출력</span>`;

                  return `
                    <tr style="border-bottom: 1px solid #eee; text-align: center;" data-no="${escapeHtml(r.no)}">
                      <td style="padding: 10px;"><input type="checkbox" class="chk-absence-row" data-no="${escapeHtml(r.no)}"></td>
                      <td style="padding: 10px; color: #868e96;">${idx + 1}</td>
                      <td style="padding: 10px; font-weight: 500;">${r.grade}-${r.ban}-${r.num}</td>
                      <td style="padding: 10px; font-weight: bold; color: #212529;">${escapeHtml(r.name)}</td>
                      <td style="padding: 10px;"><span style="font-weight: bold;">${escapeHtml(r.cat)}</span></td>
                      <td style="padding: 10px;">${escapeHtml(r.type)}${r.subType ? ` (${escapeHtml(r.subType)})` : ''}</td>
                      <td style="padding: 10px; font-size: 12px; color: #495057;">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</td>
                      <td style="padding: 10px; text-align: left; color: #333; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.reason)}">${escapeHtml(r.reason)}</td>
                      <td style="padding: 10px;">${printBadge}</td>
                      <td style="padding: 10px;">
                        <button type="button" class="btn btn-sm btn-print-single" data-no="${escapeHtml(r.no)}" style="padding: 4px 10px; font-size: 12px; background: #4A86E8; color: white; border: none; border-radius: 4px; cursor: pointer;">
                          🖨️ 인쇄
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
