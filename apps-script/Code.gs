const APP = {
  TEAM_NAME: 'AthenA H2-O',
  SEASON: '2026-2027',
  VOTERS_PER_ROUND: 16,
  REQUIRE_VOTER_CODE: false,
  AUTO_OPEN_MINUTES_AFTER_START: 90,
  AUTO_CLOSE_HOURS_AFTER_START: 30,
  SHEETS: {
    MATCHES: 'Matches',
    PLAYERS: 'Players',
    ROUND1: 'Round1Votes',
    NOMINATIONS: 'Nominations',
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

    if (action === 'config') payload = getPublicConfig_(p.matchId || '');
    else if (action === 'receipt') payload = getReceipt_(p.submissionId || '');
    else if (action === 'results') payload = getPublicResults_(p.matchId || '');
    else payload = { ok: false, message: 'Onbekende actie.' };

    return jsonp_(payload, p.callback);
  } catch (err) {
    return jsonp_({ ok: false, message: errorMessage_(err) }, e && e.parameter && e.parameter.callback);
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
    if (getReceipt_(submissionId).found) return text_('duplicate receipt');

    const message = validateAndStoreVote_(vote);
    saveReceipt_(submissionId, true, message);
    return text_('ok');
  } catch (err) {
    if (submissionId) saveReceipt_(submissionId, false, errorMessage_(err));
    return text_('error');
  } finally {
    lock.releaseLock();
  }
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Koppel dit script aan de Google Spreadsheet via Extensies > Apps Script.');

  const definitions = [
    [APP.SHEETS.MATCHES, ['match_id','date','start_time','home','away','venue','status','open_at','close_at']],
    [APP.SHEETS.PLAYERS, ['player_name','active']],
    [APP.SHEETS.ROUND1, ['timestamp','submission_id','match_id','browser_id','motm','dotd','sexy_player','client_timestamp','round','note']],
    [APP.SHEETS.NOMINATIONS, ['match_id','category','nominee_1','nominee_2','nominee_3','generated_at','source_votes']],
    [APP.SHEETS.VOTES, ['timestamp','submission_id','match_id','browser_id','voter_code','motm','dotd','sexy_player','client_timestamp']],
    [APP.SHEETS.RESULTS, ['match_id','updated_at','total_votes','motm_winner','motm_votes','dotd_winner','dotd_votes','sexy_winner','sexy_votes']],
    [APP.SHEETS.RECEIPTS, ['submission_id','timestamp','ok','message']],
    [APP.SHEETS.CODES, ['match_id','voter_code','round','used_at']]
  ];

  definitions.forEach(([name, headers]) => ensureSheet_(ss, name, headers));
  seedMatches_();
  seedPlayers_();
  formatWorkbook_();
  SpreadsheetApp.flush();
}

function getPublicConfig_(requestedMatchId) {
  const matches = rowsAsObjects_(APP.SHEETS.MATCHES);
  const match = pickMatch_(matches, requestedMatchId);
  if (!match) return { ok: false, message: 'Geen wedstrijd gevonden.' };

  ensureNominationsIfReady_(clean_(match.match_id, 80));

  const players = activePlayers_();
  const round = currentRound_(clean_(match.match_id, 80));
  const nominations = getNominations_(clean_(match.match_id, 80));
  const status = effectiveStatus_(match, round);

  return {
    ok: true,
    requireVoterCode: APP.REQUIRE_VOTER_CODE,
    round,
    round1Votes: round1VotesForMatch_(match.match_id).length,
    round2Votes: finalVotesForMatch_(match.match_id).length,
    votersPerRound: APP.VOTERS_PER_ROUND,
    nominees: {
      motm: nominations.motm,
      dotd: nominations.dotd,
      sexy: nominations.sexy
    },
    match: {
      matchId: clean_(match.match_id, 80),
      date: asDateString_(match.date),
      startTime: clean_(match.start_time, 8),
      home: clean_(match.home, 80),
      away: clean_(match.away, 80),
      venue: clean_(match.venue, 120),
      status: status.status,
      statusLabel: status.label
    },
    players
  };
}

