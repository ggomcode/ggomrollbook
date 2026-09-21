/**
 * 포곡고 출결기록 & 결석계 초경량 단일 웹훅 API (화면 0%, 오직 백그라운드 데이터 저장만 수행)
 * 
 * [설치 방법]
 * 스프레드시트(1-Ki9X_EKw5xEq-Pc-ba-PBU6VWhvdBun-1bkUjTTH0Q)의
 * [확장 프로그램] > [Apps Script]의 Code.gs 내용을 모두 지우고 이 코드를 붙여넣은 뒤
 * [배포] > [새 배포] > [웹 앱] (액세스: 모든 사용자)으로 배포합니다.
 */

const SHEET_RECORDS = '출결기록';
const SHEET_REGISTRY = '대장';

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: '포곡고 출결 & 결석계 초경량 단일 웹훅 API 정상 가동 중',
    time: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      payload = JSON.parse(e.parameter.data);
    }

    // 1. 학생/학부모 결석계 제출 처리 (absence.html)
    if (payload.action === 'submit_absence') {
      let sheet = ss.getSheetByName(SHEET_REGISTRY);
      if (!sheet) sheet = ss.insertSheet(SHEET_REGISTRY);
      
      const newNo = sheet.getLastRow(); // 헤더 제외 순번
      const d = payload;
      
      // 서명 이미지 저장 (구글 드라이브)
      let studentSigUrl = '';
      let parentSigUrl = '';
      try {
        if (d.studentSigData) {
          const sBlob = Utilities.newBlob(Utilities.base64Decode(d.studentSigData.split(',')[1]), 'image/png', `${d.grade}${d.class}${d.number}_학생서명.png`);
          const sFolder = getTargetFolder('3학년_출결_학생_서명');
          const sFile = sFolder.createFile(sBlob);
          sFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          studentSigUrl = sFile.getUrl();
        }
        if (d.parentSigData) {
          const pBlob = Utilities.newBlob(Utilities.base64Decode(d.parentSigData.split(',')[1]), 'image/png', `${d.grade}${d.class}${d.number}_학부모서명.png`);
          const pFolder = getTargetFolder('3학년_출결_학부모_서명');
          const pFile = pFolder.createFile(pBlob);
          pFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          parentSigUrl = pFile.getUrl();
        }
      } catch(sigErr) {
        console.warn('서명 이미지 저장 경고:', sigErr.message);
      }

      sheet.appendRow([
        newNo, d.grade, d.class, d.number, d.name,
        d.cat === '결석', d.cat === '지각', d.cat === '조퇴', d.cat === '결과',
        d.type === '질병', d.type === '생리통', d.type === '출석인정', d.type === '기타',
        d.startDate, d.startPeriod, d.endDate, d.endPeriod,
        d.totalDays, d.reason, d.writeDate, d.parentName,
        '', '', '', '', '', '', '', '', '', '', '', '',
        studentSigUrl, parentSigUrl, '', Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss'), d.subType, ''
      ]);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 인쇄 상태 갱신 처리 (mark_printed)
    if (payload.action === 'mark_printed') {
      const sheet = ss.getSheetByName(SHEET_REGISTRY);
      if (sheet && Array.isArray(payload.rowNos)) {
        const data = sheet.getDataRange().getValues();
        const timeStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm');
        for (let i = 1; i < data.length; i++) {
          if (payload.rowNos.some(no => String(no) === String(data[i][0]))) {
            sheet.getRange(i + 1, 39).setValue(timeStr);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. 출석부(ggomrollbook) 실시간 출결 저장
    let sheet = ss.getSheetByName(SHEET_RECORDS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_RECORDS);
      sheet.appendRow(['고유키', '날짜', '교시', '반', '번호', '이름', '이동반교실', '출결내용', '수정일시', '서류제출']);
      sheet.setFrozenRows(1);
    }

    const records = Array.isArray(payload) ? payload : (payload.records || [payload]);
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const lastRow = sheet.getLastRow();
    const keyMap = {};
    if (lastRow > 1) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        const k = String(keys[i][0]).trim();
        if (k) keyMap[k] = i + 2;
      }
    }

    const rowsToDelete = [];
    records.forEach(rec => {
      const key = rec.key || `${rec.date}_${rec.period}_${rec.studentId}`;
      const status = (rec.status || '').trim();
      const isDelete = (rec.action === 'delete' || !status || status === '출석');
      const docSub = rec.docSubmitted ? '제출' : '';

      if (keyMap[key]) {
        if (isDelete) {
          rowsToDelete.push(keyMap[key]);
        } else {
          sheet.getRange(keyMap[key], 8).setValue(status);
          sheet.getRange(keyMap[key], 9).setValue(nowStr);
          sheet.getRange(keyMap[key], 10).setValue(docSub);
        }
      } else if (!isDelete) {
        sheet.appendRow([key, rec.date, rec.period, rec.ban, rec.num, rec.name, rec.room || '', status, nowStr, docSub]);
      }
    });

    // Delete rows in descending order to prevent index shifts
    if (rowsToDelete.length > 0) {
      const sortedRows = Array.from(new Set(rowsToDelete)).sort((a, b) => b - a);
      sortedRows.forEach(rowIdx => {
        try {
          sheet.deleteRow(rowIdx);
        } catch(delErr) {
          // Fallback to clearing contents if deleteRow fails
          sheet.getRange(rowIdx, 1, 1, 10).clearContent();
        }
      });
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getTargetFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}
