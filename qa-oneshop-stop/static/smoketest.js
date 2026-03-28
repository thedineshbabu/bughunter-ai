document.addEventListener("DOMContentLoaded", () => {
  const spinnerOverlay = document.querySelector(".spinner-overlay");
  const spinnerText = document.querySelector(".spinner-text");
  const toastEl = document.querySelector(".toast");
  const jiraKeyInput = document.getElementById("smoke-jira-key");
  const jiraPreviewBtnGroup = document.getElementById("jira-preview-btn-group");
  const credToggle = document.getElementById("cred-toggle");
  const credFields = document.getElementById("cred-fields");

  // Show/hide credential fields
  credToggle.addEventListener("change", () => {
    credFields.style.display = credToggle.checked ? "block" : "none";
  });

  // Show "View Jira Description" button when a key is typed
  jiraKeyInput.addEventListener("input", () => {
    jiraPreviewBtnGroup.style.display = jiraKeyInput.value.trim() ? "flex" : "none";
  });

  // ── Toast ──────────────────────────────────────────
  function showToast(message, type = "success") {
    toastEl.textContent = message;
    toastEl.className = `toast ${type} show`;
    setTimeout(() => toastEl.classList.remove("show"), 3000);
  }

  // ── Spinner ────────────────────────────────────────
  function showSpinner(msg) {
    spinnerText.textContent = msg;
    spinnerOverlay.classList.add("active");
  }
  function hideSpinner() {
    spinnerOverlay.classList.remove("active");
  }

  // ── Jira Preview ─────────────────────────────────────
  window.fetchJiraPreview = async function () {
    const issueKey = jiraKeyInput.value.trim();
    if (!issueKey) return showToast("Please enter a Jira issue key.", "error");

    showSpinner("Fetching Jira issue details...");

    try {
      const resp = await fetch("/api/jira/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issueKey }),
      });

      const data = await resp.json();
      hideSpinner();

      if (!resp.ok) {
        showToast(data.error || "Failed to fetch Jira issue.", "error");
        return;
      }

      document.getElementById("jira-preview-key").textContent = data.key;
      document.getElementById("jira-preview-summary").textContent = data.summary;
      document.getElementById("jira-preview-type").textContent = data.issue_type || "—";
      document.getElementById("jira-preview-priority").textContent = data.priority || "—";

      const labelsEl = document.getElementById("jira-preview-labels");
      labelsEl.innerHTML = "";
      (data.labels || []).forEach((l) => {
        const tag = document.createElement("span");
        tag.className = "jira-meta-tag jira-meta-label";
        tag.textContent = l;
        labelsEl.appendChild(tag);
      });

      const compsEl = document.getElementById("jira-preview-components");
      compsEl.innerHTML = "";
      (data.components || []).forEach((c) => {
        const tag = document.createElement("span");
        tag.className = "jira-meta-tag jira-meta-component";
        tag.textContent = c;
        compsEl.appendChild(tag);
      });

      document.getElementById("jira-preview-desc").textContent = data.description || "No description available.";

      const acSection = document.getElementById("jira-preview-ac-section");
      if (data.acceptance_criteria) {
        document.getElementById("jira-preview-ac").textContent = data.acceptance_criteria;
        acSection.style.display = "block";
      } else {
        acSection.style.display = "none";
      }

      document.getElementById("jira-preview").style.display = "block";
      showToast(`Loaded ${data.key} — ${data.summary}`);
    } catch (err) {
      hideSpinner();
      showToast(`Error: ${err.message}`, "error");
    }
  };

  window.closeJiraPreview = function () {
    document.getElementById("jira-preview").style.display = "none";
  };

  // ── Status Icon Helper ─────────────────────────────
  function statusIcon(status) {
    switch (status) {
      case "pass": return '<span class="check-icon check-icon--pass">&#10003;</span>';
      case "fail": return '<span class="check-icon check-icon--fail">&#10007;</span>';
      case "warn": return '<span class="check-icon check-icon--warn">&#9888;</span>';
      default:     return '<span class="check-icon">&#8943;</span>';
    }
  }

  // ── Render Crawl Results ─────────────────────────────
  function renderCrawl(data) {
    const panel = document.getElementById("crawl-panel");
    document.getElementById("crawl-pages").textContent = data.pages_discovered.length;
    document.getElementById("crawl-nav").textContent = data.navigation_items.length;
    document.getElementById("crawl-forms").textContent = data.forms.length;
    document.getElementById("crawl-buttons").textContent = data.buttons.length;

    const content = document.getElementById("crawl-detail-content");
    let html = "";

    if (data.navigation_items.length) {
      html += "<h4>Navigation Items</h4><ul>";
      data.navigation_items.forEach(n => {
        html += `<li><strong>${escapeHtml(n.text)}</strong> <span class="crawl-link">${escapeHtml(n.href)}</span></li>`;
      });
      html += "</ul>";
    }

    if (data.pages_discovered.length) {
      html += `<h4>Discovered Pages (${data.pages_discovered.length})</h4><ul>`;
      data.pages_discovered.slice(0, 20).forEach(p => {
        html += `<li>${escapeHtml(p.text || p.href)} <span class="crawl-link">${escapeHtml(p.href)}</span></li>`;
      });
      if (data.pages_discovered.length > 20) html += `<li class="crawl-more">... and ${data.pages_discovered.length - 20} more</li>`;
      html += "</ul>";
    }

    if (data.forms.length) {
      html += "<h4>Forms</h4><ul>";
      data.forms.forEach(f => {
        const fields = f.inputs.map(i => i.name || i.placeholder || i.type).join(", ");
        html += `<li><strong>${escapeHtml(f.id)}</strong> (${f.method}) — Fields: ${escapeHtml(fields)}</li>`;
      });
      html += "</ul>";
    }

    if (data.buttons.length) {
      html += "<h4>Buttons / Interactive</h4><ul>";
      data.buttons.forEach(b => {
        html += `<li>${escapeHtml(b.text)} <span class="crawl-tag">${b.tag}</span></li>`;
      });
      html += "</ul>";
    }

    content.innerHTML = html;
    panel.style.display = "block";
  }

  // ── Render Generated Scenarios ───────────────────────
  function renderScenarios(scenarios) {
    const panel = document.getElementById("scenarios-panel");
    const list = document.getElementById("scenarios-list");
    document.getElementById("scenarios-count").textContent = scenarios.length;

    list.innerHTML = "";
    scenarios.forEach(s => {
      const row = document.createElement("div");
      row.className = "scenario-row";
      row.innerHTML = `<span class="scenario-id">${s.id}</span><span class="scenario-title">${escapeHtml(s.title)}</span>`;
      list.appendChild(row);
    });
    panel.style.display = "block";
  }

  // ── Render Results ─────────────────────────────────
  function renderResults(data) {
    const resultsSection = document.getElementById("smoke-results");

    document.getElementById("smoke-url-display").textContent = data.url;
    document.getElementById("stat-passed").textContent = data.summary.passed;
    document.getElementById("stat-failed").textContent = data.summary.failed;
    document.getElementById("stat-warnings").textContent = data.summary.warnings;
    document.getElementById("stat-duration").textContent = data.total_duration_ms;

    // Progress bar
    const total = data.summary.total || 1;
    document.getElementById("results-bar-pass").style.width = `${(data.summary.passed / total) * 100}%`;
    document.getElementById("results-bar-fail").style.width = `${(data.summary.failed / total) * 100}%`;
    document.getElementById("results-bar-warn").style.width = `${(data.summary.warnings / total) * 100}%`;

    // Report link
    if (data.report_path) {
      const reportActions = document.getElementById("report-actions");
      const reportLink = document.getElementById("report-link");
      const filename = data.report_path.replace(/\\/g, "/").split("/").pop();
      reportLink.href = `/output/${filename}`;
      reportActions.style.display = "flex";
    }

    // Checks
    const checksContainer = document.getElementById("smoke-checks");
    checksContainer.innerHTML = "";
    (data.checks || []).forEach((c) => {
      const row = document.createElement("div");
      row.className = `smoke-check-row smoke-check-row--${c.status}`;
      row.innerHTML = `
        <div class="smoke-check-left">
          ${statusIcon(c.status)}
          <span class="smoke-check-id">${c.id}</span>
          <span class="smoke-check-title">${escapeHtml(c.title)}</span>
        </div>
        <div class="smoke-check-right">
          <span class="smoke-check-detail">${escapeHtml(c.detail)}</span>
          ${c.duration_ms ? `<span class="smoke-check-time">${c.duration_ms}ms</span>` : ""}
        </div>
      `;
      checksContainer.appendChild(row);
    });

    // Console Errors
    const consoleSection = document.getElementById("smoke-console-section");
    const consoleList = document.getElementById("smoke-console-list");
    consoleList.innerHTML = "";
    if (data.console_errors && data.console_errors.length > 0) {
      data.console_errors.forEach((e) => {
        const li = document.createElement("li");
        li.textContent = e;
        consoleList.appendChild(li);
      });
      consoleSection.style.display = "block";
    } else {
      consoleSection.style.display = "none";
    }

    // Network Failures
    const networkSection = document.getElementById("smoke-network-section");
    const networkList = document.getElementById("smoke-network-list");
    networkList.innerHTML = "";
    if (data.network_failures && data.network_failures.length > 0) {
      data.network_failures.forEach((e) => {
        const li = document.createElement("li");
        li.textContent = e;
        networkList.appendChild(li);
      });
      networkSection.style.display = "block";
    } else {
      networkSection.style.display = "none";
    }

    // Screenshot
    const screenshotSection = document.getElementById("smoke-screenshot-section");
    if (data.screenshot_b64) {
      document.getElementById("smoke-screenshot").src = "data:image/png;base64," + data.screenshot_b64;
      screenshotSection.style.display = "block";
    } else {
      screenshotSection.style.display = "none";
    }

    resultsSection.style.display = "block";
    resultsSection.scrollIntoView({ behavior: "smooth" });
  }

  // ── Live Log Helpers ───────────────────────────────
  const logPanel = document.getElementById("live-log-panel");
  const logLines = document.getElementById("live-log-lines");
  const logOutput = document.getElementById("live-log-output");
  const logChecks = document.getElementById("live-log-checks");
  const logStatus = document.getElementById("live-log-status");
  let logWrap = true;

  function appendLog(message, level) {
    const line = document.createElement("div");
    line.className = "live-log-line";
    if (level) line.classList.add("live-log-line--" + level);

    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    line.innerHTML = `<span class="log-ts">${ts}</span> ${escapeHtml(message)}`;
    logLines.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function appendCheckBadge(check) {
    const badge = document.createElement("span");
    badge.className = `live-check-badge live-check-badge--${check.status}`;
    badge.innerHTML = `${statusIcon(check.status)} ${check.id}`;
    badge.title = `${check.title}: ${check.detail}`;
    logChecks.appendChild(badge);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  window.toggleLogWrap = function () {
    logWrap = !logWrap;
    logOutput.classList.toggle("live-log-output--nowrap", !logWrap);
  };

  window.clearLiveLog = function () {
    logLines.innerHTML = "";
  };

  // ── Execute Smoke Test (SSE streaming) ────────────
  window.executeSmoke = function () {
    const url = document.getElementById("smoke-url").value.trim();
    if (!url) return showToast("Please enter a target URL.", "error");

    // Collect credentials
    let credUser = "";
    let credPass = "";
    if (credToggle.checked) {
      credUser = document.getElementById("cred-user").value.trim();
      credPass = document.getElementById("cred-password").value;
      if (!credUser || !credPass) {
        return showToast("Please enter both User ID and Password.", "error");
      }
    }

    // Reset UI
    document.getElementById("smoke-results").style.display = "none";
    document.getElementById("crawl-panel").style.display = "none";
    document.getElementById("scenarios-panel").style.display = "none";
    document.getElementById("report-actions").style.display = "none";
    logLines.innerHTML = "";
    logChecks.innerHTML = "";
    logStatus.textContent = "Running...";
    logStatus.className = "live-log-status live-log-status--running";
    logPanel.style.display = "block";
    logPanel.scrollIntoView({ behavior: "smooth" });

    const btn = document.getElementById("btn-execute");
    btn.disabled = true;

    appendLog("Connecting to smoke test stream...", "info");

    const params = new URLSearchParams({ url });
    if (credUser) params.set("user_id", credUser);
    if (credPass) params.set("password", credPass);

    const source = new EventSource(`/api/smoketest/stream?${params}`);

    source.addEventListener("log", (e) => {
      const data = JSON.parse(e.data);
      const msg = data.message || JSON.stringify(data);
      const level = msg.includes("[WARNING]") ? "warn"
                  : msg.includes("[ERROR]") ? "error"
                  : "info";
      appendLog(msg, level);
    });

    source.addEventListener("check", (e) => {
      const check = JSON.parse(e.data);
      appendCheckBadge(check);
      const symbol = check.status === "pass" ? "PASS"
                   : check.status === "fail" ? "FAIL"
                   : "WARN";
      appendLog(`[${symbol}] ${check.id} — ${check.title}: ${check.detail}`,
                check.status === "pass" ? "pass" : check.status === "fail" ? "error" : "warn");
    });

    source.addEventListener("crawl", (e) => {
      const data = JSON.parse(e.data);
      renderCrawl(data);
      appendLog(`Crawl complete — ${data.pages_discovered.length} pages, ${data.navigation_items.length} nav, ${data.forms.length} forms, ${data.buttons.length} buttons`, "info");
    });

    source.addEventListener("scenarios", (e) => {
      const scenarios = JSON.parse(e.data);
      renderScenarios(scenarios);
      appendLog(`Generated ${scenarios.length} dynamic scenario(s)`, "info");
    });

    source.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      source.close();
      btn.disabled = false;

      logStatus.textContent = "Completed";
      logStatus.className = "live-log-status live-log-status--done";

      renderResults(data);

      const badge = document.getElementById("status-badge");
      if (data.summary.failed > 0) {
        badge.className = "status-badge error";
        badge.textContent = `${data.summary.failed} check(s) failed`;
      } else {
        badge.className = "status-badge success";
        badge.textContent = `All ${data.summary.total} checks passed`;
      }

      showToast(`Smoke test completed — ${data.summary.passed} passed, ${data.summary.failed} failed`);
    });

    source.addEventListener("error_event", (e) => {
      const data = JSON.parse(e.data);
      appendLog(`ERROR: ${data.message}`, "error");
    });

    source.onerror = () => {
      source.close();
      btn.disabled = false;
      logStatus.textContent = "Disconnected";
      logStatus.className = "live-log-status live-log-status--error";
      appendLog("Connection to server lost.", "error");
      showToast("Stream connection lost.", "error");
    };
  };
});
