/** @OnlyCurrentDoc */
const APP = {
  TEAM_NAME: 'AthenA H2-O',
  SEASON: '2026-2027',
  REQUIRE_VOTER_CODE: false,
  AUTO_OPEN_MINUTES_AFTER_START: 90,
  AUTO_CLOSE_HOURS_AFTER_START: 30,
  PHASES: {
    1: { category: 'dotd', round: 1, title: 'Dick of the Day · nominaties' },
    2: { category: 'dotd', round: 2, title: 'Dick of the Day · finale' },
    3: { category: 'sexy', round: 1, title: 'Sexy Moment · nominaties' },
    4: { category: 'sexy', round: 2, title: 'Sexy Moment · finale' },
    5: { category: 'motm', round: 1, title: 'Man of the Match · nominaties' },
    6: { category: 'motm', round: 2, title: 'Man of the Match · finale' }
  },
  SHEETS: {
    MATCHES: 'Matches', PLAYERS: 'Players', PHASE_VOTES: 'PhaseVotes',
    NOMINATIONS: 'Nominations', VOTES: 'Votes', RESULTS: 'Results',
    RECEIPTS: 'Receipts', CODES: 'VoterCodes'
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
  const defs = [
    [APP.SHEETS.MATCHES, ['match_id','date','start_time','home','away','venue','status','open_at','close_at','phase']],
    [APP.SHEETS.PLAYERS, ['player_name','active']],
    [APP.SHEETS.PHASE_VOTES, ['timestamp','submission_id','match_id','phase','category','browser_id','player','client_timestamp','note']],
    [APP.SHEETS.NOMINATIONS, ['match_id','category','nominee_1','nominee_2','nominee_3','generated_at','source_votes']],
    [APP.SHEETS.VOTES, ['timestamp','submission_id','match_id','browser_id','voter_code','motm','dotd','sexy_player','client_timestamp']],
    [APP.SHEETS.RESULTS, ['match_id','updated_at','total_votes','motm_winner','motm_votes','dotd_winner','dotd_votes','sexy_winner','sexy_votes']],
    [APP.SHEETS.RECEIPTS, ['submission_id','timestamp','ok','message']],
    [APP.SHEETS.CODES, ['match_id','voter_code','phase','used_at']]
  ];
  defs.forEach(([name, headers]) => ensureSheet_(ss, name, headers));
  formatWorkbook_();
  SpreadsheetApp.flush();
}

function getPublicConfig_(requestedMatchId) {
  const match = pickMatch_(rowsAsObjects_(APP.SHEETS.MATCHES), requestedMatchId);
  if (!match) return { ok: false, message: 'Geen wedstrijd gevonden.' };

  const matchId = clean_(match.match_id, 80);
  const phase = phaseNumber_(match.phase);
  const phaseInfo = APP.PHASES[phase];
  const status = effectiveStatus_(match);
  const phaseState = buildPhaseState_(matchId, phase);

  return {
    ok: true,
    requireVoterCode: APP.REQUIRE_VOTER_CODE,
    phase,
    phaseTitle: phaseInfo.title,
    category: phaseInfo.category,
    round: phaseInfo.round,
    choices: phaseState.choices,
    voteCount: phaseVotes_(matchId, phase).length,
    ready: phaseState.ready,
    readyMessage: phaseState.message || '',
    winners: phaseState.winners,
    match: {
      matchId,
      date: asDateString_(match.date),
      startTime: clean_(match.start_time, 8),
      home: clean_(match.home, 80),
      away: clean_(match.away, 80),
      venue: clean_(match.venue, 120),
      status: status.status,
      statusLabel: status.label
    }
  };
}

function validateAndStoreVote_(vote) {
  const matchId = clean_(vote.matchId, 80);
  const browserId = clean_(vote.browserId, 120);
  const submissionId = clean_(vote.submissionId, 80);
  const player = clean_(vote.player, 80);
  const requestedPhase = Number(vote.phase || 0);
  const voterCode = clean_(vote.voterCode, 32).toUpperCase();
  if (!matchId || !browserId || !submissionId || !player || !requestedPhase) throw new Error('De stem is niet compleet.');

  const match = rowsAsObjects_(APP.SHEETS.MATCHES).find(r => clean_(r.match_id, 80) === matchId);
  if (!match) throw new Error('Deze wedstrijd bestaat niet.');
  const phase = phaseNumber_(match.phase);
  if (requestedPhase !== phase) throw new Error(`De eigenaar heeft de stemming inmiddels naar fase ${phase} gezet. Vernieuw de pagina.`);
  if (effectiveStatus_(match).status !== 'open') throw new Error('De stemming voor deze wedstrijd is niet geopend.');

  const phaseInfo = APP.PHASES[phase];
  const state = buildPhaseState_(matchId, phase);
  if (!state.ready) throw new Error(state.message || 'Deze fase is nog niet klaar om op te stemmen.');
  if (!state.choices.includes(player)) throw new Error('Ongeldige spelerkeuze voor deze fase.');

  const existing = phaseVotes_(matchId, phase);
  if (existing.some(r => clean_(r.browser_id, 120) === browserId)) throw new Error('Op deze browser is al gestemd in deze fase.');
  if (APP.REQUIRE_VOTER_CODE) validateAndConsumeCode_(matchId, voterCode, phase);

  sheet_(APP.SHEETS.PHASE_VOTES).appendRow([
    new Date(), submissionId, matchId, phase, phaseInfo.category, browserId, player,
    clean_(vote.clientTimestamp, 40), phaseInfo.round === 1 ? 'nominatie' : 'finale'
  ]);

  if (phaseInfo.round === 2) {
    appendOfficialFinalVote_(vote, phaseInfo.category, player);
    recalculateResults_(matchId);
  }

  const count = phaseVotes_(matchId, phase).length;
  return `Je stem is opgeslagen. Deze fase heeft nu ${count} stem${count === 1 ? '' : 'men'}. De eigenaar bepaalt wanneer de volgende fase opent.`;
}

function buildPhaseState_(matchId, phase) {
  const players = activePlayers_();
  const dotdWinner = finalWinner_(matchId, 2, players);
  const sexyWinner = finalWinner_(matchId, 4, players);
  const winners = { dotd: dotdWinner.label || '', sexy: sexyWinner.label || '', motm: finalWinner_(matchId, 6, players).label || '' };

  if (phase === 1) return { ready: true, choices: players, winners };

  if (phase === 2) {
    const votes = phaseVotes_(matchId, 1);
    if (!votes.length) return { ready: false, choices: [], winners, message: 'Er zijn nog geen Dick of the Day-nominatiestemmen. Zet de phase terug op 1 of laat eerst stemmen.' };
    return { ready: true, choices: upsertNominations_(matchId, 'dotd', votes, players), winners };
  }

  if (!dotdWinner.label) return { ready: false, choices: [], winners, message: 'Dick of the Day heeft nog geen winnaar. Zet phase op 2 en laat minstens één finalestem uitbrengen.' };
  const afterDotd = players.filter(p => p !== dotdWinner.label);
  if (phase === 3) return { ready: true, choices: afterDotd, winners };

  if (phase === 4) {
    const votes = phaseVotes_(matchId, 3);
    if (!votes.length) return { ready: false, choices: [], winners, message: 'Er zijn nog geen Sexy Moment-nominatiestemmen. Zet phase terug op 3 of laat eerst stemmen.' };
    return { ready: true, choices: upsertNominations_(matchId, 'sexy', votes, afterDotd), winners };
  }

  if (!sexyWinner.label) return { ready: false, choices: [], winners, message: 'Sexy Moment heeft nog geen winnaar. Zet phase op 4 en laat minstens één finalestem uitbrengen.' };
  const afterSexy = afterDotd.filter(p => p !== sexyWinner.label);
  if (phase === 5) return { ready: true, choices: afterSexy, winners };

  const votes = phaseVotes_(matchId, 5);
  if (!votes.length) return { ready: false, choices: [], winners, message: 'Er zijn nog geen Man of the Match-nominatiestemmen. Zet phase terug op 5 of laat eerst stemmen.' };
  return { ready: true, choices: upsertNominations_(matchId, 'motm', votes, afterSexy), winners };
}

function upsertNominations_(matchId, category, votes, eligiblePlayers) {
  const top = topThree_(votes.map(r => clean_(r.player, 80)), eligiblePlayers);
  const sh = sheet_(APP.SHEETS.NOMINATIONS);
  const data = sh.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i += 1) {
    if (String(data[i][0]) === matchId && String(data[i][1]) === category) { row = i + 1; break; }
  }
  const values = [[matchId, category, top[0] || '', top[1] || '', top[2] || '', new Date(), votes.length]];
  if (row === -1) sh.getRange(sh.getLastRow() + 1, 1, 1, 7).setValues(values);
  else sh.getRange(row, 1, 1, 7).setValues(values);
  return top;
}

