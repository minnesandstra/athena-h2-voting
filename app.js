(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const API_CONFIGURED = /^https:\/\/script\.google\.com\//.test(API_URL);

  const els = {
    matchTitle: document.getElementById("match-title"),
    matchMeta: document.getElementById("match-meta"),
    roundExplainer: document.getElementById("round-explainer"),
    statusPill: document.getElementById("status-pill"),
    message: document.getElementById("message"),
    form: document.getElementById("vote-form"),
    motm: document.getElementById("motm-options"),
    dotd: document.getElementById("dotd-options"),
    sexy: document.getElementById("sexy-options"),
    motmHelp: document.getElementById("motm-help"),
    dotdHelp: document.getElementById("dotd-help"),
    sexyHelp: document.getElementById("sexy-help"),
    voterCodeWrap: document.getElementById("voter-code-wrap"),
    voterCode: document.getElementById("voter-code"),
    submit: document.getElementById("submit-button"),
    success: document.getElementById("success-card"),
    successMessage: document.getElementById("success-message"),
    postForm: document.getElementById("post-form"),
    postPayload: document.getElementById("post-payload")
  };

  let state = {
    match: null,
    players: [],
    round: 1,
    nominees: { motm: [], dotd: [], sexy: [] },
    requireVoterCode: false,
    demo: !API_CONFIGURED
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

  function localVoteKey(matchId, round) {
    return `athena_h2_voted_${matchId}_round_${round}`;
  }

  function hasLocalVote(matchId, round) {
    return localStorage.getItem(localVoteKey(matchId, round)) === "1";
  }

  function markLocalVote(matchId, round) {
    localStorage.setItem(localVoteKey(matchId, round), "1");
  }

  function demoConfig() {
    const players = [
      "Adriaan Davids","Brent van den Bongaardt","Caspar de Jong","Connor Busker","Jaap van der Mark","Jasper Batstra","Jort Bakker","Minne Sandstra","Oscar NZ","Otto Drabbe","Pelle Bruinsma","Sebastian Buddle","Seger Janssen","Skip Bakker","Tom Vos","Twan van den Berg"
    ];
    return {
      ok: true,
      demo: true,
      requireVoterCode: false,
      round: 1,
      nominees: { motm: [], dotd: [], sexy: [] },
      match: {
        matchId: "2026-09-06-ushc-home",
        date: "2026-09-06",
        startTime: "10:45",
        home: "AthenA H2-O",
        away: "USHC H2-O",
        venue: "Stadion de Meer",
        status: "open",
        statusLabel: "Demo geopend"
      },
      players
    };
  }

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
      Object.entries({ ...params, callback: cb }).forEach(([k, v]) => url.searchParams.set(k, v));
      script.src = url.toString();
      script.onerror = () => cleanup(new Error("Kan de backend niet bereiken."));
      document.head.appendChild(script);
    });
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

  function renderOptions(container, name, items) {
    container.innerHTML = "";
    items.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "option";
      const id = `${name}-${index}`;
      wrapper.innerHTML = `<input type="radio" id="${id}" name="${name}" value="${escapeHtml(item)}" /><label for="${id}">${escapeHtml(item)}</label>`;
      container.appendChild(wrapper);
    });
  }

  function selected(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
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

  function currentChoices() {
    if (state.round === 2) {
      return {
        motm: state.nominees.motm,
        dotd: state.nominees.dotd,
        sexy: state.nominees.sexy
      };
    }
    return { motm: state.players, dotd: state.players, sexy: state.players };
  }

  function validateReady() {
    if (!state.match || state.match.status !== "open") return false;
    if (hasLocalVote(state.match.matchId, state.round) && !state.demo) return false;
    if (!selected("motm") || !selected("dotd") || !selected("sexy")) return false;
    if (state.requireVoterCode && !els.voterCode.value.trim()) return false;
    return true;
  }

  function updateButton() {
    els.submit.disabled = !validateReady();
  }

  function renderStatus() {
    const status = state.match.status || "scheduled";
    els.statusPill.className = `pill ${status === "open" ? "open" : status === "closed" ? "closed" : ""}`;
    els.statusPill.textContent = status === "open" ? `Ronde ${state.round} open` : (state.match.statusLabel || "Nog gesloten");
  }

  function render(data) {
    state = {
      match: data.match,
      players: Array.isArray(data.players) ? data.players : [],
      round: Number(data.round || 1),
      nominees: data.nominees || { motm: [], dotd: [], sexy: [] },
      requireVoterCode: Boolean(data.requireVoterCode),
      demo: Boolean(data.demo)
    };

    if (!state.match) return showMessage("Geen wedstrijd gevonden.");

    els.matchTitle.textContent = `${state.match.home} – ${state.match.away}`;
    const timeText = state.match.startTime && state.match.startTime !== "00:00" ? ` · ${state.match.startTime}` : " · tijd volgt";
    els.matchMeta.textContent = `${formatDate(state.match.date)}${timeText}${state.match.venue ? ` · ${state.match.venue}` : ""}`;
    els.roundExplainer.textContent = state.round === 1
      ? "Ronde 1: iedereen kiest uit alle spelers. Na 16 unieke stemmen gaan per categorie de top 3 door."
      : "Finaleronde: stem alleen op de drie genomineerden per categorie. Alleen deze ronde bepaalt de officiële uitslag.";

    els.motmHelp.textContent = state.round === 1 ? "Wie verdient een nominatie?" : "Wie wint Man of the Match?";
    els.dotdHelp.textContent = state.round === 1 ? "Wie verdient een nominatie?" : "Wie wint Dick of the Day?";
    els.sexyHelp.textContent = state.round === 1 ? "Welke speler verdient een nominatie voor Sexy Moment?" : "Welke speler wint Sexy Moment?";

    const choices = currentChoices();
    renderOptions(els.motm, "motm", choices.motm);
    renderOptions(els.dotd, "dotd", choices.dotd);
    renderOptions(els.sexy, "sexy", choices.sexy);
    renderStatus();
    els.voterCodeWrap.classList.toggle("hidden", !state.requireVoterCode);

    if (state.demo) {
      showMessage("Demo-modus: stemmen worden niet opgeslagen.");
    } else if (hasLocalVote(state.match.matchId, state.round)) {
      showSuccess(state.round === 1
        ? "Je voorronde-stem is binnen. Zodra iedereen heeft gestemd, verschijnt hier automatisch de finaleronde."
        : "Je finalestem is binnen.");
    } else if (state.match.status !== "open") {
      showMessage(state.match.status === "closed" ? "De stemming is gesloten." : "De stemming is nog niet geopend.");
    } else {
      clearMessage();
    }

    updateButton();
  }

  async function pollReceipt(submissionId) {
    for (let i = 0; i < 8; i += 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 650 : 500));
      const result = await jsonp({ action: "receipt", submissionId }, 5000);
      if (result?.found) return result;
    }
    throw new Error("Geen ontvangstbevestiging ontvangen.");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearMessage();
    if (!validateReady()) return showMessage("Kies eerst bij alle drie de categorieën een speler.");

    if (state.demo) return showSuccess("Demo-stem ontvangen.");

    const submissionId = randomId(`round${state.round}`);
    const payload = {
      submissionId,
      matchId: state.match.matchId,
      round: state.round,
      browserId: browserId(),
      voterCode: els.voterCode.value.trim().toUpperCase(),
      motm: selected("motm"),
      dotd: selected("dotd"),
      sexyPlayer: selected("sexy"),
      clientTimestamp: new Date().toISOString()
    };

    els.submit.disabled = true;
    els.submit.querySelector("span:first-child").textContent = "Versturen…";

    try {
      els.postForm.action = API_URL;
      els.postPayload.value = JSON.stringify(payload);
      els.postForm.submit();
      const receipt = await pollReceipt(submissionId);
      if (!receipt.ok) throw new Error(receipt.message || "Stem kon niet worden opgeslagen.");
      markLocalVote(state.match.matchId, state.round);
      showSuccess(receipt.message || "Je stem is opgeslagen.");
    } catch (err) {
      showMessage(err.message || "Er ging iets mis bij het versturen.");
      els.submit.querySelector("span:first-child").textContent = "Stem versturen";
      updateButton();
    }
  }

  async function init() {
    els.form.addEventListener("submit", handleSubmit);
    els.form.addEventListener("change", updateButton);
    els.form.addEventListener("input", updateButton);
    try {
      if (!API_CONFIGURED) return render(demoConfig());
      const matchId = new URLSearchParams(location.search).get("match") || "";
      const data = await jsonp({ action: "config", matchId });
      if (!data?.ok) throw new Error(data?.message || "Configuratie kon niet worden geladen.");
      render(data);
    } catch (err) {
      showMessage(`${err.message} De site schakelt over naar demo-modus.`);
      render(demoConfig());
    }
  }

  init();
})();
