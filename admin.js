(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || "").trim();
  const POLL_MS = 3000;
  const PHASES = {
    1: { title: "Dick of the Day · nominaties", emoji: "💩" },
    2: { title: "Dick of the Day · finale", emoji: "💩" },
    3: { title: "Sexy Moment · nominaties", emoji: "🔥" },
    4: { title: "Sexy Moment · finale", emoji: "🔥" },
    5: { title: "Man of the Match · nominaties", emoji: "🏆" },
    6: { title: "Man of the Match · finale", emoji: "🏆" }
  };

  const els = {
    matchTitle: document.getElementById("match-title"),
    matchMeta: document.getElementById("match-meta"),
    statusPill: document.getElementById("status-pill"),
    message: document.getElementById("message"),
    pin: document.getElementById("admin-pin"),
    phaseOverview: document.getElementById("phase-overview"),
    previous: document.getElementById("previous-phase"),
    next: document.getElementById("next-phase"),
    phaseNote: document.getElementById("phase-note"),
    phaseStep: document.getElementById("phase-step"),
    awardEmoji: document.getElementById("award-emoji"),
    awardTitle: document.getElementById("award-title"),
    awardHelp: document.getElementById("award-help"),
    stats: document.getElementById("live-stats"),
    form: document.getElementById("admin-vote-form"),
    options: document.getElementById("award-options"),
    voteButton: document.getElementById("vote-button"),
    postForm: document.getElementById("post-form"),
    postPayload: document.getElementById("post-payload")
  };

  let state = { data: null, busy: false, posting: false };

  function randomId(prefix) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
  }

  function browserId() {
    const key = "athena_h2_admin_browser_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = randomId("admin");
      localStorage.setItem(key, id);
    }
    return id;
  }

  function votedKey(matchId, phase) { return `athena_h2_admin_voted_${matchId}_${phase}`; }
  function hasVoted(matchId, phase) { return localStorage.getItem(votedKey(matchId, phase)) === "1"; }
  function markVoted(matchId, phase) { localStorage.setItem(votedKey(matchId, phase), "1"); }

  function jsonp(params, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const cb = `__admin_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => cleanup(new Error("Backend reageert niet.")), timeoutMs);
      function cleanup(err, data) {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
        err ? reject(err) : resolve(data);
      }
      window[cb] = data => cleanup(null, data);
      const url = new URL(API_URL);
      Object.entries({ ...params, callback: cb, _ts: Date.now() }).forEach(([k, v]) => url.searchParams.set(k, v));
      script.src = url.toString();
      script.onerror = () => cleanup(new Error("Backend kon niet worden bereikt."));
      document.head.appendChild(script);
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

  function showMessage(text, good = false) {
    els.message.textContent = text;
    els.message.classList.remove("hidden");
    els.message.style.borderColor = good ? "rgba(143,230,177,.32)" : "";
    els.message.style.color = good ? "var(--good)" : "";
    els.message.style.background = good ? "rgba(143,230,177,.08)" : "";
  }

  function clearMessage() {
    els.message.classList.add("hidden");
    els.message.removeAttribute("style");
  }

  function selectedPlayer() {
    return document.querySelector('input[name="admin-award"]:checked')?.value || "";
  }

  function renderPhases(current) {
    els.phaseOverview.innerHTML = "";
    Object.entries(PHASES).forEach(([num, meta]) => {
      const n = Number(num);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `phase-button${n === current ? " active" : ""}`;
      button.textContent = `${n}. ${meta.title}`;
      button.disabled = state.busy;
      button.addEventListener("click", () => setPhase(n));
      els.phaseOverview.appendChild(button);
    });
  }

  function renderOptions(data) {
    const old = selectedPlayer();
    els.options.innerHTML = "";
    (data.choices || []).forEach((name, index) => {
      const id = `admin-option-${index}`;
      const wrap = document.createElement("div");
      wrap.className = "option";
      wrap.innerHTML = `<input type="radio" id="${id}" name="admin-award" value="${escapeHtml(name)}"><label for="${id}">${escapeHtml(name)}</label>`;
      els.options.appendChild(wrap);
    });
    if (old) {
      const match = Array.from(document.querySelectorAll('input[name="admin-award"]')).find(x => x.value === old);
      if (match) match.checked = true;
    }
  }

  function renderStats(data) {
    const stats = Array.isArray(data.choiceStats) ? data.choiceStats.slice() : [];
    stats.sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0));
    els.stats.innerHTML = "";
    stats.forEach(row => {
      const el = document.createElement("div");
      el.className = "stat-row";
      el.innerHTML = `<span>${escapeHtml(row.player)}</span><strong>${Number(row.votes || 0)} stem${Number(row.votes || 0) === 1 ? "" : "men"}</strong>`;
      els.stats.appendChild(el);
    });
    if (!stats.length) {
      els.stats.innerHTML = '<p class="muted">Nog geen live stand beschikbaar.</p>';
    }
  }

  function updateVoteButton() {
    const d = state.data;
    if (!d?.match) return els.voteButton.disabled = true;
    els.voteButton.disabled = state.posting || d.match.status !== "open" || d.ready === false || !selectedPlayer() || hasVoted(d.match.matchId, d.phase);
  }

  function render(data) {
    state.data = data;
    const match = data.match;
    if (!match) return;
    els.matchTitle.textContent = `${match.home} – ${match.away}`;
    els.matchMeta.textContent = `${match.date || ""}${match.startTime ? ` · ${match.startTime}` : ""}${match.venue ? ` · ${match.venue}` : ""}`;
    els.statusPill.className = `pill ${match.status === "open" ? "open" : match.status === "closed" ? "closed" : ""}`;
    els.statusPill.textContent = match.status === "open" ? `Fase ${data.phase} open` : (match.statusLabel || match.status);
    els.phaseStep.textContent = `FASE ${data.phase} VAN 6`;
    els.awardEmoji.textContent = PHASES[data.phase]?.emoji || "🏑";
    els.awardTitle.textContent = PHASES[data.phase]?.title || data.phaseTitle || "Fase";
    els.awardHelp.textContent = `Live: ${Number(data.voteCount || 0)} stemmen in deze fase.`;
    els.phaseNote.textContent = data.ready === false ? data.readyMessage : `Fase ${data.phase} is klaar om te stemmen.`;
    renderPhases(data.phase);
    renderOptions(data);
    renderStats(data);
    els.previous.disabled = state.busy || data.phase <= 1;
    els.next.disabled = state.busy || data.phase >= 6;
    updateVoteButton();
  }

  async function refresh() {
    try {
      const result = await jsonp({ action: "config" });
      if (result?.ok) render(result);
    } catch (err) {
      // volgende poll probeert opnieuw
    }
  }

  async function setPhase(targetPhase) {
    const d = state.data;
    const pin = els.pin.value.trim();
    if (!d?.match) return;
    if (!pin) return showMessage("Vul eerst je admin-pincode in.");
    state.busy = true;
    renderPhases(d.phase);
    els.previous.disabled = true;
    els.next.disabled = true;
    clearMessage();
    try {
      const result = await jsonp({
        action: "adminSetPhase",
        matchId: d.match.matchId,
        phase: targetPhase,
        pin
      });
      if (!result?.ok) throw new Error(result?.message || "Fase kon niet worden gewijzigd.");
      showMessage(`Fase ${targetPhase} is geopend.`, true);
      await refresh();
    } catch (err) {
      showMessage(err.message || "Fase kon niet worden gewijzigd.");
    } finally {
      state.busy = false;
      if (state.data) render(state.data);
    }
  }

  async function pollReceipt(submissionId) {
    for (let i = 0; i < 12; i += 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 600 : 650));
      const result = await jsonp({ action: "receipt", submissionId }, 5000);
      if (result?.found) return result;
    }
    return null;
  }

  async function submitVote(event) {
    event.preventDefault();
    const d = state.data;
    const player = selectedPlayer();
    if (!d?.match || !player || hasVoted(d.match.matchId, d.phase)) return;
    state.posting = true;
    updateVoteButton();
    clearMessage();
    const submissionId = randomId(`admin_phase${d.phase}`);
    const payload = {
      submissionId,
      matchId: d.match.matchId,
      phase: d.phase,
      browserId: browserId(),
      voterCode: "",
      player,
      clientTimestamp: new Date().toISOString()
    };
    try {
      els.postForm.action = API_URL;
      els.postPayload.value = JSON.stringify(payload);
      els.postForm.submit();
      const receipt = await pollReceipt(submissionId);
      if (!receipt) throw new Error("Stem is verstuurd, maar nog niet bevestigd.");
      if (!receipt.ok) throw new Error(receipt.message || "Stem kon niet worden opgeslagen.");
      markVoted(d.match.matchId, d.phase);
      showMessage(receipt.message || "Adminstem opgeslagen.", true);
      await refresh();
    } catch (err) {
      showMessage(err.message || "Stem kon niet worden opgeslagen.");
    } finally {
      state.posting = false;
      updateVoteButton();
    }
  }

  els.previous.addEventListener("click", () => state.data && setPhase(Math.max(1, state.data.phase - 1)));
  els.next.addEventListener("click", () => state.data && setPhase(Math.min(6, state.data.phase + 1)));
  els.form.addEventListener("change", updateVoteButton);
  els.form.addEventListener("submit", submitVote);

  if (!/^https:\/\/script\.google\.com\//.test(API_URL)) {
    showMessage("Apps Script URL ontbreekt in config.js.");
  } else {
    refresh();
    setInterval(refresh, POLL_MS);
  }
})();