function topThree_(values, players) {
  const order = new Map(players.map((name, i) => [name, i]));
  const counts = {};
  values.forEach(v => { if (v && order.has(v)) counts[v] = (counts[v] || 0) + 1; });
  return players.slice().sort((a, b) => {
    const d = (counts[b] || 0) - (counts[a] || 0);
    return d || (order.get(a) - order.get(b));
  }).slice(0, Math.min(3, players.length));
}

function finalWinner_(matchId, phase, players) {
  const vals = phaseVotes_(matchId, phase).map(r => clean_(r.player, 80));
  return winner_(vals, players);
}

function winner_(values, players) {
  const order = new Map((players || []).map((n, i) => [n, i]));
  const counts = {};
  values.filter(Boolean).forEach(v => counts[v] = (counts[v] || 0) + 1);
  let best = '', count = 0;
  Object.keys(counts).forEach(name => {
    if (counts[name] > count || (counts[name] === count && (order.get(name) ?? 9999) < (order.get(best) ?? 9999))) {
      best = name; count = counts[name];
    }
  });
  return { label: best, count };
}

function appendOfficialFinalVote_(vote, category, player) {
  const motm = category === 'motm' ? player : '';
  const dotd = category === 'dotd' ? player : '';
  const sexy = category === 'sexy' ? player : '';
  sheet_(APP.SHEETS.VOTES).appendRow([
    new Date(), clean_(vote.submissionId, 80), clean_(vote.matchId, 80), clean_(vote.browserId, 120),
    clean_(vote.voterCode, 32).toUpperCase(), motm, dotd, sexy, clean_(vote.clientTimestamp, 40)
  ]);
}

