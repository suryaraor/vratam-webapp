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
    var action = e.parameter.action;
    // Token-authenticated (per-member link) actions bypass the admin PIN.
    if (action === 'myRecord') return jsonOut(getMyRecord(e.parameter.id, e.parameter.token));

    checkPin(e.parameter.pin);
    if (action === 'pending') return jsonOut(getPending(e.parameter.month));
    if (action === 'members') return jsonOut(getAllMembers());
    if (action === 'completions') return jsonOut(getMemberCompletions(e.parameter.id));
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    // Token-authenticated (per-member link) actions bypass the admin PIN.
    if (body.action === 'updateMyRecord') return jsonOut(updateMyRecord(body));

    checkPin(body.pin);
    if (body.action === 'addMember') return jsonOut(addMember(body));
    if (body.action === 'complete') return jsonOut(markComplete(body.id, body.month));
    if (body.action === 'updateMember') return jsonOut(updateMember(body));
    if (body.action === 'deleteMember') return jsonOut(deleteMember(body.id));
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
      status: m.Status,
      token: m.Token
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
      case 'Token': return Utilities.getUuid();
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

function getMemberCompletions(id) {
  var rows = getCompletionsSheet().getDataRange().getValues();
  var months = [];
  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(id)) {
      months.push(monthKey(rows[i][1]));
    }
  }
  months.sort();
  return months;
}

function getMyRecord(id, token) {
  var m = readMembersRaw().filter(function (r) { return Number(r.ID) === Number(id); })[0];
  if (!m) throw new Error('Not found');
  if (!m.Token || String(m.Token) !== String(token)) throw new Error('Invalid link');

  var profile = {
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
  return { profile: profile, history: getMemberCompletions(id) };
}

function updateMyRecord(body) {
  var sh = getMembersSheet();
  var row = findMemberRow(body.id);
  if (row === -1) throw new Error('Not found');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  var currentObj = {};
  headers.forEach(function (h, idx) { currentObj[h] = current[idx]; });

  if (!currentObj.Token || String(currentObj.Token) !== String(body.token)) throw new Error('Invalid link');

  // Self-service members may only edit their own contact info and sankalpa text —
  // membership type, dates, payment, and status stay admin-controlled.
  var newRow = headers.map(function (h) {
    switch (h) {
      case 'Head Name': return body.headName !== undefined ? body.headName : currentObj['Head Name'];
      case 'Full Text': return body.fullText !== undefined ? body.fullText : currentObj['Full Text'];
      case 'Phone': return body.phone !== undefined ? body.phone : currentObj.Phone;
      default: return currentObj[h];
    }
  });
  sh.getRange(row, 1, 1, headers.length).setValues([newRow]);
  return { success: true };
}

// One-off: run manually from the Apps Script editor (Run button, select this
// function) after adding the Token column, to backfill tokens for existing rows.
function backfillTokens() {
  var sh = getMembersSheet();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var tokenCol = headers.indexOf('Token') + 1;
  if (tokenCol === 0) throw new Error('Add a "Token" column to the Members sheet first');

  var lastRow = sh.getLastRow();
  var tokens = sh.getRange(2, tokenCol, lastRow - 1, 1).getValues();
  var filled = 0;
  for (var i = 0; i < tokens.length; i++) {
    if (!tokens[i][0]) {
      sh.getRange(i + 2, tokenCol).setValue(Utilities.getUuid());
      filled++;
    }
  }
  Logger.log('Backfilled ' + filled + ' tokens');
  return filled;
}

function findMemberRow(id) {
  var sh = getMembersSheet();
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) return i + 2; // 1-indexed sheet row
  }
  return -1;
}

function updateMember(body) {
  var sh = getMembersSheet();
  var row = findMemberRow(body.id);
  if (row === -1) throw new Error('Member not found');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  var currentObj = {};
  headers.forEach(function (h, idx) { currentObj[h] = current[idx]; });

  var membershipType = body.membershipType !== undefined ? body.membershipType : currentObj['Membership Type'];
  var startStr = body.startMonth || monthKey(currentObj['Start Month']);
  var startDate = parseLocalDate(startStr);
  var endDate = membershipType === 'Annual'
    ? new Date(startDate.getFullYear(), startDate.getMonth() + 11, 1)
    : startDate;

  var newRow = headers.map(function (h) {
    switch (h) {
      case 'ID': return currentObj.ID;
      case 'Head Name': return body.headName !== undefined ? body.headName : currentObj['Head Name'];
      case 'Gotram': return body.gotram !== undefined ? body.gotram : currentObj.Gotram;
      case 'Full Text': return body.fullText !== undefined ? body.fullText : currentObj['Full Text'];
      case 'Phone': return body.phone !== undefined ? body.phone : currentObj.Phone;
      case 'Membership Type': return membershipType;
      case 'Start Month': return startDate;
      case 'End Month': return endDate;
      case 'Amount Paid': return body.amountPaid !== undefined ? body.amountPaid : currentObj['Amount Paid'];
      case 'Puja Type': return body.pujaType !== undefined ? body.pujaType : currentObj['Puja Type'];
      case 'Status': return body.status !== undefined ? body.status : currentObj.Status;
      default: return currentObj[h];
    }
  });
  sh.getRange(row, 1, 1, headers.length).setValues([newRow]);
  return { success: true, id: currentObj.ID };
}

function deleteMember(id) {
  var sh = getMembersSheet();
  var row = findMemberRow(id);
  if (row === -1) throw new Error('Member not found');
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var statusCol = headers.indexOf('Status') + 1;
  sh.getRange(row, statusCol).setValue('Cancelled');
  return { success: true };
}
