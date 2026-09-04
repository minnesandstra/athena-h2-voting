(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const API_CONFIGURED = /^https:\/\/script\.google\.com\//.test(API_URL);
  const ACTIVE_POLL_MS = 6000;
  const WAITING_POLL_MS = 3000;

  const els = {
    matchTitle: document.getElementById("match-title"),
    matchMeta: document.getElementById("match-meta"),
    phaseExplainer: document.getElementById("phase-explainer"),
    statusPill: document.getElementById("status-pill"),
    message: document.getElementById("message"),
    form: document.getElementById("vote-form"),
    awardEmoji: document.getElementById("award-emoji"),
    phaseStep: document.getElementById("phase-step"),
    awardTitle: document.getElementById("award-title"),
    awardHelp: document.getElementById("award-help"),
    awardOptions: document.getElementById("award-options"),
    voterCodeWrap: document.getElementById("voter-code-wrap"),
    voterCode: document.getElementById("voter-code"),
    submit: document.getElementById("submit-button"),
    success: document.getElementById("success-card"),
    successMessage: document.getElementById("success-message"),
    postForm: document.getElementById("post-form"),
    postPayload: document.getElementById("post-payload"),
    finalCeremonies: document.getElementById("final-ceremonies"),
    dotdWinnerName: document.getElementById("dotd-winner-name"),
    dotdWinnerVotes: document.getElementById("dotd-winner-votes"),
    dotdVisual: document.getElementById("dotd-visual"),
    sexyWinnerName: document.getElementById("sexy-winner-name"),
    sexyWinnerVotes: document.getElementById("sexy-winner-votes"),
    sexyVisual: document.getElementById("sexy-visual"),
    motmPosterArt: document.getElementById("motm-poster-art"),
    motmWinnerName: document.getElementById("motm-winner-name"),
    motmWinnerVotes: document.getElementById("motm-winner-votes")
  };

  let state = {
    match: null,
    phase: 1,
    category: "dotd",
    round: 1,
    choices: [],
    choiceStats: [],
    voteCount: 0,
    ready: true,
    readyMessage: "",
    requireVoterCode: false,
    submitting: false,
    waiting: false
  };
  let pollTimer = null;
  let pollBusy = false;
  const loadedScripts = new Map();

  const CATEGORY_META = {
    dotd: { title: "Dick of the Day", emoji: "💩" },
    sexy: { title: "Sexy Moment", emoji: "🔥" },
    motm: { title: "Man of the Match", emoji: "🏆" }
  };

  function randomId(prefix = "id") {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
  }

  function browserId() {
    const key = "athena_h2_browser_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = randomId("browser");
      localStorage.setItem(key, id);
    }
    return id;
  }

  function localVoteKey(matchId, phase) {
    return `athena_h2_voted_${matchId}_phase_${phase}`;
  }
  function hasLocalVote(matchId, phase) { return localStorage.getItem(localVoteKey(matchId, phase)) === "1"; }
  function markLocalVote(matchId, phase) { localStorage.setItem(localVoteKey(matchId, phase), "1"); }

  function jsonp(params, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cb = `__athena_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const timeout = setTimeout(() => cleanup(new Error("De backend reageert niet.")), timeoutMs);
      function cleanup(error, data) {
        clearTimeout(timeout);
        delete window[cb];
        script.remove();
        error ? reject(error) : resolve(data);
      }
      window[cb] = data => cleanup(null, data);
      const url = new URL(API_URL);
      Object.entries({ ...params, callback: cb, _ts: Date.now() }).forEach(([k, v]) => url.searchParams.set(k, v));
      script.src = url.toString();
      script.onerror = () => cleanup(new Error("Kan de backend niet bereiken."));
      document.head.appendChild(script);
    });
  }

  function loadScriptOnce(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Kon ${src} niet laden.`));
      document.head.appendChild(script);
    });
    loadedScripts.set(src, promise);
    return promise;
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const d = new Date(`${dateString}T12:00:00`);
    return new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(d);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statMap(stats) { return new Map((stats || []).map(item => [String(item.player), Number(item.votes || 0)])); }
  function selected() { return document.querySelector('input[name="award"]:checked')?.value || ""; }

  function renderOptions(items, stats, { disabled = false, showCounts = false, liveRanking = false } = {}) {
    const previous = selected();
    const counts = statMap(stats);
    const choices = Array.isArray(items) ? items.slice() : [];
    if (liveRanking) {
      const original = new Map(choices.map((name, i) => [name, i]));
      choices.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || original.get(a) - original.get(b));
    }
    els.awardOptions.innerHTML = "";
    choices.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "option";
      const id = `award-${index}`;
      const count = counts.get(item) || 0;
      const suffix = showCounts ? ` <strong>· ${count} stem${count === 1 ? "" : "men"}</strong>` : "";
      wrapper.innerHTML = `<input type="radio" id="${id}" name="award" value="${escapeHtml(item)}" ${disabled ? "disabled" : ""} ${previous === item && !disabled ? "checked" : ""} /><label for="${id}">${escapeHtml(item)}${suffix}</label>`;
      els.awardOptions.appendChild(wrapper);
    });
  }

  function showMessage(text) {
    els.message.textContent = text;
    els.message.classList.remove("hidden");
  }
  function clearMessage() {
    els.message.textContent = "";
    els.message.classList.add("hidden");
  }
  function showSuccess(message) {
    els.form.classList.add("hidden");
    els.success.classList.remove("hidden");
    els.successMessage.textContent = message;
    clearMessage();
  }
  function showForm() {
    els.form.classList.remove("hidden");
    els.success.classList.add("hidden");
  }
  function setSubmitText(text) {
    const span = els.submit.querySelector("span:first-child");
    if (span) span.textContent = text;
  }
  function setFormDisabled(disabled) {
    Array.from(els.form.elements).forEach(el => { if (el !== els.submit) el.disabled = disabled; });
    if (disabled) els.submit.disabled = true;
  }

  function validateReady() {
    if (state.submitting || state.waiting || !state.ready) return false;
    if (!state.match || state.match.status !== "open") return false;
    if (hasLocalVote(state.match.matchId, state.phase)) return false;
    if (!selected()) return false;
    if (state.requireVoterCode && !els.voterCode.value.trim()) return false;
    return true;
  }
  function updateButton() { els.submit.disabled = !validateReady(); }

  function renderMatch(match) {
    els.matchTitle.textContent = `${match.home} – ${match.away}`;
    const timeText = match.startTime && match.startTime !== "00:00" ? ` · ${match.startTime}` : " · tijd volgt";
    els.matchMeta.textContent = `${formatDate(match.date)}${timeText}${match.venue ? ` · ${match.venue}` : ""}`;
  }

  function renderHeader(view, waiting) {
    const meta = CATEGORY_META[view.category] || CATEGORY_META.dotd;
    els.awardEmoji.textContent = meta.emoji;
    els.awardTitle.textContent = meta.title;
    els.phaseStep.textContent = `FASE ${view.phase} VAN 6`;
    els.awardHelp.textContent = waiting
      ? "Je vorige stem is binnen. De volgende fase wordt automatisch actief zodra de admin hem opent."
      : view.round === 1
        ? "Kies één speler. Na je stem ga je automatisch naar de wachtruimte voor de volgende fase."
        : "Kies de winnaar uit de drie finalisten. De live stand ververst automatisch.";
  }

  function hideCeremonies() {
    els.finalCeremonies.classList.add("hidden");
  }

  async function renderFinalCeremonies(data) {
    const dotd = data?.awards?.dotd || {};
    const sexy = data?.awards?.sexy || {};
    const motm = data?.awards?.motm || {};
    if (data?.match?.status !== "closed") return false;

    els.form.classList.add("hidden");
    els.success.classList.add("hidden");
    clearMessage();

    els.dotdWinnerName.textContent = dotd.winner || "Nog geen winnaar";
    els.dotdWinnerVotes.textContent = `${Number(dotd.votes || 0)} finalestem${Number(dotd.votes || 0) === 1 ? "" : "men"}`;
    els.sexyWinnerName.textContent = sexy.winner || "Nog geen winnaar";
    els.sexyWinnerVotes.textContent = `${Number(sexy.votes || 0)} finalestem${Number(sexy.votes || 0) === 1 ? "" : "men"}`;
    els.motmWinnerName.textContent = motm.winner || "Nog geen winnaar";
    els.motmWinnerVotes.textContent = `met ${Number(motm.votes || 0)} stem${Number(motm.votes || 0) === 1 ? "" : "men"}`;
    els.motmPosterArt.setAttribute("aria-label", `Man of the Match: ${motm.winner || "onbekend"}`);

    els.finalCeremonies.classList.remove("hidden");
    els.phaseExplainer.textContent = "Fase 7 · stemming gesloten · uitreiking";
    els.statusPill.className = "pill closed";
    els.statusPill.textContent = "Uitreiking";

    Promise.allSettled([
      loadScriptOnce("dotd-image-data.js"),
      loadScriptOnce("sexy-moment-data.js"),
      loadScriptOnce("motm-poster-data.js")
    ]).then(() => {
      if (window.DOTD_IMAGE_DATA) els.dotdVisual.src = window.DOTD_IMAGE_DATA;
      if (window.SEXY_MOMENT_DATA) els.sexyVisual.src = window.SEXY_MOMENT_DATA;
      if (window.MOTM_POSTER_DATA) els.motmPosterArt.style.backgroundImage = `url("${window.MOTM_POSTER_DATA}")`;
    });
    return true;
  }

  function renderActive(data) {
    state = {
      match: data.match,
      phase: Number(data.phase || 1),
      category: data.category || "dotd",
      round: Number(data.round || 1),
      choices: Array.isArray(data.choices) ? data.choices : [],
      choiceStats: Array.isArray(data.choiceStats) ? data.choiceStats : [],
      voteCount: Number(data.voteCount || 0),
      ready: data.ready !== false,
      readyMessage: String(data.readyMessage || ""),
      requireVoterCode: Boolean(data.requireVoterCode),
      submitting: false,
      waiting: false
    };

    hideCeremonies();
    showForm();
    setFormDisabled(false);
    setSubmitText("Stem versturen");
    renderHeader(state, false);

    const meta = CATEGORY_META[state.category] || CATEGORY_META.dotd;
    const finalLive = state.round === 2;
    els.phaseExplainer.textContent = finalLive
      ? `${meta.title} · finale · ${state.voteCount} stemmen · live stand`
      : `${meta.title} · nominaties · ${state.voteCount} stemmen binnen`;
    els.statusPill.className = `pill ${state.match.status === "open" ? "open" : ""}`;
    els.statusPill.textContent = state.match.status === "open" ? `Fase ${state.phase} open` : (state.match.statusLabel || "Gesloten");
    renderOptions(state.choices, state.choiceStats, { showCounts: finalLive, liveRanking: finalLive });
    els.voterCodeWrap.classList.toggle("hidden", !state.requireVoterCode);

    if (!state.ready) showMessage(state.readyMessage || "Deze fase kan nog niet starten.");
    else if (state.match.status !== "open") showMessage("De stemming is nog niet geopend.");
    else clearMessage();
    updateButton();
    schedulePoll(ACTIVE_POLL_MS);
  }

  function renderWaiting(data) {
    const preview = data.nextPhasePreview;
    if (!preview) {
      hideCeremonies();
      showSuccess("Je stem in fase 6 is opgeslagen. Wacht tot de admin de stemming afsluit en de uitreiking start.");
      schedulePoll(WAITING_POLL_MS);
      return;
    }

    state = {
      match: data.match,
      phase: Number(preview.phase),
      category: preview.category || "dotd",
      round: Number(preview.round || 1),
      choices: Array.isArray(preview.choices) ? preview.choices : [],
      choiceStats: Array.isArray(preview.choiceStats) ? preview.choiceStats : [],
      voteCount: Number(preview.voteCount || 0),
      ready: false,
      readyMessage: String(preview.readyMessage || ""),
      requireVoterCode: Boolean(data.requireVoterCode),
      submitting: false,
      waiting: true
    };

    hideCeremonies();
    showForm();
    renderHeader(state, true);
    setSubmitText(`Wachten op fase ${state.phase}`);
    const meta = CATEGORY_META[state.category] || CATEGORY_META.dotd;
    const finalPreview = state.round === 2;
    els.phaseExplainer.textContent = finalPreview
      ? `${meta.title} · voorlopige top 3 · ${state.voteCount} nominatiestemmen · live`
      : `${meta.title} · fase ${state.phase} staat klaar`;
    els.statusPill.className = "pill";
    els.statusPill.textContent = `Wachten op fase ${state.phase}`;
    renderOptions(state.choices, state.choiceStats, { disabled: true, showCounts: finalPreview, liveRanking: finalPreview });
    els.voterCodeWrap.classList.toggle("hidden", !state.requireVoterCode);
    setFormDisabled(true);
    showMessage(`Je vorige stem is opgeslagen. Fase ${state.phase} wordt automatisch actief zodra de admin hem opent.`);
    schedulePoll(WAITING_POLL_MS);
  }

  async function render(data) {
    const valid = data?.ok && data.match && Object.prototype.hasOwnProperty.call(data, "phase") && Array.isArray(data.choices);
    if (!valid) {
      els.submit.disabled = true;
      showMessage("De website en Apps Script gebruiken niet dezelfde versie. Deploy de nieuwste Code.gs opnieuw als 'Nieuwe versie'.");
      return;
    }

    renderMatch(data.match);
    if (await renderFinalCeremonies(data)) {
      schedulePoll(15000);
      return;
    }

    const matchId = data.match.matchId;
    const serverPhase = Number(data.phase || 1);
    const alreadyVoted = hasLocalVote(matchId, serverPhase);
    if (alreadyVoted) renderWaiting(data);
    else renderActive(data);
  }

  async function pollReceipt(submissionId) {
    for (let i = 0; i < 12; i += 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 650 : 600));
      try {
        const result = await jsonp({ action: "receipt", submissionId }, 5000);
        if (result?.found) return result;
      } catch (_) {}
    }
    throw new Error("Geen ontvangstbevestiging ontvangen.");
  }

  async function loadConfig() {
    if (!API_CONFIGURED) throw new Error("Apps Script is niet geconfigureerd.");
    const matchId = new URLSearchParams(location.search).get("match") || state.match?.matchId || "";
    const data = await jsonp({ action: "config", matchId });
    if (!data?.ok) throw new Error(data?.message || "Configuratie kon niet worden geladen.");
    await render(data);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearMessage();
    if (!validateReady()) return;

    const chosenPlayer = selected();
    const submittedPhase = state.phase;
    const matchId = state.match.matchId;
    state.submitting = true;
    els.submit.disabled = true;
    setSubmitText("Versturen…");
    setFormDisabled(true);

    const submissionId = randomId(`phase${submittedPhase}`);
    const payload = {
      submissionId,
      matchId,
      phase: submittedPhase,
      browserId: browserId(),
      voterCode: els.voterCode.value.trim().toUpperCase(),
      player: chosenPlayer,
      clientTimestamp: new Date().toISOString()
    };

    try {
      els.postForm.action = API_URL;
      els.postPayload.value = JSON.stringify(payload);
      els.postForm.submit();
      const receipt = await pollReceipt(submissionId);
      if (!receipt.ok) throw new Error(receipt.message || "Stem kon niet worden opgeslagen.");
      markLocalVote(matchId, submittedPhase);
      state.submitting = false;
      await loadConfig();
    } catch (err) {
      state.submitting = false;
      setFormDisabled(false);
      setSubmitText("Stem versturen");
      showMessage(err.message || "Er ging iets mis bij het versturen.");
      updateButton();
    }
  }

  function schedulePoll(ms) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  async function poll() {
    if (pollBusy || state.submitting || !API_CONFIGURED || document.hidden) {
      schedulePoll(state.waiting ? WAITING_POLL_MS : ACTIVE_POLL_MS);
      return;
    }
    pollBusy = true;
    try { await loadConfig(); } catch (_) {} finally { pollBusy = false; }
  }

  async function init() {
    els.form.addEventListener("submit", handleSubmit);
    els.form.addEventListener("change", updateButton);
    els.form.addEventListener("input", updateButton);
    try {
      await loadConfig();
    } catch (err) {
      showMessage(err.message || "De site kon de backend niet laden.");
      els.submit.disabled = true;
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }

  init();
})();
