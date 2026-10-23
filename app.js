/* =========================================================
   FaceTrack AI — Core Application Logic
   =========================================================
   Uses face-api.js for browser-based face detection &
   recognition. All data persisted in localStorage.
   ========================================================= */

(() => {
    "use strict";

    /* ===================== STATE ===================== */
    const STATE = {
        modelsLoaded: false,
        cameraStream: null,
        recognitionRunning: false,
        recognitionInterval: null,
        registerStream: null,
        capturedDescriptors: [],
        registeredPeople: JSON.parse(localStorage.getItem("ft_people") || "[]"),
        attendanceLog: JSON.parse(localStorage.getItem("ft_attendance") || "[]"),
        todayCheckedIn: new Set(),
        faceMatcher: null,
    };

    /* ===================== DOM REFS ===================== */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const DOM = {
        loadingOverlay: $("#loading-overlay"),
        loaderBar: $("#loader-bar"),
        sidebar: $("#sidebar"),
        sidebarToggle: $("#sidebar-toggle"),
        navBtns: $$(".nav-btn"),
        pageTitle: $("#page-title"),
        clock: $("#live-clock"),
        aiStatusDot: $("#ai-status-dot"),
        aiStatusText: $("#ai-status-text"),

        /* Dashboard */
        statTotalPeople: $("#stat-total-people"),
        statPresentToday: $("#stat-present-today"),
        statLastCheckin: $("#stat-last-checkin"),
        statAccuracy: $("#stat-accuracy"),
        recentActivityList: $("#recent-activity-list"),
        weeklyChart: $("#weekly-chart"),
        activityBadge: $("#activity-live-badge"),

        /* Camera */
        videoFeed: $("#video-feed"),
        overlayCanvas: $("#overlay-canvas"),
        cameraPlaceholder: $("#camera-placeholder"),
        scanLine: $("#scan-line"),
        btnStartCamera: $("#btn-start-camera"),
        btnStopCamera: $("#btn-stop-camera"),
        btnToggleRecognition: $("#btn-toggle-recognition"),
        faceCountBadge: $("#face-count-badge"),
        detectedFacesList: $("#detected-faces-list"),

        /* Register */
        registerVideo: $("#register-video"),
        registerOverlay: $("#register-overlay"),
        registerPlaceholder: $("#register-camera-placeholder"),
        regName: $("#reg-name"),
        regId: $("#reg-id"),
        regDepartment: $("#reg-department"),
        sampleCount: $("#sample-count"),
        sampleBar: $("#sample-bar"),
        btnStartRegisterCam: $("#btn-start-register-cam"),
        btnCaptureFace: $("#btn-capture-face"),
        btnSavePerson: $("#btn-save-person"),
        registerForm: $("#register-form"),

        /* Attendance */
        attendanceDateFilter: $("#attendance-date-filter"),
        btnExportExcel: $("#btn-export-excel"),
        btnClearAttendance: $("#btn-clear-attendance"),
        attendanceTbody: $("#attendance-tbody"),
        attendanceEmpty: $("#attendance-empty"),

        /* People */
        peopleGrid: $("#people-grid"),
        peopleEmpty: $("#people-empty"),
        btnClearPeople: $("#btn-clear-people"),

        /* Modal */
        confirmModal: $("#confirm-modal"),
        confirmTitle: $("#confirm-title"),
        confirmMessage: $("#confirm-message"),
        confirmCancel: $("#confirm-cancel"),
        confirmOk: $("#confirm-ok"),

        /* Toast */
        toastContainer: $("#toast-container"),
    };

    /* ===================== UTILITIES ===================== */
    function toast(message, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.textContent = message;
        DOM.toastContainer.appendChild(el);
        setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3500);
    }

    function confirm(title, message) {
        return new Promise((resolve) => {
            DOM.confirmTitle.textContent = title;
            DOM.confirmMessage.textContent = message;
            DOM.confirmModal.classList.remove("hidden");
            const cleanup = () => DOM.confirmModal.classList.add("hidden");
            DOM.confirmCancel.onclick = () => { cleanup(); resolve(false); };
            DOM.confirmOk.onclick = () => { cleanup(); resolve(true); };
        });
    }

    function timeStr(date = new Date()) {
        return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    }
    function dateStr(date = new Date()) {
        return date.toISOString().split("T")[0];
    }
    function todayLabel() {
        return new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }

    function persistPeople() { localStorage.setItem("ft_people", JSON.stringify(STATE.registeredPeople)); }
    function persistAttendance() { localStorage.setItem("ft_attendance", JSON.stringify(STATE.attendanceLog)); }

    /* ===================== CLOCK ===================== */
    function tickClock() {
        DOM.clock.textContent = timeStr();
    }
    setInterval(tickClock, 1000);
    tickClock();

    /* ===================== NAVIGATION ===================== */
    const sectionTitles = { dashboard: "Dashboard", camera: "Live Camera", register: "Register Face", attendance: "Attendance Log", people: "Registered People" };

    function switchSection(name) {
        $$(".section").forEach((s) => s.classList.remove("active"));
        $(`#section-${name}`).classList.add("active");
        DOM.navBtns.forEach((b) => b.classList.toggle("active", b.dataset.section === name));
        DOM.pageTitle.textContent = sectionTitles[name] || name;

        if (name === "dashboard") refreshDashboard();
        if (name === "attendance") renderAttendanceTable();
        if (name === "people") renderPeopleGrid();
    }

    DOM.navBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            switchSection(btn.dataset.section);
            if (window.innerWidth <= 768) DOM.sidebar.classList.remove("open");
        })
    );
    DOM.sidebarToggle.addEventListener("click", () => DOM.sidebar.classList.toggle("open"));

    /* ===================== LOAD MODELS ===================== */
    async function loadModels() {
        DOM.aiStatusDot.className = "status-dot loading";
        DOM.aiStatusText.textContent = "Loading models…";
        const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/";
        const steps = [
            () => faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            () => faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            () => faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            () => faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        ];
        for (let i = 0; i < steps.length; i++) {
            await steps[i]();
            DOM.loaderBar.style.width = `${((i + 1) / steps.length) * 100}%`;
        }
        STATE.modelsLoaded = true;
        DOM.aiStatusDot.className = "status-dot online";
        DOM.aiStatusText.textContent = "AI Ready";
        DOM.loadingOverlay.classList.add("hidden");
        buildFaceMatcher();
        toast("AI models loaded successfully!", "success");
    }

    /* ===================== FACE MATCHER ===================== */
    function buildFaceMatcher() {
        if (STATE.registeredPeople.length === 0) { STATE.faceMatcher = null; return; }
        const labeledDescriptors = STATE.registeredPeople.map((p) => {
            const descs = p.descriptors.map((d) => new Float32Array(d));
            return new faceapi.LabeledFaceDescriptors(p.name, descs);
        });
        STATE.faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5);
    }

    /* ===================== CAMERA ===================== */
    async function startCamera(videoEl, placeholderEl) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
            videoEl.srcObject = stream;
            videoEl.classList.add("active");
            if (placeholderEl) placeholderEl.classList.add("hidden");
            return stream;
        } catch (err) {
            toast("Camera access denied. Please allow camera permissions.", "error");
            throw err;
        }
    }

    function stopStream(stream) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
    }

    /* -- Main camera -- */
    DOM.btnStartCamera.addEventListener("click", async () => {
        if (!STATE.modelsLoaded) { toast("Models still loading, please wait…", "warning"); return; }
        try {
            STATE.cameraStream = await startCamera(DOM.videoFeed, DOM.cameraPlaceholder);
            DOM.btnStartCamera.disabled = true;
            DOM.btnStopCamera.disabled = false;
            DOM.btnToggleRecognition.disabled = false;
            toast("Camera started.", "info");
        } catch (_) { /* handled */ }
    });

    DOM.btnStopCamera.addEventListener("click", () => {
        stopRecognition();
        stopStream(STATE.cameraStream);
        STATE.cameraStream = null;
        DOM.videoFeed.srcObject = null;
        DOM.videoFeed.classList.remove("active");
        DOM.cameraPlaceholder.classList.remove("hidden");
        DOM.btnStartCamera.disabled = false;
        DOM.btnStopCamera.disabled = true;
        DOM.btnToggleRecognition.disabled = true;
        clearCanvas(DOM.overlayCanvas);
        toast("Camera stopped.", "info");
    });

    /* -- Recognition -- */
    DOM.btnToggleRecognition.addEventListener("click", () => {
        if (STATE.recognitionRunning) {
            stopRecognition();
        } else {
            startRecognition();
        }
    });

    function startRecognition() {
        if (!STATE.cameraStream) return;
        STATE.recognitionRunning = true;
        DOM.btnToggleRecognition.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop Recognition`;
        DOM.scanLine.classList.add("active");
        runDetectionLoop();
        toast("Face recognition started!", "success");
    }

    function stopRecognition() {
        STATE.recognitionRunning = false;
        if (STATE.recognitionInterval) { clearTimeout(STATE.recognitionInterval); STATE.recognitionInterval = null; }
        DOM.btnToggleRecognition.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 15c1.333 1.333 2.667 2 4 2s2.667-.667 4-2"/></svg> Start Recognition`;
        DOM.scanLine.classList.remove("active");
        clearCanvas(DOM.overlayCanvas);
        DOM.faceCountBadge.textContent = "0";
    }

    async function runDetectionLoop() {
        if (!STATE.recognitionRunning) return;
        const video = DOM.videoFeed;
        if (video.readyState < 2) { STATE.recognitionInterval = setTimeout(runDetectionLoop, 200); return; }

        const detections = await faceapi
            .detectAllFaces(video)
            .withFaceLandmarks()
            .withFaceDescriptors()
            .withFaceExpressions();

        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(DOM.overlayCanvas, displaySize);
        const resized = faceapi.resizeResults(detections, displaySize);

        clearCanvas(DOM.overlayCanvas);
        const ctx = DOM.overlayCanvas.getContext("2d");

        DOM.faceCountBadge.textContent = resized.length;

        const detectedItems = [];

        resized.forEach((det) => {
            const box = det.detection.box;
            let label = "Unknown";
            let confidence = det.detection.score;
            let matchDistance = 1;

            if (STATE.faceMatcher) {
                const match = STATE.faceMatcher.findBestMatch(det.descriptor);
                if (match.label !== "unknown") {
                    label = match.label;
                    matchDistance = match.distance;
                    markAttendance(label, 1 - matchDistance);
                }
            }

            /* Draw box */
            const color = label === "Unknown" ? "#ef4444" : "#22c55e";
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            /* Draw corners */
            const cornerLen = 14;
            ctx.lineWidth = 3;
            ctx.strokeStyle = color;
            /* top-left */
            ctx.beginPath(); ctx.moveTo(box.x, box.y + cornerLen); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + cornerLen, box.y); ctx.stroke();
            /* top-right */
            ctx.beginPath(); ctx.moveTo(box.x + box.width - cornerLen, box.y); ctx.lineTo(box.x + box.width, box.y); ctx.lineTo(box.x + box.width, box.y + cornerLen); ctx.stroke();
            /* bottom-left */
            ctx.beginPath(); ctx.moveTo(box.x, box.y + box.height - cornerLen); ctx.lineTo(box.x, box.y + box.height); ctx.lineTo(box.x + cornerLen, box.y + box.height); ctx.stroke();
            /* bottom-right */
            ctx.beginPath(); ctx.moveTo(box.x + box.width - cornerLen, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height - cornerLen); ctx.stroke();

            /* Label bg */
            const text = `${label} (${(confidence * 100).toFixed(0)}%)`;
            ctx.font = "bold 13px Inter, sans-serif";
            const textW = ctx.measureText(text).width + 16;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(box.x, box.y - 28, textW, 24, 4);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.fillText(text, box.x + 8, box.y - 11);

            detectedItems.push({ label, confidence, matchDistance });
        });

        renderDetectedPanel(detectedItems);

        STATE.recognitionInterval = setTimeout(runDetectionLoop, 150);
    }

    function clearCanvas(canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function renderDetectedPanel(items) {
        if (items.length === 0) {
            DOM.detectedFacesList.innerHTML = `<div class="empty-state small"><p>No faces detected yet.</p></div>`;
            return;
        }
        DOM.detectedFacesList.innerHTML = items.map((item) => {
            const conf = ((1 - item.matchDistance) * 100).toFixed(0);
            const initial = item.label === "Unknown" ? "?" : item.label.charAt(0).toUpperCase();
            return `
                <div class="detected-face-item">
                    <div class="face-thumb">${initial}</div>
                    <div class="face-info">
                        <div class="name">${item.label}</div>
                        <div class="meta">Confidence: ${conf}%</div>
                        <div class="confidence-bar"><div class="confidence-fill" style="width:${conf}%;background:${item.label === "Unknown" ? "var(--accent-red)" : "var(--accent-green)"}"></div></div>
                    </div>
                </div>`;
        }).join("");
    }

    /* ===================== ATTENDANCE ===================== */
    function markAttendance(name, confidence) {
        const today = dateStr();
        const key = `${name}_${today}`;
        if (STATE.todayCheckedIn.has(key)) return;
        STATE.todayCheckedIn.add(key);

        const person = STATE.registeredPeople.find((p) => p.name === name);
        const entry = {
            name,
            id: person ? person.id : "",
            department: person ? person.department : "",
            date: today,
            time: timeStr(),
            confidence: (confidence * 100).toFixed(1),
            status: new Date().getHours() < 10 ? "Present" : "Late",
        };
        STATE.attendanceLog.unshift(entry);
        persistAttendance();
        addRecentActivity(entry);
        updateDashboardStats();
        toast(`✅ ${name} checked in!`, "success");
    }

    /* ===================== REGISTER ===================== */
    DOM.btnStartRegisterCam.addEventListener("click", async () => {
        if (!STATE.modelsLoaded) { toast("Models still loading…", "warning"); return; }
        try {
            STATE.registerStream = await startCamera(DOM.registerVideo, DOM.registerPlaceholder);
            DOM.btnStartRegisterCam.disabled = true;
            DOM.btnCaptureFace.disabled = false;
        } catch (_) { /* handled */ }
    });

    DOM.btnCaptureFace.addEventListener("click", async () => {
        const video = DOM.registerVideo;
        if (video.readyState < 2) { toast("Camera not ready yet.", "warning"); return; }
        const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
        if (!detection) { toast("No face detected. Please position your face clearly.", "warning"); return; }

        STATE.capturedDescriptors.push(Array.from(detection.descriptor));
        const count = STATE.capturedDescriptors.length;
        DOM.sampleCount.textContent = count;
        DOM.sampleBar.style.width = `${(count / 5) * 100}%`;

        /* Flash overlay */
        const ctx = DOM.registerOverlay.getContext("2d");
        const w = video.videoWidth, h = video.videoHeight;
        DOM.registerOverlay.width = w; DOM.registerOverlay.height = h;
        ctx.fillStyle = "rgba(59,130,246,0.2)";
        ctx.fillRect(0, 0, w, h);
        setTimeout(() => ctx.clearRect(0, 0, w, h), 200);

        toast(`Sample ${count}/5 captured`, "info");

        if (count >= 5) {
            DOM.btnSavePerson.disabled = false;
            toast("All samples captured! You can save now or capture more.", "success");
        }
    });

    DOM.registerForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = DOM.regName.value.trim();
        if (!name) { toast("Please enter a name.", "error"); return; }
        if (STATE.capturedDescriptors.length < 1) { toast("Please capture at least one face sample.", "error"); return; }

        /* Capture thumbnail from video */
        let thumbnail = null;
        try {
            const canvas = document.createElement("canvas");
            canvas.width = 100; canvas.height = 100;
            const ctx = canvas.getContext("2d");
            const v = DOM.registerVideo;
            const size = Math.min(v.videoWidth, v.videoHeight);
            const sx = (v.videoWidth - size) / 2, sy = (v.videoHeight - size) / 2;
            ctx.drawImage(v, sx, sy, size, size, 0, 0, 100, 100);
            thumbnail = canvas.toDataURL("image/jpeg", 0.6);
        } catch (_) { /* fallback */ }

        const person = {
            name,
            id: DOM.regId.value.trim(),
            department: DOM.regDepartment.value.trim(),
            descriptors: STATE.capturedDescriptors,
            thumbnail,
            createdAt: new Date().toISOString(),
        };

        STATE.registeredPeople.push(person);
        persistPeople();
        buildFaceMatcher();

        /* Reset form */
        STATE.capturedDescriptors = [];
        DOM.registerForm.reset();
        DOM.sampleCount.textContent = "0";
        DOM.sampleBar.style.width = "0%";
        DOM.btnSavePerson.disabled = true;
        DOM.btnCaptureFace.disabled = true;
        DOM.btnStartRegisterCam.disabled = false;
        stopStream(STATE.registerStream);
        STATE.registerStream = null;
        DOM.registerVideo.srcObject = null;
        DOM.registerVideo.classList.remove("active");
        DOM.registerPlaceholder.classList.remove("hidden");

        updateDashboardStats();
        toast(`🎉 ${name} registered successfully!`, "success");
    });

    /* ===================== ATTENDANCE TABLE ===================== */
    function renderAttendanceTable() {
        let records = [...STATE.attendanceLog];
        const filterDate = DOM.attendanceDateFilter.value;
        if (filterDate) records = records.filter((r) => r.date === filterDate);

        if (records.length === 0) {
            DOM.attendanceTbody.innerHTML = "";
            DOM.attendanceEmpty.style.display = "";
            return;
        }
        DOM.attendanceEmpty.style.display = "none";
        DOM.attendanceTbody.innerHTML = records.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${r.name}</td>
                <td>${r.id || "—"}</td>
                <td>${r.department || "—"}</td>
                <td>${r.date}</td>
                <td>${r.time}</td>
                <td>${r.confidence}%</td>
                <td class="${r.status === "Present" ? "status-present" : "status-late"}">${r.status}</td>
            </tr>`).join("");
    }

    DOM.attendanceDateFilter.addEventListener("change", renderAttendanceTable);

    DOM.btnExportExcel.addEventListener("click", () => {
        if (STATE.attendanceLog.length === 0) { toast("No data to export.", "warning"); return; }
        const ws = XLSX.utils.json_to_sheet(STATE.attendanceLog.map((r, i) => ({
            "#": i + 1, Name: r.name, ID: r.id, Department: r.department, Date: r.date, "Check-in Time": r.time, "Confidence (%)": r.confidence, Status: r.status,
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance");
        XLSX.writeFile(wb, `FaceTrack_Attendance_${dateStr()}.xlsx`);
        toast("Excel file downloaded!", "success");
    });

    DOM.btnClearAttendance.addEventListener("click", async () => {
        if (await confirm("Clear Attendance", "This will delete all attendance records. Continue?")) {
            STATE.attendanceLog = [];
            STATE.todayCheckedIn.clear();
            persistAttendance();
            renderAttendanceTable();
            updateDashboardStats();
            toast("Attendance records cleared.", "info");
        }
    });

    /* ===================== PEOPLE ===================== */
    function renderPeopleGrid() {
        if (STATE.registeredPeople.length === 0) {
            DOM.peopleGrid.innerHTML = "";
            DOM.peopleGrid.appendChild(DOM.peopleEmpty);
            DOM.peopleEmpty.style.display = "";
            return;
        }
        DOM.peopleEmpty.style.display = "none";
        DOM.peopleGrid.innerHTML = STATE.registeredPeople.map((p, i) => {
            const initial = p.name.charAt(0).toUpperCase();
            const thumb = p.thumbnail ? `<img src="${p.thumbnail}" alt="${p.name}">` : initial;
            return `
                <div class="person-card" data-index="${i}">
                    <button class="person-delete" data-index="${i}" title="Remove" aria-label="Remove ${p.name}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div class="person-avatar">${thumb}</div>
                    <div class="person-name">${p.name}</div>
                    <div class="person-meta">${p.id || ""} ${p.department ? "· " + p.department : ""}</div>
                    <div class="person-meta">${p.descriptors.length} samples</div>
                </div>`;
        }).join("");

        DOM.peopleGrid.querySelectorAll(".person-delete").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                const name = STATE.registeredPeople[idx].name;
                if (await confirm("Remove Person", `Remove "${name}" from the system?`)) {
                    STATE.registeredPeople.splice(idx, 1);
                    persistPeople();
                    buildFaceMatcher();
                    renderPeopleGrid();
                    updateDashboardStats();
                    toast(`${name} removed.`, "info");
                }
            });
        });
    }

    DOM.btnClearPeople.addEventListener("click", async () => {
        if (await confirm("Clear All People", "This will remove all registered people and their face data. Continue?")) {
            STATE.registeredPeople = [];
            persistPeople();
            buildFaceMatcher();
            renderPeopleGrid();
            updateDashboardStats();
            toast("All people removed.", "info");
        }
    });

    /* ===================== DASHBOARD ===================== */
    function updateDashboardStats() {
        DOM.statTotalPeople.textContent = STATE.registeredPeople.length;
        const today = dateStr();
        const todayRecords = STATE.attendanceLog.filter((r) => r.date === today);
        DOM.statPresentToday.textContent = todayRecords.length;
        DOM.statLastCheckin.textContent = todayRecords.length > 0 ? todayRecords[0].time : "--:--";

        /* Reconstruct todayCheckedIn set from persisted data */
        STATE.attendanceLog.forEach((r) => {
            if (r.date === today) STATE.todayCheckedIn.add(`${r.name}_${today}`);
        });
    }

    function addRecentActivity(entry) {
        const list = DOM.recentActivityList;
        if (list.querySelector(".empty-state")) list.innerHTML = "";

        const item = document.createElement("div");
        item.className = "activity-item";
        item.innerHTML = `
            <span class="activity-dot"></span>
            <span class="activity-text"><strong>${entry.name}</strong> checked in — ${entry.status}</span>
            <span class="activity-time">${entry.time}</span>`;
        list.prepend(item);

        /* Keep only last 20 items in the list */
        while (list.children.length > 20) list.lastChild.remove();
    }

    function refreshDashboard() {
        updateDashboardStats();
        renderWeeklyChart();
        renderRecentFromLog();
    }

    function renderRecentFromLog() {
        const today = dateStr();
        const recent = STATE.attendanceLog.filter((r) => r.date === today).slice(0, 20);
        if (recent.length === 0) return;
        DOM.recentActivityList.innerHTML = recent.map((r) => `
            <div class="activity-item">
                <span class="activity-dot"></span>
                <span class="activity-text"><strong>${r.name}</strong> checked in — ${r.status}</span>
                <span class="activity-time">${r.time}</span>
            </div>`).join("");
    }

    function renderWeeklyChart() {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const today = new Date();
        const weekData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = dateStr(d);
            const count = STATE.attendanceLog.filter((r) => r.date === ds).length;
            weekData.push({ day: days[d.getDay()], count });
        }
        const max = Math.max(...weekData.map((w) => w.count), 1);
        DOM.weeklyChart.innerHTML = weekData.map((w) => {
            const h = Math.max((w.count / max) * 140, 4);
            return `<div class="bar-col"><div class="bar-fill" style="height:${h}px" data-value="${w.count}"></div><span class="bar-label">${w.day}</span></div>`;
        }).join("");
    }

    /* ===================== INIT ===================== */
    async function init() {
        updateDashboardStats();
        renderWeeklyChart();
        renderRecentFromLog();

        /* Set default date filter to today */
        DOM.attendanceDateFilter.value = dateStr();

        /* Wait for face-api.js to load */
        if (typeof faceapi === "undefined") {
            await new Promise((resolve) => {
                const check = setInterval(() => { if (typeof faceapi !== "undefined") { clearInterval(check); resolve(); } }, 100);
            });
        }

        await loadModels();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
