document.addEventListener("DOMContentLoaded", () => {
  const spinnerOverlay = document.querySelector(".spinner-overlay");
  const spinnerText = document.querySelector(".spinner-text");
  const toastEl = document.querySelector(".toast");

  let selectedFramework = null;
  let resolvedRepoPath = "";
  let uploadedSpec = null;

  function showToast(message, type = "success") {
    toastEl.textContent = message;
    toastEl.className = `toast ${type} show`;
    setTimeout(() => toastEl.classList.remove("show"), 3000);
  }

  function showSpinner(msg) {
    spinnerText.textContent = msg;
    spinnerOverlay.classList.add("active");
  }

  function hideSpinner() {
    spinnerOverlay.classList.remove("active");
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ═══════════════════════════════════════════════════════
  //  Mode Switching
  // ═══════════════════════════════════════════════════════

  window.switchMode = function (mode) {
    document.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.classList.toggle("mode-tab--active", tab.dataset.mode === mode);
    });
    document.getElementById("mode-repo").style.display = mode === "repo" ? "block" : "none";
    document.getElementById("mode-collection").style.display = mode === "collection" ? "block" : "none";
  };

  // ═══════════════════════════════════════════════════════
  //  REPO MODE — Detect Frameworks
  // ═══════════════════════════════════════════════════════

  window.detectFrameworks = async function () {
    const repoPath = document.getElementById("repo-path").value.trim();
    if (!repoPath) return showToast("Please enter a repository path or Git URL.", "error");

    showSpinner("Scanning repository for test frameworks...");

    try {
      const resp = await fetch("/api/apitest/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_path: repoPath }),
      });

      const data = await resp.json();
      hideSpinner();

      if (!resp.ok) {
        showToast(data.error || "Detection failed.", "error");
        return;
      }

      resolvedRepoPath = data.repo_path;
      renderDetectionResults(data);
    } catch (err) {
      hideSpinner();
      showToast(`Error: ${err.message}`, "error");
    }
  };

  function renderDetectionResults(data) {
    const section = document.getElementById("detect-results");
    document.getElementById("detect-repo-path").textContent = data.repo_path;

    const container = document.getElementById("framework-cards");
    container.innerHTML = "";

    if (data.frameworks.length === 0) {
      container.innerHTML = `
        <div class="fw-empty">
          <p>No test frameworks detected in this repository.</p>
          <p class="fw-empty-hint">You can still enter a custom command below to run tests manually.</p>
        </div>`;
      section.style.display = "block";
      section.scrollIntoView({ behavior: "smooth" });
      showToast("No test frameworks detected.", "error");
      return;
    }

    selectedFramework = data.frameworks[0].name;

    data.frameworks.forEach((fw, idx) => {
      const card = document.createElement("div");
      card.className = `fw-card ${idx === 0 ? "fw-card--selected" : ""}`;
      card.dataset.name = fw.name;
      card.onclick = () => selectFramework(fw.name);

      const confidenceCls = fw.confidence === "high" ? "fw-conf--high"
                          : fw.confidence === "medium" ? "fw-conf--medium"
                          : "fw-conf--low";

      card.innerHTML = `
        <div class="fw-card-top">
          <div class="fw-card-title">${escapeHtml(fw.display_name)}</div>
          <span class="fw-conf ${confidenceCls}">${fw.confidence}</span>
        </div>
        <div class="fw-card-meta">
          <span class="fw-meta-item">${fw.test_file_count} test file(s)</span>
          ${fw.config_file ? `<span class="fw-meta-item">${escapeHtml(fw.config_file)}</span>` : ""}
        </div>
        <div class="fw-card-cmd">
          <code>${escapeHtml(fw.command)}</code>
        </div>
        ${fw.test_files.length > 0 ? `
          <details class="fw-card-files">
            <summary>${fw.test_file_count} file(s) discovered</summary>
            <ul>${fw.test_files.slice(0, 20).map(f => `<li>${escapeHtml(f)}</li>`).join("")}
            ${fw.test_file_count > 20 ? `<li class="fw-more">... and ${fw.test_file_count - 20} more</li>` : ""}</ul>
          </details>` : ""}
      `;
      container.appendChild(card);
    });

    section.style.display = "block";
    section.scrollIntoView({ behavior: "smooth" });
    showToast(`Detected ${data.frameworks.length} framework(s)`);
  }

  window.selectFramework = function (name) {
    selectedFramework = name;
    document.querySelectorAll(".fw-card").forEach((c) => {
      c.classList.toggle("fw-card--selected", c.dataset.name === name);
    });
  };

  // ── Repo Live Log Helpers ───────────────────────────────
  const logPanel = document.getElementById("live-log-panel");
  const logLines = document.getElementById("live-log-lines");
  const logOutput = document.getElementById("live-log-output");
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

  window.toggleLogWrap = function () {
    logWrap = !logWrap;
    logOutput.classList.toggle("live-log-output--nowrap", !logWrap);
  };

  window.clearLiveLog = function () {
    logLines.innerHTML = "";
  };

  // ── Run Tests (SSE) — Repo Mode ────────────────────────
  window.runTests = function () {
    const repoPath = resolvedRepoPath || document.getElementById("repo-path").value.trim();
    if (!repoPath) return showToast("Please detect frameworks first.", "error");

    const customCmd = document.getElementById("custom-command").value.trim();

    document.getElementById("test-results").style.display = "none";
    logLines.innerHTML = "";
    logStatus.textContent = "Running...";
    logStatus.className = "live-log-status live-log-status--running";
    logPanel.style.display = "block";
    logPanel.scrollIntoView({ behavior: "smooth" });

    const btnRun = document.getElementById("btn-run");
    const btnDetect = document.getElementById("btn-detect");
    btnRun.disabled = true;
    btnDetect.disabled = true;

    appendLog("Connecting to test execution stream...", "info");

    const params = new URLSearchParams({
      repo_path: repoPath,
      ...(selectedFramework && { framework: selectedFramework }),
      ...(customCmd && { command: customCmd }),
    });

    const source = new EventSource(`/api/apitest/stream?${params}`);

    source.addEventListener("log", (e) => {
      const data = JSON.parse(e.data);
      const msg = data.message || JSON.stringify(data);
      appendLog(msg, "info");
    });

    source.addEventListener("output", (e) => {
      const data = JSON.parse(e.data);
      const msg = data.message || JSON.stringify(data);
      const level = msg.includes("FAIL") || msg.includes("ERROR") || msg.includes("error")
        ? "error"
        : msg.includes("PASS") || msg.includes("passed") || msg.includes("ok")
        ? "pass"
        : "";
      appendLog(msg, level);
    });

    source.addEventListener("framework", (e) => {
      const data = JSON.parse(e.data);
      appendLog(`Framework: ${data.display_name} | Command: ${data.command}`, "info");
    });

    source.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      source.close();
      btnRun.disabled = false;
      btnDetect.disabled = false;

      logStatus.textContent = "Completed";
      logStatus.className = "live-log-status live-log-status--done";

      renderResults(data);

      const badge = document.getElementById("status-badge");
      if (data.failed > 0 || data.exit_code !== 0) {
        badge.className = "status-badge error";
        badge.textContent = `${data.failed} test(s) failed`;
      } else {
        badge.className = "status-badge success";
        badge.textContent = `All ${data.total} test(s) passed`;
      }

      showToast(`Tests complete — ${data.passed} passed, ${data.failed} failed`);
    });

    source.addEventListener("error_event", (e) => {
      const data = JSON.parse(e.data);
      appendLog(`ERROR: ${data.message}`, "error");
    });

    source.onerror = () => {
      source.close();
      btnRun.disabled = false;
      btnDetect.disabled = false;
      logStatus.textContent = "Disconnected";
      logStatus.className = "live-log-status live-log-status--error";
      appendLog("Connection to server lost.", "error");
      showToast("Stream connection lost.", "error");
    };
  };

  function renderResults(data) {
    const section = document.getElementById("test-results");

    document.getElementById("results-framework").textContent = selectedFramework || "—";
    document.getElementById("stat-passed").textContent = data.passed;
    document.getElementById("stat-failed").textContent = data.failed;
    document.getElementById("stat-skipped").textContent = data.skipped;
    document.getElementById("stat-errors").textContent = data.errors;
    document.getElementById("stat-duration").textContent = data.duration_ms;
    document.getElementById("stat-exit-code").textContent = data.exit_code;

    const total = data.total || 1;
    document.getElementById("results-bar-pass").style.width = `${(data.passed / total) * 100}%`;
    document.getElementById("results-bar-fail").style.width = `${(data.failed / total) * 100}%`;
    document.getElementById("results-bar-skip").style.width = `${(data.skipped / total) * 100}%`;

    section.style.display = "block";
    section.scrollIntoView({ behavior: "smooth" });
  }

  document.getElementById("repo-path").addEventListener("keydown", (e) => {
    if (e.key === "Enter") detectFrameworks();
  });

  // ═══════════════════════════════════════════════════════
  //  COLLECTION MODE — Upload & Parse
  // ═══════════════════════════════════════════════════════

  const uploadArea = document.getElementById("upload-area");
  const fileInput = document.getElementById("collection-file");
  const filenameDisplay = document.getElementById("upload-filename");
  let selectedFile = null;

  uploadArea.addEventListener("click", () => fileInput.click());

  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("upload-area--dragover");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("upload-area--dragover");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("upload-area--dragover");
    if (e.dataTransfer.files.length > 0) {
      selectedFile = e.dataTransfer.files[0];
      filenameDisplay.textContent = selectedFile.name;
      uploadArea.classList.add("upload-area--selected");
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      selectedFile = fileInput.files[0];
      filenameDisplay.textContent = selectedFile.name;
      uploadArea.classList.add("upload-area--selected");
    }
  });

  window.uploadCollection = async function () {
    if (!selectedFile) return showToast("Please select an OpenAPI JSON file.", "error");

    showSpinner("Parsing OpenAPI specification...");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const resp = await fetch("/api/apitest/upload", {
        method: "POST",
        body: formData,
      });

      const data = await resp.json();
      hideSpinner();

      if (!resp.ok) {
        showToast(data.error || "Upload failed.", "error");
        return;
      }

      uploadedSpec = data.raw_spec;

      if (data.spec_info.base_url) {
        const baseUrlInput = document.getElementById("base-url");
        if (!baseUrlInput.value.trim()) {
          baseUrlInput.value = data.spec_info.base_url;
        }
      }

      renderEndpointPreview(data);
    } catch (err) {
      hideSpinner();
      showToast(`Error: ${err.message}`, "error");
    }
  };

  function renderEndpointPreview(data) {
    const section = document.getElementById("endpoints-preview");
    document.getElementById("spec-title").textContent = data.spec_info.title || "API Endpoints";
    document.getElementById("spec-version").textContent = data.spec_info.version ? `v${data.spec_info.version}` : "";
    document.getElementById("spec-count").textContent = `${data.endpoints.length} endpoint(s)`;

    const container = document.getElementById("endpoint-cards");
    container.innerHTML = "";

    if (data.endpoints.length === 0) {
      container.innerHTML = `<div class="fw-empty"><p>No endpoints found in the specification.</p></div>`;
      section.style.display = "block";
      showToast("No endpoints found.", "error");
      return;
    }

    const methodColors = {
      GET: "method-get", POST: "method-post", PUT: "method-put",
      PATCH: "method-patch", DELETE: "method-delete", HEAD: "method-head",
      OPTIONS: "method-options",
    };

    data.endpoints.forEach((ep) => {
      const card = document.createElement("div");
      card.className = "ep-card";

      const cls = methodColors[ep.method] || "method-get";
      card.innerHTML = `
        <div class="ep-card-top">
          <span class="method-badge ${cls}">${ep.method}</span>
          <span class="ep-path">${escapeHtml(ep.path)}</span>
        </div>
        ${ep.summary ? `<div class="ep-summary">${escapeHtml(ep.summary)}</div>` : ""}
        <div class="ep-meta">
          ${ep.tags.length ? ep.tags.map(t => `<span class="ep-tag">${escapeHtml(t)}</span>`).join("") : ""}
          ${ep.has_body ? '<span class="ep-tag ep-tag--body">has body</span>' : ""}
          ${ep.param_count > 0 ? `<span class="ep-tag">${ep.param_count} param(s)</span>` : ""}
        </div>
      `;
      container.appendChild(card);
    });

    section.style.display = "block";
    section.scrollIntoView({ behavior: "smooth" });
    showToast(`Parsed ${data.endpoints.length} endpoint(s)`);
  }

  // ═══════════════════════════════════════════════════════
  //  COLLECTION MODE — Generate & Execute Tests (SSE)
  // ═══════════════════════════════════════════════════════

  const collLogPanel = document.getElementById("collection-log-panel");
  const collLogLines = document.getElementById("collection-log-lines");
  const collLogOutput = document.getElementById("collection-log-output");
  const collLogStatus = document.getElementById("collection-log-status");
  let collLogWrap = true;

  function appendCollectionLog(message, level) {
    const line = document.createElement("div");
    line.className = "live-log-line";
    if (level) line.classList.add("live-log-line--" + level);
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    line.innerHTML = `<span class="log-ts">${ts}</span> ${escapeHtml(message)}`;
    collLogLines.appendChild(line);
    collLogOutput.scrollTop = collLogOutput.scrollHeight;
  }

  window.toggleCollectionLogWrap = function () {
    collLogWrap = !collLogWrap;
    collLogOutput.classList.toggle("live-log-output--nowrap", !collLogWrap);
  };

  window.clearCollectionLog = function () {
    collLogLines.innerHTML = "";
  };

  let dashboardData = { endpoints: 0, tests: 0, passed: 0, failed: 0, errors: 0, duration_ms: 0, results: [] };
  let currentEndpointResults = [];

  function resetDashboard() {
    dashboardData = { endpoints: 0, tests: 0, passed: 0, failed: 0, errors: 0, duration_ms: 0, results: [] };
    currentEndpointResults = [];
    document.getElementById("dash-total-endpoints").textContent = "0";
    document.getElementById("dash-total-tests").textContent = "0";
    document.getElementById("dash-passed").textContent = "0";
    document.getElementById("dash-failed").textContent = "0";
    document.getElementById("dash-pass-rate").textContent = "0%";
    document.getElementById("dash-duration").textContent = "0s";
    document.getElementById("dash-bar-pass").style.width = "0%";
    document.getElementById("dash-bar-fail").style.width = "0%";
    document.getElementById("endpoint-results").innerHTML = "";
  }

  function updateDashboardSummary() {
    const d = dashboardData;
    document.getElementById("dash-total-endpoints").textContent = d.endpoints;
    document.getElementById("dash-total-tests").textContent = d.tests;
    document.getElementById("dash-passed").textContent = d.passed;
    document.getElementById("dash-failed").textContent = d.failed;

    const rate = d.tests > 0 ? Math.round((d.passed / d.tests) * 100) : 0;
    document.getElementById("dash-pass-rate").textContent = rate + "%";

    const durationSec = (d.duration_ms / 1000).toFixed(1);
    document.getElementById("dash-duration").textContent = durationSec + "s";

    const total = d.tests || 1;
    document.getElementById("dash-bar-pass").style.width = `${(d.passed / total) * 100}%`;
    document.getElementById("dash-bar-fail").style.width = `${(d.failed / total) * 100}%`;
  }

  function addEndpointResultCard(epData) {
    const container = document.getElementById("endpoint-results");
    const epEl = document.createElement("div");
    epEl.className = "ep-result-card";

    const allPassed = epData.failed === 0;
    const statusCls = allPassed ? "ep-result--pass" : "ep-result--fail";
    const methodCls = "method-" + epData.method.toLowerCase();

    let testsHtml = "";
    (epData.tests || []).forEach((t) => {
      const rowCls = t.passed ? "test-row--pass" : "test-row--fail";
      const typeCls = t.type === "positive" ? "type-badge--positive" : "type-badge--negative";
      const statusIcon = t.passed ? "&#10004;" : "&#10008;";

      let assertionsHtml = "";
      if (t.assertions && t.assertions.length > 0) {
        assertionsHtml = `<div class="test-assertions">
          ${t.assertions.map(a =>
            `<span class="assertion ${a.passed ? 'assertion--pass' : 'assertion--fail'}">${a.passed ? '&#10004;' : '&#10008;'} ${escapeHtml(a.assertion)}</span>`
          ).join("")}
        </div>`;
      }

      testsHtml += `
        <div class="test-row ${rowCls}">
          <div class="test-row-main">
            <span class="test-status-icon">${statusIcon}</span>
            <span class="type-badge ${typeCls}">${escapeHtml(t.type)}</span>
            <span class="test-name">${escapeHtml(t.name)}</span>
            <span class="test-status-codes">
              <span class="status-expected">Expected: ${t.expected_status}</span>
              <span class="status-actual ${t.actual_status === t.expected_status ? 'status-match' : 'status-mismatch'}">Actual: ${t.actual_status || 'N/A'}</span>
            </span>
            <span class="test-time">${t.response_time_ms}ms</span>
          </div>
          ${t.error ? `<div class="test-error">${escapeHtml(t.error)}</div>` : ""}
          ${assertionsHtml}
        </div>
      `;
    });

    epEl.innerHTML = `
      <div class="ep-result-header ${statusCls}" onclick="this.parentElement.classList.toggle('ep-result-card--open')">
        <div class="ep-result-left">
          <span class="method-badge ${methodCls}">${epData.method}</span>
          <span class="ep-result-path">${escapeHtml(epData.path)}</span>
          ${epData.summary ? `<span class="ep-result-summary">${escapeHtml(epData.summary)}</span>` : ""}
        </div>
        <div class="ep-result-right">
          <span class="ep-result-stat ep-result-stat--pass">${epData.passed} passed</span>
          <span class="ep-result-stat ep-result-stat--fail">${epData.failed} failed</span>
          <span class="ep-result-toggle">&#9660;</span>
        </div>
      </div>
      <div class="ep-result-body">
        ${testsHtml}
      </div>
    `;

    container.appendChild(epEl);
  }

  window.runCollectionTests = function () {
    if (!uploadedSpec) return showToast("Please upload and parse a specification first.", "error");

    const baseUrl = document.getElementById("base-url").value.trim();
    if (!baseUrl) return showToast("Please provide a base URL.", "error");

    const btnGenExec = document.getElementById("btn-generate-execute");
    const btnUpload = document.getElementById("btn-upload");
    btnGenExec.disabled = true;
    btnUpload.disabled = true;

    resetDashboard();

    collLogLines.innerHTML = "";
    collLogStatus.textContent = "Running...";
    collLogStatus.className = "live-log-status live-log-status--running";
    collLogPanel.style.display = "block";
    document.getElementById("collection-dashboard").style.display = "block";
    collLogPanel.scrollIntoView({ behavior: "smooth" });

    appendCollectionLog("Starting AI test generation & execution...", "info");

    // Use fetch + ReadableStream to POST the spec (SSE via POST)
    fetch("/api/apitest/collection-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: baseUrl, spec: uploadedSpec }),
    }).then((response) => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function processChunk() {
        reader.read().then(({ done, value }) => {
          if (done) {
            onStreamComplete();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.substring(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const payload = JSON.parse(line.substring(6));
                handleCollectionEvent(currentEvent, payload);
              } catch (e) { /* skip malformed */ }
              currentEvent = "";
            }
          }

          processChunk();
        });
      }

      processChunk();
    }).catch((err) => {
      appendCollectionLog(`Connection error: ${err.message}`, "error");
      onStreamComplete();
    });

    let liveTimer = setInterval(() => {
      dashboardData.duration_ms += 1000;
      updateDashboardSummary();
    }, 1000);

    function onStreamComplete() {
      clearInterval(liveTimer);
      btnGenExec.disabled = false;
      btnUpload.disabled = false;
      collLogStatus.textContent = "Completed";
      collLogStatus.className = "live-log-status live-log-status--done";
      updateDashboardSummary();

      const badge = document.getElementById("status-badge");
      if (dashboardData.failed > 0) {
        badge.className = "status-badge error";
        badge.textContent = `${dashboardData.failed} test(s) failed`;
      } else {
        badge.className = "status-badge success";
        badge.textContent = `All ${dashboardData.passed} test(s) passed`;
      }

      showToast(`Tests complete — ${dashboardData.passed} passed, ${dashboardData.failed} failed`);
      document.getElementById("collection-dashboard").scrollIntoView({ behavior: "smooth" });
    }
  };

  function handleCollectionEvent(eventType, payload) {
    switch (eventType) {
      case "log": {
        const msg = payload.message || JSON.stringify(payload);
        appendCollectionLog(msg, "info");
        break;
      }

      case "spec_info": {
        appendCollectionLog(`API: ${payload.title} — ${payload.endpoint_count} endpoint(s)`, "info");
        break;
      }

      case "endpoint_start": {
        currentEndpointResults = [];
        appendCollectionLog(`[${payload.index + 1}/${payload.total}] ${payload.method} ${payload.path}`, "info");
        break;
      }

      case "test_generated": {
        appendCollectionLog(`Generated ${payload.count} test(s) for ${payload.method} ${payload.path}`, "pass");
        break;
      }

      case "test_result": {
        const icon = payload.passed ? "PASS" : "FAIL";
        const level = payload.passed ? "pass" : "error";
        appendCollectionLog(`  ${icon}: ${payload.name} [${payload.actual_status}] ${payload.response_time_ms}ms`, level);

        dashboardData.tests++;
        if (payload.passed) dashboardData.passed++;
        else dashboardData.failed++;

        currentEndpointResults.push(payload);
        updateDashboardSummary();
        break;
      }

      case "endpoint_complete": {
        dashboardData.endpoints++;
        const epData = {
          method: payload.method,
          path: payload.path,
          summary: "",
          tests: currentEndpointResults,
          passed: payload.passed,
          failed: payload.failed,
        };
        addEndpointResultCard(epData);
        updateDashboardSummary();
        break;
      }

      case "complete": {
        dashboardData.duration_ms = payload.duration_ms || dashboardData.duration_ms;
        dashboardData.endpoints = payload.endpoints || dashboardData.endpoints;
        updateDashboardSummary();
        appendCollectionLog(
          `Completed: ${payload.passed} passed, ${payload.failed} failed out of ${payload.tests} tests in ${payload.duration_ms}ms`,
          payload.failed > 0 ? "error" : "pass"
        );
        break;
      }

      case "error_event": {
        const msg = payload.message || JSON.stringify(payload);
        appendCollectionLog(`ERROR: ${msg}`, "error");
        break;
      }
    }
  }
});
