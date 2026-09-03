const APP = {
  TEAM_NAME: 'AthenA H2-O',
  SEASON: '2026-2027',
  REQUIRE_VOTER_CODE: false,
  AUTO_OPEN_MINUTES_AFTER_START: 90,
  AUTO_CLOSE_HOURS_AFTER_START: 30,
  SHEETS: {
    MATCHES: 'Matches',
    PLAYERS: 'Players',
    MOMENTS: 'Moments',
    VOTES: 'Votes',
    RESULTS: 'Results',
    RECEIPTS: 'Receipts',
    CODES: 'VoterCodes'
  }
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'config';
    let payload;

    if (action === 'config') {
      payload = getPublicConfig_(p.matchId || '');
    } else if (action === 'receipt') {
      payload = getReceipt_(p.submissionId || '');
    } else if (action === 'results') {
      payload = getPublicResults_(p.matchId || '');
    } else {
      payload = { ok: false, message: 'Onbekende actie.' };
    }

    return jsonp_(payload, p.callback);
  } catch (err) {
    return jsonp_({ ok: false, message: String(err && err.message ? err.message : err) }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let submissionId = '';

  try {
    const raw = (e && e.parameter && e.parameter.payload) || (e && e.postData && e.postData.contents) || '{}';
    const vote = JSON.parse(raw);
    submissionId = clean_(vote.submissionId, 80);

    if (!submissionId) throw new Error('Submission ID ontbreekt.');
    if (getReceipt_(submissionId).found) {
      return text_('duplicate receipt');
    }

    validateAndStoreVote_(vote);
    saveReceipt_(submissionId, true, 'Je stem is opgeslagen.');
    return text_('ok');
  } catch (err) {
    if (submissionId) saveReceipt_(submissionId, false, String(err && err.message ? err.message : err));
    return text_('error');
  } finally {
    lock.releaseLock();
  }
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Koppel dit script aan een Google Spreadsheet via Extensies > Apps Script.');

  const definitions = [
    [APP.SHEETS.MATCHES, ['match_id','date','start_time','home','away','venue','status','open_at','close_at']],
    [APP.SHEETS.PLAYERS, ['player_name','active']],
    [APP.SHEETS.MOMENTS, ['match_id','moment_label','active']],
    [APP.SHEETS.VOTES, ['timestamp','submission_id','match_id','browser_id','voter_code','motm','dotd','sexy_moment','client_timestamp']],
    [APP.SHEETS.RESULTS, ['match_id','updated_at','total_votes','motm_winner','motm_votes','dotd_winner','dotd_votes','sexy_winner','sexy_votes']],
    [APP.SHEETS.RECEIPTS, ['submission_id','timestamp','ok','message']],
    [APP.SHEETS.CODES, ['match_id','voter_code','used_at']]
  ];

  definitions.forEach(([name, headers]) => ensureSheet_(ss, name, headers));
  seedMatches_();
  seedPlayers_();
  formatWorkbook_();

  SpreadsheetApp.flush();
  Logger.log('Setup klaar. Vul nu Players in en deploy daarna als Web App.');
}

function seedMatches_() {
  const sheet = sheet_(APP.SHEETS.MATCHES);
  if (sheet.getLastRow() > 1) return;

  const rows = [
    ['2026-09-06-ushc-home','2026-09-06','10:45','AthenA H2-O','USHC H2-O','Stadion de Meer','scheduled','',''],
    ['2026-09-13-houten-away','2026-09-13','16:15','Houten H2-O','AthenA H2-O','Veld 1 ABN-AMRO','scheduled','',''],
    ['2026-09-20-uno-home','2026-09-20','00:00','AthenA H2-O','UNO H2-O','','scheduled','',''],
    ['2026-09-27-abcoude-away','2026-09-27','13:00','Abcoude H2','AthenA H2-O','Veld 3','scheduled','',''],
    ['2026-10-04-kampong-h6-home','2026-10-04','00:00','AthenA H2-O','Kampong H6','','scheduled','',''],
    ['2026-10-11-nijkerk-away','2026-10-11','00:00','Nijkerk H1','AthenA H2-O','','scheduled','',''],
    ['2026-10-25-pinoke-h8-home','2026-10-25','00:00','AthenA H2-O','Pinoké H8','','scheduled','',''],
    ['2026-11-01-vvv-h3o-away','2026-11-01','00:00','VVV HC H3-O','AthenA H2-O','','scheduled','',''],
    ['2026-11-08-voordaan-h3-home','2026-11-08','00:00','AthenA H2-O','Voordaan H3','','scheduled','',''],
    ['2026-11-15-weesp-h2o-home','2026-11-15','00:00','AthenA H2-O','Weesp H2-O','','scheduled','',''],
    ['2026-11-22-kampong-h4-away','2026-11-22','00:00','Kampong H4','AthenA H2-O','','scheduled','',''],
    ['2027-03-07-ushc-away','2027-03-07','00:00','USHC H2-O','AthenA H2-O','','scheduled','','']
  ];

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedPlayers_() {
  const sheet = sheet_(APP.SHEETS.PLAYERS);
  if (sheet.getLastRow() > 1) return;
  const rows = [
    ['Adriaan Davids', true],
    ['Brent van den Bongaardt', true],
    ['Caspar de Jong', true],
    ['Connor Busker', true],
    ['Jaap van der Mark', true],
    ['Jasper Batstra', true],
    ['Jort Bakker', true],
    ['Minne Sandstra', true],
    ['Oscar NZ', true],
    ['Otto Drabbe', true],
    ['Pelle Bruinsma', true],
    ['Sebastian Buddle', true],
    ['Seger Janssen', true],
    ['Skip Bakker', true],
    ['Tom Vos', true],
    ['Twan van den Berg', true]
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

function getPublicConfig_(requestedMatchId) {
  const matches = rowsAsObjects_(APP.SHEETS.MATCHES);
  const match = pickMatch_(matches, requestedMatchId);
  if (!match) return { ok: false, message: 'Geen wedstrijd gevonden.' };

  const players = rowsAsObjects_(APP.SHEETS.PLAYERS)
    .filter(r => truthy_(r.active) && clean_(r.player_name, 80))
    .map(r => clean_(r.player_name, 80));

  const moments = rowsAsObjects_(APP.SHEETS.MOMENTS)
    .filter(r => clean_(r.match_id, 80) === match.match_id && truthy_(r.active))
    .map(r => clean_(r.moment_label, 160))
    .filter(Boolean);

  const status = effectiveStatus_(match);

  return {
    ok: true,
    requireVoterCode: APP.REQUIRE_VOTER_CODE,
    match: {
      matchId: match.match_id,
      date: asDateString_(match.date),
      startTime: clean_(match.start_time, 8),
      home: clean_(match.home, 80),
      away: clean_(match.away, 80),
      venue: clean_(match.venue, 120),
      status: status.status,
      statusLabel: status.label
    },
    players,
    moments
  };
}

function validateAndStoreVote_(vote) {
  const matchId = clean_(vote.matchId, 80);
  const browserId = clean_(vote.browserId, 120);
  const voterCode = clean_(vote.voterCode, 32).toUpperCase();
  const motm = clean_(vote.motm, 80);
  const dotd = clean_(vote.dotd, 80);
  const sexy = clean_(vote.sexyMoment, 160);
  const submissionId = clean_(vote.submissionId, 80);

  if (!matchId || !browserId || !motm || !dotd || !sexy) throw new Error('De stem is niet compleet.');

  const matches = rowsAsObjects_(APP.SHEETS.MATCHES);
  const match = matches.find(r => clean_(r.match_id, 80) === matchId);
  if (!match) throw new Error('Deze wedstrijd bestaat niet.');

  const status = effectiveStatus_(match);
  if (status.status !== 'open') throw new Error('De stemming voor deze wedstrijd is niet geopend.');

  const players = rowsAsObjects_(APP.SHEETS.PLAYERS)
    .filter(r => truthy_(r.active))
    .map(r => clean_(r.player_name, 80));
  if (!players.includes(motm) || !players.includes(dotd)) throw new Error('Ongeldige spelerkeuze.');

  const moments = rowsAsObjects_(APP.SHEETS.MOMENTS)
    .filter(r => clean_(r.match_id, 80) === matchId && truthy_(r.active))
    .map(r => clean_(r.moment_label, 160))
    .filter(Boolean);
  if (moments.length && !moments.includes(sexy)) throw new Error('Ongeldig Sexy Moment.');

  const votes = rowsAsObjects_(APP.SHEETS.VOTES);
  if (votes.some(r => clean_(r.match_id, 80) === matchId && clean_(r.browser_id, 120) === browserId)) {
    throw new Error('Op deze browser is al gestemd voor deze wedstrijd.');
  }

  if (APP.REQUIRE_VOTER_CODE) validateAndConsumeCode_(matchId, voterCode);

  sheet_(APP.SHEETS.VOTES).appendRow([
    new Date(), submissionId, matchId, browserId, voterCode, motm, dotd, sexy,
    clean_(vote.clientTimestamp, 40)
  ]);

  recalculateResults_(matchId);
}

function validateAndConsumeCode_(matchId, voterCode) {
  if (!voterCode) throw new Error('Stemcode ontbreekt.');
  const sheet = sheet_(APP.SHEETS.CODES);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (String(data[i][0]) === matchId && String(data[i][1]).toUpperCase() === voterCode) {
      if (data[i][2]) throw new Error('Deze stemcode is al gebruikt.');
      sheet.getRange(i + 1, 3).setValue(new Date());
      return;
    }
  }
  throw new Error('Ongeldige stemcode.');
}

function generateVoterCodes(matchId, amount) {
  amount = Number(amount || 24);
  if (!matchId) throw new Error('Gebruik bijvoorbeeld generateVoterCodes("2026-09-06-ushc-home", 24).');
  const sheet = sheet_(APP.SHEETS.CODES);
  const existing = new Set(rowsAsObjects_(APP.SHEETS.CODES).map(r => `${r.match_id}|${String(r.voter_code).toUpperCase()}`));
  const rows = [];

  while (rows.length < amount) {
    const code = randomCode_(6);
    if (!existing.has(`${matchId}|${code}`)) {
      existing.add(`${matchId}|${code}`);
      rows.push([matchId, code, '']);
    }
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  return rows.map(r => r[1]);
}

function recalculateResults_(matchId) {
  const votes = rowsAsObjects_(APP.SHEETS.VOTES).filter(r => clean_(r.match_id, 80) === matchId);
  const motm = winner_(votes.map(r => clean_(r.motm, 80)));
  const dotd = winner_(votes.map(r => clean_(r.dotd, 80)));
  const sexy = winner_(votes.map(r => clean_(r.sexy_moment, 160)));
  const sheet = sheet_(APP.SHEETS.RESULTS);
  const data = sheet.getDataRange().getValues();
  let row = -1;

  for (let i = 1; i < data.length; i += 1) {
    if (String(data[i][0]) === matchId) { row = i + 1; break; }
  }

  const values = [[
    matchId, new Date(), votes.length,
    motm.label, motm.count,
    dotd.label, dotd.count,
    sexy.label, sexy.count
  ]];

  if (row === -1) sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
  else sheet.getRange(row, 1, 1, values[0].length).setValues(values);
}

function getPublicResults_(matchId) {
  const matches = rowsAsObjects_(APP.SHEETS.MATCHES);
  const match = matches.find(r => clean_(r.match_id, 80) === matchId);
  if (!match) return { ok: false, message: 'Wedstrijd niet gevonden.' };
  if (effectiveStatus_(match).status !== 'closed') return { ok: false, message: 'Uitslag is nog niet openbaar.' };
  const result = rowsAsObjects_(APP.SHEETS.RESULTS).find(r => clean_(r.match_id, 80) === matchId);
  return { ok: true, result: result || null };
}

function effectiveStatus_(match) {
  const manual = clean_(match.status, 20).toLowerCase();
  if (manual === 'open') return { status: 'open', label: 'Stemmen open' };
  if (manual === 'closed') return { status: 'closed', label: 'Gesloten' };

  const openOverride = parseDateTime_(match.open_at);
  const closeOverride = parseDateTime_(match.close_at);
  const now = new Date();
  if (openOverride && now >= openOverride && (!closeOverride || now < closeOverride)) return { status: 'open', label: 'Stemmen open' };
  if (closeOverride && now >= closeOverride) return { status: 'closed', label: 'Gesloten' };

  const date = asDateString_(match.date);
  const time = clean_(match.start_time, 8);
  if (!date || !time || time === '00:00') return { status: 'scheduled', label: 'Tijd volgt' };

  const start = new Date(`${date}T${time}:00`);
  if (isNaN(start.getTime())) return { status: 'scheduled', label: 'Nog gesloten' };
  const open = new Date(start.getTime() + APP.AUTO_OPEN_MINUTES_AFTER_START * 60000);
  const close = new Date(start.getTime() + APP.AUTO_CLOSE_HOURS_AFTER_START * 3600000);
  if (now >= open && now < close) return { status: 'open', label: 'Stemmen open' };
  if (now >= close) return { status: 'closed', label: 'Gesloten' };
  return { status: 'scheduled', label: 'Nog gesloten' };
}

function pickMatch_(matches, requestedMatchId) {
  if (requestedMatchId) {
    const exact = matches.find(r => clean_(r.match_id, 80) === requestedMatchId);
    if (exact) return exact;
  }

  const open = matches.find(r => effectiveStatus_(r).status === 'open');
  if (open) return open;

  const now = new Date();
  const sortable = matches
    .map(m => ({ m, d: matchDate_(m) }))
    .filter(x => x.d && !isNaN(x.d.getTime()))
    .sort((a, b) => a.d - b.d);
  return (sortable.find(x => x.d >= now) || sortable[sortable.length - 1] || {}).m || null;
}

function matchDate_(match) {
  const date = asDateString_(match.date);
  const time = clean_(match.start_time, 8);
  if (!date) return null;
  return new Date(`${date}T${time && time !== '00:00' ? time : '12:00'}:00`);
}

function winner_(values) {
  const counts = {};
  values.filter(Boolean).forEach(v => counts[v] = (counts[v] || 0) + 1);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return { label: '', count: 0 };
  const max = entries[0][1];
  return { label: entries.filter(e => e[1] === max).map(e => e[0]).join(' / '), count: max };
}

function getReceipt_(submissionId) {
  if (!submissionId) return { found: false };
  const rows = rowsAsObjects_(APP.SHEETS.RECEIPTS);
  const row = rows.slice().reverse().find(r => clean_(r.submission_id, 80) === submissionId);
  if (!row) return { found: false };
  return { found: true, ok: truthy_(row.ok), message: clean_(row.message, 240) };
}

function saveReceipt_(submissionId, ok, message) {
  sheet_(APP.SHEETS.RECEIPTS).appendRow([submissionId, new Date(), Boolean(ok), clean_(message, 240)]);
}

function rowsAsObjects_(sheetName) {
  const sheet = sheet_(sheetName);
  const data = sheet.getDataRange().getValues();
  if (!data.length) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`Tabblad ${name} ontbreekt. Run setup() eerst.`);
  return sheet;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function formatWorkbook_() {
  Object.values(APP.SHEETS).forEach(name => {
    const sh = sheet_(name);
    sh.setFrozenRows(1);
    if (sh.getLastColumn()) {
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#0b1736').setFontColor('#ffffff');
      sh.autoResizeColumns(1, sh.getLastColumn());
    }
  });
}

function asDateString_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Europe/Amsterdam', 'yyyy-MM-dd');
  }
  const s = clean_(value, 20);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

function parseDateTime_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

function clean_(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen || 500);
}

function truthy_(value) {
  if (value === true || value === 1) return true;
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return ['true','1','yes','ja','x'].includes(s);
}

function randomCode_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function jsonp_(payload, callback) {
  const cb = clean_(callback, 120);
  if (!/^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(cb)) {
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(`${cb}(${JSON.stringify(payload)});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function text_(value) {
  return ContentService.createTextOutput(String(value)).setMimeType(ContentService.MimeType.TEXT);
}