function validateAndStoreVote_(vote) {
  const matchId = clean_(vote.matchId, 80);
  const browserId = clean_(vote.browserId, 120);
  const voterCode = clean_(vote.voterCode, 32).toUpperCase();
  const motm = clean_(vote.motm, 80);
  const dotd = clean_(vote.dotd, 80);
  const sexy = clean_(vote.sexyPlayer, 80);
  const submissionId = clean_(vote.submissionId, 80);
  const requestedRound = Number(vote.round || 1);

  if (!matchId || !browserId || !motm || !dotd || !sexy) throw new Error('De stem is niet compleet.');

  const match = rowsAsObjects_(APP.SHEETS.MATCHES).find(r => clean_(r.match_id, 80) === matchId);
  if (!match) throw new Error('Deze wedstrijd bestaat niet.');

  ensureNominationsIfReady_(matchId);
  const round = currentRound_(matchId);
  if (requestedRound !== round) throw new Error(`Deze stemronde is gewijzigd. Vernieuw de pagina; ronde ${round} is nu actief.`);

  const status = effectiveStatus_(match, round);
  if (status.status !== 'open') throw new Error('De stemming voor deze wedstrijd is niet geopend.');

  const players = activePlayers_();
  if (![motm, dotd, sexy].every(name => players.includes(name))) throw new Error('Ongeldige spelerkeuze.');

  if (round === 1) {
    const votes = round1VotesForMatch_(matchId);
    if (votes.some(r => clean_(r.browser_id, 120) === browserId)) {
      throw new Error('Op deze browser is al gestemd in ronde 1.');
    }
    if (votes.length >= APP.VOTERS_PER_ROUND) {
      ensureNominationsIfReady_(matchId);
      throw new Error('Ronde 1 is afgerond. Vernieuw de pagina voor de finaleronde.');
    }

    if (APP.REQUIRE_VOTER_CODE) validateAndConsumeCode_(matchId, voterCode, 1);

    sheet_(APP.SHEETS.ROUND1).appendRow([
      new Date(), submissionId, matchId, browserId, motm, dotd, sexy,
      clean_(vote.clientTimestamp, 40), 1, 'voorronde'
    ]);

    ensureNominationsIfReady_(matchId);
    const count = round1VotesForMatch_(matchId).length;
    if (count >= APP.VOTERS_PER_ROUND) {
      return 'Je voorronde-stem is opgeslagen. De top 3 per categorie is bepaald; de finaleronde kan beginnen.';
    }
    return `Je voorronde-stem is opgeslagen (${count}/${APP.VOTERS_PER_ROUND}).`;
  }

  const nominations = getNominations_(matchId);
  if (!nominations.ready) throw new Error('De nominaties voor ronde 2 zijn nog niet klaar.');
  if (!nominations.motm.includes(motm)) throw new Error('Ongeldige Man of the Match-nominatie.');
  if (!nominations.dotd.includes(dotd)) throw new Error('Ongeldige Dick of the Day-nominatie.');
  if (!nominations.sexy.includes(sexy)) throw new Error('Ongeldige Sexy Moment-nominatie.');

  const finalVotes = finalVotesForMatch_(matchId);
  if (finalVotes.some(r => clean_(r.browser_id, 120) === browserId)) {
    throw new Error('Op deze browser is al gestemd in ronde 2.');
  }
  if (finalVotes.length >= APP.VOTERS_PER_ROUND) throw new Error('De finaleronde is al afgerond.');

  if (APP.REQUIRE_VOTER_CODE) validateAndConsumeCode_(matchId, voterCode, 2);

  sheet_(APP.SHEETS.VOTES).appendRow([
    new Date(), submissionId, matchId, browserId, voterCode, motm, dotd, sexy,
    clean_(vote.clientTimestamp, 40)
  ]);

  recalculateResults_(matchId);
  const count = finalVotesForMatch_(matchId).length;
  return count >= APP.VOTERS_PER_ROUND
    ? 'Je finalestem is opgeslagen. De einduitslag is compleet.'
    : `Je finalestem is opgeslagen (${count}/${APP.VOTERS_PER_ROUND}).`;
}

function currentRound_(matchId) {
  const nominations = getNominations_(matchId);
  return nominations.ready ? 2 : 1;
}

function ensureNominationsIfReady_(matchId) {
  const existing = getNominations_(matchId);
  if (existing.ready) return existing;

  const votes = round1VotesForMatch_(matchId);
  if (votes.length < APP.VOTERS_PER_ROUND) return existing;

  const players = activePlayers_();
  const motm = topThree_(votes.map(r => clean_(r.motm, 80)), players);
  const dotd = topThree_(votes.map(r => clean_(r.dotd, 80)), players);
  const sexy = topThree_(votes.map(r => clean_(r.sexy_player, 80)), players);
  const sh = sheet_(APP.SHEETS.NOMINATIONS);
  const now = new Date();

  sh.appendRow([matchId, 'motm', motm[0] || '', motm[1] || '', motm[2] || '', now, votes.length]);
  sh.appendRow([matchId, 'dotd', dotd[0] || '', dotd[1] || '', dotd[2] || '', now, votes.length]);
  sh.appendRow([matchId, 'sexy', sexy[0] || '', sexy[1] || '', sexy[2] || '', now, votes.length]);
  return getNominations_(matchId);
}

