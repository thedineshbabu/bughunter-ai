document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");
  const outputSection = document.querySelector(".output-section");
  const featureOutput = document.querySelector(".feature-output");
  const spinnerOverlay = document.querySelector(".spinner-overlay");
  const spinnerText = document.querySelector(".spinner-text");
  const toastEl = document.querySelector(".toast");
  const outputTitle = document.getElementById("output-title");
  const btnDownload = document.getElementById("btn-download");

  let currentSource = "user_story";
  let lastContent = "";
  let lastOutputFormat = "feature";
  let lastIssueKey = "";
  let lastGenerationSource = "";
  let parsedScenarios = [];

  // ── Tab Switching ──────────────────────────────────
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.source;
      currentSource = target;

      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      panels.forEach((p) => {
        p.classList.toggle("active", p.id === `panel-${target}`);
      });
    });
  });

  // ── Extra Instructions Toggle ──────────────────────
  document.querySelectorAll(".extra-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.nextElementSibling;
      const isOpen = body.classList.toggle("open");
      btn.textContent = isOpen
        ? "- Hide additional instructions"
        : "+ Add additional instructions";
    });
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

  // ── Syntax Highlighting (lightweight) ──────────────
  function highlightGherkin(text) {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(
      /(^|\n)(\s*)(Feature:|Scenario Outline:|Scenario:|Background:|Examples:|Given |When |Then |And |But |Rule:)/g,
      '$1$2<span class="keyword">$3</span>'
    );

    html = html.replace(/(^|\n)(\s*@[\w-]+)/g, '$1<span style="color:#ffd93d">$2</span>');
    html = html.replace(
      /("[^"]*")/g,
      '<span style="color:#51cf66">$1</span>'
    );
    html = html.replace(
      /(<[^>]+>)/g,
      '<span style="color:#00d4aa">$1</span>'
    );

    return html;
  }

  function highlightTestScenario(text) {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(
      /(^|\n)(Test Scenario Document|Scenario ID|Scenario Title|Priority|Type|Preconditions?|Test Steps?|Expected Results?|Test Data|Summary Table|Section\s*\d*):?/gi,
      '$1<span class="keyword">$2</span>:'
    );

    html = html.replace(
      /(TS-\d+)/g,
      '<span style="color:#ffd93d">$1</span>'
    );

    html = html.replace(
      /\b(High|Medium|Low)\b/g,
      '<span style="color:#00d4aa">$1</span>'
    );

    html = html.replace(
      /\b(Positive|Negative|Edge Case|Boundary)\b/gi,
      '<span style="color:#51cf66">$1</span>'
    );

    return html;
  }

  // ── Jira Preview ─────────────────────────────────────
  window.fetchJiraPreview = async function () {
    const issueKey = document.getElementById("jira-key").value.trim();
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

      const preview = document.getElementById("jira-preview");

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

      const subtasksSection = document.getElementById("jira-preview-subtasks-section");
      const subtasksList = document.getElementById("jira-preview-subtasks");
      subtasksList.innerHTML = "";
      if (data.subtasks && data.subtasks.length > 0) {
        data.subtasks.forEach((st) => {
          const li = document.createElement("li");
          li.innerHTML = `<strong>${st.key}</strong>: ${st.summary}`;
          subtasksList.appendChild(li);
        });
        subtasksSection.style.display = "block";
      } else {
        subtasksSection.style.display = "none";
      }

      preview.style.display = "block";
      preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast(`Loaded ${data.key} — ${data.summary}`);
    } catch (err) {
      hideSpinner();
      showToast(`Error: ${err.message}`, "error");
    }
  };

  window.closeJiraPreview = function () {
    document.getElementById("jira-preview").style.display = "none";
  };

  // ── Unified Generate Request ───────────────────────
  window.generateContent = async function (source, outputFormat) {
    const payload = { source, output_format: outputFormat };

    if (source === "user_story") {
      payload.story_text = document.getElementById("story-text").value.trim();
      payload.extra_instructions = document.getElementById("extra-user-story")?.value?.trim() || "";
      if (!payload.story_text) return showToast("Please enter a user story.", "error");
    } else if (source === "jira") {
      payload.issue_key = document.getElementById("jira-key").value.trim();
      payload.extra_instructions = document.getElementById("extra-jira")?.value?.trim() || "";
      if (!payload.issue_key) return showToast("Please enter a Jira issue key.", "error");
    } else if (source === "jira_jql") {
      payload.jql = document.getElementById("jira-jql").value.trim();
      payload.extra_instructions = document.getElementById("extra-jira-jql")?.value?.trim() || "";
      if (!payload.jql) return showToast("Please enter a JQL query.", "error");
    } else if (source === "confluence") {
      payload.page_url = document.getElementById("confluence-url").value.trim();
      payload.extra_instructions = document.getElementById("extra-confluence")?.value?.trim() || "";
      if (!payload.page_url) return showToast("Please enter a Confluence page URL or ID.", "error");
    } else if (source === "figma") {
      payload.figma_url = document.getElementById("figma-url").value.trim();
      payload.extra_instructions = document.getElementById("extra-figma")?.value?.trim() || "";
      if (!payload.figma_url) return showToast("Please enter a Figma file URL.", "error");
    } else if (source === "multi") {
      payload.story_text = document.getElementById("multi-story").value.trim();
      payload.jira_key = document.getElementById("multi-jira").value.trim();
      payload.confluence_url = document.getElementById("multi-confluence").value.trim();
      payload.figma_url = document.getElementById("multi-figma").value.trim();
      payload.extra_instructions = document.getElementById("extra-multi")?.value?.trim() || "";
      if (!payload.story_text && !payload.jira_key && !payload.confluence_url && !payload.figma_url) {
        return showToast("Please provide at least one source.", "error");
      }
    }

    const isScenario = outputFormat === "test_scenario";
    const label = isScenario ? "test scenario" : "BDD feature";
    showSpinner(`Generating ${label} file...`);

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      hideSpinner();

      if (!resp.ok) {
        showToast(data.error || "Generation failed.", "error");
        return;
      }

      lastContent = data.feature_content || "";
      lastOutputFormat = outputFormat;
      lastGenerationSource = source;

      if (source === "jira") {
        lastIssueKey = data.issue_key || payload.issue_key || "";
      } else if (source === "multi") {
        lastIssueKey = payload.jira_key || "";
      } else {
        lastIssueKey = "";
      }

      if (isScenario) {
        outputTitle.textContent = "Generated Test Scenario File";
        btnDownload.textContent = "Download .txt";
        featureOutput.innerHTML = highlightTestScenario(lastContent);
      } else {
        outputTitle.textContent = "Generated Feature File";
        btnDownload.textContent = "Download .feature";
        featureOutput.innerHTML = highlightGherkin(lastContent);
      }

      const pushResult = document.getElementById("push-jira-result");
      pushResult.style.display = "none";
      pushResult.innerHTML = "";

      outputSection.classList.add("visible");
      outputSection.scrollIntoView({ behavior: "smooth" });

      const badge = document.getElementById("status-badge");
      badge.className = "status-badge success";
      badge.textContent = `Saved: ${data.filepath || "output/"}`;

      showToast(`${isScenario ? "Test scenario" : "Feature"} file generated successfully!`);

      if (lastIssueKey) {
        parseAndShowScenarioCards(lastContent);
      } else {
        hideScenarioCards();
      }
    } catch (err) {
      hideSpinner();
      showToast(`Error: ${err.message}`, "error");
    }
  };

  // ── Copy ───────────────────────────────────────────
  window.copyOutput = function () {
    if (!lastContent) return;
    navigator.clipboard.writeText(lastContent).then(() => {
      showToast("Copied to clipboard!");
    });
  };

  // ── Download ───────────────────────────────────────
  window.downloadOutput = function () {
    if (!lastContent) return;
    const ext = lastOutputFormat === "test_scenario" ? ".txt" : ".feature";
    const filename = lastOutputFormat === "test_scenario" ? "test_scenarios" : "generated";
    const blob = new Blob([lastContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Download started!");
  };

  // ── Scenario Cards ─────────────────────────────────

  function hideScenarioCards() {
    document.getElementById("scenario-cards-section").style.display = "none";
    parsedScenarios = [];
  }

  function updateCardCount() {
    const active = parsedScenarios.filter((s) => !s._deleted);
    const el = document.getElementById("scenario-cards-count");
    el.textContent = `${active.length} of ${parsedScenarios.length} active`;

    const btn = document.getElementById("btn-push-jira");
    btn.disabled = active.length === 0;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderScenarioCards() {
    const list = document.getElementById("scenario-cards-list");
    list.innerHTML = "";

    parsedScenarios.forEach((sc, idx) => {
      const card = document.createElement("div");
      card.className = "sc-card" + (sc._deleted ? " sc-card--deleted" : "");
      card.dataset.index = idx;
      card.id = `sc-card-${idx}`;

      const titleText = escapeHtml(sc.title || `Test Case #${idx + 1}`);
      const descText = escapeHtml(sc.description || "");
      const idBadge = sc.id ? `<span class="sc-card-id">${escapeHtml(sc.id)}</span>` : "";

      card.innerHTML = `
        <div class="sc-card-header">
          <div class="sc-card-title-row">
            ${idBadge}
            <span class="sc-card-title" id="sc-title-${idx}">${titleText}</span>
          </div>
          <div class="sc-card-actions">
            ${sc._deleted ? `
              <button class="sc-btn sc-btn-restore" onclick="restoreScenario(${idx})" title="Restore">&#8634; Restore</button>
            ` : `
              <button class="sc-btn sc-btn-edit" onclick="toggleEditScenario(${idx})" title="Edit">&#9998; Edit</button>
              <button class="sc-btn sc-btn-delete" onclick="deleteScenario(${idx})" title="Delete">&#128465; Delete</button>
            `}
          </div>
        </div>
        <div class="sc-card-body" id="sc-body-${idx}">
          <pre class="sc-card-desc">${descText}</pre>
        </div>
        <div class="sc-card-edit" id="sc-edit-${idx}" style="display:none;">
          <label class="sc-edit-label">Title</label>
          <input type="text" class="sc-edit-title" id="sc-edit-title-${idx}" value="${escapeHtml(sc.title || "")}" />
          <label class="sc-edit-label">Description</label>
          <textarea class="sc-edit-desc" id="sc-edit-desc-${idx}">${escapeHtml(sc.description || "")}</textarea>
          <div class="sc-edit-actions">
            <button class="sc-btn sc-btn-save" onclick="saveScenarioEdit(${idx})">Save</button>
            <button class="sc-btn sc-btn-cancel" onclick="cancelScenarioEdit(${idx})">Cancel</button>
          </div>
        </div>
      `;

      list.appendChild(card);
    });

    updateCardCount();
  }

  async function parseAndShowScenarioCards(content) {
    try {
      const resp = await fetch("/api/parse-scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_content: content }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.scenarios || data.scenarios.length === 0) {
        hideScenarioCards();
        return;
      }

      parsedScenarios = data.scenarios.map((s) => ({ ...s, _deleted: false }));
      renderScenarioCards();

      const section = document.getElementById("scenario-cards-section");
      section.style.display = "block";

      const btn = document.getElementById("btn-push-jira");
      btn.disabled = false;
      btn.innerHTML = "&#128640; Push to Jira";

    } catch (err) {
      console.error("Failed to parse scenarios:", err);
      hideScenarioCards();
    }
  }

  window.toggleEditScenario = function (idx) {
    const body = document.getElementById(`sc-body-${idx}`);
    const edit = document.getElementById(`sc-edit-${idx}`);
    const isEditing = edit.style.display !== "none";

    if (isEditing) {
      edit.style.display = "none";
      body.style.display = "block";
    } else {
      document.getElementById(`sc-edit-title-${idx}`).value = parsedScenarios[idx].title || "";
      document.getElementById(`sc-edit-desc-${idx}`).value = parsedScenarios[idx].description || "";
      body.style.display = "none";
      edit.style.display = "block";
    }
  };

  window.saveScenarioEdit = function (idx) {
    const newTitle = document.getElementById(`sc-edit-title-${idx}`).value.trim();
    const newDesc = document.getElementById(`sc-edit-desc-${idx}`).value.trim();

    if (!newTitle) return showToast("Title cannot be empty.", "error");

    parsedScenarios[idx].title = newTitle;
    parsedScenarios[idx].description = newDesc;

    renderScenarioCards();
    showToast("Scenario updated.");
  };

  window.cancelScenarioEdit = function (idx) {
    document.getElementById(`sc-edit-${idx}`).style.display = "none";
    document.getElementById(`sc-body-${idx}`).style.display = "block";
  };

  window.deleteScenario = function (idx) {
    parsedScenarios[idx]._deleted = true;
    renderScenarioCards();

    const active = parsedScenarios.filter((s) => !s._deleted);
    showToast(`Scenario removed. ${active.length} remaining.`);
  };

  window.restoreScenario = function (idx) {
    parsedScenarios[idx]._deleted = false;
    renderScenarioCards();
    showToast("Scenario restored.");
  };

  // ── Push to Jira ──────────────────────────────────

  window.pushToJira = async function () {
    const activeScenarios = parsedScenarios.filter((s) => !s._deleted);

    if (!lastIssueKey) {
      return showToast("No Jira issue key available.", "error");
    }
    if (activeScenarios.length === 0) {
      return showToast("No active test cases to push. Restore or re-generate scenarios.", "error");
    }

    const btnPushJira = document.getElementById("btn-push-jira");
    const pushResult = document.getElementById("push-jira-result");
    btnPushJira.disabled = true;
    btnPushJira.innerHTML = "Uploading...";
    pushResult.style.display = "none";

    showSpinner(`Uploading ${activeScenarios.length} test case(s) to ${lastIssueKey}...`);

    const testCases = activeScenarios.map((s) => ({
      title: s.title,
      description: s.description,
    }));

    try {
      const resp = await fetch("/api/jira/push-testcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_key: lastIssueKey,
          test_cases: testCases,
        }),
      });

      const data = await resp.json();
      hideSpinner();

      if (!resp.ok) {
        btnPushJira.disabled = false;
        btnPushJira.innerHTML = "&#128640; Push to Jira";
        showToast(data.error || "Push to Jira failed.", "error");
        return;
      }

      btnPushJira.innerHTML = "\u2705 Pushed to Jira";

      let html = `<div class="push-result-header">`;
      html += `<strong>${data.success_count}</strong> of <strong>${data.total}</strong> test cases created as sub-tasks under `;
      html += `<span class="jira-preview-badge">${data.parent_key}</span>`;
      html += `</div>`;

      if (data.created && data.created.length > 0) {
        html += `<ul class="push-result-list">`;
        data.created.forEach((item) => {
          const jiraUrl = `${window.location.protocol}//kornferry.atlassian.net/browse/${item.key}`;
          html += `<li class="push-result-item push-result-item--success">`;
          html += `<span class="push-result-icon">\u2705</span>`;
          html += `<a href="${jiraUrl}" target="_blank" rel="noopener">${item.key}</a>`;
          html += ` \u2014 ${escapeHtml(item.summary)}`;
          html += `</li>`;
        });
        html += `</ul>`;
      }

      if (data.errors && data.errors.length > 0) {
        html += `<ul class="push-result-list">`;
        data.errors.forEach((item) => {
          html += `<li class="push-result-item push-result-item--error">`;
          html += `<span class="push-result-icon">\u274C</span>`;
          html += `${escapeHtml(item.title)} \u2014 <em>${escapeHtml(item.error)}</em>`;
          html += `</li>`;
        });
        html += `</ul>`;
      }

      pushResult.innerHTML = html;
      pushResult.style.display = "block";
      pushResult.scrollIntoView({ behavior: "smooth", block: "nearest" });

      showToast(`${data.success_count} test case(s) pushed to Jira!`);

    } catch (err) {
      hideSpinner();
      btnPushJira.disabled = false;
      btnPushJira.innerHTML = "&#128640; Push to Jira";
      showToast(`Error: ${err.message}`, "error");
    }
  };
});