function recalculateResults_(matchId) {
  const players = activePlayers_();
  const motm = finalWinner_(matchId, 6, players);
  const dotd = finalWinner_(matchId, 2, players);
  const sexy = finalWinner_(matchId, 4, players);
  const total = phaseVotes_(matchId, 2).length + phaseVotes_(matchId, 4).length + phaseVotes_(matchId, 6).length;
  const sh = sheet_(APP.SHEETS.RESULTS);
  const data = sh.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i += 1) if (String(data[i][0]) === matchId) { row = i + 1; break; }
  const vals = [[matchId, new Date(), total, motm.label, motm.count, dotd.label, dotd.count, sexy.label, sexy.count]];
  if (row === -1) sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues(vals);
  else sh.getRange(row, 1, 1, 9).setValues(vals);
}

function getPublicResults_(matchId) {
  const match = rowsAsObjects_(APP.SHEETS.MATCHES).find(r => clean_(r.match_id, 80) === clean_(matchId, 80));
  if (!match) return { ok: false, message: 'Wedstrijd niet gevonden.' };
  if (effectiveStatus_(match).status !== 'closed') return { ok: false, message: 'De uitslag is nog niet openbaar.' };
  const result = rowsAsObjects_(APP.SHEETS.RESULTS).find(r => clean_(r.match_id, 80) === clean_(matchId, 80));
  return { ok: true, result: result || null };
}

function phaseVotes_(matchId, phase) {
  return rowsAsObjects_(APP.SHEETS.PHASE_VOTES).filter(r => clean_(r.match_id, 80) === clean_(matchId, 80) && Number(r.phase) === Number(phase));
}

function activePlayers_() {
  return rowsAsObjects_(APP.SHEETS.PLAYERS).filter(r => truthy_(r.active) && clean_(r.player_name, 80)).map(r => clean_(r.player_name, 80));
}

function phaseNumber_(value) {
  const n = Number(value || 1);
  return n >= 1 && n <= 6 ? Math.floor(n) : 1;
}

