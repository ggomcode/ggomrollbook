/**
 * Google Apps Script for ggomrollbook & 결석계 인쇄 프로그램 통합 Web App
 * 
 * [설치 및 배포 안내]
 * 스프레드시트(1-Ki9X_EKw5xEq-Pc-ba-PBU6VWhvdBun-1bkUjTTH0Q)의 [확장 프로그램] > [Apps Script]에서
 * GAS/ 폴더의 파일들을 프로젝트에 추가하여 배포합니다:
 * 
 * 1. GAS/Code.gs       -> Apps Script의 'Code.gs' (출결기록 실시간 API + 결석계 라우팅 + 대장 관리)
 * 2. GAS/PDFService.gs  -> Apps Script의 'PDFService.gs' (A4 PDF 생성 및 서명 삽입)
 * 3. GAS/holiday.gs     -> Apps Script의 'holiday.gs' (휴일 데이터 관리)
 * 4. GAS/index.html     -> Apps Script의 'index.html' (학생/학부모 결석계 제출 화면)
 * 5. GAS/index2.html    -> Apps Script의 'index2.html' (교사용 결석계 대장 조회/인쇄 화면)
 * 
 * [구글 드라이브 3대 전용 폴더 자동 연동]
 * - '3학년_출결_PDF'         -> 결석계 단일 및 일괄 PDF 파일 저장
 * - '3학년_출결_학부모_서명'  -> 학부모 서명 이미지(PNG) 저장
 * - '3학년_출결_학생_서명'    -> 학생 서명 이미지(PNG) 저장
 * (위 3개 폴더를 드라이브에 만들어 두시면 스크립트가 이름으로 자동 인식하여 연결합니다!)
 * 
 * [배포 설정]
 * - [배포] > [새 배포] > 유형: [웹 앱]
 * - 다음 사용자로 실행: 나 (내 계정)
 * - 액세스 권한: 모든 사용자 (Anyone)  <-- 중요!
 * - 배포된 Web App URL을 출석부 앱의 [⚙️ GAS 설정]에 등록합니다.
 * 
 * [학생/학부모 은닉 및 교사용 보안 (방안 B)]
 * - 학생/학부모: 기본 URL로 접속하여 결석계 작성만 가능 (메뉴/조회 링크 완전 미노출)
 * - 교사용: 출석부 앱의 [📝 결석계 관리] 클릭 시 비밀 토큰(?page=search&key=teacher2026)을 통해 원클릭 접속
 * - 무단 접속 차단: ?page=search로 직접 접근해도 유효한 토큰이 없으면 학생용 작성 화면으로 자동 리다이렉트
 * - 보안 강화: 주소창 토큰 즉시 세척(history.replaceState) 및 20분 비활동 시 화면 자동 잠금(PIN 재인증)
 * 
 * [대장 인쇄 최적화 및 출석부 실시간 연동]
 * - 일괄 인쇄 안정성: 1회 최대 25건 이하 권장 가이드로 GAS 6분 타임아웃 방지
 * - 인쇄 상태 자동 추적: 대장 시트 39열(AM)에 '출력일시' 자동 기록 및 [미출력/출력완료] 필터 지원
 * - 출석부 실시간 연동: 출석부 셀에 📄 결석계 접수 배지 표시 및 우클릭 시 [📄 결석계 원본 PDF 보기] 지원
 */

const SHEET_NAME = '출결기록';

// 헤더 컬럼 정의: [고유키, 날짜, 교시, 반, 번호, 이름, 이동반교실, 출결내용, 수정일시, 서류제출]
const HEADERS = ['고유키', '날짜', '교시', '반', '번호', '이름', '이동반교실', '출결내용', '수정일시', '서류제출'];

/**
 * Web App GET 요청 핸들러 (연결 테스트용)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    message: 'ggomrollbook 출결기록 API가 정상 작동 중입니다.'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Web App POST 요청 핸들러 (출결 변경 저장)
 */
function doPost(e) {
  try {
    const lock = LockService.getScriptLock();
    // 동시 쓰기 충돌 방지를 위해 최대 10초 대기
    lock.waitLock(10000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }

    // 데이터 파싱
    let requestData;
    if (e.postData && e.postData.contents) {
      requestData = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      requestData = JSON.parse(e.parameter.data);
    } else {
      throw new Error('요청 데이터가 비어 있습니다.');
    }

    // 단일 레코드 또는 배열 레코드 처리
    const records = Array.isArray(requestData) ? requestData : (requestData.records || [requestData]);
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

    // 기존 시트의 전체 고유키 목록 조회 (A열: 고유키 = 날짜_교시_학번)
    const lastRow = sheet.getLastRow();
    const keyMap = {}; // key -> row index (1-based)
    if (lastRow > 1) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        const k = String(keys[i][0]).trim();
        if (k) keyMap[k] = i + 2; // 2행부터 시작
      }
    }

    // 행 삭제를 뒤에서부터 진행하기 위한 배열
    const rowsToDelete = [];
    const rowsToAppend = [];

    records.forEach(rec => {
      // 고유키 생성: 날짜_교시_학번 (예: 2026-09-22_2_30109)
      const key = rec.key || `${rec.date}_${rec.period}_${rec.studentId}`;
      const status = (rec.status || '').trim();
      const existingRow = keyMap[key];

      if (!status || status === '출석') {
        // '출석'(정상/빈값)으로 복귀한 경우: 기존 행이 있으면 삭제 대상에 추가
        if (existingRow) {
          rowsToDelete.push(existingRow);
          delete keyMap[key];
        }
      } else {
        // 출결 사유('병', '미', '인', '기' 등)가 있는 경우
        const rowData = [
          key,
          rec.date,
          rec.period,
          rec.ban,
          rec.num,
          rec.name,
          rec.room || '',
          status,
          nowStr,
          rec.docSubmitted ? '제출' : ''
        ];

        if (existingRow) {
          // 기존 행 덮어쓰기 (Update)
          sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([rowData]);
        } else {
          // 신규 행 추가 (Append)
          rowsToAppend.push(rowData);
          // 이후 같은 요청 내에서 중복 추가 방지
          keyMap[key] = lastRow + rowsToAppend.length;
        }
      }
    });

    // 신규 행 일괄 추가
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, HEADERS.length).setValues(rowsToAppend);
    }

    // 삭제 대상 행을 아래쪽 행부터 역순으로 삭제 (인덱스 보존)
    if (rowsToDelete.length > 0) {
      // 내림차순 정렬
      rowsToDelete.sort((a, b) => b - a);
      // 중복 제거
      const uniqueDeleteRows = [...new Set(rowsToDelete)];
      uniqueDeleteRows.forEach(r => {
        sheet.deleteRow(r);
      });
    }

    lock.releaseLock();

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: `${records.length}건 처리 완료`,
      timestamp: nowStr
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
