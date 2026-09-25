const state = { doctors: [], sessions: [] };
const $ = (selector) => document.querySelector(selector);
const doctorSelect = $("#doctor");
const dateInput = $("#date");
const sessionSelect = $("#session");
const message = $("#form-message");
const menuToggle = $(".menu-toggle");
const mainNav = $(".main-nav");

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const open = mainNav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  mainNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
}

function setMessage(text = "") { message.textContent = text; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function tomorrow() { const date = new Date(); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10); }
function formatTime(value) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "We could not complete that request.");
  return data;
}

function renderDoctors() {
  const list = $("#doctor-list");
  list.innerHTML = state.doctors.length
    ? state.doctors.map((doctor) => `<article class="doctor-card"><div><p>Specialist</p><h3>${doctor.displayName}</h3></div><button type="button" data-doctor="${doctor.id}">Book with this doctor <span aria-hidden="true">&#8594;</span></button></article>`).join("")
    : '<p class="empty-state">Doctor profiles are being updated. Please check back soon or contact the hospital.</p>';
  list.querySelectorAll("[data-doctor]").forEach((button) => button.addEventListener("click", () => { doctorSelect.value = button.dataset.doctor; $("#book").scrollIntoView({ behavior: "smooth" }); dateInput.focus(); }));
  doctorSelect.insertAdjacentHTML("beforeend", state.doctors.map((doctor) => `<option value="${doctor.id}" data-slug="${doctor.slug}">${doctor.displayName}</option>`).join(""));
}

function renderDepartments(departments) {
  const list = $("#department-list");
  list.innerHTML = departments.length
    ? departments.map((department) => `<article class="service-card"><span class="service-icon">+</span><h3>${department.name}</h3><p>Hospital department information is available through the care team.</p><a class="text-button" href="#book">Book an appointment <span aria-hidden="true">&#8594;</span></a></article>`).join("")
    : '<p class="empty-state">Services and departments are being updated. Please check back soon.</p>';
}

function renderDiagnostics(services) {
  const list = $("#diagnostic-list");
  list.innerHTML = services.length
    ? services.map((service) => `<article class="service-card diagnostic-card"><p class="diagnostic-category">${escapeHtml(service.category)}</p><h3>${escapeHtml(service.name)}</h3>${service.description ? `<p>${escapeHtml(service.description)}</p>` : ""}<strong class="diagnostic-price">${service.price === null ? "Contact the centre" : `₹${Number(service.price).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${service.priceNote ? ` ${escapeHtml(service.priceNote)}` : ""}`}</strong></article>`).join("")
    : '<p class="empty-state">Diagnostic and laboratory services will be listed here soon.</p>';
}

async function loadAvailability() {
  sessionSelect.disabled = true;
  sessionSelect.innerHTML = "<option value=\"\">Checking availability...</option>";
  if (!doctorSelect.value || !dateInput.value) return;
  try {
    const slug = doctorSelect.selectedOptions[0]?.dataset.slug;
    const data = await getJson(`/api/public/doctors/${encodeURIComponent(slug)}/availability?date=${dateInput.value}`);
    state.sessions = data.sessions;
    sessionSelect.innerHTML = data.sessions.length ? data.sessions.map((session) => `<option value="${session.scheduleId}">${session.startLocal.slice(0, 5)} - ${session.endLocal.slice(0, 5)} (${session.bookingMode === "EXCLUSIVE" ? "Choose a time" : "Serial"})</option>`).join("") : "<option value=\"\">No sitting on this date</option>";
    sessionSelect.disabled = !data.sessions.length;
  } catch (error) { sessionSelect.innerHTML = `<option value="">${error.message}</option>`; }
}

dateInput.min = tomorrow();
dateInput.addEventListener("change", loadAvailability);
doctorSelect.addEventListener("change", loadAvailability);
$("#booking-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage("");
  const form = new FormData(event.currentTarget);
  if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return; }
  const patientMobile = String(form.get("mobile")).replace(/[ ()-]/g, "");
  const body = { doctorId: "", scheduleId: String(form.get("session")), date: String(form.get("date")), source: "ONLINE", patient: { fullName: String(form.get("fullName")).trim(), mobile: patientMobile }, slotLocal: null, overrideReason: null, repeatReason: null };
  body.doctorId = String(form.get("doctor"));
  const button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true; button.querySelector("span").textContent = "Saving appointment...";
  try {
    const booking = await getJson("/api/public/appointments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") }, body: JSON.stringify(body) });
    $("#confirmation-reference").textContent = booking.reference;
    $("#confirmation-date").textContent = booking.date;
    $("#confirmation-serial").textContent = `#${booking.serialNumber}`;
    $("#confirmation-time").textContent = formatTime(booking.estimatedStartAt);
    $("#confirmation").hidden = false; $("#book").hidden = true; $("#confirmation").scrollIntoView({ behavior: "smooth" });
  } catch (error) { setMessage(error.message); }
  button.disabled = false; button.querySelector("span").textContent = "Confirm appointment";
});

(async function init() {
  try {
    const [hospital, doctors, departments, diagnostics] = await Promise.all([getJson("/api/public/hospital"), getJson("/api/public/doctors"), getJson("/api/public/departments"), getJson("/api/public/diagnostics")]);
    $("#hospital-name").textContent = hospital.displayName; $("#footer-name").textContent = hospital.displayName;
    state.doctors = doctors; renderDepartments(departments); renderDiagnostics(diagnostics); renderDoctors();
  } catch (error) { $("#doctor-list").innerHTML = `<p class="loading">${error.message}</p>`; $("#doctor-hint").textContent = "Doctors are temporarily unavailable."; }
})();