function validateAndConsumeCode_(matchId, code, phase) {
  if (!code) throw new Error('Stemcode ontbreekt.');
  const sh = sheet_(APP.SHEETS.CODES);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i += 1) {
    if (String(data[i][0]) === matchId && String(data[i][1]).toUpperCase() === code && Number(data[i][2]) === phase) {
      if (data[i][3]) throw new Error('Deze stemcode is al gebruikt.');
      sh.getRange(i + 1, 4).setValue(new Date()); return;
    }
  }
  throw new Error('Ongeldige stemcode.');
}

function getReceipt_(submissionId) {
  const id = clean_(submissionId, 80);
  if (!id) return { found: false };
  const rows = rowsAsObjects_(APP.SHEETS.RECEIPTS);
  const r = rows.find(x => clean_(x.submission_id, 80) === id);
  return r ? { found: true, ok: truthy_(r.ok), message: clean_(r.message, 240) } : { found: false };
}

function saveReceipt_(submissionId, ok, message) {
  sheet_(APP.SHEETS.RECEIPTS).appendRow([submissionId, new Date(), Boolean(ok), clean_(message, 240)]);
}

function effectiveStatus_(match) {
  const manual = clean_(match.status, 20).toLowerCase();
  if (manual === 'open') return { status: 'open', label: 'Stemmen open' };
  if (manual === 'closed') return { status: 'closed', label: 'Gesloten' };
  const openOverride = parseDateTime_(match.open_at);
  const closeOverride = parseDateTime_(match.close_at);
  const now = new Date();
  if (closeOverride && now >= closeOverride) return { status: 'closed', label: 'Gesloten' };
  if (openOverride && now >= openOverride) return { status: 'open', label: 'Stemmen open' };
  const date = asDateString_(match.date), time = clean_(match.start_time, 8);
  if (!date || !time || time === '00:00') return { status: 'scheduled', label: 'Tijd volgt' };
  const start = new Date(`${date}T${time}:00`);
  if (isNaN(start.getTime())) return { status: 'scheduled', label: 'Nog gesloten' };
  const open = new Date(start.getTime() + APP.AUTO_OPEN_MINUTES_AFTER_START * 60000);
  const close = new Date(start.getTime() + APP.AUTO_CLOSE_HOURS_AFTER_START * 3600000);
  if (now >= close) return { status: 'closed', label: 'Gesloten' };
  if (now >= open) return { status: 'open', label: 'Stemmen open' };
  return { status: 'scheduled', label: 'Nog gesloten' };
}

function pickMatch_(matches, requestedId) {
  if (requestedId) return matches.find(r => clean_(r.match_id, 80) === clean_(requestedId, 80)) || null;
  const open = matches.find(r => effectiveStatus_(r).status === 'open');
  if (open) return open;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Amsterdam', 'yyyy-MM-dd');
  return matches.filter(r => asDateString_(r.date) >= today).sort((a,b) => asDateString_(a.date).localeCompare(asDateString_(b.date)))[0] || matches[matches.length - 1] || null;
}

function rowsAsObjects_(sheetName) {
  const sh = sheet_(sheetName), data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const o = {}; headers.forEach((h, i) => { if (h) o[h] = row[i]; }); return o;
  });
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss && ss.getSheetByName(name);
  if (!sh) throw new Error(`Tabblad ${name} ontbreekt. Voer setup() uit.`);
  return sh;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

function formatWorkbook_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.values(APP.SHEETS).forEach(name => {
    const sh = ss.getSheetByName(name); if (!sh) return;
    const lastCol = Math.max(1, sh.getLastColumn());
    sh.getRange(1,1,1,lastCol).setBackground('#1e3366').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}

function clean_(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 500); }
function truthy_(value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; }
function errorMessage_(err) { return String(err && err.message ? err.message : err); }
function asDateString_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Europe/Amsterdam', 'yyyy-MM-dd');
  const s = clean_(value, 20); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : '';
}
function parseDateTime_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(String(value)); return isNaN(d.getTime()) ? null : d;
}
function text_(value) { return ContentService.createTextOutput(String(value)).setMimeType(ContentService.MimeType.TEXT); }
function jsonp_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
