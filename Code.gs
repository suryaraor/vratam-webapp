// Bound to the "Sri Satyanarayana Vratam - Members" spreadsheet.
// Deploy: Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.

const SPREADSHEET_ID = '1n68FIqp6ohAgi8glr9AzdYqsLXQzWw9Fez19E_T_PI4';
const MEMBERS_SHEET = 'Members';
const COMPLETIONS_SHEET = 'Completions';
const ACCESS_PIN = 'SATYA2026'; // change this, then Deploy > Manage deployments > Edit > New version

function getSS() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function getMembersSheet() { return getSS().getSheetByName(MEMBERS_SHEET); }

function getCompletionsSheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(COMPLETIONS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(COMPLETIONS_SHEET);
    sh.appendRow(['MemberID', 'Month', 'CompletedAt']);
  }
  return sh;
}

function monthKey(dateVal) {
  var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-01');
}

// Parses "YYYY-MM" or "YYYY-MM-DD" as a LOCAL date (avoids the UTC-midnight
// shift that new Date("YYYY-MM-DD") causes when the script timezone is behind UTC).
function parseLocalDate(str) {
  var parts = str.split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

function checkPin(pin) {
  if (pin !== ACCESS_PIN) throw new Error('Invalid PIN');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    checkPin(e.parameter.pin);
    var action = e.parameter.action;
    if (action === 'pending') return jsonOut(getPending(e.parameter.month));
    if (action === 'members') return jsonOut(getAllMembers());
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    checkPin(body.pin);
    if (body.action === 'addMember') return jsonOut(addMember(body));
    if (body.action === 'complete') return jsonOut(markComplete(body.id, body.month));
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function readMembersRaw() {
  var sh = getMembersSheet();
  var values = sh.getDataRange().getValues();
  var headers = values.shift();
  return values
    .map(function (row, i) {
      var obj = {};
      headers.forEach(function (h, idx) { obj[h] = row[idx]; });
      obj._row = i + 2;
      return obj;
    })
    .filter(function (m) { return m.ID !== '' && m.ID !== null; });
}

function getAllMembers() {
  return readMembersRaw().map(function (m) {
    return {
      id: m.ID,
      headName: m['Head Name'],
      gotram: m.Gotram,
      text: m['Full Text'],
      phone: m.Phone,
      membershipType: m['Membership Type'],
      startMonth: monthKey(m['Start Month']),
      endMonth: monthKey(m['End Month']),
      amountPaid: m['Amount Paid'],
      pujaType: m['Puja Type'],
      status: m.Status
    };
  });
}

function getPending(monthStr) {
  var targetKey = monthKey(monthStr ? parseLocalDate(monthStr) : new Date());

  var members = readMembersRaw().filter(function (m) {
    if (m.Status !== 'Active') return false;
    if (!m['Start Month'] || !m['End Month']) return false;
    var start = monthKey(m['Start Month']);
    var end = monthKey(m['End Month']);
    return start <= targetKey && targetKey <= end;
  });

  var completedIds = {};
  var completedRows = getCompletionsSheet().getDataRange().getValues();
  for (var i = 1; i < completedRows.length; i++) {
    if (monthKey(completedRows[i][1]) === targetKey) {
      completedIds[completedRows[i][0]] = true;
    }
  }

  return members
    .filter(function (m) { return !completedIds[m.ID]; })
    .map(function (m) { return { id: m.ID, gotram: m.Gotram, text: m['Full Text'] }; });
}

function addMember(body) {
  var sh = getMembersSheet();
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var lastId = 0;
  for (var i = 1; i < values.length; i++) {
    var idNum = Number(values[i][0]);
    if (idNum > lastId) lastId = idNum;
  }
  var newId = lastId + 1;

  var startStr = body.startMonth || monthKey(new Date());
  var startDate = parseLocalDate(startStr);
  var endDate = body.membershipType === 'Annual'
    ? new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1)
    : startDate;

  var row = headers.map(function (h) {
    switch (h) {
      case 'ID': return newId;
      case 'Head Name': return body.headName || '';
      case 'Gotram': return body.gotram || '';
      case 'Full Text': return body.fullText || '';
      case 'Phone': return body.phone || '';
      case 'Membership Type': return body.membershipType || 'One-Time';
      case 'Start Month': return startDate;
      case 'End Month': return endDate;
      case 'Amount Paid': return body.amountPaid || '';
      case 'Puja Type': return body.pujaType || '';
      case 'Status': return 'Active';
      default: return '';
    }
  });
  sh.appendRow(row);
  return { success: true, id: newId };
}

function markComplete(id, monthStr) {
  var sh = getCompletionsSheet();
  var targetKey = monthKey(monthStr ? parseLocalDate(monthStr) : new Date());
  sh.appendRow([id, targetKey, new Date()]);
  return { success: true };
}
