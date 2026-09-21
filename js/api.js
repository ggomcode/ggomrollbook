/**
 * Google Sheets API & CSV Loader Service for ggomrollbook
 * Supports live Google Sheets fetch via gviz/tq (JSONP / CSV) with offline fallback.
 */

const SHEET_ID = '1-Ki9X_EKw5xEq-Pc-ba-PBU6VWhvdBun-1bkUjTTH0Q';
const GID_ATTENDANCE = '923106420'; // 출결사항 (구 취합)
const GID_HOLIDAYS = '969683114';   // 행사및휴일
const SHEET_NAME_RECORDS = '출결기록'; // 사용자 추가 시트

// Default or configured GAS Web App URL
let _configuredGasUrl = localStorage.getItem('ggom_gas_webapp_url') || '';

export const SheetAPI = {
  sheetId: SHEET_ID,
  gidAttendance: GID_ATTENDANCE,
  gidHolidays: GID_HOLIDAYS,
  sheetNameRecords: SHEET_NAME_RECORDS,

  getGasUrl() {
    return _configuredGasUrl || localStorage.getItem('ggom_gas_webapp_url') || '';
  },

  setGasUrl(url) {
    _configuredGasUrl = (url || '').trim();
    if (_configuredGasUrl) {
      localStorage.setItem('ggom_gas_webapp_url', _configuredGasUrl);
    } else {
      localStorage.removeItem('ggom_gas_webapp_url');
    }
  },

  /**
   * Fetch sheet data via gviz JSONP or CSV
   */
  async loadAllData() {
    let attendanceCsv = '';
    let holidaysCsv = '';
    let recordsCsv = '';
    let isLive = false;

    try {
      // Live fetch for attendance, holidays, and records sheet
      const [attData, holData, recData] = await Promise.all([
        this.fetchSheetCsv(this.gidAttendance),
        this.fetchSheetCsv(this.gidHolidays),
        this.fetchSheetByName(this.sheetNameRecords).catch(() => '')
      ]);
      attendanceCsv = attData;
      holidaysCsv = holData;
      recordsCsv = recData;
      isLive = true;
    } catch (err) {
      console.error('Live Google Sheets fetch failed:', err);
      throw err;
    }

    return {
      attendanceCsv,
      holidaysCsv,
      recordsCsv,
      isLive,
      timestamp: new Date()
    };
  },

  /**
   * Fetch CSV from Google Sheets with JSONP fallback
   */
  async fetchSheetCsv(gid) {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${this.sheetId}/export?format=csv&gid=${gid}`;
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (fetchErr) {
      // Try gviz JSONP approach if direct fetch is blocked by CORS
      return await this.fetchViaGvizJsonp(gid);
    }
  },

  /**
   * Fetch sheet by tab name (e.g. '출결기록')
   */
  async fetchSheetByName(sheetName) {
    const encName = encodeURIComponent(sheetName);
    const csvUrl = `https://docs.google.com/spreadsheets/d/${this.sheetId}/gviz/tq?tqx=out:csv&sheet=${encName}`;
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (err) {
      return await this.fetchViaGvizJsonpByName(sheetName);
    }
  },

  fetchViaGvizJsonpByName(sheetName) {
    return new Promise((resolve, reject) => {
      const callbackName = `gvizNameCallback_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      const script = document.createElement('script');
      const encName = encodeURIComponent(sheetName);
      script.src = `https://docs.google.com/spreadsheets/d/${this.sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&sheet=${encName}`;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout fetching sheet ${sheetName}`));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      window[callbackName] = (json) => {
        cleanup();
        try {
          const csv = this.convertGvizJsonToCsv(json);
          resolve(csv);
        } catch (e) {
          reject(e);
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error(`Script error loading sheet ${sheetName}`));
      };

      document.head.appendChild(script);
    });
  },

  /**
   * Send attendance override records to Google Apps Script Web App
   * @param {Array|Object} records [{ key, date, period, studentId, ban, num, name, room, status }]
   */
  async saveAttendanceRecords(records) {
    const url = this.getGasUrl();
    if (!url) {
      console.warn('Google Apps Script Web App URL이 설정되지 않았습니다.');
      return { status: 'no_gas_url', message: 'GAS URL 미설정' };
    }

    const payload = Array.isArray(records) ? { records } : records;

    // Use text/plain to avoid CORS preflight OPTIONS check in GAS Web App
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`GAS POST failed with HTTP ${response.status}`);
    }

    try {
      return await response.json();
    } catch (e) {
      // Sometimes GAS redirects with opaque or plain response
      return { status: 'success', raw: true };
    }
  },

  /**
   * Fetch submitted absence reports from GAS Web App
   */
  async fetchSubmittedReports() {
    const gasUrl = this.getGasUrl();
    if (!gasUrl) return [];
    const teacherKey = localStorage.getItem('teacher_auth_key') || 'teacher2026';
    const sep = gasUrl.includes('?') ? '&' : '?';
    const url = `${gasUrl}${sep}action=get_submitted_reports&key=${encodeURIComponent(teacherKey)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const json = await response.json();
      if (json && json.status === 'success' && Array.isArray(json.reports)) {
        return json.reports;
      }
      return [];
    } catch (e) {
      console.warn('Failed to fetch submitted reports from GAS:', e);
      return [];
    }
  },

  /**
   * Fetch sheet data using Google Visualization API (JSONP callback)
   */
  fetchViaGvizJsonp(gid) {
    return new Promise((resolve, reject) => {
      const callbackName = `gvizCallback_${gid}_${Date.now()}`;
      const script = document.createElement('script');
      script.src = `https://docs.google.com/spreadsheets/d/${this.sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&gid=${gid}`;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout fetching GID ${gid} via JSONP`));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      window[callbackName] = (json) => {
        cleanup();
        try {
          const csv = this.convertGvizJsonToCsv(json);
          resolve(csv);
        } catch (e) {
          reject(e);
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error(`Script load error for GID ${gid}`));
      };

      document.head.appendChild(script);
    });
  },

  /**
   * Convert gviz JSON table format to CSV string
   */
  convertGvizJsonToCsv(json) {
    if (!json || !json.table || !json.table.rows) return '';
    const rows = json.table.rows;
    const lines = [];

    rows.forEach(r => {
      const cells = r.c || [];
      const line = cells.map(cell => {
        if (!cell || cell.v === null || cell.v === undefined) return '';
        let val = String(cell.v);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',');
      lines.push(line);
    });

    return lines.join('\n');
  },

  /**
   * Standard robust CSV parser handling quoted values with commas
   */
  parseCsv(text) {
    const lines = [];
    let row = [''];
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

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

    return lines;
  }
};
