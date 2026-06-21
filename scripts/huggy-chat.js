(function () {
  const API_BASE = (window.HUGGY_API_BASE || "https://huggy-worker.athulyaweerakoon.workers.dev/api/huggy").replace(/\/+$/, "");
  const STORAGE_KEY = "huggy.chat.v1";
  const DAILY_GRACE_MS = 60 * 1000;
  const MAX_VISIBLE_PAIRS = 40;
  const SPRITES = {
    asleep: "assets/images/huggy-asleep.png",
    thinking: "assets/images/huggy-thinking.png",
    waving: "assets/images/huggy-waving.png",
    sitting: "assets/images/huggy-sitting.png",
    standing: "assets/images/huggy-standing.png",
  };
  const LOCAL_QUOTA_REPLIES = [
    "You have been hanging with me for an awfully long time today. Huggy is out of daily budget and trying to look dignified about it.",
    "Tiny backend, finite allowance. Huggy is done answering for today, but he will sit here dramatically for a bit.",
    "Daily quota is gone. Huggy would love to answer, but the free-tier meter has filed a formal complaint.",
    "I am afraid today's Huggy budget has left the chat. Try again after the reset.",
  ];

  const widget = document.getElementById("huggy-widget");
  const avatar = document.getElementById("huggy-avatar");
  const avatarImg = document.getElementById("huggy-avatar-img");
  const statusEl = document.getElementById("huggy-status");
  const chat = document.getElementById("huggy-chat");
  const closeButton = document.getElementById("huggy-chat-close");
  const messagesEl = document.getElementById("huggy-messages");
  const form = document.getElementById("huggy-form");
  const input = document.getElementById("huggy-input");
  const sendButton = form?.querySelector(".huggy-send");

  if (!widget || !avatar || !avatarImg || !statusEl || !chat || !closeButton || !messagesEl || !form || !input || !sendButton) {
    return;
  }

  const state = {
    visible: false,
    open: false,
    busy: false,
    disabled: false,
    dailyQuota: false,
    dailyGraceUntil: 0,
    messages: [],
    history: [],
    longTermContext: { summary: "" },
    compactPromise: null,
    lastQuotaReply: "",
  };

  restoreState();
  renderMessages();
  setMode("asleep", "Waking up...");
  setDisabled(false);

  avatar.addEventListener("click", toggleChat);
  closeButton.addEventListener("click", closeChat);
  form.addEventListener("submit", handleSubmit);
  input.addEventListener("input", autosizeInput);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      closeChat();
    }
  });

  wakeup();

  async function wakeup() {
    try {
      const payload = await postJson("wakeup", {});
      showWidget();

      if (isDailyQuotaPayload(payload)) {
        enterSleepingQuota(payload.reply || quotaReply());
        return;
      }

      const greeting = payload.reply || "Huggy is awake and ready to answer.";
      state.dailyQuota = false;
      state.dailyGraceUntil = 0;
      state.lastQuotaReply = "";
      ensureAssistantGreeting(greeting);
      setMode("waving", "Hi there");
      setDisabled(false);
      saveState();

      window.setTimeout(() => {
        if (!state.busy && !state.disabled) {
          setMode("standing", "Ready");
        }
      }, 2600);
    } catch (error) {
      showWidget();
      ensureAssistantGreeting("Huggy is having trouble waking up right now. Very free-tier of him.");
      setMode("sitting", "Offline-ish");
      setDisabled(true);
      saveState();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) {
      return;
    }

    if (state.disabled) {
      return;
    }

    if (state.dailyQuota) {
      appendMessage("user", message);
      input.value = "";
      autosizeInput();
      handleLocalDailyQuota();
      return;
    }

    appendMessage("user", message);
    input.value = "";
    autosizeInput();
    setBusy(true, state.compactPromise ? "Thinking deeply..." : "Thinking...");

    try {
      if (state.compactPromise) {
        await state.compactPromise;
      }

      const payload = await postJson("chat", {
        message,
        chat_history: state.history,
        long_term_context: state.longTermContext,
      });

      handleChatPayload(message, payload);
    } catch (error) {
      appendMessage("assistant", "Huggy tripped over the network cable. Try again in a moment.");
      setMode("sitting", "Network trouble");
    } finally {
      setBusy(false);
      saveState();
    }
  }

  function handleChatPayload(userMessage, payload) {
    const reply = payload.reply || "Huggy did not receive a proper answer. Suspicious.";

    if (isDailyQuotaPayload(payload)) {
      appendMessage("assistant", reply);
      state.lastQuotaReply = reply;
      enterDailyQuotaGrace();
      return;
    }

    if (isRateLimitPayload(payload)) {
      appendMessage("assistant", reply);
      setMode("sitting", "Rate limited");
      return;
    }

    if (payload.backend_refused) {
      appendMessage("assistant", reply);
      setMode("standing", "Ready");
      return;
    }

    if (handleCommand(reply)) {
      addHistoryPair(userMessage, "I opened that for you.");
      setMode("standing", "Ready");
      return;
    }

    appendMessage("assistant", reply);
    addHistoryPair(userMessage, reply);
    setMode("standing", "Ready");
    scheduleCompaction();
  }

  function handleCommand(reply) {
    const command = reply.trim();
    if (command.startsWith("/navigate ")) {
      const section = command.slice("/navigate ".length).trim().replace(/^#/, "");
      const target = document.getElementById(section);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        appendMessage("assistant", `Taking you to ${section}.`);
        return true;
      }
    }

    if (command.startsWith("/open ")) {
      const href = command.slice("/open ".length).trim();
      try {
        const url = new URL(href, window.location.href);
        window.open(url.href, "_blank", "noopener,noreferrer");
        appendMessage("assistant", "Opening that in a new tab.");
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  function scheduleCompaction() {
    if (state.compactPromise || state.history.length < 8) {
      return;
    }

    const compactInput = state.history.slice();
    const previousContext = state.longTermContext;
    state.compactPromise = postJson("compact-context", {
      chat_history: compactInput,
      previous_long_term_context: previousContext,
    })
      .then((payload) => {
        if (!payload.backend_refused && payload.long_term_context) {
          state.longTermContext = payload.long_term_context;
          state.history = [];
        }
      })
      .catch(() => {
        // Compaction is opportunistic; keep the regular history if it fails.
      })
      .finally(() => {
        state.compactPromise = null;
        saveState();
      });
  }

  async function postJson(endpoint, body) {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    payload.http_status = response.status;
    return payload;
  }

  function addHistoryPair(user, assistant) {
    state.history.push({ user, assistant });
    if (state.history.length > MAX_VISIBLE_PAIRS) {
      state.history = state.history.slice(-MAX_VISIBLE_PAIRS);
    }
  }

  function appendMessage(role, text) {
    state.messages.push({ role, text, at: Date.now() });
    if (state.messages.length > MAX_VISIBLE_PAIRS * 2) {
      state.messages = state.messages.slice(-MAX_VISIBLE_PAIRS * 2);
    }
    renderMessages();
    saveState();
  }

  function ensureAssistantGreeting(text) {
    if (state.messages.length === 0) {
      appendMessage("assistant", text);
    }
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    for (const message of state.messages) {
      const bubble = document.createElement("div");
      bubble.className = `huggy-message ${message.role === "user" ? "user" : "assistant"}`;
      bubble.textContent = message.text;
      messagesEl.appendChild(bubble);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function toggleChat() {
    state.open ? closeChat() : openChat();
  }

  function openChat() {
    state.open = true;
    widget.classList.add("chat-open");
    avatar.setAttribute("aria-expanded", "true");
    avatar.setAttribute("aria-label", "Close Huggy chat");
    window.setTimeout(() => input.focus({ preventScroll: true }), 80);
  }

  function closeChat() {
    state.open = false;
    widget.classList.remove("chat-open");
    avatar.setAttribute("aria-expanded", "false");
    avatar.setAttribute("aria-label", "Open Huggy chat");
  }

  function showWidget() {
    state.visible = true;
    widget.hidden = false;
    requestAnimationFrame(() => widget.classList.add("huggy-visible"));
  }

  function setMode(mode, status) {
    avatarImg.src = SPRITES[mode] || SPRITES.standing;
    widget.dataset.huggyState = mode;
    statusEl.textContent = status;
  }

  function setBusy(isBusy, status = "Thinking...") {
    state.busy = isBusy;
    input.disabled = isBusy || state.disabled;
    sendButton.disabled = isBusy || state.disabled;
    if (isBusy) {
      setMode("thinking", status);
    } else if (!state.disabled && !state.dailyQuota) {
      setMode("standing", "Ready");
    }
  }

  function setDisabled(disabled) {
    state.disabled = disabled;
    input.disabled = disabled || state.busy;
    sendButton.disabled = disabled || state.busy;
    input.placeholder = disabled ? "Huggy is asleep for now." : "Ask Huggy about Athulya...";
  }

  function enterDailyQuotaGrace() {
    state.dailyQuota = true;
    state.dailyGraceUntil = Date.now() + DAILY_GRACE_MS;
    setMode("sitting", "Daily limit");
    setDisabled(false);

    window.setTimeout(() => {
      if (state.dailyQuota && Date.now() >= state.dailyGraceUntil) {
        setMode("asleep", "Asleep");
        setDisabled(true);
        saveState();
      }
    }, DAILY_GRACE_MS);
  }

  function enterSleepingQuota(reply) {
    state.dailyQuota = true;
    state.dailyGraceUntil = 0;
    state.lastQuotaReply = reply;
    ensureAssistantGreeting(reply);
    setMode("asleep", "Asleep");
    setDisabled(true);
    saveState();
  }

  function handleLocalDailyQuota() {
    if (Date.now() < state.dailyGraceUntil) {
      appendMessage("assistant", state.lastQuotaReply || quotaReply());
      setMode("sitting", "Daily limit");
      return;
    }
    appendMessage("assistant", "Huggy is asleep now. The daily quota is done, and he is taking the boundary-setting very seriously.");
    setMode("asleep", "Asleep");
    setDisabled(true);
  }

  function isDailyQuotaPayload(payload) {
    const error = payload?.metadata?.error || payload?.metadata?.rate_limit?.error;
    return payload?.http_status === 429 && (
      error === "worker_daily_rate_limited" ||
      error === "daily_ip_request_limit_reached" ||
      error === "daily_ip_payload_word_limit_reached"
    );
  }

  function isRateLimitPayload(payload) {
    return payload?.metadata?.rate_limit?.error === "rate_limited";
  }

  function quotaReply() {
    return LOCAL_QUOTA_REPLIES[Math.floor(Math.random() * LOCAL_QUOTA_REPLIES.length)];
  }

  function autosizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          messages: state.messages,
          history: state.history,
          longTermContext: state.longTermContext,
          dailyQuota: state.dailyQuota,
          dailyGraceUntil: state.dailyGraceUntil,
          lastQuotaReply: state.lastQuotaReply,
        }),
      );
    } catch {
      // Storage is a comfort feature, not a hard requirement.
    }
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw);
      state.messages = Array.isArray(saved.messages) ? saved.messages : [];
      state.history = Array.isArray(saved.history) ? saved.history : [];
      state.longTermContext = saved.longTermContext || { summary: "" };
      state.dailyQuota = Boolean(saved.dailyQuota);
      state.dailyGraceUntil = Number(saved.dailyGraceUntil || 0);
      state.lastQuotaReply = saved.lastQuotaReply || "";
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
})();
