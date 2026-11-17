(() => {
  const apiBase = () => (window.SAMPLE_QC_API_BASE || "").replace(/\/$/, "");

  async function api(path, opts = {}) {
    const url = apiBase() + path;
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data && data.detail) || text || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  }

  const el = {
    health: document.getElementById("health"),
    form: document.getElementById("upload-form"),
    status: document.getElementById("form-status"),
    jobs: document.getElementById("jobs"),
    preview: document.getElementById("preview-frame"),
    gate: document.getElementById("gate"),
    refresh: document.getElementById("refresh-jobs"),
  };

  let selectedJob = null;
  let pollTimer = null;

  async function refreshHealth() {
    try {
      const h = await api("/api/health");
      el.health.textContent = `API OK · ${h.time} · auth ${h.dev_auth_bypass ? "dev-bypass" : "google"}`;
      el.health.className = "pill ok";
    } catch (e) {
      el.health.textContent = `API unreachable: ${e.message}. Set window.SAMPLE_QC_API_BASE in config.js`;
      el.health.className = "pill bad";
    }
  }

  function statusClass(s) {
    if (s === "succeeded") return "ok";
    if (s === "failed") return "bad";
    if (s === "running" || s === "queued") return "run";
    return "";
  }

  async function refreshJobs() {
    const data = await api("/api/jobs?limit=30");
    el.jobs.innerHTML = "";
    for (const j of data.jobs || []) {
      const li = document.createElement("li");
      li.className = "job" + (selectedJob === j.job_id ? " active" : "");
      li.innerHTML = `
        <div class="job-id">${j.job_id}</div>
        <div class="job-meta">
          <span>${j.order_id || "-"}</span>
          <span class="pill ${statusClass(j.status)}">${j.status}</span>
          <span>gate ${j.gate_pass === true ? "pass" : j.gate_pass === false ? "block" : "-"}</span>
        </div>`;
      li.onclick = () => selectJob(j.job_id);
      el.jobs.appendChild(li);
    }
  }

  async function selectJob(jobId) {
    selectedJob = jobId;
    await refreshJobs();
    const meta = await api(`/api/jobs/${jobId}`);
    el.gate.textContent = JSON.stringify(
      {
        status: meta.status,
        error: meta.error,
        intake: meta.intake,
        gate_pass: meta.gate_pass,
        delivered: meta.delivered,
      },
      null,
      2
    );
    if (meta.preview_available || meta.status === "succeeded") {
      el.preview.src = apiBase() + `/api/jobs/${jobId}/preview?t=${Date.now()}`;
    } else {
      el.preview.srcdoc = "<p style='font-family:sans-serif;padding:1rem'>Preview not ready.</p>";
    }
    if (meta.status === "queued" || meta.status === "running") {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => selectJob(jobId), 2500);
    }
  }

  el.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    el.status.textContent = "Uploading…";
    const fd = new FormData(el.form);
    try {
      const meta = await api("/api/jobs", { method: "POST", body: fd });
      el.status.textContent = `Created ${meta.job_id} (${meta.status})`;
      await refreshJobs();
      await selectJob(meta.job_id);
    } catch (e) {
      el.status.textContent = e.message;
    }
  });

  el.refresh.addEventListener("click", () => refreshJobs().catch(console.error));

  refreshHealth();
  refreshJobs().catch((e) => {
    el.jobs.innerHTML = `<li class="job">${e.message}</li>`;
  });
})();
