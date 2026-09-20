/**
 * Google Sheets API & CSV Loader Service for ggomrollbook
 * Supports live Google Sheets fetch via gviz/tq (JSONP / CSV) with offline fallback.
 */

const SHEET_ID = '1-Ki9X_EKw5xEq-Pc-ba-PBU6VWhvdBun-1bkUjTTH0Q';
const GID_ATTENDANCE = '923106420'; // 출결사항 (구 취합)
const GID_HOLIDAYS = '969683114';   // 행사및휴일

export const SheetAPI = {
  sheetId: SHEET_ID,
  gidAttendance: GID_ATTENDANCE,
  gidHolidays: GID_HOLIDAYS,

  /**
   * Fetch sheet data via gviz JSONP or CSV
   */
  async loadAllData() {
    let attendanceCsv = '';
    let holidaysCsv = '';
    let isLive = false;

    try {
      // Attempt live fetch
      const [attData, holData] = await Promise.all([
        this.fetchSheetCsv(this.gidAttendance),
        this.fetchSheetCsv(this.gidHolidays)
      ]);
      attendanceCsv = attData;
      holidaysCsv = holData;
      isLive = true;
    } catch (err) {
      console.warn('Live Google Sheets fetch failed, falling back to local cached data:', err);
      // Fallback to embedded default data
      attendanceCsv = window.DEFAULT_ATTENDANCE_CSV || '';
      holidaysCsv = window.DEFAULT_HOLIDAYS_CSV || '';
      isLive = false;
    }

    return {
      attendanceCsv,
      holidaysCsv,
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
