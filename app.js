(() => {
  const apiBase = () => (window.SAMPLE_QC_API_BASE || "").replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);

  const el = {
    health: $("health"),
    steps: $("steps"),
    dropzone: $("dropzone"),
    file: $("file"),
    pickFile: $("pick-file"),
    uploadStatus: $("upload-status"),
    jobs: $("jobs"),
    views: {
      upload: $("view-upload"),
      confirm: $("view-confirm"),
      images: $("view-images"),
      preview: $("view-preview"),
    },
    vendorRef: $("vendor-ref"),
    detectSummary: $("detect-summary"),
    confirmOrderId: $("confirm-order-id"),
    confirmSampleCount: $("confirm-sample-count"),
    confirmQcType: $("confirm-qc-type"),
    confirmProjectType: $("confirm-project-type"),
    confirmRun: $("confirm-run"),
    confirmStatus: $("confirm-status"),
    backUpload: $("back-upload"),
    backConfirm: $("back-confirm"),
    backImages: $("back-images"),
    imagesPanel: $("images-panel"),
    imagesStatus: $("images-status"),
    imgLightbox: $("img-lightbox"),
    imgLightboxImg: $("img-lightbox-img"),
    imgLightboxCaption: $("img-lightbox-caption"),
    imgLightboxClose: $("img-lightbox-close"),
    generateRun: $("generate-run"),
    jobTitle: $("job-title"),
    jobSummary: $("job-summary"),
    gatePanel: $("gate-panel"),
    preview: $("preview-frame"),
    download: $("download-job"),
    newJob: $("new-job"),
    editTitle: $("edit-title"),
    editConclusions: $("edit-conclusions"),
    saveEdits: $("save-edits"),
    editStatus: $("edit-status"),
  };

  const TYPE_ZH = {
    dna_long_read: "三代 DNA",
    dna_illumina: "二代 DNA",
    rna: "RNA",
    hic: "Hi-C 交联",
    library: "文库",
    generic: "通用",
  };
  const STATUS_ZH = {
    queued: "排队中",
    running: "处理中",
    awaiting_confirm: "待确认",
    awaiting_images: "待处理图片",
    images_pending: "图片待处理",
    succeeded: "已完成",
    failed: "失败",
  };

  let selectedJob = null;
  let selectedMeta = null;
  let pollTimer = null;
  let tableState = null;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node && k !== "list") node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {}, {
      "X-User-Role": "supply",
      "X-User-Email": "dev@local",
    });
    const res = await fetch(apiBase() + path, { ...opts, headers });
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

  function setStep(n) {
    el.steps.querySelectorAll(".step").forEach((node) => {
      const s = Number(node.dataset.step);
      node.classList.toggle("active", s === n);
      node.classList.toggle("done", s < n);
    });
  }

  function showView(name) {
    Object.entries(el.views).forEach(([k, node]) => {
      node.hidden = k !== name;
    });
  }

  function setPreviewLoading(msg) {
    el.preview.removeAttribute("src");
    el.preview.srcdoc = `<p style="font-family:sans-serif;padding:1.5rem;color:#5b6b62">${msg}</p>`;
  }

  function setPreviewUrl(jobId) {
    // srcdoc wins over src in browsers — must clear it or the loading text sticks forever.
    el.preview.removeAttribute("srcdoc");
    el.preview.src = apiBase() + `/api/jobs/${jobId}/preview?t=${Date.now()}`;
  }

  async function refreshHealth() {
    try {
      const hl = await api("/api/health");
      const missing = Object.entries(hl.deps || {})
        .filter(([k, v]) => !v && k !== "cursor_sdk")
        .map(([k]) => k);
      el.health.textContent = missing.length ? `缺依赖：${missing.join(", ")}` : "服务正常";
      el.health.className = "pill " + (missing.length ? "run" : "ok");
    } catch (e) {
      el.health.textContent = `无法连接：${e.message}`;
      el.health.className = "pill bad";
    }
  }

  async function refreshJobs() {
    const data = await api("/api/jobs?limit=8");
    el.jobs.replaceChildren();
    for (const j of data.jobs || []) {
      el.jobs.appendChild(
        h(
          "li",
          { class: "job", onclick: () => openJob(j.job_id) },
          h("strong", {}, j.order_id || j.job_id),
          " · ",
          STATUS_ZH[j.status] || j.status,
          " · ",
          j.source_filename || ""
        )
      );
    }
  }

  function fillConfirm(meta) {
    const it = meta.intake || {};
    const hints = meta.vendor_hints || {};
    const contracts = [...(hints.vendor_contract_ids || []), ...(hints.vendor_project_ids || [])].filter(Boolean);
    if (contracts.length) {
      el.vendorRef.hidden = false;
      el.vendorRef.replaceChildren(
        h("div", { class: "ref-title" }, "报告中读到的供应商编号（仅参考，勿当作本公司订单号）"),
        h("ul", {}, contracts.slice(0, 6).map((c) => h("li", {}, c)))
      );
    } else {
      el.vendorRef.hidden = true;
    }
    el.detectSummary.textContent = [
      it.qc_report_type && `识别类型：${TYPE_ZH[it.qc_report_type] || it.qc_report_type}`,
      it.vendor_family && `模板：${it.vendor_family}`,
      it.n_table_rows != null && `表格行数：${it.n_table_rows}`,
      it.sample_count && `样本数：${it.sample_count}（${it.sample_count_source || "自动"}）`,
      it.layout === "generic" && "通用版式，请加强预览",
    ]
      .filter(Boolean)
      .join(" · ");
    el.confirmOrderId.value = meta.order_id || "";
    el.confirmSampleCount.value = meta.sample_count || it.sample_count || "";
    el.confirmQcType.value = meta.qc_type || it.qc_report_type || "generic";
    el.confirmProjectType.value = meta.project_type || it.project_type || "";
    el.confirmStatus.textContent = "";
  }

  const PENDING = new Set(["needs_review", "needs_removal", "needs_crop"]);
  let cropState = null;

  function statusLabel(st) {
    if (st === "excluded") return "已排除（品牌/不要）";
    if (st === "cleared") return "已裁剪/净图 · 将纳入";
    if (st === "include") return "将纳入报告";
    if (st === "needs_crop") return "待裁剪（中文界面）";
    if (st === "needs_review" || st === "needs_removal") return "待去水印";
    return st;
  }

  function cropBoxString(img) {
    const sc = img.suggested_crop;
    if (sc && [sc.x0, sc.y0, sc.x1, sc.y1].every((n) => Number.isFinite(n))) {
      return [sc.x0, sc.y0, sc.x1, sc.y1].map((n) => Math.round(n)).join(",");
    }
    const [w, h] = img.pixel_size || [];
    if (w && h) {
      return [
        Math.round(w * 0.04),
        Math.round(h * 0.22),
        Math.round(w * 0.96),
        Math.round(h * 0.72),
      ].join(",");
    }
    return "10,10,100,100";
  }

  async function applySuggestedCrop(img) {
    await reviewImage(img.index, "crop", null, cropBoxString(img));
  }

  async function applySuggestedCropAll(imgs) {
    const todo = (imgs || []).filter((img) => img.status === "needs_crop");
    if (!todo.length) return;
    el.imagesStatus.textContent = `正在按建议裁剪 ${todo.length} 张…`;
    for (const img of todo) {
      await reviewImage(img.index, "crop", null, cropBoxString(img));
    }
  }

  function openImgLightbox(src, caption) {
    if (!el.imgLightbox || !el.imgLightboxImg || !src) return;
    el.imgLightboxImg.src = src;
    el.imgLightboxImg.alt = caption || "图片预览";
    if (el.imgLightboxCaption) {
      el.imgLightboxCaption.textContent = caption || "";
      el.imgLightboxCaption.hidden = !caption;
    }
    el.imgLightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeImgLightbox() {
    if (!el.imgLightbox) return;
    el.imgLightbox.hidden = true;
    if (el.imgLightboxImg) el.imgLightboxImg.removeAttribute("src");
    document.body.style.overflow = "";
  }

  function renderImages(data) {
    el.imagesPanel.replaceChildren();
    const imgs = data.images || [];
    if (!imgs.length) {
      el.imagesPanel.textContent = "未抽取到图片，可直接生成报告。";
      el.generateRun.disabled = false;
      el.imagesStatus.textContent = "";
      return;
    }
    let pending = 0;
    let included = 0;
    let needCrop = 0;
    const cropTargets = imgs.filter((img) => img.status === "needs_crop");
    if (cropTargets.length) {
      el.imagesPanel.appendChild(
        h(
          "div",
          { class: "img-toolbar" },
          h(
            "button",
            { type: "button", onclick: () => applySuggestedCropAll(imgs) },
            `全部按建议裁剪（${cropTargets.length}）`
          ),
          h(
            "span",
            { class: "muted small" },
            "去掉中文表头/页脚，只留电泳图；不满意再点「调整裁剪框」。"
          )
        )
      );
    }
    for (const img of imgs) {
      const st = img.status;
      if (PENDING.has(st)) pending += 1;
      if (st === "needs_crop") needCrop += 1;
      if (st === "include" || st === "cleared") included += 1;
      const src =
        apiBase() +
        `/api/jobs/${selectedJob}/images/${img.index}/file?processed=${st === "cleared"}&t=${Date.now()}`;
      const fileInput = h("input", { type: "file", accept: ".png,.jpg,.jpeg,.gif,.webp", class: "hidden" });
      fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) reviewImage(img.index, "replace", fileInput.files[0]);
      });
      const pillClass =
        st === "excluded" ? "" : st === "include" || st === "cleared" ? "ok" : PENDING.has(st) ? "bad" : "run";
      const actions = [];
      if (st === "needs_crop") {
        actions.push(h("button", { type: "button", class: "small", onclick: () => applySuggestedCrop(img) }, "按建议裁剪"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => openCrop(img) }, "调整裁剪框"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => fileInput.click() }, "上传净图"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "exclude") }, "排除"));
      } else if (st === "needs_review" || st === "needs_removal") {
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => fileInput.click() }, "上传净图"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => openCrop(img) }, "裁剪"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "exclude") }, "排除（报告中不要此图）"));
      } else if (st === "include") {
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "exclude") }, "排除"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => openCrop(img) }, "裁剪"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => fileInput.click() }, "换净图"));
      } else if (st === "cleared") {
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "exclude") }, "排除"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => openCrop(img) }, "重新裁剪"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "restore") }, "重置"));
      } else if (st === "excluded") {
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "restore") }, "恢复分类"));
        if (PENDING.has(img.classified_status) || img.role === "science_dirty") {
          actions.push(h("button", { type: "button", class: "secondary small", onclick: () => openCrop(img) }, "裁剪"));
          actions.push(h("button", { type: "button", class: "secondary small", onclick: () => fileInput.click() }, "上传净图"));
        }
      } else {
        actions.push(h("button", { type: "button", class: "small", onclick: () => openCrop(img) }, "裁剪"));
        actions.push(h("button", { type: "button", class: "secondary small", onclick: () => reviewImage(img.index, "exclude") }, "排除"));
      }
      actions.push(fileInput);
      const caption = `#${img.index} ${statusLabel(st)}${img.note ? " · " + img.note : ""}`;
      const thumb = h("img", {
        src,
        alt: `图 ${img.index}`,
        class: "thumb" + (st === "excluded" ? " excluded" : ""),
        title: "点击放大审核",
        tabindex: "0",
        role: "button",
        onclick: () => openImgLightbox(src, caption),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openImgLightbox(src, caption);
          }
        },
      });
      el.imagesPanel.appendChild(
        h(
          "div",
          { class: "img-row" },
          thumb,
          h(
            "div",
            { class: "img-meta" },
            h("div", {}, `#${img.index} `, h("span", { class: "pill " + pillClass }, statusLabel(st))),
            h("div", { class: "muted small" }, img.note || ""),
            h("div", { class: "muted small" }, "点击左侧缩略图可放大审核"),
            h("div", { class: "row-actions img-actions" }, ...actions)
          )
        )
      );
    }
    el.generateRun.disabled = false;
    el.imagesStatus.textContent = pending
      ? `将纳入 ${included} 张；另有 ${pending} 张待处理${needCrop ? `（其中 ${needCrop} 张待裁剪中文界面）` : ""}。可先预览，下载前须裁剪/上传净图或排除。`
      : `将纳入 ${included} 张科学图，可以生成英文报告。`;
  }

  function defaultCropBox(natW, natH) {
    // Portrait gel strip: keep most of the strip. Landscape / Bioanalyzer: trim chrome.
    const portrait = natH > natW * 1.05;
    if (portrait) {
      return {
        x0: Math.round(natW * 0.08),
        y0: Math.round(natH * 0.06),
        x1: Math.round(natW * 0.92),
        y1: Math.round(natH * 0.94),
      };
    }
    return {
      x0: Math.round(natW * 0.04),
      y0: Math.round(natH * 0.22),
      x1: Math.round(natW * 0.96),
      y1: Math.round(natH * 0.72),
    };
  }

  function openCrop(img) {
    const modal = $("crop-modal");
    const image = $("crop-image");
    const box = $("crop-box");
    const status = $("crop-status");
    if (!modal || !image || !box) return;
    status.textContent = "";
    const src =
      apiBase() +
      `/api/jobs/${selectedJob}/images/${img.index}/file?processed=false&t=${Date.now()}`;
    const nat = img.pixel_size || [];
    const suggested = img.suggested_crop || null;
    cropState = {
      index: img.index,
      natW: nat[0] || 0,
      natH: nat[1] || 0,
      suggested,
      scale: 1,
      box: null,
      mode: null,
      handle: null,
    };
    const place = () => {
      cropState.natW = image.naturalWidth || cropState.natW;
      cropState.natH = image.naturalHeight || cropState.natH;
      if (!cropState.natW || !image.clientWidth) {
        requestAnimationFrame(place);
        return;
      }
      const sc = suggested || defaultCropBox(cropState.natW, cropState.natH);
      setCropBoxNatural(sc);
      bindCropDrag();
    };
    image.onload = () => {
      // Wait until modal layout finishes (cached images fire onload before show).
      requestAnimationFrame(() => requestAnimationFrame(place));
    };
    modal.hidden = false;
    if (image.src === src && image.complete && image.naturalWidth) {
      requestAnimationFrame(() => requestAnimationFrame(place));
    } else {
      image.src = src;
    }
  }

  function setCropBoxNatural(sc) {
    const image = $("crop-image");
    const box = $("crop-box");
    if (!image.naturalWidth) return;
    const scale = image.clientWidth / image.naturalWidth;
    cropState.scale = scale;
    const x0 = Math.max(0, Math.min(sc.x0, cropState.natW - 2));
    const y0 = Math.max(0, Math.min(sc.y0, cropState.natH - 2));
    const x1 = Math.max(x0 + 2, Math.min(sc.x1, cropState.natW));
    const y1 = Math.max(y0 + 2, Math.min(sc.y1, cropState.natH));
    cropState.box = { x0, y0, x1, y1 };
    // Box is positioned inside .crop-frame (same box as the image), so no stage offset.
    box.style.left = x0 * scale + "px";
    box.style.top = y0 * scale + "px";
    box.style.width = (x1 - x0) * scale + "px";
    box.style.height = (y1 - y0) * scale + "px";
  }

  function bindCropDrag() {
    const box = $("crop-box");
    const MIN = 16;
    const onPointerDown = (e) => {
      if (!cropState || !cropState.box) return;
      const handle = e.target && e.target.dataset ? e.target.dataset.handle : null;
      e.preventDefault();
      e.stopPropagation();
      box.setPointerCapture?.(e.pointerId);
      cropState.mode = handle ? "resize" : "move";
      cropState.handle = handle || null;
      cropState.startX = e.clientX;
      cropState.startY = e.clientY;
      cropState.orig = { ...cropState.box };
    };
    const onPointerMove = (e) => {
      if (!cropState || !cropState.mode || !cropState.orig) return;
      const scale = cropState.scale || 1;
      if (scale <= 0) return;
      const dx = (e.clientX - cropState.startX) / scale;
      const dy = (e.clientY - cropState.startY) / scale;
      const o = cropState.orig;
      let { x0, y0, x1, y1 } = o;
      if (cropState.mode === "move") {
        const w = o.x1 - o.x0;
        const h = o.y1 - o.y0;
        x0 = Math.max(0, Math.min(cropState.natW - w, o.x0 + dx));
        y0 = Math.max(0, Math.min(cropState.natH - h, o.y0 + dy));
        x1 = x0 + w;
        y1 = y0 + h;
      } else {
        const hdl = cropState.handle;
        if (hdl.includes("w")) x0 = Math.max(0, Math.min(o.x1 - MIN, o.x0 + dx));
        if (hdl.includes("e")) x1 = Math.min(cropState.natW, Math.max(o.x0 + MIN, o.x1 + dx));
        if (hdl.includes("n")) y0 = Math.max(0, Math.min(o.y1 - MIN, o.y0 + dy));
        if (hdl.includes("s")) y1 = Math.min(cropState.natH, Math.max(o.y0 + MIN, o.y1 + dy));
      }
      setCropBoxNatural({ x0, y0, x1, y1 });
    };
    const onPointerUp = () => {
      if (!cropState) return;
      cropState.mode = null;
      cropState.handle = null;
      cropState.orig = null;
    };
    box.onpointerdown = onPointerDown;
    window.onpointermove = onPointerMove;
    window.onpointerup = onPointerUp;
    window.onpointercancel = onPointerUp;
  }

  async function applyCrop() {
    if (!cropState || !cropState.box) return;
    const b = cropState.box;
    const crop = [Math.round(b.x0), Math.round(b.y0), Math.round(b.x1), Math.round(b.y1)].join(",");
    $("crop-status").textContent = "裁剪中…";
    try {
      await reviewImage(cropState.index, "crop", null, crop);
      $("crop-modal").hidden = true;
    } catch (e) {
      $("crop-status").textContent = e.message;
    }
  }

  async function reviewImage(index, action, file, crop) {
    const fd = new FormData();
    fd.append("action", action);
    if (file) fd.append("file", file);
    if (crop) fd.append("crop", crop);
    el.imagesStatus.textContent = "处理中…";
    try {
      const res = await api(`/api/jobs/${selectedJob}/images/${index}`, { method: "POST", body: fd });
      renderImages(res);
      if (selectedMeta && (selectedMeta.status === "succeeded" || selectedMeta.status === "images_pending")) {
        await openJob(selectedJob);
      }
    } catch (e) {
      el.imagesStatus.textContent = e.message;
      throw e;
    }
  }

  function renderGate(gate) {
    el.gatePanel.replaceChildren();
    if (!gate || !gate.ready) return;
    el.gatePanel.appendChild(
      h("div", { class: "gate-head " + (gate.pass ? "ok" : "bad") }, gate.pass ? "门禁已通过，可以下载" : "门禁未通过，暂不可下载")
    );
    const labels = {
      table_fail: "结果表",
      zero_tamper_fail: "数值一致性",
      identity_hits: "供应商身份残留",
      chinese_residual: "中文残留",
      watermark_blocks: "图片待处理",
    };
    for (const c of gate.checks || []) {
      if (c.ok) continue;
      el.gatePanel.appendChild(
        h(
          "details",
          { class: "gate-row bad", open: true },
          h("summary", {}, `✗ ${labels[c.key] || c.label}（${c.count}）`),
          c.items.length ? h("ul", {}, c.items.slice(0, 8).map((x) => h("li", {}, x))) : null
        )
      );
    }
  }

  function renderEditPanel(table) {
    tableState = table;
    el.editConclusions.replaceChildren();
    const editable = table.editable_fields || [];
    if (!table.rows?.length || !editable.length) {
      el.editConclusions.textContent = "本表无可编辑结论列。";
      return;
    }
    table.rows.forEach((row, idx) => {
      const label = [row["Sample Name"], row["Sample ID"]].filter(Boolean).join(" / ");
      const block = h("div", { class: "concl-row" }, h("div", { class: "concl-title" }, `#${idx + 1} ${label}`));
      for (const field of editable) {
        const input = h("input", { type: "text", value: row[field] || "" });
        input.dataset.row = String(idx);
        input.dataset.field = field;
        input.dataset.orig = row[field] || "";
        block.appendChild(h("label", {}, field, input));
      }
      el.editConclusions.appendChild(block);
    });
  }

  async function loadPreviewExtras(jobId) {
    try {
      const table = await api(`/api/jobs/${jobId}/table`);
      renderEditPanel(table);
    } catch (e) {
      el.editConclusions.textContent = e.message;
    }
    el.editStatus.textContent = "";
  }

  async function openJob(jobId) {
    clearTimeout(pollTimer);
    selectedJob = jobId;
    const meta = await api(`/api/jobs/${jobId}`);
    selectedMeta = meta;
    const running = meta.status === "queued" || meta.status === "running";

    if (meta.status === "awaiting_confirm") {
      setStep(2);
      showView("confirm");
      fillConfirm(meta);
    } else if (meta.status === "awaiting_images") {
      setStep(3);
      showView("images");
      const images = await api(`/api/jobs/${jobId}/images`);
      renderImages(images);
    } else if (meta.status === "succeeded" || meta.status === "images_pending") {
      setStep(4);
      showView("preview");
      el.jobTitle.textContent = `预览 · ${meta.order_id || jobId}`;
      const it = meta.intake || {};
      el.jobSummary.textContent = [
        STATUS_ZH[meta.status],
        it.qc_report_type && TYPE_ZH[it.qc_report_type],
        it.n_table_rows != null && `${it.n_table_rows} 行`,
      ]
        .filter(Boolean)
        .join(" · ");
      el.download.disabled = !meta.gate_pass;
      setPreviewUrl(jobId);
      renderGate(await api(`/api/jobs/${jobId}/gate`).catch(() => null));
      await loadPreviewExtras(jobId);
    } else if (running) {
      const phase = meta.phase || "";
      if (phase === "intake") {
        setStep(2);
        showView("confirm");
        el.confirmStatus.textContent = "正在识别报告，请稍候…";
      } else if (phase === "assets") {
        setStep(3);
        showView("images");
        el.imagesStatus.textContent = "正在抽取表格与图片…";
      } else {
        setStep(4);
        showView("preview");
        setPreviewLoading("正在生成报告，请稍候…");
      }
    } else if (meta.status === "failed") {
      setStep(1);
      showView("upload");
      el.uploadStatus.textContent = `任务失败：${meta.error || "未知错误"}`;
    } else {
      setStep(1);
      showView("upload");
    }

    if (running) pollTimer = setTimeout(() => openJob(jobId).catch(console.error), 2000);
    refreshJobs().catch(() => {});
  }

  async function uploadFile(file) {
    if (!file) return;
    el.uploadStatus.textContent = `正在上传 ${file.name}…`;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("run_now", "false");
    try {
      const meta = await api("/api/jobs", { method: "POST", body: fd });
      el.uploadStatus.textContent = "上传成功，正在识别报告…";
      await openJob(meta.job_id);
    } catch (e) {
      el.uploadStatus.textContent = e.message;
    }
  }

  el.pickFile.addEventListener("click", () => el.file.click());
  el.file.addEventListener("change", () => uploadFile(el.file.files[0]));
  el.dropzone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    el.dropzone.classList.add("drag");
  });
  el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("drag"));
  el.dropzone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    el.dropzone.classList.remove("drag");
    const f = ev.dataTransfer.files[0];
    if (f) uploadFile(f);
  });

  el.confirmRun.addEventListener("click", async () => {
    if (!selectedJob) return;
    el.confirmStatus.textContent = "提交中…";
    try {
      const body = {
        order_id: el.confirmOrderId.value.trim(),
        qc_type: el.confirmQcType.value,
        project_type: el.confirmProjectType.value.trim(),
      };
      if (el.confirmSampleCount.value) body.sample_count = Number(el.confirmSampleCount.value);
      await api(`/api/jobs/${selectedJob}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      el.confirmStatus.textContent = "正在抽取表格与图片…";
      await openJob(selectedJob);
    } catch (e) {
      el.confirmStatus.textContent = e.message;
    }
  });

  el.generateRun.addEventListener("click", async () => {
    if (!selectedJob) return;
    el.imagesStatus.textContent = "正在生成英文报告…";
    try {
      const res = await api(`/api/jobs/${selectedJob}/generate`, { method: "POST" });
      if (res.warning) el.imagesStatus.textContent = res.warning;
      await openJob(selectedJob);
    } catch (e) {
      el.imagesStatus.textContent = e.message;
    }
  });

  el.saveEdits.addEventListener("click", async () => {
    if (!selectedJob) return;
    el.editStatus.textContent = "保存中…";
    try {
      const title = el.editTitle.value.trim();
      if (title) {
        await api(`/api/jobs/${selectedJob}/revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: `标题改成 ${title}` }),
        });
      }
      if (tableState) {
        const edits = [...el.editConclusions.querySelectorAll("input[data-field]")]
          .filter((inp) => inp.value !== inp.dataset.orig)
          .map((inp) => ({ row_index: Number(inp.dataset.row), field: inp.dataset.field, value: inp.value }));
        if (edits.length) {
          await api(`/api/jobs/${selectedJob}/conclusions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ edits }),
          });
        }
      }
      el.editStatus.textContent = "已保存，正在刷新预览…";
      await openJob(selectedJob);
      el.editStatus.textContent = "预览已更新。";
    } catch (e) {
      el.editStatus.textContent = e.message;
    }
  });

  el.backUpload.addEventListener("click", () => {
    setStep(1);
    showView("upload");
  });
  el.backConfirm.addEventListener("click", () => openJob(selectedJob));
  el.backImages.addEventListener("click", async () => {
    if (!selectedJob) return;
    setStep(3);
    showView("images");
    renderImages(await api(`/api/jobs/${selectedJob}/images`));
  });
  el.newJob.addEventListener("click", () => {
    selectedJob = null;
    selectedMeta = null;
    el.file.value = "";
    el.uploadStatus.textContent = "";
    el.editTitle.value = "";
    setStep(1);
    showView("upload");
    refreshJobs();
  });
  el.download.addEventListener("click", () => {
    if (selectedJob && selectedMeta?.gate_pass) {
      window.open(apiBase() + `/api/jobs/${selectedJob}/download`, "_blank");
    }
  });

  $("crop-cancel")?.addEventListener("click", () => {
    $("crop-modal").hidden = true;
  });
  $("crop-reset")?.addEventListener("click", () => {
    if (!cropState) return;
    const sc = cropState.suggested || defaultCropBox(cropState.natW, cropState.natH);
    setCropBoxNatural(sc);
  });
  $("crop-apply")?.addEventListener("click", () => {
    applyCrop().catch(() => {});
  });

  el.imgLightboxClose?.addEventListener("click", closeImgLightbox);
  el.imgLightboxImg?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeImgLightbox();
  });
  el.imgLightbox?.addEventListener("click", (e) => {
    if (e.target === el.imgLightbox) closeImgLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.imgLightbox && !el.imgLightbox.hidden) closeImgLightbox();
  });

  setStep(1);
  showView("upload");
  refreshHealth();
  refreshJobs().catch((e) => {
    el.jobs.replaceChildren(h("li", {}, e.message));
  });
})();
