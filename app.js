(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const API_CONFIGURED = /^https:\/\/script\.google\.com\//.test(API_URL);

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
    postPayload: document.getElementById("post-payload")
  };

  let state = {
    match: null,
    phase: 1,
    category: "dotd",
    round: 1,
    choices: [],
    voteCount: 0,
    ready: true,
    readyMessage: "",
    requireVoterCode: false,
    demo: !API_CONFIGURED,
    submitting: false
  };

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

  function hasLocalVote(matchId, phase) {
    return localStorage.getItem(localVoteKey(matchId, phase)) === "1";
  }

  function markLocalVote(matchId, phase) {
    localStorage.setItem(localVoteKey(matchId, phase), "1");
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

  function renderOptions(items) {
    els.awardOptions.innerHTML = "";
    items.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "option";
      const id = `award-${index}`;
      wrapper.innerHTML = `<input type="radio" id="${id}" name="award" value="${escapeHtml(item)}" /><label for="${id}">${escapeHtml(item)}</label>`;
      els.awardOptions.appendChild(wrapper);
    });
  }

  function selected() {
    return document.querySelector('input[name="award"]:checked')?.value || "";
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

  function validateReady() {
    if (state.submitting || !state.ready) return false;
    if (!state.match || state.match.status !== "open") return false;
    if (hasLocalVote(state.match.matchId, state.phase) && !state.demo) return false;
    if (!selected()) return false;
    if (state.requireVoterCode && !els.voterCode.value.trim()) return false;
    return true;
  }

  function updateButton() {
    els.submit.disabled = !validateReady();
  }

  function render(data) {
    state = {
      match: data.match,
      phase: Number(data.phase || 1),
      category: data.category || "dotd",
      round: Number(data.round || 1),
      choices: Array.isArray(data.choices) ? data.choices : [],
      voteCount: Number(data.voteCount || 0),
      ready: data.ready !== false,
      readyMessage: String(data.readyMessage || ""),
      requireVoterCode: Boolean(data.requireVoterCode),
      demo: Boolean(data.demo),
      submitting: false
    };

    if (!state.match) return showMessage("Geen wedstrijd gevonden.");

    els.matchTitle.textContent = `${state.match.home} – ${state.match.away}`;
    const timeText = state.match.startTime && state.match.startTime !== "00:00" ? ` · ${state.match.startTime}` : " · tijd volgt";
    els.matchMeta.textContent = `${formatDate(state.match.date)}${timeText}${state.match.venue ? ` · ${state.match.venue}` : ""}`;

    const meta = CATEGORY_META[state.category] || CATEGORY_META.dotd;
    els.awardEmoji.textContent = meta.emoji;
    els.awardTitle.textContent = meta.title;
    els.phaseStep.textContent = `FASE ${state.phase} VAN 6`;
    els.awardHelp.textContent = state.round === 1
      ? "Kies één speler. De eigenaar bepaalt wanneer de top 3 naar de finale gaat."
      : "Kies de winnaar uit de drie genomineerden.";
    els.phaseExplainer.textContent = `${meta.title} · ronde ${state.round} · ${state.voteCount} stem${state.voteCount === 1 ? "" : "men"} binnen`;
    els.statusPill.className = `pill ${state.match.status === "open" ? "open" : state.match.status === "closed" ? "closed" : ""}`;
    els.statusPill.textContent = state.match.status === "open" ? `Fase ${state.phase} open` : (state.match.statusLabel || "Gesloten");

    renderOptions(state.choices);
    els.voterCodeWrap.classList.toggle("hidden", !state.requireVoterCode);

    if (state.match.status !== "open") {
      showMessage(state.match.status === "closed" ? "De stemming is gesloten." : "De stemming is nog niet geopend.");
    } else if (!state.ready) {
      showMessage(state.readyMessage || "Deze fase kan nog niet starten.");
    } else if (hasLocalVote(state.match.matchId, state.phase) && !state.demo) {
      showSuccess(`Je hebt al gestemd in fase ${state.phase}. Er zijn nu ${state.voteCount} stemmen binnen. De eigenaar bepaalt wanneer fase ${Math.min(6, state.phase + 1)} opent.`);
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
    if (!validateReady()) return;

    state.submitting = true;
    els.submit.disabled = true;
    els.submit.querySelector("span:first-child").textContent = "Versturen…";
    Array.from(els.form.elements).forEach(el => { if (el !== els.submit) el.disabled = true; });

    const chosenPlayer = selected();
    const submissionId = randomId(`phase${state.phase}`);
    const payload = {
      submissionId,
      matchId: state.match.matchId,
      phase: state.phase,
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
      markLocalVote(state.match.matchId, state.phase);
      showSuccess(receipt.message || "Je stem is opgeslagen.");
    } catch (err) {
      state.submitting = false;
      Array.from(els.form.elements).forEach(el => { if (el !== els.submit) el.disabled = false; });
      els.submit.querySelector("span:first-child").textContent = "Stem versturen";
      showMessage(err.message || "Er ging iets mis bij het versturen.");
      updateButton();
    }
  }

  async function init() {
    els.form.addEventListener("submit", handleSubmit);
    els.form.addEventListener("change", updateButton);
    els.form.addEventListener("input", updateButton);

    try {
      if (!API_CONFIGURED) throw new Error("Apps Script is niet geconfigureerd.");
      const matchId = new URLSearchParams(location.search).get("match") || "";
      const data = await jsonp({ action: "config", matchId });
      if (!data?.ok) throw new Error(data?.message || "Configuratie kon niet worden geladen.");
      render(data);
    } catch (err) {
      showMessage(err.message || "De site kon de backend niet laden.");
      els.submit.disabled = true;
    }
  }

  init();
})();
