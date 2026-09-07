"use strict";

const api = {
  courses: "/api/courses",
  filters: "/api/courses/filters",
  scheduleCheck: "/api/schedule/check"
};

const days = ["پنج‌شنبه", "چهارشنبه", "سه‌شنبه", "دوشنبه", "یک‌شنبه", "شنبه"];
const calendarStartMinutes = 7 * 60;
const calendarEndMinutes = 19 * 60;
const slotMinutes = 60;
const slotHeight = 44;
const $ = id => document.getElementById(id);
const faDigits = value => String(value ?? "").replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const themeStorageKey = "sbuThemePreference";
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const desktopNoticeStorageKey = "sbuDesktopNoticeShownAt";
const desktopNoticeInterval = 24 * 60 * 60 * 1000;
const desktopNoticeDuration = 10_000;
let themeTransitionRunning = false;
let queuedThemeRequest = null;

function runSmoothThemeTransition(updateTheme) {
  if (typeof document.startViewTransition !== "function") {
    updateTheme();
    return Promise.resolve();
  }

  try {
    const transition = document.startViewTransition(updateTheme);
    return transition.finished.catch(() => undefined);
  } catch {
    updateTheme();
    return Promise.resolve();
  }
}

function finishThemeTransition() {
  if (!themeTransitionRunning) return;
  themeTransitionRunning = false;
  document.documentElement.removeAttribute("data-theme-transition");

  const nextRequest = queuedThemeRequest;
  queuedThemeRequest = null;
  if (nextRequest) {
    applyThemePreference(
      nextRequest.preference,
      nextRequest.persist,
      nextRequest.animate
    );
  }
}

function themePreference() {
  const preference = document.documentElement.dataset.themePreference;
  return preference === "light" || preference === "dark" ? preference : "system";
}