function getNominations_(matchId) {
  const rows = rowsAsObjects_(APP.SHEETS.NOMINATIONS).filter(r => clean_(r.match_id, 80) === matchId);
  const out = { motm: [], dotd: [], sexy: [], ready: false };
  rows.forEach(r => {
    const category = clean_(r.category, 20);
    if (!Object.prototype.hasOwnProperty.call(out, category)) return;
    out[category] = [r.nominee_1, r.nominee_2, r.nominee_3].map(v => clean_(v, 80)).filter(Boolean);
  });
  out.ready = out.motm.length === 3 && out.dotd.length === 3 && out.sexy.length === 3;
  return out;
}

function topThree_(values, players) {
  const order = new Map(players.map((name, index) => [name, index]));
  const counts = {};
  values.filter(Boolean).forEach(v => counts[v] = (counts[v] || 0) + 1);

  return players.slice().sort((a, b) => {
    const diff = (counts[b] || 0) - (counts[a] || 0);
    if (diff !== 0) return diff;
    return (order.get(a) || 0) - (order.get(b) || 0);
  }).slice(0, 3);
}

function round1VotesForMatch_(matchId) {
  return rowsAsObjects_(APP.SHEETS.ROUND1).filter(r => clean_(r.match_id, 80) === clean_(matchId, 80));
}

function finalVotesForMatch_(matchId) {
  return rowsAsObjects_(APP.SHEETS.VOTES).filter(r => clean_(r.match_id, 80) === clean_(matchId, 80));
}

function activePlayers_() {
  return rowsAsObjects_(APP.SHEETS.PLAYERS)
    .filter(r => truthy_(r.active) && clean_(r.player_name, 80))
    .map(r => clean_(r.player_name, 80));
}

function recalculateResults_(matchId) {
  const votes = finalVotesForMatch_(matchId);
  const motm = winner_(votes.map(r => clean_(r.motm, 80)));
  const dotd = winner_(votes.map(r => clean_(r.dotd, 80)));
  const sexy = winner_(votes.map(r => clean_(r.sexy_player, 80)));
  const sh = sheet_(APP.SHEETS.RESULTS);
  const data = sh.getDataRange().getValues();
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

  if (row === -1) sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues(values);
  else sh.getRange(row, 1, 1, 9).setValues(values);
}

function getPublicResults_(matchId) {
  const finalVotes = finalVotesForMatch_(matchId);
  if (finalVotes.length < APP.VOTERS_PER_ROUND) {
    return { ok: false, message: 'De finaleronde is nog niet compleet.' };
  }
  const result = rowsAsObjects_(APP.SHEETS.RESULTS).find(r => clean_(r.match_id, 80) === clean_(matchId, 80));
  return { ok: true, result: result || null };
}

function effectiveStatus_(match, round) {
  const manual = clean_(match.status, 20).toLowerCase();
  if (manual === 'open') {
    if (round === 2 && finalVotesForMatch_(match.match_id).length >= APP.VOTERS_PER_ROUND) return { status: 'closed', label: 'Finale afgerond' };
    return { status: 'open', label: `Ronde ${round} open` };
  }
  if (manual === 'closed') return { status: 'closed', label: 'Gesloten' };

  const openOverride = parseDateTime_(match.open_at);
  const closeOverride = parseDateTime_(match.close_at);
  const now = new Date();
  if (closeOverride && now >= closeOverride) return { status: 'closed', label: 'Gesloten' };
  if (openOverride && now >= openOverride) return { status: 'open', label: `Ronde ${round} open` };

  const date = asDateString_(match.date);
  const time = clean_(match.start_time, 8);
  if (!date || !time || time === '00:00') return { status: 'scheduled', label: 'Tijd volgt' };

  const start = new Date(`${date}T${time}:00`);
  if (isNaN(start.getTime())) return { status: 'scheduled', label: 'Nog gesloten' };
  const open = new Date(start.getTime() + APP.AUTO_OPEN_MINUTES_AFTER_START * 60000);
  const close = new Date(start.getTime() + APP.AUTO_CLOSE_HOURS_AFTER_START * 3600000);
  if (now >= close) return { status: 'closed', label: 'Gesloten' };
  if (now >= open) return { status: 'open', label: `Ronde ${round} open` };
  return { status: 'scheduled', label: 'Nog gesloten' };
}

