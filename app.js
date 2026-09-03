(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const API_CONFIGURED = /^https:\/\/script\.google\.com\//.test(API_URL);

  const els = {
    matchTitle: document.getElementById("match-title"),
    matchMeta: document.getElementById("match-meta"),
    statusPill: document.getElementById("status-pill"),
    message: document.getElementById("message"),
    form: document.getElementById("vote-form"),
    motm: document.getElementById("motm-options"),
    dotd: document.getElementById("dotd-options"),
    sexy: document.getElementById("sexy-options"),
    sexyTextWrap: document.getElementById("sexy-free-text-wrap"),
    sexyText: document.getElementById("sexy-free-text"),
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
    moments: [],
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

  function hasLocalVote(matchId) {
    return localStorage.getItem(`athena_h2_voted_${matchId}`) === "1";
  }

  function markLocalVote(matchId) {
    localStorage.setItem(`athena_h2_voted_${matchId}`, "1");
  }

  function demoConfig() {
    return {
      ok: true,
      demo: true,
      requireVoterCode: false,
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
      players: [
        "Adriaan Davids",
        "Brent van den Bongaardt",
        "Caspar de Jong",
        "Connor Busker",
        "Jaap van der Mark",
        "Jasper Batstra",
        "Jort Bakker",
        "Minne Sandstra",
        "Oscar NZ",
        "Otto Drabbe",
        "Pelle Bruinsma",
        "Sebastian Buddle",
        "Seger Janssen",
        "Skip Bakker",
        "Tom Vos",
        "Twan van den Berg"
      ],
      moments: []
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

  function matchLabel(match) {
    return `${match.home} – ${match.away}`;
  }

  function renderStatus(match) {
    const status = match.status || "scheduled";
    els.statusPill.className = `pill ${status === "open" ? "open" : status === "closed" ? "closed" : ""}`;
    els.statusPill.textContent = match.statusLabel || ({ open: "Stemmen open", closed: "Gesloten", scheduled: "Nog gesloten" }[status] || status);
  }

  function renderOptions(container, name, items) {
    container.innerHTML = "";
    items.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "option";
      const id = `${name}-${index}`;
      wrapper.innerHTML = `
        <input type="radio" id="${id}" name="${name}" value="${escapeHtml(item)}" />
        <label for="${id}">${escapeHtml(item)}</label>
      `;
      container.appendChild(wrapper);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showMessage(text) {
    els.message.textContent = text;
    els.message.classList.remove("hidden");
  }

  function clearMessage() {
    els.message.textContent = "";
    els.message.classList.add("hidden");
  }

  function selected(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
  }

  function getSexyValue() {
    if (state.moments.length) return selected("sexyMoment");
    return els.sexyText.value.trim();
  }

  function validateReady() {
    if (!state.match || state.match.status !== "open") return false;
    if (hasLocalVote(state.match.matchId) && !state.demo) return false;
    if (!selected("motm") || !selected("dotd") || !getSexyValue()) return false;
    if (state.requireVoterCode && !els.voterCode.value.trim()) return false;
    return true;
  }

  function updateButton() {
    els.submit.disabled = !validateReady();
  }

  function render(data) {
    state = {
      match: data.match,
      players: Array.isArray(data.players) ? data.players : [],
      moments: Array.isArray(data.moments) ? data.moments : [],
      requireVoterCode: Boolean(data.requireVoterCode),
      demo: Boolean(data.demo)
    };

    if (!state.match) {
      els.matchTitle.textContent = "Geen wedstrijd gevonden";
      els.matchMeta.textContent = "Controleer het Matches-tabblad in Google Sheets.";
      els.statusPill.textContent = "Geen wedstrijd";
      showMessage("Er is nog geen wedstrijd geconfigureerd.");
      return;
    }

    els.matchTitle.textContent = matchLabel(state.match);
    const timeText = state.match.startTime && state.match.startTime !== "00:00" ? ` · ${state.match.startTime}` : " · tijd volgt";
    els.matchMeta.textContent = `${formatDate(state.match.date)}${timeText}${state.match.venue ? ` · ${state.match.venue}` : ""}`;
    renderStatus(state.match);

    renderOptions(els.motm, "motm", state.players);
    renderOptions(els.dotd, "dotd", state.players);

    if (state.moments.length) {
      renderOptions(els.sexy, "sexyMoment", state.moments);
      els.sexyTextWrap.classList.add("hidden");
    } else {
      els.sexy.innerHTML = "";
      els.sexyTextWrap.classList.remove("hidden");
    }

    els.voterCodeWrap.classList.toggle("hidden", !state.requireVoterCode);

    if (state.demo) {
      showMessage("Demo-modus: koppel eerst je Apps Script URL in config.js. Stemmen worden nu niet opgeslagen.");
    } else if (hasLocalVote(state.match.matchId)) {
      showSuccess("Op deze browser is al gestemd voor deze wedstrijd.");
    } else if (state.match.status !== "open") {
      showMessage(state.match.status === "closed"
        ? "De stemming voor deze wedstrijd is gesloten."
        : "De stemming opent automatisch na de wedstrijd, of zodra je in Google Sheets de status op ‘open’ zet.");
    } else {
      clearMessage();
    }

    els.form.addEventListener("change", updateButton);
    els.form.addEventListener("input", updateButton);
    updateButton();
  }

  function showSuccess(message) {
    els.form.classList.add("hidden");
    els.success.classList.remove("hidden");
    els.successMessage.textContent = message;
    clearMessage();
  }

  async function pollReceipt(submissionId) {
    let lastError;
    for (let i = 0; i < 6; i += 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 650 : 500));
      try {
        const result = await jsonp({ action: "receipt", submissionId }, 5000);
        if (result?.found) return result;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
    throw new Error("Geen ontvangstbevestiging ontvangen.");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearMessage();

    if (!validateReady()) {
      showMessage("Kies eerst bij alle drie de categorieën een antwoord.");
      return;
    }

    if (state.demo) {
      showSuccess("Demo-stem ontvangen. Na het koppelen aan Google Sheets wordt deze hier automatisch opgeslagen.");
      return;
    }

    const submissionId = randomId("vote");
    const payload = {
      submissionId,
      matchId: state.match.matchId,
      browserId: browserId(),
      voterCode: els.voterCode.value.trim().toUpperCase(),
      motm: selected("motm"),
      dotd: selected("dotd"),
      sexyMoment: getSexyValue(),
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

      markLocalVote(state.match.matchId);
      showSuccess(receipt.message || "Je stem is opgeslagen in Google Sheets.");
    } catch (err) {
      showMessage(err.message || "Er ging iets mis bij het versturen.");
      els.submit.querySelector("span:first-child").textContent = "Stem versturen";
      updateButton();
    }
  }

  async function init() {
    els.form.addEventListener("submit", handleSubmit);

    try {
      if (!API_CONFIGURED) {
        render(demoConfig());
        return;
      }
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