function applyThemePreference(preference, persist = true, animate = false) {
  const normalizedPreference = preference === "light" || preference === "dark" ? preference : "system";
  const resolvedTheme = normalizedPreference === "system"
    ? (systemThemeQuery.matches ? "dark" : "light")
    : normalizedPreference;

  const updateTheme = () => {
    document.documentElement.dataset.themePreference = normalizedPreference;
    document.documentElement.dataset.theme = resolvedTheme;
    $("themeColorMeta")?.setAttribute("content", resolvedTheme === "dark" ? "#10181c" : "#fffdf8");

    document.querySelectorAll("[data-theme-choice]").forEach(button => {
      const isActive = button.dataset.themeChoice === normalizedPreference;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    if (persist) {
      try { localStorage.setItem(themeStorageKey, normalizedPreference); } catch {  }
    }
  };

  const themeActuallyChanges = document.documentElement.dataset.theme !== resolvedTheme;

  if (themeTransitionRunning) {
    queuedThemeRequest = { preference: normalizedPreference, persist, animate };
    return;
  }

  if (!animate || !themeActuallyChanges || reducedMotionQuery.matches) {
    updateTheme();
    return;
  }

  themeTransitionRunning = true;
  document.documentElement.dataset.themeTransition = "running";
  runSmoothThemeTransition(updateTheme).finally(finishThemeTransition);
}

document.querySelectorAll("[data-theme-choice]").forEach(button => {
  button.addEventListener("click", () => {
    applyThemePreference(button.dataset.themeChoice, true, true);
  });
});
systemThemeQuery.addEventListener?.("change", () => {
  if (themePreference() === "system") applyThemePreference("system", false);
});
applyThemePreference(themePreference(), false);

const searchInput = $("searchInput");
const facultyFilter = $("facultyFilter");
const departmentFilter = $("departmentFilter");
const coursesById = new Map();
const manualCourseIds = new Set();
let nextManualCourseId = -1;
let courseResults = [];
let filterData = { faculties: [], departments: [] };
let currentPage = 1;
let totalPages = 0;
let totalCount = 0;
let courseRequestId = 0;
let courseRequestController = null;
let analysisRequestId = 0;
let scheduleAnalysis = { classConflicts: [], examConflicts: [], totalUnits: 0 };
let previewCourseId = null;
let activeCourseDetailsCard = null;
let autoBuilderSelectedCourses = [];
let autoBuilderPlans = [];
let autoBuilderVisiblePlans = 0;
let autoBuilderSuggestionGroups = [];
let autoBuilderSearchTimer = null;
let autoBuilderSearchRequestId = 0;
let autoBuilderSearchController = null;
let autoBuilderModalTrigger = null;
let manualCourseModalTrigger = null;
let manualMeetingRowId = 0;
let activeManualPickerInput = null;

let schedules = loadSchedules();
let activeScheduleId = readLocalStorage("sbuActiveScheduleId") || schedules[0].id;
if (!schedules.some(schedule => schedule.id === activeScheduleId)) activeScheduleId = schedules[0].id;
const scheduleUndoStack = [];
const scheduleRedoStack = [];
const scheduleHistoryLimit = 50;
const maxSchedules = 5;
let scheduleHistoryBusy = false;

function loadSchedules() {
  try {
    const saved = JSON.parse(localStorage.getItem("sbuSchedules") || "null");
    if (Array.isArray(saved) && saved.length) {
      return saved.map(schedule => ({
        id: String(schedule.id),
        name: String(schedule.name || "برنامه"),
        courseIds: Array.isArray(schedule.courseIds) ? [...new Set(schedule.courseIds.map(Number).filter(Number.isInteger))] : [],
        excludedMeetingKeys: Array.isArray(schedule.excludedMeetingKeys)
          ? [...new Set(schedule.excludedMeetingKeys.map(String).filter(Boolean))]
          : [],
        view: schedule.view === "exams" ? "exams" : "classes"
      }));
    }
  } catch {  }

  return [{
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    name: "برنامه ۱",
    courseIds: [],
    excludedMeetingKeys: [],
    view: "classes"
  }];
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSchedules() {
  try {
    const persistableSchedules = schedules.map(schedule => ({
      ...schedule,
      courseIds: schedule.courseIds.filter(id => !manualCourseIds.has(id)),
      excludedMeetingKeys: (schedule.excludedMeetingKeys || []).filter(key => {
        const courseId = Number(String(key).split("|", 1)[0]);
        return !manualCourseIds.has(courseId);
      })
    }));
    localStorage.setItem("sbuSchedules", JSON.stringify(persistableSchedules));
    localStorage.setItem("sbuActiveScheduleId", activeScheduleId);
    return true;
  } catch {
    return false;
  }
}

function scheduleStateSnapshot() {
  return {
    schedules: JSON.parse(JSON.stringify(schedules)),
    activeScheduleId
  };
}

function rememberScheduleState() {
  if (scheduleHistoryBusy) return;
  scheduleUndoStack.push(scheduleStateSnapshot());
  if (scheduleUndoStack.length > scheduleHistoryLimit) scheduleUndoStack.shift();
  scheduleRedoStack.length = 0;
}

async function restoreScheduleState(state, message) {
  scheduleHistoryBusy = true;
  try {
    schedules = JSON.parse(JSON.stringify(state.schedules));
    activeScheduleId = schedules.some(schedule => schedule.id === state.activeScheduleId)
      ? state.activeScheduleId
      : schedules[0].id;
    previewCourseId = null;
    scheduleAnalysis = { classConflicts: [], examConflicts: [], totalUnits: 0 };
    saveSchedules();
    await hydrateSelectedCourses();
    renderAll();
    await refreshScheduleAnalysis();
    showToast(message, "info");
  } finally {
    scheduleHistoryBusy = false;
  }
}

async function undoScheduleChange() {
  if (scheduleHistoryBusy) return;
  if (!scheduleUndoStack.length) {
    showToast("تغییری برای بازگردانی وجود ندارد.", "info");
    return;
  }
  const previousState = scheduleUndoStack.pop();
  scheduleRedoStack.push(scheduleStateSnapshot());
  await restoreScheduleState(previousState, "آخرین تغییر بازگردانده شد.");
}

async function redoScheduleChange() {
  if (scheduleHistoryBusy) return;
  if (!scheduleRedoStack.length) {
    showToast("تغییری برای انجام مجدد وجود ندارد.", "info");
    return;
  }
  const nextState = scheduleRedoStack.pop();
  scheduleUndoStack.push(scheduleStateSnapshot());
  await restoreScheduleState(nextState, "تغییر دوباره انجام شد.");
}

function activeSchedule() {
  return schedules.find(schedule => schedule.id === activeScheduleId) || schedules[0];
}

function activeView() {
  return activeSchedule().view === "exams" ? "exams" : "classes";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function persianizeText(value) {
  return String(value ?? "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
}

function courseSkeletonMarkup(count = 5) {
  return Array.from({ length: count }, () => `
    <article class="course-skeleton" aria-hidden="true">
      <div class="skeleton-row"><span class="skeleton-line skeleton-title"></span><span class="skeleton-button"></span></div>
      <span class="skeleton-line skeleton-subtitle"></span>
      <span class="skeleton-line skeleton-detail"></span>
      <span class="skeleton-line skeleton-detail skeleton-detail-short"></span>
      <div class="skeleton-footer"><span class="skeleton-line"></span><span class="skeleton-line"></span></div>
    </article>`).join("");
}

const emptyStateIcons = {
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"></circle><path d="m16 16 4.2 4.2M8.4 10.8h4.8"></path></svg>`,
  error: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 19h18.4L12 3Z"></path><path d="M12 9v4.5M12 17h.01"></path></svg>`,
  calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M7.5 3v4M16.5 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"></path></svg>`
};

function emptyStateMarkup(kind, title, description, action = null) {
  const icon = emptyStateIcons[kind] || emptyStateIcons.calendar;
  const button = action
    ? `<button class="btn empty-state-action" id="${escapeHtml(action.id)}" type="button">${escapeHtml(action.label)}</button>`
    : "";
  return `
    <div class="empty-state empty-state-${escapeHtml(kind)}">
      <span class="empty-state-icon">${icon}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
      ${button}
    </div>`;
}

function normalizeCourse(item) {
  return {
    id: Number(item.id),
    code: persianizeText(item.courseCode),
    group: persianizeText(item.group),
    name: persianizeText(item.name),
    units: Number(item.units || 0),
    practicalUnits: Number(item.practicalUnits || 0),
    faculty: persianizeText(item.facultyName),
    department: persianizeText(item.departmentName),
    capacity: Number(item.capacity || 0),
    registered: Number(item.registered || 0),
    waitlist: Number(item.waitlist || 0),
    gender: persianizeText(item.gender),
    restrictions: persianizeText(item.restrictions || "").trim(),
    notes: persianizeText(item.notes || "").trim(),
    professors: Array.isArray(item.professors) ? item.professors.map(persianizeText) : [],
    meetings: Array.isArray(item.meetings) ? item.meetings.map(meeting => ({
      type: persianizeText(meeting.type),
      day: persianizeText(meeting.day).trim(),
      start: String(meeting.startTime || ""),
      end: String(meeting.endTime || "")
    })) : [],
    exam: item.exam ? {
      date: String(item.exam.date || ""),
      start: String(item.exam.startTime || ""),
      end: String(item.exam.endTime || "")
    } : null
  };
}

function rememberCourses(items) {
  return items.map(normalizeCourse).map(course => {
    const previous = coursesById.get(course.id) || {};
    const merged = { ...previous, ...course };
    coursesById.set(course.id, merged);
    return merged;
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json", ...(options?.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function autoBuilderCourseKey(course) {
  return String(course?.code || "").trim();
}

function renderAutoBuilderSelected() {
  const container = $("autoBuilderSelected");
  const count = autoBuilderSelectedCourses.length;
  $("autoBuilderSelectionCount").textContent = `${faDigits(count)} درس انتخاب شده`;
  $("generateSchedulesBtn").disabled = count === 0;

  container.innerHTML = count
    ? autoBuilderSelectedCourses.map(course => `
        <span class="auto-builder-chip">
          <span>${escapeHtml(course.name)}</span>
          <small>${escapeHtml(course.code)}</small>
          <button type="button" data-auto-remove-code="${escapeHtml(course.code)}" aria-label="حذف ${escapeHtml(course.name)}">×</button>
        </span>`).join("")
    : `<span class="auto-builder-selected-empty">هنوز درسی انتخاب نشده است.</span>`;

  container.querySelectorAll("[data-auto-remove-code]").forEach(button => {
    button.addEventListener("click", () => {
      autoBuilderSelectedCourses = autoBuilderSelectedCourses.filter(
        course => course.code !== button.dataset.autoRemoveCode
      );
      autoBuilderPlans = [];
      autoBuilderVisiblePlans = 0;
      $("autoBuilderResults").innerHTML = "";
      $("autoBuilderStatus").textContent = "";
      renderAutoBuilderSelected();
      updateAutoBuilderSuggestionStates();
    });
  });
}

function updateAutoBuilderSuggestionStates() {
  $("autoBuilderSuggestions").querySelectorAll("[data-auto-course-code]").forEach(button => {
    const selected = autoBuilderSelectedCourses.some(course => course.code === button.dataset.autoCourseCode);
    button.disabled = selected;
    button.lastElementChild.textContent = selected ? "انتخاب شده" : "افزودن";
  });
}

function selectAutoBuilderSuggestion(courseCode) {
  if (autoBuilderSelectedCourses.length >= 10) {
    showToast("حداکثر ۱۰ درس را می‌توان هم‌زمان بررسی کرد.", "warning");
    return;
  }
  const group = autoBuilderSuggestionGroups.find(item => item.code === courseCode);
  if (!group || autoBuilderSelectedCourses.some(course => course.code === group.code)) return;
  autoBuilderSelectedCourses.push({
    code: group.code,
    name: group.name,
    faculty: $("autoBuilderFaculty").value,
    department: $("autoBuilderDepartment").value
  });
  autoBuilderPlans = [];
  autoBuilderVisiblePlans = 0;
  $("autoBuilderResults").innerHTML = "";
  $("autoBuilderStatus").textContent = "";
  renderAutoBuilderSelected();
  updateAutoBuilderSuggestionStates();
}

function renderAutoBuilderSuggestions(groups) {
  const container = $("autoBuilderSuggestions");
  autoBuilderSuggestionGroups = groups;
  if (!groups.length) {
    container.innerHTML = `<span class="auto-builder-suggestion-note">درسی با این عبارت پیدا نشد.</span>`;
    return;
  }

  container.innerHTML = groups.map(group => {
    const selected = autoBuilderSelectedCourses.some(course => course.code === group.code);
    const professorText = group.professors.length
      ? ` · ${group.professors.map(professor => `استاد ${professor}`).join(" - ")}`
      : "";
    return `
      <button class="auto-builder-suggestion" type="button" data-auto-course-code="${escapeHtml(group.code)}" ${selected ? "disabled" : ""}>
        <span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.code)} · ${faDigits(group.offerings)} ارائه${escapeHtml(professorText)}</small></span>
        <span>${selected ? "انتخاب شده" : "افزودن"}</span>
      </button>`;
  }).join("");
}

async function searchAutoBuilderCourses() {
  const search = $("autoBuilderSearch").value.trim();
  const requestId = ++autoBuilderSearchRequestId;
  autoBuilderSearchController?.abort();
  const requestController = new AbortController();
  autoBuilderSearchController = requestController;
  const suggestions = $("autoBuilderSuggestions");

  suggestions.setAttribute("aria-busy", "true");
  suggestions.innerHTML = `<span class="auto-builder-suggestion-note"><span class="spinner"></span>در حال دریافت درس‌ها…</span>`;
  const query = new URLSearchParams({
    page: "1",
    pageSize: "100",
    sortBy: search ? "relevance" : "name",
    sortOrder: "asc"
  });
  if (search) query.set("search", search);
  if ($("autoBuilderFaculty").value) query.set("faculty", $("autoBuilderFaculty").value);
  if ($("autoBuilderDepartment").value) query.set("department", $("autoBuilderDepartment").value);
  try {
    const result = await fetchJson(`${api.courses}?${query}`, { signal: requestController.signal });
    if (requestId !== autoBuilderSearchRequestId) return;
    const courses = rememberCourses(Array.isArray(result.items) ? result.items : []);
    const grouped = new Map();
    courses.forEach(course => {
      const code = autoBuilderCourseKey(course);
      if (!code) return;
      const current = grouped.get(code);
      const professors = Array.isArray(course.professors) ? course.professors.filter(Boolean) : [];
      if (current) {
        current.offerings++;
        professors.forEach(professor => {
          if (!current.professors.includes(professor)) current.professors.push(professor);
        });
      } else {
        grouped.set(code, { code, name: course.name, offerings: 1, professors: [...new Set(professors)] });
      }
    });
    renderAutoBuilderSuggestions([...grouped.values()]);
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (requestId !== autoBuilderSearchRequestId) return;
    suggestions.innerHTML = `<span class="auto-builder-suggestion-note error">جست‌وجوی درس انجام نشد.</span>`;
  } finally {
    if (autoBuilderSearchController === requestController) autoBuilderSearchController = null;
    if (requestId === autoBuilderSearchRequestId) suggestions.removeAttribute("aria-busy");
  }
}

async function fetchAutoBuilderOfferings(selectedCourse) {
  const query = new URLSearchParams({
    search: selectedCourse.code,
    page: "1",
    pageSize: "100",
    sortBy: "code",
    sortOrder: "asc"
  });
  if (selectedCourse.faculty) query.set("faculty", selectedCourse.faculty);
  if (selectedCourse.department) query.set("department", selectedCourse.department);
  const result = await fetchJson(`${api.courses}?${query}`);
  return rememberCourses(Array.isArray(result.items) ? result.items : [])
    .filter(course => autoBuilderCourseKey(course) === selectedCourse.code)
    .filter((course, index, items) => items.findIndex(item => item.id === course.id) === index);
}

function autoBuilderClassConflict(first, second) {
  return first.meetings.some(firstMeeting => second.meetings.some(secondMeeting =>
    firstMeeting.day === secondMeeting.day &&
    overlap(firstMeeting.start, firstMeeting.end, secondMeeting.start, secondMeeting.end)
  ));
}

function autoBuilderExamConflict(courses) {
  for (let firstIndex = 0; firstIndex < courses.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < courses.length; secondIndex++) {
      const first = courses[firstIndex].exam;
      const second = courses[secondIndex].exam;
      if (first?.date && second?.date && first.date === second.date && overlap(first.start, first.end, second.start, second.end)) {
        return true;
      }
    }
  }
  return false;
}

function buildAutoSchedulePlans(offeringGroups, limit = 2000) {
  const plans = [];
  let truncated = false;
  const orderedGroups = [...offeringGroups].sort((first, second) => first.length - second.length);

  const visit = (groupIndex, selected) => {
    if (plans.length >= limit) {
      truncated = true;
      return;
    }
    if (groupIndex === orderedGroups.length) {
      plans.push({ courses: [...selected], hasExamConflict: autoBuilderExamConflict(selected) });
      return;
    }

    for (const offering of orderedGroups[groupIndex]) {
      if (selected.some(course => autoBuilderClassConflict(course, offering))) continue;
      selected.push(offering);
      visit(groupIndex + 1, selected);
      selected.pop();
      if (truncated) return;
    }
  };

  visit(0, []);
  plans.sort((first, second) => Number(first.hasExamConflict) - Number(second.hasExamConflict));
  return { plans, truncated };
}

function autoBuilderPlanMarkup(plan, index) {
  return `
    <article class="auto-plan-card">
      <div class="auto-plan-head">
        <strong>برنامه ${faDigits(index + 1)}</strong>
        ${plan.hasExamConflict ? `<span class="auto-plan-tag conflict">تداخل امتحان</span>` : `<span class="auto-plan-tag">بدون تداخل کلاس</span>`}
      </div>
      <div class="auto-plan-courses">
        ${plan.courses.map(course => `
          <div class="auto-plan-course">
            <div><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.code)}-${escapeHtml(course.group)}</small></div>
            <span>${escapeHtml(course.professors.join("، ") || "استاد ثبت نشده")}</span>
            <small>${escapeHtml(meetingText(course))}</small>
          </div>`).join("")}
      </div>
      <button class="btn auto-plan-use" type="button" data-auto-plan-index="${index}">ساخت این برنامه</button>
    </article>`;
}

function renderAutoBuilderPlans(reset = false) {
  if (reset) autoBuilderVisiblePlans = Math.min(30, autoBuilderPlans.length);
  const visiblePlans = autoBuilderPlans.slice(0, autoBuilderVisiblePlans);
  $("autoBuilderResults").innerHTML = visiblePlans.map(autoBuilderPlanMarkup).join("") +
    (autoBuilderVisiblePlans < autoBuilderPlans.length
      ? `<button class="btn auto-builder-more" id="autoBuilderMoreBtn" type="button">نمایش برنامه‌های بیشتر</button>`
      : "");

  document.querySelectorAll("[data-auto-plan-index]").forEach(button => {
    button.addEventListener("click", () => useAutoBuilderPlan(Number(button.dataset.autoPlanIndex)));
  });
  $("autoBuilderMoreBtn")?.addEventListener("click", () => {
    autoBuilderVisiblePlans = Math.min(autoBuilderVisiblePlans + 30, autoBuilderPlans.length);
    renderAutoBuilderPlans();
  });
}

async function generateAutoSchedules() {
  if (!autoBuilderSelectedCourses.length) return;
  showAutoBuilderStep("results");
  const generateButton = $("generateSchedulesBtn");
  generateButton.disabled = true;
  generateButton.innerHTML = `<span class="spinner"></span>در حال بررسی…`;
  $("autoBuilderStatus").textContent = "در حال دریافت همهٔ ارائه‌ها و بررسی تداخل‌ها…";
  $("autoBuilderResults").innerHTML = "";

  try {
    const offeringGroups = await Promise.all(autoBuilderSelectedCourses.map(fetchAutoBuilderOfferings));
    const missingIndex = offeringGroups.findIndex(group => group.length === 0);
    if (missingIndex >= 0) throw new Error(`برای «${autoBuilderSelectedCourses[missingIndex].name}» ارائهٔ فعالی پیدا نشد.`);

    const generated = buildAutoSchedulePlans(offeringGroups);
    autoBuilderPlans = generated.plans;
    if (!autoBuilderPlans.length) {
      $("autoBuilderStatus").innerHTML = `<span class="auto-builder-no-result">هیچ ترکیب بدون تداخل کلاسی برای این درس‌ها وجود ندارد.</span>`;
      return;
    }

    const examConflictCount = autoBuilderPlans.filter(plan => plan.hasExamConflict).length;
    $("autoBuilderStatus").innerHTML = `
      <strong>${faDigits(autoBuilderPlans.length)} برنامه پیدا شد</strong>
      <span>${faDigits(examConflictCount)} برنامه دارای تداخل امتحان است.${generated.truncated ? " برای حفظ سرعت، نتایج به ۲۰۰۰ برنامه محدود شده‌اند." : ""}</span>`;
    renderAutoBuilderPlans(true);
  } catch (error) {
    autoBuilderPlans = [];
    $("autoBuilderStatus").innerHTML = `<span class="auto-builder-no-result">${escapeHtml(error?.message || "ساخت برنامه‌ها انجام نشد.")}</span>`;
  } finally {
    generateButton.disabled = autoBuilderSelectedCourses.length === 0;
    generateButton.innerHTML = `<iconify-icon icon="solar:stars-line-duotone"></iconify-icon>ساخت برنامه‌ها`;
  }
}

async function useAutoBuilderPlan(index) {
  const plan = autoBuilderPlans[index];
  if (!plan) return;
  if (schedules.length >= maxSchedules) {
    showToast("حداکثر ۵ برنامه می‌توانید داشته باشید.", "warning");
    return;
  }
  rememberScheduleState();
  const schedule = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    name: nextScheduleName(),
    courseIds: plan.courses.map(course => course.id),
    excludedMeetingKeys: [],
    view: "classes"
  };
  schedules.push(schedule);
  activeScheduleId = schedule.id;
  saveSchedules();
  renderAll();
  await refreshScheduleAnalysis();
  showToast("برنامه پیشنهادی ساخته شد.", "success");
}

function openAutoBuilderModal() {
  autoBuilderModalTrigger = document.activeElement;
  refreshAutoBuilderFilters();
  showAutoBuilderStep("selection");
  $("autoBuilderModal").classList.add("open");
  $("autoBuilderModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("dialog-open");
  renderAutoBuilderSelected();
  $("autoBuilderDialog").focus();
  void searchAutoBuilderCourses();
  setTimeout(() => $("autoBuilderSearch").focus(), 60);
}

function showAutoBuilderStep(step) {
  const showResults = step === "results";
  $("autoBuilderSelectionStep").hidden = showResults;
  $("autoBuilderResultsStep").hidden = !showResults;
  setTimeout(() => (showResults ? $("autoBuilderBackBtn") : $("autoBuilderSearch")).focus(), 0);
}

function closeAutoBuilderModal() {
  ++autoBuilderSearchRequestId;
  autoBuilderSearchController?.abort();
  autoBuilderSearchController = null;
  clearTimeout(autoBuilderSearchTimer);
  closeAutoBuilderSelectMenus();
  $("autoBuilderModal").classList.remove("open");
  $("autoBuilderModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("dialog-open");
  autoBuilderModalTrigger?.focus?.();
}

function closeAutoBuilderSelectMenus(except = null) {
  let closed = false;
  document.querySelectorAll(".auto-builder-compact-select").forEach(wrapper => {
    if (wrapper === except) return;
    const menu = wrapper.querySelector(".auto-builder-select-menu");
    const button = wrapper.querySelector(".auto-builder-select-button");
    if (!menu.hidden) closed = true;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    wrapper.classList.remove("open");
  });
  return closed;
}

function syncAutoBuilderSelectUi(select) {
  const wrapper = select.closest(".auto-builder-compact-select");
  if (!wrapper) return;
  const button = wrapper.querySelector(".auto-builder-select-button");
  const valueLabel = button.querySelector("span");
  const menu = wrapper.querySelector(".auto-builder-select-menu");
  const selectedOption = select.options[select.selectedIndex] || select.options[0];
  valueLabel.textContent = selectedOption?.textContent || "";
  menu.innerHTML = [...select.options].map(option => `
    <button class="auto-builder-select-option${option.selected ? " selected" : ""}" type="button" role="option" aria-selected="${option.selected}" data-auto-select-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent)}</button>
  `).join("");
}

function initializeAutoBuilderSelects() {
  document.querySelectorAll(".auto-builder-compact-select").forEach(wrapper => {
    const select = $(wrapper.dataset.autoSelect);
    const button = wrapper.querySelector(".auto-builder-select-button");
    const menu = wrapper.querySelector(".auto-builder-select-menu");

    button.addEventListener("click", event => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeAutoBuilderSelectMenus(willOpen ? wrapper : null);
      menu.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
      wrapper.classList.toggle("open", willOpen);
      if (willOpen) menu.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
    });

    menu.addEventListener("click", event => {
      const option = event.target.closest("[data-auto-select-value]");
      if (!option) return;
      select.value = option.dataset.autoSelectValue;
      syncAutoBuilderSelectUi(select);
      closeAutoBuilderSelectMenus();
      select.dispatchEvent(new Event("change", { bubbles: true }));
      button.focus();
    });

    syncAutoBuilderSelectUi(select);
  });
  document.addEventListener("click", () => closeAutoBuilderSelectMenus());
}

function fillSelect(select, options, placeholder) {
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${options.map(option =>
    `<option value="${escapeHtml(option.value)}">${escapeHtml(persianizeText(option.label))}</option>`
  ).join("")}`;
  if (options.some(option => option.value === selected)) select.value = selected;
  syncAutoBuilderSelectUi(select);
}

function computerFacultyFirst(items) {
  const isComputerEngineeringAndScience = item =>
    persianizeText(item.name).replace(/\s+/g, " ").trim().includes("مهندسی و علوم کامپیوتر");

  return [...items].sort((a, b) =>
    Number(isComputerEngineeringAndScience(b)) - Number(isComputerEngineeringAndScience(a))
  );
}

function refreshAutoBuilderDepartments() {
  const facultySelect = $("autoBuilderFaculty");
  const departmentSelect = $("autoBuilderDepartment");
  const selectedFaculty = filterData.faculties.find(item => item.name === facultySelect.value);
  const departments = computerFacultyFirst(filterData.departments
    .filter(item => !selectedFaculty || item.facultyCode === selectedFaculty.code)
  ).map(item => ({ value: item.name, label: item.name }));
  fillSelect(departmentSelect, departments, "همه گروه‌ها");
}

function refreshAutoBuilderFilters() {
  const faculties = computerFacultyFirst(filterData.faculties)
    .map(item => ({ value: item.name, label: item.name }));
  fillSelect($("autoBuilderFaculty"), faculties, "همه دانشکده‌ها");
  refreshAutoBuilderDepartments();
}

function refreshDepartments() {
  const selectedFaculty = filterData.faculties.find(item => item.name === facultyFilter.value);
  const departments = computerFacultyFirst(filterData.departments
    .filter(item => !selectedFaculty || item.facultyCode === selectedFaculty.code)
  )
    .map(item => ({ value: item.name, label: item.name }));
  fillSelect(departmentFilter, departments, "همه گروه‌ها");
}

async function loadFilters() {
  try {
    const result = await fetchJson(api.filters);
    filterData = {
      faculties: Array.isArray(result.faculties) ? result.faculties : [],
      departments: Array.isArray(result.departments) ? result.departments : []
    };
    const faculties = computerFacultyFirst(filterData.faculties)
      .map(item => ({ value: item.name, label: item.name }));
    fillSelect(facultyFilter, faculties, "همه دانشکده‌ها");
    refreshDepartments();
    refreshAutoBuilderFilters();
    if ($("autoBuilderModal").classList.contains("open")) void searchAutoBuilderCourses();
  } catch {
    showToast("فیلترهای دروس دریافت نشدند.", "error");
  }
}

function buildCoursesUrl(page) {
  const search = searchInput.value.trim();
  const query = new URLSearchParams({
    page: String(page),
    pageSize: "100",
    sortBy: search ? "relevance" : "name",
    sortOrder: "asc"
  });
  if (search) query.set("search", search);
  if (facultyFilter.value) query.set("faculty", facultyFilter.value);
  if (departmentFilter.value) query.set("department", departmentFilter.value);
  return `${api.courses}?${query}`;
}

async function loadCourses({ append = false } = {}) {
  if (previewCourseId !== null) {
    previewCourseId = null;
    renderCalendarArea();
  }
  const requestId = ++courseRequestId;
  courseRequestController?.abort();
  const requestController = new AbortController();
  courseRequestController = requestController;
  const page = append ? currentPage + 1 : 1;
  if (!append) {
    $("courseList").setAttribute("aria-busy", "true");
    $("courseList").innerHTML = courseSkeletonMarkup();
  } else {
    const loadMoreButton = $("loadMoreBtn");
    if (loadMoreButton) {
      loadMoreButton.disabled = true;
      loadMoreButton.innerHTML = `<span class="spinner"></span>در حال دریافت…`;
    }
  }

  try {
    const result = await fetchJson(buildCoursesUrl(page), { signal: requestController.signal });
    if (requestId !== courseRequestId) return;
    const normalized = rememberCourses(Array.isArray(result.items) ? result.items : []);
    courseResults = append ? [...courseResults, ...normalized] : normalized;
    currentPage = Number(result.page || page);
    totalPages = Number(result.totalPages || 0);
    totalCount = Number(result.totalCount || 0);
    $("courseList").setAttribute("aria-busy", "false");
    renderCourses();
    requestAnimationFrame(syncPanelHeights);
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (requestId !== courseRequestId) return;
    $("courseList").setAttribute("aria-busy", "false");
    if (append) {
      renderCourses();
      showToast("دریافت درس‌های بیشتر انجام نشد.", "error");
      return;
    }
    totalCount = 0;
    courseResults = [];
    $("courseList").innerHTML = emptyStateMarkup(
      "error",
      "دریافت درس‌ها انجام نشد",
      "اتصال اینترنت یا دسترسی به سرور را بررسی کنید.",
      { id: "retryCoursesBtn", label: "تلاش دوباره" }
    );
    $("retryCoursesBtn")?.addEventListener("click", () => loadCourses());
    showToast("ارتباط با فهرست درس‌ها برقرار نشد.", "error");
  } finally {
    if (courseRequestController === requestController) courseRequestController = null;
  }
}

async function hydrateSelectedCourses() {
  const ids = [...new Set(schedules.flatMap(schedule => schedule.courseIds))]
    .filter(id => !manualCourseIds.has(id) && !coursesById.has(id));
  await Promise.all(ids.map(async id => {
    try {
      const item = await fetchJson(`${api.courses}/${id}`);
      rememberCourses([item]);
    } catch {  }
  }));
}

function meetingText(course) {
  if (!course.meetings.length) return "زمان کلاس ثبت نشده";
  return course.meetings.map(meeting => `${meeting.day} ${meeting.start}–${meeting.end}`).join("، ");
}

function examText(course) {
  if (!course.exam || !course.exam.date) return "امتحان ثبت نشده";
  const weekday = examWeekday(course.exam.date);
  return `${weekday ? `${weekday} ` : ""}${course.exam.date} · ${course.exam.start}–${course.exam.end}`;
}

function reelTextMarkup(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => `<span class="reel-word ${index % 2 ? "reel-word-down" : "reel-word-up"}">${escapeHtml(word)}</span>`)
    .join(" ");
}

function renderCourses() {
  hideCourseExtraDetails();
  const schedule = activeSchedule();
  $("resultCount").textContent = faDigits(totalCount);
  $("activeScheduleCaption").textContent = schedule.name;

  if (!courseResults.length) {
    const hasQuery = Boolean(searchInput.value.trim() || facultyFilter.value || departmentFilter.value);
    $("courseList").innerHTML = emptyStateMarkup(
      "search",
      hasQuery ? "درسی پیدا نشد" : "درسی برای نمایش وجود ندارد",
      hasQuery ? "عبارت جست‌وجو یا فیلترهای انتخاب‌شده را تغییر دهید." : "هنوز درس فعالی در سامانه ثبت نشده است.",
      hasQuery ? { id: "emptyResetFiltersBtn", label: "پاک کردن فیلترها" } : null
    );
    $("emptyResetFiltersBtn")?.addEventListener("click", resetFilters);
    return;
  }

  const cards = courseResults.map(course => {
    const selected = schedule.courseIds.includes(course.id);
    const hasDetails = Boolean(course.notes || course.restrictions);
    const professorText = course.professors.length ? course.professors.join("، ") : "ثبت نشده";
    return `
      <article class="course-card" data-preview-course-id="${course.id}"${hasDetails ? ' data-has-course-details="true"' : ""}>
        <div class="course-card-top">
          <div class="course-heading">
            <div class="course-title">${escapeHtml(course.name)} <span class="course-code">${escapeHtml(course.code)}-${escapeHtml(course.group)}</span></div>
          </div>
          <div class="course-card-actions">
            ${hasDetails ? `<button class="course-details-btn" data-details-course-id="${course.id}" type="button" aria-expanded="false" aria-controls="course-extra-${course.id}">جزئیات</button>` : ""}
            <button class="add-btn ${selected ? "selected" : ""}" data-course-id="${course.id}" type="button" aria-pressed="${selected}">${selected ? "حذف" : "افزودن"}</button>
          </div>
        </div>
        <div class="course-card-detail-stage">
          <div class="course-default-details">
            <div class="course-sub">${escapeHtml(course.faculty || "دانشکده نامشخص")} — ${escapeHtml(course.department || "گروه نامشخص")}</div>
            <div class="course-info">
              <div class="course-info-row"><b>استاد:</b><span>${escapeHtml(professorText)}</span></div>
              <div class="course-info-row"><b>کلاس:</b><span>${escapeHtml(meetingText(course))}</span></div>
              <div class="course-info-row"><b>امتحان:</b><span>${escapeHtml(examText(course))}</span></div>
            </div>
            <div class="course-footer">
              <span class="capacity">ثبت‌نام <strong>${faDigits(course.registered)}</strong> از <strong>${faDigits(course.capacity)}</strong></span>
              <span class="units"><strong>${faDigits(course.units)}</strong> واحد</span>
            </div>
          </div>
          ${hasDetails ? `<div class="course-extra-details" id="course-extra-${course.id}" aria-hidden="true">
            ${course.notes ? `<div class="course-extra-section"><b>توضیحات درس</b><p>${reelTextMarkup(course.notes)}</p></div>` : ""}
            ${course.restrictions ? `<div class="course-extra-section course-extra-restrictions"><b>محدودیت اخذ</b><p>${reelTextMarkup(course.restrictions)}</p></div>` : ""}
          </div>` : ""}
        </div>
      </article>`;
  }).join("");

  const more = currentPage < totalPages
    ? `<button class="btn load-more" id="loadMoreBtn" type="button">نمایش درس‌های بیشتر</button>`
    : "";
  $("courseList").innerHTML = cards + more;
  document.querySelectorAll(".add-btn[data-course-id]").forEach(button => {
    button.addEventListener("click", () => toggleCourse(Number(button.dataset.courseId)));
  });
  document.querySelectorAll(".course-details-btn[data-details-course-id]").forEach(button => {
    button.addEventListener("click", () => toggleCourseExtraDetails(button.closest(".course-card")));
  });
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".course-card[data-preview-course-id]").forEach(card => {
      card.addEventListener("mouseenter", () => {
        const courseId = Number(card.dataset.previewCourseId);
        showCoursePreview(courseId, card);
      });
      card.addEventListener("mouseleave", () => {
        const courseId = Number(card.dataset.previewCourseId);
        hideCoursePreview(courseId, card);
      });
    });
  }
  $("loadMoreBtn")?.addEventListener("click", () => loadCourses({ append: true }));
}

function toggleCourseExtraDetails(card) {
  if (!card) return;
  if (card.classList.contains("is-details-revealed")) {
    hideCourseExtraDetails(card);
    return;
  }
  if (activeCourseDetailsCard && activeCourseDetailsCard !== card) hideCourseExtraDetails(activeCourseDetailsCard);
  revealCourseExtraDetails(card);
}

function revealCourseExtraDetails(card) {
  if (!card?.matches('[data-has-course-details="true"]')) return;
  activeCourseDetailsCard = card;

  card.querySelectorAll(".reel-word").forEach((word, index) => {
    word.style.setProperty("--reel-delay", `${Math.min(index, 20) * 28}ms`);
  });
  card.querySelector(".course-default-details")?.setAttribute("aria-hidden", "true");
  card.querySelector(".course-extra-details")?.setAttribute("aria-hidden", "false");
  const detailsButton = card.querySelector(".course-details-btn");
  if (detailsButton) {
    detailsButton.textContent = "مخفی کردن";
    detailsButton.setAttribute("aria-expanded", "true");
  }
  card.classList.remove("is-details-revealed");
  void card.offsetWidth;
  card.classList.add("is-details-revealed");
}

function hideCourseExtraDetails(card = activeCourseDetailsCard) {
  if (card) {
    card.classList.remove("is-details-revealed");
    card.querySelector(".course-default-details")?.setAttribute("aria-hidden", "false");
    card.querySelector(".course-extra-details")?.setAttribute("aria-hidden", "true");
    const detailsButton = card.querySelector(".course-details-btn");
    if (detailsButton) {
      detailsButton.textContent = "جزئیات";
      detailsButton.setAttribute("aria-expanded", "false");
    }
  }
  if (!card || activeCourseDetailsCard === card) activeCourseDetailsCard = null;
}

function showCoursePreview(id, card) {
  if (activeSchedule().courseIds.includes(id) || previewCourseId === id) return;
  document.querySelector(".course-card.is-previewing")?.classList.remove("is-previewing");
  previewCourseId = id;
  card.classList.add("is-previewing");
  renderCalendarArea();
}

function hideCoursePreview(id, card) {
  card?.classList.remove("is-previewing");
  if (previewCourseId !== id) return;
  previewCourseId = null;
  renderCalendarArea();
}

function renderScheduleTabs() {
  $("scheduleTabs").innerHTML = schedules.map(schedule => `
    <button class="schedule-tab ${schedule.id === activeScheduleId ? "active" : ""}" data-schedule-id="${escapeHtml(schedule.id)}" type="button" title="برای تغییر نام دوبار کلیک کنید">${escapeHtml(schedule.name)}</button>
  `).join("");
  $("newScheduleBtn").disabled = schedules.length >= maxSchedules;

  document.querySelectorAll("[data-schedule-id]").forEach(button => {
    button.addEventListener("click", async () => {
      activeScheduleId = button.dataset.scheduleId;
      saveSchedules();
      renderAll();
      await hydrateSelectedCourses();
      await refreshScheduleAnalysis();
    });
    button.addEventListener("dblclick", () => {
      const schedule = schedules.find(item => item.id === button.dataset.scheduleId);
      const name = prompt("نام برنامه:", schedule.name);
      const normalizedName = name?.trim();
      if (normalizedName && normalizedName !== schedule.name) {
        rememberScheduleState();
        schedule.name = normalizedName;
        saveSchedules();
        renderAll();
      }
    });
  });
}

function renderViewTabs() {
  document.querySelectorAll(".view-tab[data-view]").forEach(button => {
    const isActive = button.dataset.view === activeView();
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function nextScheduleName() {
  const toLatinDigits = value => String(value).replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const largestNumber = schedules.reduce((largest, schedule) => {
    const match = schedule.name.trim().match(/^برنامه\s+([۰-۹0-9]+)$/);
    return match ? Math.max(largest, Number(toLatinDigits(match[1])) || 0) : largest;
  }, 0);
  return `برنامه ${faDigits(largestNumber + 1)}`;
}

function addSchedule() {
  if (schedules.length >= maxSchedules) {
    showToast("حداکثر ۵ برنامه می‌توانید داشته باشید.", "warning");
    return;
  }
  rememberScheduleState();
  const schedule = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    name: nextScheduleName(),
    courseIds: [],
    excludedMeetingKeys: [],
    view: "classes"
  };
  schedules.push(schedule);
  activeScheduleId = schedule.id;
  scheduleAnalysis = { classConflicts: [], examConflicts: [], totalUnits: 0 };
  saveSchedules();
  renderAll();
  showToast("برنامه جدید ساخته شد.", "success");
}

function deleteSchedule() {
  if (schedules.length === 1) {
    showToast("حداقل یک برنامه باید باقی بماند.", "warning");
    return;
  }
  const schedule = activeSchedule();
  rememberScheduleState();
  schedules = schedules.filter(item => item.id !== activeScheduleId);
  activeScheduleId = schedules[0].id;
  saveSchedules();
  renderAll();
  refreshScheduleAnalysis();
  showToast(`«${schedule.name}» حذف شد.`, "success");
}

async function toggleCourse(id) {
  previewCourseId = null;
  const schedule = activeSchedule();
  const wasSelected = schedule.courseIds.includes(id);
  rememberScheduleState();
  schedule.courseIds = wasSelected
    ? schedule.courseIds.filter(courseId => courseId !== id)
    : [...schedule.courseIds, id];
  schedule.excludedMeetingKeys = (schedule.excludedMeetingKeys || [])
    .filter(key => !key.startsWith(String(id) + "|"));
  saveSchedules();
  renderCourses();
  renderCalendarArea();
  await refreshScheduleAnalysis();
  const courseName = coursesById.get(id)?.name || "درس";
  showToast(wasSelected ? `«${courseName}» حذف شد.` : `«${courseName}» به برنامه اضافه شد.`, wasSelected ? "info" : "success");
}

async function removeCourse(id) {
  const courseName = coursesById.get(id)?.name || "درس";
  const schedule = activeSchedule();
  if (!schedule.courseIds.includes(id)) return;
  rememberScheduleState();
  schedule.courseIds = schedule.courseIds.filter(courseId => courseId !== id);
  schedule.excludedMeetingKeys = (schedule.excludedMeetingKeys || [])
    .filter(key => !key.startsWith(String(id) + "|"));
  saveSchedules();
  renderCourses();
  renderCalendarArea();
  await refreshScheduleAnalysis();
  showToast(`«${courseName}» حذف شد.`, "info");
}

function meetingKey(courseId, meeting) {
  return [courseId, meeting.day, meeting.start, meeting.end, meeting.type || ""].join("|");
}

async function removeMeeting(courseId, key) {
  const schedule = activeSchedule();
  if (!schedule.courseIds.includes(courseId) || !key) return;
  if ((schedule.excludedMeetingKeys || []).includes(key)) return;

  rememberScheduleState();
  schedule.excludedMeetingKeys = [...new Set([...(schedule.excludedMeetingKeys || []), key])];
  const course = coursesById.get(courseId);
  const remainingMeetingCount = course?.meetings.filter(meeting =>
    !schedule.excludedMeetingKeys.includes(meetingKey(courseId, meeting))
  ).length ?? 0;
  const removedWholeCourse = remainingMeetingCount === 0;
  if (removedWholeCourse) {
    schedule.courseIds = schedule.courseIds.filter(id => id !== courseId);
    schedule.excludedMeetingKeys = schedule.excludedMeetingKeys
      .filter(excludedKey => !excludedKey.startsWith(String(courseId) + "|"));
  }
  saveSchedules();
  renderCourses();
  renderCalendarArea();
  await refreshScheduleAnalysis();

  const courseName = coursesById.get(courseId)?.name || "درس";
  showToast(
    removedWholeCourse
      ? "آخرین جلسهٔ «" + courseName + "» حذف شد و درس از برنامه خارج شد."
      : "همین جلسه از «" + courseName + "» حذف شد.",
    "info"
  );
}

function selectedCourses() {
  const excludedMeetingKeys = new Set(activeSchedule().excludedMeetingKeys || []);
  return activeSchedule().courseIds
    .map(id => coursesById.get(id))
    .filter(Boolean)
    .map(course => ({
      ...course,
      meetings: course.meetings.filter(meeting => !excludedMeetingKeys.has(meetingKey(course.id, meeting)))
    }));
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : NaN;
}

function overlap(firstStart, firstEnd, secondStart, secondEnd) {
  const start1 = timeToMinutes(firstStart);
  const end1 = timeToMinutes(firstEnd);
  const start2 = timeToMinutes(secondStart);
  const end2 = timeToMinutes(secondEnd);
  return [start1, end1, start2, end2].every(Number.isFinite) && start1 < end2 && start2 < end1;
}

function findLocalConflicts(selected) {
  const classConflicts = [];
  const examConflicts = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const first = selected[i];
      const second = selected[j];
      first.meetings.forEach(a => second.meetings.forEach(b => {
        if (a.day === b.day && overlap(a.start, a.end, b.start, b.end)) {
          classConflicts.push({ firstCourseId: first.id, secondCourseId: second.id });
        }
      }));
      if (first.exam && second.exam && first.exam.date === second.exam.date && overlap(first.exam.start, first.exam.end, second.exam.start, second.exam.end)) {
        examConflicts.push({ firstCourseId: first.id, secondCourseId: second.id });
      }
    }
  }
  return { classConflicts, examConflicts, totalUnits: selected.reduce((sum, course) => sum + course.units, 0) };
}

async function refreshScheduleAnalysis() {
  const requestId = ++analysisRequestId;
  const ids = [...activeSchedule().courseIds];
  if (!ids.length) {
    scheduleAnalysis = { classConflicts: [], examConflicts: [], totalUnits: 0 };
    renderCalendarArea();
    return;
  }

  if ((activeSchedule().excludedMeetingKeys || []).length || ids.some(id => manualCourseIds.has(id))) {
    scheduleAnalysis = findLocalConflicts(selectedCourses());
    renderCalendarArea();
    return;
  }

  try {
    const result = await fetchJson(api.scheduleCheck, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseIds: ids })
    });
    if (requestId !== analysisRequestId) return;
    scheduleAnalysis = {
      classConflicts: Array.isArray(result.classConflicts) ? result.classConflicts : [],
      examConflicts: Array.isArray(result.examConflicts) ? result.examConflicts : [],
      totalUnits: Number(result.totalUnits || 0)
    };
  } catch {
    if (requestId !== analysisRequestId) return;
    scheduleAnalysis = findLocalConflicts(selectedCourses());
  }
  renderCalendarArea();
}

function layoutDayEvents(events) {
  const sorted = [...events].sort((a, b) => timeToMinutes(a.meeting.start) - timeToMinutes(b.meeting.start));
  const lanes = [];
  for (const event of sorted) {
    let lane = 0;
    while (lane < lanes.length) {
      const last = lanes[lane][lanes[lane].length - 1];
      if (timeToMinutes(last.meeting.end) <= timeToMinutes(event.meeting.start)) break;
      lane++;
    }
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(event);
    event.lane = lane;
  }
  const laneCount = Math.max(1, lanes.length);
  sorted.forEach(event => { event.laneCount = laneCount; });
  return sorted;
}

function conflictIds(conflicts) {
  const ids = new Set();
  conflicts.forEach(conflict => {
    ids.add(Number(conflict.firstCourseId));
    ids.add(Number(conflict.secondCourseId));
  });
  return ids;
}

function renderCalendarArea() {
  const selected = selectedCourses();
  const previewCourse = previewCourseId && !activeSchedule().courseIds.includes(previewCourseId)
    ? coursesById.get(previewCourseId) || null
    : null;
  const view = activeView();
  $("selectedCount").textContent = faDigits(selected.length);
  $("selectedUnits").textContent = faDigits(scheduleAnalysis.totalUnits || selected.reduce((sum, course) => sum + course.units, 0));
  $("selectedCoursesDock").innerHTML = selected.length
    ? selected.map(course => `
        <button class="selected-course-dock-chip" type="button" data-selected-course-id="${course.id}" title="حذف ${escapeHtml(course.name)} از برنامه">
          <span>${escapeHtml(course.name)}</span>
          <b aria-hidden="true">×</b>
        </button>`).join("")
    : `<span class="selected-courses-dock-empty">هنوز درسی به این برنامه اضافه نشده است.</span>`;
  document.querySelectorAll("[data-selected-course-id]").forEach(button => {
    button.addEventListener("click", () => removeCourse(Number(button.dataset.selectedCourseId)));
  });
  $("classScheduleView").hidden = view !== "classes";
  $("examScheduleView").hidden = view !== "exams";

  const visibleConflicts = view === "classes" ? scheduleAnalysis.classConflicts : scheduleAnalysis.examConflicts;
  const banner = $("conflictBanner");
  if (visibleConflicts.length) {
    banner.textContent = `در این برنامه ${faDigits(visibleConflicts.length)} ${view === "classes" ? "تداخل کلاس" : "تداخل امتحان"} وجود دارد. موارد قرمز را بررسی کنید.`;
    banner.classList.add("show");
  } else {
    banner.textContent = "";
    banner.classList.remove("show");
  }

  renderCalendar(selected, conflictIds(scheduleAnalysis.classConflicts), previewCourse);
  renderExamSchedule(selected, conflictIds(scheduleAnalysis.examConflicts), previewCourse);
  requestAnimationFrame(syncPanelHeights);
}

function renderCalendar(selected, classConflictIds, previewCourse = null) {
  let html = days.map(day => `<div class="day-header">${day}</div>`).join("") + `<div class="calendar-corner"></div>`;
  let timeAxis = `<div class="time-axis">`;
  const slotCount = (calendarEndMinutes - calendarStartMinutes) / slotMinutes;
  for (let i = 0; i <= slotCount; i++) {
    const minutes = calendarStartMinutes + i * slotMinutes;
    const label = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const edgeClass = i === 0 ? " first" : i === slotCount ? " last" : "";
    timeAxis += `<div class="time-label${edgeClass}" style="top:${i * slotHeight}px">${label}</div>`;
  }
  timeAxis += `</div>`;

  days.forEach(day => {
    const events = [];
    selected.forEach(course => course.meetings.filter(meeting => meeting.day === day).forEach(meeting => events.push({ course, meeting })));
    html += `<div class="day-column">`;
    layoutDayEvents(events).forEach(item => {
      const start = timeToMinutes(item.meeting.start);
      const end = timeToMinutes(item.meeting.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= calendarStartMinutes || start >= calendarEndMinutes) return;
      const top = ((Math.max(start, calendarStartMinutes) - calendarStartMinutes) / slotMinutes) * slotHeight;
      const height = Math.max(28, ((Math.min(end, calendarEndMinutes) - Math.max(start, calendarStartMinutes)) / slotMinutes) * slotHeight);
      const width = 100 / item.laneCount;
      const left = item.lane * width;
      const key = meetingKey(item.course.id, item.meeting);
      html += `
        <div class="calendar-event ${classConflictIds.has(item.course.id) ? "conflict" : ""}" data-calendar-course-id="${item.course.id}" data-calendar-meeting-key="${escapeHtml(key)}"
             style="top:${top}px;height:${height}px;left:calc(${left}% + 4px);width:calc(${width}% - 8px)">
          <div class="event-name">${escapeHtml(item.course.name)}</div>
          <div class="event-meta">استاد: ${escapeHtml(item.course.professors.join("، ") || "ثبت نشده")}</div>
        </div>`;
    });

    if (previewCourse) {
      previewCourse.meetings.filter(meeting => meeting.day === day).forEach(meeting => {
        const start = timeToMinutes(meeting.start);
        const end = timeToMinutes(meeting.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= calendarStartMinutes || start >= calendarEndMinutes) return;

        const top = ((Math.max(start, calendarStartMinutes) - calendarStartMinutes) / slotMinutes) * slotHeight;
        const height = Math.max(28, ((Math.min(end, calendarEndMinutes) - Math.max(start, calendarStartMinutes)) / slotMinutes) * slotHeight);
        const hasPreviewConflict = selected.some(course =>
          course.meetings.some(selectedMeeting =>
            selectedMeeting.day === day && overlap(meeting.start, meeting.end, selectedMeeting.start, selectedMeeting.end)
          )
        );

        html += `
          <div class="calendar-event preview${hasPreviewConflict ? " preview-conflict" : ""}"
               style="top:${top}px;height:${height}px;left:4px;width:calc(100% - 8px)"
               aria-hidden="true">
            <div class="event-name">${escapeHtml(previewCourse.name)}</div>
            <div class="event-meta">استاد: ${escapeHtml(previewCourse.professors.join("، ") || "ثبت نشده")}</div>
          </div>`;
      });
    }
    html += `</div>`;
  });

  const emptyOverlay = !selected.length && !previewCourse
    ? `<div class="calendar-empty-state">
        <span class="empty-state-icon">${emptyStateIcons.calendar}</span>
        <strong>برنامه هنوز خالی است</strong>
        <span>درس‌های موردنظرتان را از پنل دروس اضافه کنید.</span>
      </div>`
    : "";
  $("calendar").innerHTML = html + timeAxis + emptyOverlay;
  document.querySelectorAll("[data-calendar-course-id]").forEach(event => {
    event.addEventListener("click", () => removeCourse(Number(event.dataset.calendarCourseId)));
    event.addEventListener("contextmenu", contextMenuEvent => {
      contextMenuEvent.preventDefault();
      removeMeeting(Number(event.dataset.calendarCourseId), event.dataset.calendarMeetingKey);
    });
  });
}

function renderExamSchedule(selected, examConflictIds, previewCourse = null) {
  const heading = `
    <div class="exam-view-head">
      <div><h2 class="exam-view-title">برنامه امتحانی ${escapeHtml(activeSchedule().name)}</h2><p class="exam-view-subtitle">تاریخ، روز و ساعت امتحان درس‌های این برنامه</p></div>
      <span class="exam-order-note">مرتب‌شده بر اساس تاریخ امتحان</span>
    </div>`;

  if (!selected.length && !previewCourse) {
    $("examScheduleView").innerHTML = `${heading}${emptyStateMarkup(
      "calendar",
      "برنامه امتحانی خالی است",
      "با افزودن درس، تاریخ و ساعت امتحان آن در این بخش نمایش داده می‌شود."
    )}`;
    return;
  }

  const sorted = [
    ...selected.map(course => ({ course, isPreview: false })),
    ...(previewCourse ? [{ course: previewCourse, isPreview: true }] : [])
  ].sort((a, b) => {
    if (!a.course.exam) return 1;
    if (!b.course.exam) return -1;
    return `${a.course.exam.date}${a.course.exam.start}`.localeCompare(`${b.course.exam.date}${b.course.exam.start}`);
  });
  $("examScheduleView").innerHTML = `${heading}
    <div class="exam-table-wrap"><table class="exam-table">
      <thead><tr><th>درس و استاد</th><th>تاریخ امتحان</th><th>روز</th><th>ساعت</th></tr></thead>
      <tbody>${sorted.map(item => {
        const course = item.course;
        const previewConflict = item.isPreview && course.exam && selected.some(selectedCourse =>
          selectedCourse.exam && selectedCourse.exam.date === course.exam.date &&
          overlap(course.exam.start, course.exam.end, selectedCourse.exam.start, selectedCourse.exam.end)
        );
        return `
        <tr class="${examConflictIds.has(course.id) ? "conflict" : ""}${item.isPreview ? " preview" : ""}${previewConflict ? " preview-conflict" : ""}">
          <td class="exam-course-cell"><strong>${escapeHtml(course.name)}</strong><span>استاد: ${escapeHtml(course.professors.join("، ") || "ثبت نشده")}</span></td>
          <td class="exam-date">${course.exam?.date ? faDigits(course.exam.date) : "—"}</td>
          <td>${course.exam?.date ? escapeHtml(examWeekday(course.exam.date)) : "—"}</td>
          <td class="exam-clock">${course.exam ? escapeHtml(`${course.exam.start}–${course.exam.end}`) : "—"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

function jalaliToGregorian(jy, jm, jd) {
  const div = (a, b) => Math.trunc(a / b);
  jy += 1595;
  let count = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(count, 146097);
  count %= 146097;
  if (count > 36524) {
    gy += 100 * div(--count, 36524);
    count %= 36524;
    if (count >= 365) count++;
  }
  gy += 4 * div(count, 1461);
  count %= 1461;
  if (count > 365) {
    gy += div(count - 1, 365);
    count = (count - 1) % 365;
  }
  let gd = count + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  while (gm <= 12 && gd > monthDays[gm]) gd -= monthDays[gm++];
  return { gy, gm, gd };
}

function examWeekday(jalaliDate) {
  const [jy, jm, jd] = String(jalaliDate).split("/").map(Number);
  if (!jy || !jm || !jd) return "";
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return ["یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"][new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay()];
}

function renderAll() {
  renderScheduleTabs();
  renderViewTabs();
  renderCourses();
  renderCalendarArea();
}

let weeklyCalendarPanelHeight = 0;

function syncPanelHeights() {
  const coursesPanel = document.querySelector(".courses-panel");
  const calendarPanel = $("calendarCapture");
  const classScheduleView = $("classScheduleView");
  const workspace = $("workspace");
  const frame = $("workspaceFrame");
  if (!coursesPanel || !calendarPanel || !classScheduleView || !workspace || !frame) return;

  if (!classScheduleView.hidden) {
    weeklyCalendarPanelHeight = calendarPanel.offsetHeight;
  }
  const synchronizedHeight = Math.max(calendarPanel.offsetHeight, weeklyCalendarPanelHeight);

  if (!window.matchMedia("(max-width: 760px)").matches) {
    coursesPanel.style.height = `${synchronizedHeight}px`;
    frame.style.height = "";
    workspace.style.removeProperty("--mobile-workspace-scale");
    return;
  }

  coursesPanel.style.height = `${synchronizedHeight}px`;
  const designWidth = 1100;
  const scale = Math.min(1, frame.clientWidth / designWidth);
  workspace.style.setProperty("--mobile-workspace-scale", String(scale));
  frame.style.height = `${Math.ceil(Math.max(synchronizedHeight, coursesPanel.offsetHeight) * scale)}px`;
}

function resetFilters() {
  searchInput.value = "";
  facultyFilter.value = "";
  syncAutoBuilderSelectUi(facultyFilter);
  refreshDepartments();
  departmentFilter.value = "";
  syncAutoBuilderSelectUi(departmentFilter);
  loadCourses();
}

function manualMeetingMarkup() {
  const rowId = ++manualMeetingRowId;
  const dayOptions = [...days].reverse().map(day => `<option value="${escapeHtml(day)}">${escapeHtml(day)}</option>`).join("");
  return `
    <div class="manual-meeting-row" data-manual-meeting>
      <div class="modal-field manual-meeting-day"><label for="manualMeetingDay${rowId}">روز کلاس <span aria-hidden="true">*</span></label><select id="manualMeetingDay${rowId}" data-manual-day required><option value="">انتخاب روز</option>${dayOptions}</select></div>
      <div class="modal-field"><label for="manualMeetingStart${rowId}">شروع <span aria-hidden="true">*</span></label><input class="manual-picker-input" id="manualMeetingStart${rowId}" data-manual-start data-manual-time-picker type="text" inputmode="none" placeholder="انتخاب ساعت" readonly required aria-haspopup="dialog" /></div>
      <div class="modal-field"><label for="manualMeetingEnd${rowId}">پایان <span aria-hidden="true">*</span></label><input class="manual-picker-input" id="manualMeetingEnd${rowId}" data-manual-end data-manual-time-picker type="text" inputmode="none" placeholder="انتخاب ساعت" readonly required aria-haspopup="dialog" /></div>
      <button class="btn manual-meeting-remove" type="button" data-remove-manual-meeting title="حذف جلسه" aria-label="حذف این جلسه">×</button>
    </div>`;
}

function updateManualMeetingButtons() {
  const buttons = $("manualMeetings").querySelectorAll("[data-remove-manual-meeting]");
  buttons.forEach(button => { button.disabled = buttons.length === 1; });
}

function addManualMeeting() {
  $("manualMeetings").insertAdjacentHTML("beforeend", manualMeetingMarkup());
  updateManualMeetingButtons();
}

function showManualCourseError(message = "") {
  const error = $("manualCourseError");
  error.textContent = message;
  error.hidden = !message;
}

function gregorianToJalali(gy, gm, gd) {
  const gregorianMonthDays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const adjustedYear = gm > 2 ? gy + 1 : gy;
  let days = 355666 + (365 * gy) + Math.floor((adjustedYear + 3) / 4)
    - Math.floor((adjustedYear + 99) / 100) + Math.floor((adjustedYear + 399) / 400) + gd;
  for (let month = 1; month < gm; month++) days += gregorianMonthDays[month];

  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

function normalizeJalaliDate(value) {
  const match = String(value || "").match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  const maximumDay = jalaliMonthLength(jy, jm);
  const isInExamRange = (jm === 10 && jd >= 20) || (jm === 11 && jd <= 20);
  if (jy !== 1405 || !maximumDay || jd < 1 || jd > maximumDay || !isInExamRange) return null;
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

function jalaliMonthLength(jy, jm) {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  if (jm !== 12) return 0;
  const current = jalaliToGregorian(jy, 12, 1);
  const next = jalaliToGregorian(jy + 1, 1, 1);
  return Math.round((Date.UTC(next.gy, next.gm - 1, next.gd) - Date.UTC(current.gy, current.gm - 1, current.gd)) / 86400000);
}

function closeManualPicker() {
  const popover = $("manualPickerPopover");
  popover.hidden = true;
  popover.innerHTML = "";
  activeManualPickerInput = null;
}

function positionManualPicker(input) {
  const popover = $("manualPickerPopover");
  const anchor = input.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, anchor.right - width));
  const top = anchor.bottom + height + 8 <= window.innerHeight
    ? anchor.bottom + 6
    : Math.max(12, anchor.top - height - 6);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function openManualDatePicker(input) {
  activeManualPickerInput = input;
  renderManualDatePicker();
  positionManualPicker(input);
}

function renderManualDatePicker() {
  const popover = $("manualPickerPopover");
  const weekdays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  const firstGregorian = jalaliToGregorian(1405, 10, 20);
  const firstWeekday = (new Date(Date.UTC(firstGregorian.gy, firstGregorian.gm - 1, firstGregorian.gd)).getUTCDay() + 1) % 7;
  const selected = normalizeJalaliDate(activeManualPickerInput?.value);
  const daysMarkup = [
    ...Array.from({ length: firstWeekday }, () => `<span class="manual-calendar-day placeholder"></span>`),
    ...Array.from({ length: 31 }, (_, index) => {
      const month = index <= 10 ? 10 : 11;
      const day = index <= 10 ? index + 20 : index - 10;
      const value = `1405/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
      return `<button class="manual-calendar-day${selected === value ? " selected" : ""}${day === 1 ? " month-start" : ""}" type="button" data-manual-date="${value}" title="${faDigits(day)} ${month === 10 ? "دی" : "بهمن"}">${faDigits(day)}</button>`;
    })
  ].join("");
  popover.innerHTML = `
    <div class="manual-picker-head">
      <strong class="manual-picker-title">۲۰ دی تا ۲۰ بهمن ۱۴۰۵</strong>
    </div>
    <div class="manual-calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join("")}</div>
    <div class="manual-calendar-days">${daysMarkup}</div>
    <div class="manual-picker-actions"><button class="btn" type="button" data-manual-picker-clear>پاک کردن</button></div>`;
  popover.hidden = false;
}

function openManualTimePicker(input) {
  activeManualPickerInput = input;
  const [storedHours, storedMinutes] = String(input.dataset.timeValue || input.value || "08:00").split(":").map(Number);
  const period = storedHours >= 12 ? "pm" : "am";
  const hour = storedHours % 12 || 12;
  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  const minutes = [0, 30];
  const selectedMinute = storedMinutes >= 30 ? 30 : 0;
  const popover = $("manualPickerPopover");
  popover.innerHTML = `
    <div class="manual-picker-head"><strong class="manual-picker-title">انتخاب ساعت</strong></div>
    <div class="manual-time-picker-grid">
      <div class="manual-time-column"><label for="manualPickerHour">ساعت</label><select id="manualPickerHour">${hours.map(value => `<option value="${value}"${value === hour ? " selected" : ""}>${faDigits(String(value).padStart(2, "0"))}</option>`).join("")}</select></div>
      <div class="manual-time-column"><label for="manualPickerMinute">دقیقه</label><select id="manualPickerMinute">${minutes.map(value => `<option value="${value}"${value === selectedMinute ? " selected" : ""}>${faDigits(String(value).padStart(2, "0"))}</option>`).join("")}</select></div>
      <div class="manual-time-column"><label for="manualPickerPeriod">بازه روز</label><select id="manualPickerPeriod"><option value="am"${period === "am" ? " selected" : ""}>قبل‌ازظهر</option><option value="pm"${period === "pm" ? " selected" : ""}>بعدازظهر</option></select></div>
    </div>
    <div class="manual-picker-actions">
      ${input.required ? "" : `<button class="btn" type="button" data-manual-picker-clear>پاک کردن</button>`}
      <button class="btn btn-primary" type="button" data-manual-time-confirm>ثبت زمان</button>
    </div>`;
  popover.hidden = false;
  positionManualPicker(input);
}

function commitManualTimePicker() {
  if (!activeManualPickerInput || !$("manualPickerHour")) return;
  const hour = Number($("manualPickerHour").value);
  const minute = Number($("manualPickerMinute").value);
  const period = $("manualPickerPeriod").value;
  const hour24 = period === "pm" ? (hour % 12) + 12 : hour % 12;
  const value = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  activeManualPickerInput.value = value;
  activeManualPickerInput.dataset.timeValue = value;
  activeManualPickerInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function openManualCourseModal() {
  manualCourseModalTrigger = document.activeElement;
  closeManualPicker();
  $("manualCourseForm").reset();
  $("manualCourseForm").querySelectorAll("[data-time-value]").forEach(input => delete input.dataset.timeValue);
  $("manualMeetings").innerHTML = "";
  addManualMeeting();
  showManualCourseError();
  $("manualCourseModal").classList.add("open");
  $("manualCourseModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("dialog-open");
  $("manualCourseDialog").focus();
  setTimeout(() => $("manualCourseName").focus(), 40);
}

function closeManualCourseModal() {
  closeManualPicker();
  $("manualCourseModal").classList.remove("open");
  $("manualCourseModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("dialog-open");
  manualCourseModalTrigger?.focus?.();
}

async function addManualCourse(event) {
  event.preventDefault();
  const form = $("manualCourseForm");
  showManualCourseError();
  if (!form.reportValidity()) return;
  const name = persianizeText($("manualCourseName").value).trim();
  const professor = persianizeText($("manualProfessorName").value).trim();
  if (!name) {
    showManualCourseError("نام درس را وارد کنید.");
    $("manualCourseName").focus();
    return;
  }

  const meetings = [...$("manualMeetings").querySelectorAll("[data-manual-meeting]")].map(row => ({
    type: "کلاس",
    day: row.querySelector("[data-manual-day]").value,
    start: row.querySelector("[data-manual-start]").value,
    end: row.querySelector("[data-manual-end]").value
  }));
  if (meetings.some(meeting => !meeting.day || !meeting.start || !meeting.end)) {
    showManualCourseError("روز، ساعت شروع و ساعت پایان همهٔ جلسه‌ها را کامل کنید.");
    return;
  }
  if (meetings.some(meeting => timeToMinutes(meeting.start) >= timeToMinutes(meeting.end))) {
    showManualCourseError("ساعت پایان هر جلسه باید بعد از ساعت شروع باشد.");
    return;
  }

  const examDate = normalizeJalaliDate($("manualExamDate").value);
  const examStart = $("manualExamStart").value;
  const examEnd = $("manualExamEnd").value;
  const hasExamDetails = Boolean(examDate || examStart || examEnd);
  if (hasExamDetails && (!examDate || !examStart || !examEnd)) {
    showManualCourseError("برای ثبت امتحان، تاریخ و هر دو ساعت شروع و پایان را کامل کنید.");
    return;
  }
  if (hasExamDetails && timeToMinutes(examStart) >= timeToMinutes(examEnd)) {
    showManualCourseError("ساعت پایان امتحان باید بعد از ساعت شروع باشد.");
    return;
  }

  const id = nextManualCourseId--;
  const course = {
    id,
    code: "دستی",
    group: "",
    name,
    units: 0,
    practicalUnits: 0,
    faculty: "درس دلخواه",
    department: "",
    capacity: 0,
    registered: 0,
    waitlist: 0,
    gender: "",
    restrictions: "",
    notes: "",
    professors: professor ? [professor] : [],
    meetings,
    exam: hasExamDetails ? { date: examDate, start: examStart, end: examEnd } : null,
    isManual: true
  };

  rememberScheduleState();
  manualCourseIds.add(id);
  coursesById.set(id, course);
  activeSchedule().courseIds.push(id);
  saveSchedules();
  renderCalendarArea();
  await refreshScheduleAnalysis();
  closeManualCourseModal();
  showToast(`«${name}» به برنامه اضافه شد.`, "success");
}

const toastIcons = {
  success: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.2 3.4 3.4 7.7-8"></path></svg>`,
  error: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8 8 8M16 8l-8 8"></path></svg>`,
  warning: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.5 19h17L12 4Z"></path><path d="M12 9v4M12 16.5h.01"></path></svg>`,
  info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 10.5V17M12 7.5h.01"></path></svg>`
};

function hideToast() {
  const toast = $("toast");
  clearTimeout(showToast.timer);
  toast.classList.remove("show");
}

function showToast(text, type = "info", duration = 2800) {
  const toast = $("toast");
  const normalizedType = Object.prototype.hasOwnProperty.call(toastIcons, type) ? type : "info";
  $("toastMessage").textContent = text;
  $("toastIcon").innerHTML = toastIcons[normalizedType];
  toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");
  toast.classList.remove("show", "toast-success", "toast-error", "toast-warning", "toast-info");
  toast.classList.add(`toast-${normalizedType}`);
  toast.style.setProperty("--toast-duration", `${duration}ms`);
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(hideToast, duration);
}

async function scheduleCanvas(target, scale) {
  if (typeof globalThis.html2canvas !== "function") throw new Error("html2canvas unavailable");
  if (!target) throw new Error("Capture target unavailable");

  if (document.fonts) {
    await Promise.all([
      document.fonts.load('400 16px "Vazirmatn"', "برنامه هفتگی دانشگاه شهید بهشتی"),
      document.fonts.load('900 16px "Vazirmatn"', "آزمایشگاه زیست‌شناسی")
    ]);
    await document.fonts.ready;
  }

  const previousInlineZoom = document.body.style.zoom;
  const stage = document.createElement("div");

  try {
    document.body.style.zoom = "1";

    stage.style.position = "fixed";
    stage.style.inset = "0 auto auto 0";
    stage.style.zIndex = "-1";
    stage.style.pointerEvents = "none";

    const captureFrame = document.createElement("div");
    captureFrame.className = "schedule-image-frame";
    captureFrame.dataset.imageCaptureRoot = "true";
    captureFrame.style.width = `${Math.ceil(target.offsetWidth)}px`;

    const captureTarget = target.cloneNode(true);
    captureTarget.style.width = `${Math.ceil(target.offsetWidth)}px`;
    captureTarget.style.transform = "none";
    captureTarget.removeAttribute("id");
    captureTarget.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));

    const watermark = document.createElement("div");
    watermark.className = "schedule-image-watermark";
    watermark.dir = "ltr";
    watermark.textContent = "sbucalendar.ir";

    captureFrame.append(captureTarget, watermark);
    stage.append(captureFrame);
    document.body.append(stage);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return await globalThis.html2canvas(captureFrame, {
      scale,
      useCORS: false,
      backgroundColor: "#fffdf8",
      logging: false,
      width: Math.ceil(captureFrame.scrollWidth),
      height: Math.ceil(captureFrame.scrollHeight),
      windowWidth: Math.ceil(captureFrame.scrollWidth),
      windowHeight: Math.ceil(captureFrame.scrollHeight),
      onclone: clonedDocument => {
        const captureRoot = clonedDocument.querySelector('[data-image-capture-root="true"]');
        if (!captureRoot) return;

        captureRoot.style.letterSpacing = "normal";
        captureRoot.style.fontFamily = '"Vazirmatn", Tahoma, Arial, sans-serif';

        captureRoot.querySelectorAll("*").forEach(element => {
          element.style.letterSpacing = "normal";
          element.style.animation = "none";
          element.style.transition = "none";
        });

        captureRoot.querySelectorAll(".event-name").forEach(element => {
          element.style.overflow = "visible";
          element.style.textOverflow = "clip";
          element.style.whiteSpace = "normal";
          const title = element.textContent.trim();
          if (title.length > 26) element.textContent = `${title.slice(0, 23)}...`;
        });

        captureRoot.querySelectorAll(".event-meta, .event-time, .exam-table th, .exam-table td").forEach(element => {
          element.style.overflow = "visible";
          element.style.overflowWrap = "normal";
          element.style.wordBreak = "normal";
          element.style.textOverflow = "clip";
        });

        captureRoot.querySelectorAll(".calendar-event.preview, .exam-table tr.preview").forEach(element => element.remove());
      }
    });
  } finally {
    stage.remove();
    if (previousInlineZoom) document.body.style.zoom = previousInlineZoom;
    else document.body.style.removeProperty("zoom");
  }
}

async function downloadScheduleImage() {
  if (!selectedCourses().length) {
    showToast("ابتدا چند درس به برنامه اضافه کنید.", "warning");
    return;
  }
  const source = activeView() === "exams" ? $("examScheduleView") : $("calendar");
  try {
    showToast("در حال ساخت تصویر باکیفیت…", "info", 8000);
    const canvas = await scheduleCanvas(source, 4);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG generation failed");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeSchedule().name}-${activeView() === "exams" ? "امتحانات" : "هفتگی"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("تصویر برنامه دانلود شد.", "success");
  } catch {
    showToast("ساخت تصویر انجام نشد.", "error");
  }
}

function openGoogleModal() {
  if (!selectedCourses().length) {
    showToast("ابتدا چند درس به برنامه اضافه کنید.", "warning");
    return;
  }
  $("googleModal").classList.add("open");
  $("googleModal").setAttribute("aria-hidden", "false");
  $("semesterStart").focus();
}

function closeGoogleModal() {
  $("googleModal").classList.remove("open");
  $("googleModal").setAttribute("aria-hidden", "true");
}

let aboutModalTrigger = null;

function openAboutModal() {
  aboutModalTrigger = document.activeElement;
  $("aboutModal").classList.add("open");
  $("aboutModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("dialog-open");
  $("aboutDialog").focus();
}

function closeAboutModal() {
  $("aboutModal").classList.remove("open");
  $("aboutModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("dialog-open");
  aboutModalTrigger?.focus?.();
}

function hideDesktopNotice() {
  const notice = $("desktopNotice");
  clearTimeout(hideDesktopNotice.timer);
  notice.classList.remove("show");
  notice.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (!notice.classList.contains("show")) notice.hidden = true;
  }, reducedMotionQuery.matches ? 0 : 380);
}

function showDesktopNoticeIfDue() {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  let lastShown = 0;
  try { lastShown = Number(localStorage.getItem(desktopNoticeStorageKey) || 0); } catch {  }
  if (Date.now() - lastShown < desktopNoticeInterval) return;

  try { localStorage.setItem(desktopNoticeStorageKey, String(Date.now())); } catch {  }
  const notice = $("desktopNotice");
  notice.hidden = false;
  notice.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => requestAnimationFrame(() => notice.classList.add("show")));
  clearTimeout(hideDesktopNotice.timer);
  hideDesktopNotice.timer = setTimeout(hideDesktopNotice, desktopNoticeDuration);
}

const pad2 = number => String(number).padStart(2, "0");
const icsDate = date => `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
function icsDateTime(date, time) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${icsDate(date)}T${pad2(hours)}${pad2(minutes)}00`;
}
function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}
function escapeIcs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function exportIcs() {
  const startValue = $("semesterStart").value;
  const weeks = Math.max(1, Math.min(30, Number($("semesterWeeks").value) || 16));
  if (!startValue) {
    showToast("تاریخ اولین شنبه ترم را وارد کنید.", "warning");
    return;
  }
  const startDate = new Date(`${startValue}T00:00:00`);
  const dayIndex = { "شنبه": 0, "یک‌شنبه": 1, "دوشنبه": 2, "سه‌شنبه": 3, "چهارشنبه": 4, "پنج‌شنبه": 5 };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SbuCalendar//Schedule//FA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  selectedCourses().forEach(course => course.meetings.forEach(meeting => {
    const date = addDays(startDate, dayIndex[meeting.day] ?? 0);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${activeSchedule().id}-${course.id}-${meeting.day}-${meeting.start}@sbucalendar.local`,
      `DTSTAMP:${icsDateTime(new Date(), "00:00")}Z`,
      `DTSTART:${icsDateTime(date, meeting.start)}`,
      `DTEND:${icsDateTime(date, meeting.end)}`,
      `RRULE:FREQ=WEEKLY;COUNT=${weeks}`,
      `SUMMARY:${escapeIcs(course.name)}`,
      `DESCRIPTION:${escapeIcs(course.professors.join("، "))}`,
      "END:VEVENT"
    );
  }));
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${activeSchedule().name}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  closeGoogleModal();
  showToast("فایل Calendar آماده شد.", "success");
}

let searchTimer;
initializeAutoBuilderSelects();
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCourses(), 320);
});
facultyFilter.addEventListener("change", () => { refreshDepartments(); loadCourses(); });
departmentFilter.addEventListener("change", () => loadCourses());
$("manualCourseBtn").addEventListener("click", openManualCourseModal);
$("cancelManualCourseBtn").addEventListener("click", closeManualCourseModal);
$("addManualMeetingBtn").addEventListener("click", addManualMeeting);
$("manualMeetings").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-manual-meeting]");
  if (!button || button.disabled) return;
  if (button.closest("[data-manual-meeting]")?.contains(activeManualPickerInput)) closeManualPicker();
  button.closest("[data-manual-meeting]")?.remove();
  updateManualMeetingButtons();
});
$("manualCourseForm").addEventListener("submit", event => void addManualCourse(event));
$("manualPickerPopover").addEventListener("click", event => {
  const dateButton = event.target.closest("[data-manual-date]");
  if (dateButton && activeManualPickerInput) {
    const input = activeManualPickerInput;
    input.value = dateButton.dataset.manualDate;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    closeManualPicker();
    input.focus();
    return;
  }

  if (event.target.closest("[data-manual-picker-clear]") && activeManualPickerInput) {
    const input = activeManualPickerInput;
    input.value = "";
    delete input.dataset.timeValue;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    closeManualPicker();
    input.focus();
    return;
  }

  if (event.target.closest("[data-manual-time-confirm]") && activeManualPickerInput) {
    const input = activeManualPickerInput;
    commitManualTimePicker();
    closeManualPicker();
    input.focus();
  }
});
$("manualPickerPopover").addEventListener("change", event => {
  if (event.target.matches("#manualPickerHour, #manualPickerMinute, #manualPickerPeriod")) commitManualTimePicker();
});
document.addEventListener("click", event => {
  const input = event.target.closest?.("#manualExamDate, [data-manual-time-picker]");
  if (input && $("manualCourseModal").classList.contains("open")) {
    event.preventDefault();
    if (activeManualPickerInput && activeManualPickerInput !== input) commitManualTimePicker();
    if (input.id === "manualExamDate") openManualDatePicker(input);
    else openManualTimePicker(input);
    return;
  }
  if (activeManualPickerInput && !event.target.closest?.("#manualPickerPopover")) {
    commitManualTimePicker();
    closeManualPicker();
  }
});
$("autoBuilderBtn").addEventListener("click", openAutoBuilderModal);
$("closeAutoBuilderModal").addEventListener("click", closeAutoBuilderModal);
$("autoBuilderBackBtn").addEventListener("click", () => showAutoBuilderStep("selection"));
$("generateSchedulesBtn").addEventListener("click", generateAutoSchedules);
$("autoBuilderSuggestions").addEventListener("click", event => {
  const button = event.target.closest("[data-auto-course-code]");
  if (button && !button.disabled) selectAutoBuilderSuggestion(button.dataset.autoCourseCode);
});
$("autoBuilderSearch").addEventListener("input", () => {
  clearTimeout(autoBuilderSearchTimer);
  autoBuilderSearchTimer = setTimeout(searchAutoBuilderCourses, 280);
});
$("autoBuilderFaculty").addEventListener("change", () => {
  refreshAutoBuilderDepartments();
  void searchAutoBuilderCourses();
});
$("autoBuilderDepartment").addEventListener("change", () => void searchAutoBuilderCourses());
$("newScheduleBtn").addEventListener("click", addSchedule);
$("deleteScheduleBtn").addEventListener("click", deleteSchedule);
document.querySelectorAll(".view-tab[data-view]").forEach(button => button.addEventListener("click", () => {
  activeSchedule().view = button.dataset.view;
  saveSchedules();
  renderViewTabs();
  renderCalendarArea();
}));
$("downloadImageBtn").addEventListener("click", downloadScheduleImage);
$("googleCalendarBtn").addEventListener("click", openGoogleModal);
$("closeGoogleModal").addEventListener("click", closeGoogleModal);
$("cancelGoogleBtn").addEventListener("click", closeGoogleModal);
$("exportIcsBtn").addEventListener("click", exportIcs);
$("toastCloseBtn").addEventListener("click", hideToast);
$("aboutSiteBtn").addEventListener("click", openAboutModal);
$("desktopNoticeClose").addEventListener("click", hideDesktopNotice);
$("manualCourseModal").addEventListener("click", event => { if (event.target === $("manualCourseModal")) closeManualCourseModal(); });
$("autoBuilderModal").addEventListener("click", event => { if (event.target === $("autoBuilderModal")) closeAutoBuilderModal(); });
$("googleModal").addEventListener("click", event => { if (event.target === $("googleModal")) closeGoogleModal(); });
$("aboutModal").addEventListener("click", event => { if (event.target === $("aboutModal")) closeAboutModal(); });
document.addEventListener("keydown", event => {
  const target = event.target;
  const isTyping = target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable);
  const hasCommandModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
  const key = event.key.toLowerCase();
  const code = event.code;

  if (hasCommandModifier && !isTyping) {
    const isZ = key === "z" || code === "KeyZ";
    const wantsUndo = isZ && !event.shiftKey;
    const wantsRedo = key === "u" || code === "KeyU" || key === "y" || code === "KeyY" || (isZ && event.shiftKey);
    if (wantsUndo || wantsRedo) {
      event.preventDefault();
      if (wantsUndo) void undoScheduleChange();
      else void redoScheduleChange();
      return;
    }
  }

  if (event.key === "Escape") {
    if (activeManualPickerInput) {
      event.preventDefault();
      closeManualPicker();
      return;
    }
    if (closeAutoBuilderSelectMenus()) {
      event.preventDefault();
      return;
    }
    hideCourseExtraDetails();
    if ($("manualCourseModal").classList.contains("open")) closeManualCourseModal();
    else if ($("autoBuilderModal").classList.contains("open")) closeAutoBuilderModal();
    else if ($("aboutModal").classList.contains("open")) closeAboutModal();
    else closeGoogleModal();
  }
});
let panelResizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(panelResizeFrame);
  panelResizeFrame = requestAnimationFrame(syncPanelHeights);
});
if ("ResizeObserver" in window) new ResizeObserver(syncPanelHeights).observe($("calendarCapture"));

async function initialize() {
  renderScheduleTabs();
  renderViewTabs();
  renderCalendarArea();
  await Promise.all([loadFilters(), loadCourses()]);
  await hydrateSelectedCourses();
  await refreshScheduleAnalysis();
}

initialize();
setTimeout(showDesktopNoticeIfDue, 700);