function validateAndConsumeCode_(matchId, voterCode, round) {
  if (!voterCode) throw new Error('Stemcode ontbreekt.');
  const sh = sheet_(APP.SHEETS.CODES);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (String(data[i][0]) === matchId && String(data[i][1]).toUpperCase() === voterCode && Number(data[i][2] || round) === round) {
      if (data[i][3]) throw new Error('Deze stemcode is al gebruikt in deze ronde.');
      sh.getRange(i + 1, 4).setValue(new Date());
      return;
    }
  }
  throw new Error('Ongeldige stemcode.');
}

function generateVoterCodes(matchId, amount, round) {
  amount = Number(amount || APP.VOTERS_PER_ROUND);
  round = Number(round || 1);
  if (!matchId) throw new Error('Match ID ontbreekt.');
  const sh = sheet_(APP.SHEETS.CODES);
  const rows = [];
  const existing = new Set(rowsAsObjects_(APP.SHEETS.CODES).map(r => `${r.match_id}|${String(r.voter_code).toUpperCase()}|${r.round}`));

  while (rows.length < amount) {
    const code = randomCode_(6);
    const key = `${matchId}|${code}|${round}`;
    if (!existing.has(key)) {
      existing.add(key);
      rows.push([matchId, code, round, '']);
    }
  }

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  return rows.map(r => r[1]);
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

function winner_(values) {
  const counts = {};
  values.filter(Boolean).forEach(v => counts[v] = (counts[v] || 0) + 1);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return { label: '', count: 0 };
  const max = entries[0][1];
  return { label: entries.filter(e => e[1] === max).map(e => e[0]).join(' / '), count: max };
}

function pickMatch_(matches, requestedMatchId) {
  if (requestedMatchId) {
    const exact = matches.find(r => clean_(r.match_id, 80) === requestedMatchId);
    if (exact) return exact;
  }
  const open = matches.find(r => effectiveStatus_(r, currentRound_(r.match_id)).status === 'open');
  if (open) return open;
  const now = new Date();
  const sortable = matches.map(m => ({ m, d: matchDate_(m) })).filter(x => x.d && !isNaN(x.d.getTime())).sort((a, b) => a.d - b.d);
  return (sortable.find(x => x.d >= now) || sortable[sortable.length - 1] || {}).m || null;
}

function matchDate_(match) {
  const date = asDateString_(match.date);
  const time = clean_(match.start_time, 8);
  if (!date) return null;
  return new Date(`${date}T${time && time !== '00:00' ? time : '12:00'}:00`);
}

function rowsAsObjects_(sheetName) {
  const sh = sheet_(sheetName);
  const data = sh.getDataRange().getValues();
  if (!data.length) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error(`Tabblad ${name} ontbreekt. Run setup() eerst.`);
  return sh;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function formatWorkbook_() {
  Object.values(APP.SHEETS).forEach(name => {
    const sh = sheet_(name);
    sh.setFrozenRows(1);
    if (sh.getLastColumn()) {
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#0b1736').setFontColor('#ffffff');
    }
  });
}

function seedMatches_() {
  const sh = sheet_(APP.SHEETS.MATCHES);
  if (sh.getLastRow() > 1) return;
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
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedPlayers_() {
  const sh = sheet_(APP.SHEETS.PLAYERS);
  if (sh.getLastRow() > 1) return;
  const names = ['Adriaan Davids','Brent van den Bongaardt','Caspar de Jong','Connor Busker','Jaap van der Mark','Jasper Batstra','Jort Bakker','Minne Sandstra','Oscar NZ','Otto Drabbe','Pelle Bruinsma','Sebastian Buddle','Seger Janssen','Skip Bakker','Tom Vos','Twan van den Berg'];
  sh.getRange(2, 1, names.length, 2).setValues(names.map(name => [name, true]));
}

function asDateString_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Europe/Amsterdam', 'yyyy-MM-dd');
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
  return ['true','1','yes','ja','x'].includes(String(value == null ? '' : value).trim().toLowerCase());
}

function randomCode_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function jsonp_(payload, callback) {
  const cb = clean_(callback, 120);
  if (!/^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(cb)) return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  return ContentService.createTextOutput(`${cb}(${JSON.stringify(payload)});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function text_(value) {
  return ContentService.createTextOutput(String(value)).setMimeType(ContentService.MimeType.TEXT);
}

function errorMessage_(err) {
  return String(err && err.message ? err.message : err);
}
