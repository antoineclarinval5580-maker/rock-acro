import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY, QUOTA_MB } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stars = n => n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
const STATUS = { a_apprendre: "À apprendre", en_cours: "En cours", maitrise: "Maîtrisé" };
const MAXB = 50 * 1024 * 1024;

let me = null, profile = null, settings = { signups_open: false };
let MOVES = [], PROG = {}, MYVIDS = [], list = [], cur = 0, speed = 1;
let filter = "all", vfilter = "all", sfilter = "all", dfilter = "all", sort = "ord", q = "";
let trim = null, trimOff = false;
let started = false, loaded = false;

function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
const pub = p => p ? sb.storage.from("library").getPublicUrl(p).data.publicUrl : "";
const hasVid = m => !!m.video_path;
const stamp = () => Date.now().toString(36);

// ---------------- Étoiles ----------------
const RATE = {};
function setupRate(el) {
  const key = el.dataset.rate; RATE[key] = 0;
  el.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} étoile${n > 1 ? "s" : ""}">★</button>`).join("") + '<button type="button" class="clr" data-n="0">effacer</button>';
  el.querySelectorAll("[data-n]").forEach(b => b.onclick = () => setRate(key, +b.dataset.n));
}
function setRate(key, n) { RATE[key] = n || 0; document.querySelectorAll(`[data-rate="${key}"] [data-n]`).forEach(b => { if (+b.dataset.n) b.classList.toggle("on", +b.dataset.n <= RATE[key]); }); }
document.querySelectorAll("[data-rate]").forEach(setupRate);

// ---------------- Auth ----------------
function amsg(t, err) { $("#a-msg").textContent = t || ""; $("#a-msg").className = "msg" + (err ? " err" : ""); }
$$("[data-auth]").forEach(b => b.onclick = () => {
  $$("[data-auth]").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#f-login").hidden = b.dataset.auth !== "login"; $("#f-signup").hidden = b.dataset.auth !== "signup"; $("#f-newpass").hidden = true; amsg("");
});
$("#f-login").onsubmit = async e => {
  e.preventDefault(); amsg("Connexion…");
  const { error } = await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value });
  if (error) amsg(error.message.includes("Invalid") ? "E-mail ou mot de passe incorrect." : error.message.includes("confirm") ? "Confirme d'abord ton e-mail (regarde tes mails)." : error.message, 1);
};
$("#f-signup").onsubmit = async e => {
  e.preventDefault(); amsg("Création du profil…");
  const { data, error } = await sb.auth.signUp({
    email: $("#s-email").value.trim(), password: $("#s-pass").value,
    options: { data: { display_name: $("#s-name").value.trim() }, emailRedirectTo: location.origin + location.pathname }
  });
  if (error) { amsg(/fermées|Database error/i.test(error.message) ? "Les inscriptions sont fermées pour le moment. Demande à l'animateur." : error.message, 1); return; }
  if (!data.session) amsg("Profil créé ! Clique sur le lien reçu par e-mail pour l'activer, puis connecte-toi.");
};
$("#forgot").onclick = async () => {
  const email = $("#l-email").value.trim(); if (!email) { amsg("Écris d'abord ton e-mail ci-dessus.", 1); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  amsg(error ? error.message : "Un lien pour changer ton mot de passe t'a été envoyé par e-mail.", !!error);
};
$("#f-newpass").onsubmit = async e => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#n-pass").value });
  if (error) amsg(error.message, 1); else { amsg(""); $("#f-newpass").hidden = true; start(); }
};
$("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "PASSWORD_RECOVERY") { $("#app").hidden = true; $("#auth").hidden = false; $("#f-login").hidden = $("#f-signup").hidden = true; $("#f-newpass").hidden = false; amsg("Choisis un nouveau mot de passe."); return; }
  const was = me; me = session?.user || null;
  if (me && !was) start(); if (!me && was) location.reload();
});
(async () => { const { data } = await sb.auth.getSession(); me = data.session?.user || null; if (me) start(); else { $("#auth").hidden = false; } })();

// ---------------- Chargement ----------------
async function start() {
  if (started) return; started = true;
  $("#auth").hidden = true; $("#app").hidden = false; render();
  const [p, s] = await Promise.all([
    sb.from("profiles").select("*").eq("id", me.id).maybeSingle(),
    sb.from("settings").select("*").eq("id", 1).maybeSingle()
  ]);
  profile = p.data; settings = s.data || settings;
  $("#hello").textContent = profile ? `Salut ${profile.display_name} !` : "";
  $("#nav-admin").hidden = !profile?.is_admin;
  if (!profile || !profile.approved) {
    $("#v-lib").hidden = true; $("#v-wait").hidden = false; $$("[data-view]").forEach(b => b.hidden = true);
    if (!profile) $("#v-wait").querySelector("span").textContent = "Ton accès n'a pas été accepté. Contacte l'animateur si c'est une erreur.";
    return;
  }
  await Promise.all([loadMoves(), loadMine()]);
  loaded = true; render();
}
async function loadMoves() {
  const { data, error } = await sb.from("moves").select("*").order("ord");
  if (error) { $("#empty-t").textContent = "Erreur de chargement"; $("#empty-s").textContent = error.message; return; }
  MOVES = data;
}
async function loadMine() {
  const [p, v] = await Promise.all([
    sb.from("progress").select("*").eq("user_id", me.id),
    sb.from("user_videos").select("*").eq("user_id", me.id).order("created_at", { ascending: false })
  ]);
  PROG = Object.fromEntries((p.data || []).map(r => [r.move_id, r.status]));
  MYVIDS = v.data || [];
}

// ---------------- Navigation ----------------
$$("[data-view]").forEach(b => b.onclick = () => {
  $$("[data-view]").forEach(x => x.setAttribute("aria-pressed", x === b));
  for (const v of ["lib", "journal", "admin"]) $("#v-" + v).hidden = v !== b.dataset.view;
  if (b.dataset.view === "journal") renderJournal();
  if (b.dataset.view === "admin") renderAdmin();
});

// ---------------- Bibliothèque ----------------
function render() {
  const nq = norm(q);
  list = MOVES.filter(m => (filter === "all" || m.kind === filter)
    && (vfilter === "all" || (vfilter === "vid" ? hasVid(m) : !hasVid(m)))
    && (sfilter === "all" || (sfilter === "none" ? !PROG[m.id] : PROG[m.id] === sfilter))
    && (dfilter === "all" || +m.diff === +dfilter)
    && (!nq || norm(m.name + " " + (m.note || "") + " " + (m.description || "")).includes(nq)));
  const dv = m => m.diff || 0;
  if (sort === "dup") list.sort((a, b) => (dv(a) || 9) - (dv(b) || 9) || a.ord - b.ord);
  if (sort === "ddown") list.sort((a, b) => dv(b) - dv(a) || a.ord - b.ord);
  if (sort === "az") list.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
  const nv = MOVES.filter(hasVid).length, n = MOVES.filter(m => PROG[m.id] === "maitrise").length;
  $("#count").textContent = loaded ? `${nv} vidéo${nv > 1 ? "s" : ""} · ${MOVES.length - nv} à filmer · ${n} maîtrisé${n > 1 ? "s" : ""}` : "";
  const mineCount = id => MYVIDS.filter(v => v.move_id === id).length;
  $("#grid").innerHTML = list.map((m, i) => {
    const st = PROG[m.id], mc = mineCount(m.id);
    return `<div class="move" role="button" tabindex="0" data-i="${i}" aria-label="Voir ${esc(m.name)}">
      ${m.poster_path ? `<div class="thumb"><img src="${pub(m.poster_path)}" alt="" loading="lazy">` : `<div class="thumb ph"><b>${esc(m.name)}</b>`}
        <span class="kind ${esc(m.kind)}">${esc(m.kind)}</span>
        ${st ? `<span class="st ${st}" title="${STATUS[st]}">${st === "maitrise" ? "✓" : st === "en_cours" ? "…" : "○"}</span>` : ""}
        ${hasVid(m) ? "" : '<span class="tofilm">À filmer</span>'}
        ${mc ? `<span class="mine">Moi ×${mc}</span>` : ""}</div>
      <div class="mname">${esc(m.name)}</div>
      ${m.diff ? `<div class="stars" title="Difficulté ${m.diff}/5">${stars(m.diff)}</div>` : ""}
      <div class="mmeta">${esc(m.note || "")}</div></div>`;
  }).join("");
  $("#empty").hidden = list.length > 0;
  if (!loaded) { $("#empty-t").textContent = "Chargement…"; $("#empty-s").textContent = ""; }
  else if (!list.length) { $("#empty-t").textContent = MOVES.length ? "Rien ici" : "Bibliothèque vide"; $("#empty-s").textContent = MOVES.length ? "Aucune fiche ne correspond." : (profile?.is_admin ? "Ajoute une fiche ou importe l'ancienne bibliothèque dans Admin." : "L'animateur n'a pas encore ajouté de fiches."); }
  $$(".move").forEach(b => { b.onclick = () => open(+b.dataset.i); b.onkeydown = e => { if (e.key === "Enter") open(+b.dataset.i); }; });
}
$$("[data-f]").forEach(t => t.onclick = () => { filter = t.dataset.f; $$("[data-f]").forEach(x => x.setAttribute("aria-pressed", x === t)); render(); });
$("#vf").onchange = e => { vfilter = e.target.value; render(); };
$("#sf").onchange = e => { sfilter = e.target.value; render(); };
$("#df").onchange = e => { dfilter = e.target.value; render(); };
$("#so").onchange = e => { sort = e.target.value; render(); };
$("#q").oninput = e => { q = e.target.value; render(); };

// ---------------- Lecteur ----------------
const vcache = new Map(); let wantRef = null;
async function blobUrl(url) {
  if (vcache.has(url)) return vcache.get(url);
  const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
  const u = URL.createObjectURL(new Blob([await r.blob()], { type: "video/mp4" }));
  vcache.set(url, u); if (vcache.size > 25) { const [k, v] = vcache.entries().next().value; URL.revokeObjectURL(v); vcache.delete(k); }
  return u;
}
async function setVideo(el, url, tag) {
  el.dataset.want = tag; el.removeAttribute("src"); el.load();
  try { const u = await blobUrl(url); if (el.dataset.want !== tag) return; el.src = u; } catch (e) { if (el.dataset.want !== tag) return; el.src = url; }
  el.playbackRate = speed; el.play().catch(() => {});
}
function open(i) { cur = i; $("#player").hidden = false; document.body.style.overflow = "hidden"; load(); }
function load() {
  const m = list[cur]; if (!m) { closeP(); return; }
  $("#ptitle").textContent = m.name; $("#psub").textContent = m.note || "";
  const info = [`<span>${esc(m.kind)}</span>`];
  if (m.diff) info.push(`<span>Difficulté <span class="stars">${stars(m.diff)}</span></span>`, `<span>Risque <span class="stars">${stars(m.risk)}</span></span>`, `<span>Spectaculaire <span class="stars">${stars(m.spec)}</span></span>`);
  if (m.source) info.push(`<a href="${esc(m.source)}" target="_blank" rel="noopener">Fiche technique (site P. Messin) ↗</a>`);
  $("#pinfo").innerHTML = info.join("");
  const steps = String(m.description || "").split("\n").map(x => x.replace(/^\s*(\d+[.)]|[-•])\s*/, "").trim()).filter(Boolean);
  $("#pdesc").hidden = !steps.length;
  $("#pdesc").innerHTML = steps.length > 1 ? "<ol>" + steps.map(x => `<li>${esc(x)}</li>`).join("") + "</ol>" : esc(steps[0] || "");
  const vr = $("#vref");
  trim = (m.trim_end > m.trim_start) ? { s: +m.trim_start || 0, e: +m.trim_end } : null; trimOff = false;
  if (hasVid(m)) { vr.hidden = false; $("#novid").hidden = true; setVideo(vr, pub(m.video_path), m.id); $("#play").textContent = "Pause"; }
  else { vr.dataset.want = ""; vr.pause(); vr.removeAttribute("src"); vr.load(); vr.hidden = true; $("#novid").hidden = false; $("#novid-a").textContent = profile?.is_admin ? "Ajoute-la avec « Modifier la fiche »." : ""; }
  // mes vidéos
  renderGallery(m);
  // statut
  const st = PROG[m.id];
  $$("#status [data-st]").forEach(b => b.classList.toggle("on", b.dataset.st === st));
  $("#p-note").value = ""; $("#p-msg").textContent = "";
  $("#edit").hidden = !profile?.is_admin; $("#editp").hidden = true;
  $("#q-del").hidden = !profile?.is_admin; $("#q-unvid").hidden = !(profile?.is_admin && hasVid(m));
  for (const b of [$("#q-del"), $("#q-unvid")]) b.classList.remove("armed");
  $("#q-del").textContent = "🗑 Fiche"; $("#q-unvid").textContent = "🗑 Vidéo";
}
let meSel = null;
async function signed(paths) {
  const p = paths.filter(Boolean); if (!p.length) return {};
  const { data } = await sb.storage.from("personal").createSignedUrls(p, 3600);
  return Object.fromEntries((data || []).map(x => [x.path, x.signedUrl]));
}
async function renderGallery(m) {
  const mine = MYVIDS.filter(v => v.move_id === m.id);
  const urls = await signed(mine.map(v => v.poster_path));
  if (list[cur]?.id !== m.id) return;
  $("#gallery").innerHTML = mine.map(v => `<div class="gv${v.id === meSel ? " on" : ""}" role="button" tabindex="0" data-gv="${v.id}" aria-label="Voir ma vidéo du ${new Date(v.created_at).toLocaleDateString("fr-BE")}">
      ${v.poster_path && urls[v.poster_path] ? `<img src="${urls[v.poster_path]}" alt="">` : '<div class="ph">▶</div>'}
      <time>${new Date(v.created_at).toLocaleDateString("fr-BE", { day: "2-digit", month: "short" })}</time>
      <button class="x" data-delv="${v.id}" aria-label="Supprimer">✕</button></div>`).join("")
    + `<label class="gv add"><b>+</b>Ajouter ma vidéo<input id="my-file" type="file" accept="video/*"></label>`;
  $$("[data-gv]").forEach(el => { el.onclick = e => { if (e.target.closest(".x")) return; showMine(el.dataset.gv); }; el.onkeydown = e => { if (e.key === "Enter") showMine(el.dataset.gv); }; });
  $$("[data-delv]").forEach(b => b.onclick = e => { e.stopPropagation(); delMine(b.dataset.delv, b); });
  $("#my-file").onchange = onMyFile;
  if (!mine.length) { meSel = null; $("#st-me").hidden = true; const vm = $("#vme"); vm.pause(); vm.removeAttribute("src"); vm.load(); $("#g-msg").textContent = "Filme-toi et ajoute ta vidéo : elle s'affichera à côté de la vidéo de base pour comparer."; }
  else { $("#g-msg").textContent = "Touche une de tes vidéos pour la comparer à la vidéo de base."; if (!mine.some(v => v.id === meSel)) showMine(mine[0].id); }
}
async function showMine(id) {
  const v = MYVIDS.find(x => x.id === id); if (!v) return;
  meSel = id; $$("[data-gv]").forEach(el => el.classList.toggle("on", el.dataset.gv === id));
  $("#st-me").hidden = false; $("#mecap").textContent = "Moi · " + new Date(v.created_at).toLocaleDateString("fr-BE");
  const u = (await signed([v.video_path]))[v.video_path];
  if (!u) { toast("Impossible de lire ta vidéo"); return; }
  setVideo($("#vme"), u, v.id);
}
function closeP() { $("#vref").pause(); $("#vme").pause(); $("#player").hidden = true; document.body.style.overflow = ""; render(); }
$("#close").onclick = closeP;
$("#prev").onclick = () => { cur = (cur - 1 + list.length) % list.length; load(); };
$("#next").onclick = () => { cur = (cur + 1) % list.length; load(); };
const vids = () => [$("#vref"), $("#vme")].filter(v => !v.hidden && v.src && !v.closest("[hidden]"));
$("#play").onclick = () => {
  const vs = vids(); const paused = vs.some(v => v.paused);
  vs.forEach(v => paused ? v.play().catch(() => {}) : v.pause()); $("#play").textContent = paused ? "Pause" : "Lecture";
};
$("#sync").onclick = () => { vids().forEach(v => { v.currentTime = (v.id === "vref" && trim && !trimOff) ? trim.s : 0; v.play().catch(() => {}); }); $("#play").textContent = "Pause"; };
$$(".spd").forEach(b => b.onclick = () => { speed = +b.dataset.s; [$("#vref"), $("#vme")].forEach(v => v.playbackRate = speed); $$(".spd").forEach(x => x.classList.toggle("on", x === b)); });
$("#vref").addEventListener("loadedmetadata", e => { if (trim && !trimOff) e.target.currentTime = trim.s; });
$("#vref").addEventListener("loadeddata", e => e.target.playbackRate = speed);
$("#vme").addEventListener("loadeddata", e => e.target.playbackRate = speed);
(function loop() { const v = $("#vref");
  if (trim && !trimOff && !v.paused && v.readyState > 1 && (v.currentTime >= trim.e || v.currentTime < trim.s - 0.05)) v.currentTime = trim.s;
  requestAnimationFrame(loop); })();
document.addEventListener("keydown", e => { if ($("#player").hidden || e.target.closest("input,select,textarea")) return;
  if (e.key === "Escape") closeP(); if (e.key === "ArrowRight") $("#next").click(); if (e.key === "ArrowLeft") $("#prev").click(); if (e.key === " ") { e.preventDefault(); $("#play").click(); } });

// ---------------- Progression ----------------
let pendingSt = null;
$$("#status [data-st]").forEach(b => b.onclick = () => { pendingSt = b.dataset.st; $$("#status [data-st]").forEach(x => x.classList.toggle("on", x === b)); saveProgress(); });
$("#p-save").onclick = () => saveProgress(true);
async function saveProgress(withNote) {
  const m = list[cur]; const st = pendingSt || PROG[m.id]; const note = $("#p-note").value.trim();
  if (!st) { $("#p-msg").textContent = "Choisis d'abord un statut."; return; }
  if (withNote && !note && st === PROG[m.id]) { $("#p-msg").textContent = "Écris une note."; return; }
  const changed = st !== PROG[m.id];
  const ops = [];
  if (changed) ops.push(sb.from("progress").upsert({ user_id: me.id, move_id: m.id, status: st, updated_at: new Date().toISOString() }));
  if (changed || note) ops.push(sb.from("progress_log").insert({ user_id: me.id, move_id: m.id, status: st, note }));
  const res = await Promise.all(ops); const err = res.find(r => r.error);
  if (err) { $("#p-msg").textContent = "Échec : " + err.error.message; return; }
  PROG[m.id] = st; pendingSt = null; $("#p-note").value = ""; $("#p-msg").textContent = "Noté dans ton journal ✓";
}

// ---------------- Mes vidéos ----------------
async function usedBytes() { return MYVIDS.reduce((a, v) => a + (+v.size_bytes || 0), 0); }
async function onMyFile(e) {
  const f = e.target.files[0]; if (!f) return; const m = list[cur]; e.target.value = "";
  const msg = t => $("#g-msg").textContent = t;
  try {
    let file = f;
    if (f.size > 8 * 1024 * 1024) { msg("Compression de la vidéo… (laisse l'écran allumé)"); file = await compress(f, msg).catch(() => f); }
    if (file.size > MAXB) { msg(`Vidéo trop lourde (${(file.size / 1048576).toFixed(0)} Mo, 50 Mo max). Raccourcis-la.`); return; }
    if ((await usedBytes()) + file.size > QUOTA_MB * 1048576) { msg(`Ton espace est plein (${QUOTA_MB} Mo). Supprime une ancienne vidéo.`); return; }
    msg("Envoi de ta vidéo…");
    const ext = file.type.includes("webm") ? "webm" : "mp4", base = `${me.id}/${m.id}/${stamp()}`;
    const up = await sb.storage.from("personal").upload(`${base}.${ext}`, file, { contentType: file.type || "video/mp4" });
    if (up.error) throw up.error;
    let poster = null; const pb = await posterFromFile(f);
    if (pb) { const u2 = await sb.storage.from("personal").upload(`${base}.jpg`, pb, { contentType: "image/jpeg" }); if (!u2.error) poster = `${base}.jpg`; }
    const ins = await sb.from("user_videos").insert({ user_id: me.id, move_id: m.id, video_path: `${base}.${ext}`, poster_path: poster, size_bytes: file.size }).select().single();
    if (ins.error) throw ins.error;
    MYVIDS.unshift(ins.data); meSel = ins.data.id;
    await sb.from("progress_log").insert({ user_id: me.id, move_id: m.id, status: PROG[m.id] || null, note: "📹 Nouvelle vidéo" });
    await renderGallery(m); showMine(ins.data.id); msg("Vidéo ajoutée ✓");
  } catch (err) { msg("Échec de l'envoi : " + (err.message || err)); }
}
async function delMine(id, btn) {
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "?"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "✕"; }, 4000); toast("Touche encore ✕ pour supprimer"); return; }
  const v = MYVIDS.find(x => x.id === id); if (!v) return;
  const { error } = await sb.from("user_videos").delete().eq("id", id);
  if (error) { toast("Échec : " + error.message); return; }
  await sb.storage.from("personal").remove([v.video_path, v.poster_path].filter(Boolean));
  MYVIDS = MYVIDS.filter(x => x.id !== id); if (meSel === id) meSel = null; renderGallery(list[cur]);
}
// Compression : relit la vidéo et la ré-enregistre en 480p (≈1,2 Mb/s)
function compress(file, progress) {
  return new Promise((resolve, reject) => {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return reject(new Error("non supporté"));
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(file);
    v.onerror = () => reject(new Error("lecture impossible"));
    v.onloadedmetadata = () => {
      const h = Math.min(854, v.videoHeight), w = Math.round(v.videoWidth * h / v.videoHeight);
      const c = document.createElement("canvas"); c.width = w - (w % 2); c.height = h - (h % 2); const ctx = c.getContext("2d");
      const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const type = types.find(t => MediaRecorder.isTypeSupported(t)); if (!type) return reject(new Error("format"));
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 1200000 }); const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => { URL.revokeObjectURL(v.src); const out = new Blob(chunks, { type: type.split(";")[0] }); out.size && out.size < file.size ? resolve(out) : resolve(file); };
      const draw = () => { if (v.ended || v.paused) return; ctx.drawImage(v, 0, 0, c.width, c.height); progress && progress(`Compression… ${Math.round(100 * v.currentTime / v.duration)} %`); requestAnimationFrame(draw); };
      v.onended = () => rec.stop();
      rec.start(500); v.play().then(draw).catch(reject);
    };
  });
}

// ---------------- Journal ----------------
async function renderJournal() {
  const counts = { maitrise: 0, en_cours: 0, a_apprendre: 0 }; Object.values(PROG).forEach(s => counts[s]++);
  const total = MOVES.length || 1;
  $("#stats").innerHTML = `
    <div class="stat"><b>${counts.maitrise}</b><span>maîtrisés (${Math.round(100 * counts.maitrise / total)} % de la bibliothèque)</span></div>
    <div class="stat"><b>${counts.en_cours}</b><span>en cours</span></div>
    <div class="stat"><b>${counts.a_apprendre}</b><span>à apprendre</span></div>
    <div class="stat"><b>${MYVIDS.length}</b><span>vidéos de moi</span></div>`;
  const used = await usedBytes();
  $("#qfill").style.width = Math.min(100, 100 * used / (QUOTA_MB * 1048576)) + "%";
  $("#qtxt").textContent = `${(used / 1048576).toFixed(1)} Mo utilisés sur ${QUOTA_MB} Mo`;
  $("#log").innerHTML = '<p class="msg">Chargement…</p>';
  const { data } = await sb.from("progress_log").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(300);
  const byId = Object.fromEntries(MOVES.map(m => [m.id, m]));
  $("#log").innerHTML = (data || []).length ? data.map(r => {
    const m = byId[r.move_id]; const d = new Date(r.created_at);
    return `<div class="entry" data-mid="${esc(r.move_id)}"><time>${d.toLocaleDateString("fr-BE", { day: "2-digit", month: "short", year: "2-digit" })}</time>
      <div><b>${esc(m?.name || "Fiche supprimée")}</b>${r.status ? `<span class="pill ${r.status}">${STATUS[r.status]}</span>` : ""}
      ${r.note ? `<div class="mmeta">${esc(r.note)}</div>` : ""}</div></div>`;
  }).join("") : '<p class="msg">Ton journal est vide. Ouvre une fiche et choisis « À apprendre », « En cours » ou « Maîtrisé ».</p>';
  $$(".entry").forEach(el => el.onclick = () => {
    filter = "all"; vfilter = "all"; sfilter = "all"; q = ""; render();
    const i = list.findIndex(m => m.id === el.dataset.mid); if (i >= 0) open(i);
  });
}

// ---------------- Admin : fiche ----------------
let editId = null;
function emsg(t, err) { $("#e-msg").textContent = t; $("#e-msg").className = "msg" + (err ? " err" : ""); }
function tmsg(t, err) { $("#t-msg").textContent = t; $("#t-msg").className = "msg" + (err ? " err" : ""); }
const fmt = t => (Math.round(t * 10) / 10).toFixed(1);
$("#edit").onclick = () => {
  const m = list[cur]; editId = m.id; const p = $("#editp"); p.hidden = !p.hidden; if (p.hidden) { trimOff = false; return; }
  $("#e-name").value = m.name; $("#e-note").value = m.note || ""; $("#e-kind").value = m.kind; emsg("");
  $("#e-desc").value = m.description || "";
  setRate("e-diff", m.diff); setRate("e-risk", m.risk); setRate("e-spec", m.spec);
  $("#e-file-t").textContent = hasVid(m) ? "Remplacer la vidéo" : "Mettre une vidéo";
  $("#e-trim").hidden = !hasVid(m); $("#e-unvid").hidden = !hasVid(m);
  const has = m.trim_end > m.trim_start;
  $("#t-start").value = has ? fmt(m.trim_start) : ""; $("#t-end").value = has ? fmt(m.trim_end) : "";
  trimOff = true; tmsg(has ? `Découpage actuel : ${fmt(m.trim_start)} s → ${fmt(m.trim_end)} s. Vidéo entière affichée pour régler.` : "Pas de découpage : toute la vidéo est lue.");
  $("#e-del").classList.remove("armed"); $("#e-del").textContent = "Supprimer la fiche";
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
};
async function upd(id, patch) { const { data, error } = await sb.from("moves").update(patch).eq("id", id).select().single(); if (error) throw error; const i = MOVES.findIndex(m => m.id === id); MOVES[i] = data; const j = list.findIndex(m => m.id === id); if (j >= 0) list[j] = data; return data; }
async function rmLib(...paths) { const p = paths.filter(Boolean); if (p.length) await sb.storage.from("library").remove(p); }
$("#e-save").onclick = async () => {
  const name = $("#e-name").value.trim(); if (!name) { emsg("Le nom ne peut pas être vide.", 1); return; }
  try { const d = await upd(editId, { name, note: $("#e-note").value.trim(), kind: $("#e-kind").value, description: $("#e-desc").value.trim() || null, diff: RATE["e-diff"] || null, risk: RATE["e-risk"] || null, spec: RATE["e-spec"] || null }); load(); $("#editp").hidden = false; emsg("Enregistré ✓"); }
  catch (e) { emsg("Échec : " + e.message, 1); }
};
function readTrim() { const v = $("#vref"), d = v.duration || 0; let s = parseFloat($("#t-start").value), e = parseFloat($("#t-end").value);
  if (isNaN(s)) s = 0; if (isNaN(e)) e = d; s = Math.max(0, s); if (d) e = Math.min(d, e); return { s, e }; }
$("#t-setS").onclick = () => { $("#t-start").value = fmt($("#vref").currentTime); tmsg("Début fixé."); };
$("#t-setE").onclick = () => { $("#t-end").value = fmt($("#vref").currentTime); tmsg("Fin fixée."); };
$("#t-prev").onclick = () => { const r = readTrim(); if (!(r.e - r.s > 0.2)) { tmsg("La fin doit être après le début.", 1); return; }
  trim = r; trimOff = false; const v = $("#vref"); v.currentTime = r.s; v.play(); tmsg(`Aperçu : ${fmt(r.s)} s → ${fmt(r.e)} s (pas encore enregistré).`); };
$("#t-full").onclick = () => { trimOff = true; $("#vref").play(); tmsg("Vidéo entière."); };
$("#t-save").onclick = async () => { const r = readTrim(); if (!(r.e - r.s > 0.2)) { tmsg("La fin doit être après le début.", 1); return; }
  try { await upd(editId, { trim_start: Math.round(r.s * 10) / 10, trim_end: Math.round(r.e * 10) / 10 }); trim = r; trimOff = false; tmsg("Découpage enregistré ✓"); } catch (e) { tmsg("Échec : " + e.message, 1); } };
$("#t-reset").onclick = async () => { try { await upd(editId, { trim_start: null, trim_end: null }); trim = null; $("#t-start").value = $("#t-end").value = ""; tmsg("Découpage supprimé."); } catch (e) { tmsg("Échec : " + e.message, 1); } };
async function uploadPoster(blob, m) {
  const path = `moves/${m.id}/poster-${stamp()}.jpg`;
  const up = await sb.storage.from("library").upload(path, blob, { contentType: "image/jpeg" }); if (up.error) throw up.error;
  const old = m.poster_path; await upd(m.id, { poster_path: path }); await rmLib(old);
}
function frameBlob(v, at) { return new Promise(res => { const h = 640, w = Math.round(v.videoWidth * h / v.videoHeight) || 360;
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h); c.toBlob(res, "image/jpeg", 0.82); }); }
$("#t-poster").onclick = async () => { const v = $("#vref"); if (!v.videoWidth) { tmsg("La vidéo n'est pas encore chargée.", 1); return; }
  try { tmsg("Envoi de la vignette…"); await uploadPoster(await frameBlob(v), MOVES.find(x => x.id === editId)); tmsg("Vignette mise à jour ✓"); } catch (e) { tmsg("Échec : " + e.message, 1); } };
$("#e-img").onchange = async e => { const f = e.target.files[0]; if (!f) return; e.target.value = "";
  try { emsg("Envoi de l'image…"); const img = await createImageBitmap(f); const h = 640, w = Math.round(img.width * h / img.height);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85)); await uploadPoster(b, MOVES.find(x => x.id === editId)); emsg("Vignette mise à jour ✓"); }
  catch (err) { emsg("Échec : " + (err.message || err), 1); } };
function posterFromFile(file) { return new Promise(res => {
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; const url = URL.createObjectURL(file); v.src = url;
  const fin = b => { URL.revokeObjectURL(url); res(b); }; setTimeout(() => fin(null), 15000);
  v.onloadedmetadata = () => { v.currentTime = Math.min(v.duration * 0.55, v.duration - 0.1) || 0; };
  v.onseeked = async () => { try { fin(await frameBlob(v)); } catch (e) { fin(null); } }; v.onerror = () => fin(null); }); }
async function putLibVideo(m, file) {
  if (file.size > MAXB) throw new Error(`vidéo trop lourde (${(file.size / 1048576).toFixed(0)} Mo, 50 Mo max)`);
  const pb = await posterFromFile(file);
  const vp = `moves/${m.id}/video-${stamp()}.mp4`;
  const up = await sb.storage.from("library").upload(vp, file, { contentType: file.type || "video/mp4" }); if (up.error) throw up.error;
  let pp = null; if (pb) { pp = `moves/${m.id}/poster-${stamp()}.jpg`; const u2 = await sb.storage.from("library").upload(pp, pb, { contentType: "image/jpeg" }); if (u2.error) pp = null; }
  const old = [m.video_path, m.poster_path];
  const d = await upd(m.id, { video_path: vp, poster_path: pp || m.poster_path, trim_start: null, trim_end: null });
  await rmLib(old[0], pp ? old[1] : null); return d;
}
$("#e-file").onchange = async e => { const f = e.target.files[0]; if (!f) return; e.target.value = "";
  try { emsg("Envoi de la vidéo…"); await putLibVideo(MOVES.find(x => x.id === editId), f); emsg("Vidéo ajoutée ✓"); load(); $("#edit").click(); }
  catch (err) { emsg("Échec : " + (err.message || err), 1); } };
$("#e-unvid").onclick = async () => { const m = MOVES.find(x => x.id === editId);
  try { await upd(m.id, { video_path: null, poster_path: null, trim_start: null, trim_end: null }); await rmLib(m.video_path, m.poster_path); emsg("Vidéo retirée ✓"); load(); }
  catch (e) { emsg("Échec : " + e.message, 1); } };
$("#e-del").onclick = async () => { const b = $("#e-del");
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer la suppression ?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Supprimer la fiche"; }, 4000); return; }
  const m = MOVES.find(x => x.id === editId);
  const { error } = await sb.from("moves").delete().eq("id", m.id); if (error) { emsg("Échec : " + error.message, 1); return; }
  await rmLib(m.video_path, m.poster_path); MOVES = MOVES.filter(x => x.id !== m.id); closeP(); };

// Suppression rapide (admin), avec confirmation
function arm(b, label, txt) { if (b.classList.contains("armed")) return true; b.classList.add("armed"); b.textContent = txt;
  setTimeout(() => { b.classList.remove("armed"); b.textContent = label; }, 4000); return false; }
$("#q-del").onclick = async () => { const b = $("#q-del"); if (!arm(b, "🗑 Fiche", "Confirmer : supprimer la fiche ?")) return;
  const m = list[cur]; const { error } = await sb.from("moves").delete().eq("id", m.id);
  if (error) { toast("Échec : " + error.message); return; }
  await rmLib(m.video_path, m.poster_path); MOVES = MOVES.filter(x => x.id !== m.id); toast("Fiche supprimée"); closeP(); };
$("#q-unvid").onclick = async () => { const b = $("#q-unvid"); if (!arm(b, "🗑 Vidéo", "Confirmer : retirer la vidéo ?")) return;
  const m = list[cur];
  try { await upd(m.id, { video_path: null, poster_path: null, trim_start: null, trim_end: null }); await rmLib(m.video_path, m.poster_path); toast("Vidéo retirée"); load(); }
  catch (e) { toast("Échec : " + e.message); } };

// ---------------- Admin : page ----------------
async function renderAdmin() {
  const b = $("#signups"); b.textContent = settings.signups_open ? "🔓 Inscriptions libres ouvertes — fermer" : "🔒 Inscriptions libres fermées — ouvrir"; b.classList.toggle("on", settings.signups_open);
  $("#members").innerHTML = '<p class="msg">Chargement…</p>';
  const [p, g, em] = await Promise.all([sb.from("profiles").select("*").order("created_at"), sb.from("progress").select("user_id,status"), sb.from("allowed_emails").select("*").order("added_at", { ascending: false })]);
  const users = p.data || [];
  const hasAcc = new Set(users.map(u => u.email));
  $("#emails").innerHTML = (em.data || []).map(r => `<div class="member"><span>${esc(r.email)} <span class="msg">${hasAcc.has(r.email) ? "· profil créé ✓" : "· pas encore inscrit"}</span></span><button class="btn sm danger" data-rmem="${esc(r.email)}">Retirer</button></div>`).join("") || '<p class="msg">Aucune adresse autorisée pour l\'instant.</p>';
  $$("[data-rmem]").forEach(x => x.onclick = async () => { await sb.from("allowed_emails").delete().eq("email", x.dataset.rmem); renderAdmin(); });
  const pend = users.filter(u => !u.approved);
  $("#pending-card").hidden = !pend.length;
  $("#pending").innerHTML = pend.map(u => `<div class="member"><span><b>${esc(u.display_name)}</b> <span class="msg">${esc(u.email || "")} · demandé le ${new Date(u.created_at).toLocaleDateString("fr-BE")}</span></span>
     <span class="row"><button class="btn sm primary" data-ok="${esc(u.email || "")}" data-uid="${u.id}">Accepter</button><button class="btn sm danger" data-no="${u.id}">Refuser</button></span></div>`).join("");
  $$("[data-ok]").forEach(x => x.onclick = async () => { const r = x.dataset.ok ? await sb.from("allowed_emails").upsert({ email: x.dataset.ok }) : await sb.from("profiles").update({ approved: true }).eq("id", x.dataset.uid); if (r.error) toast(r.error.message); renderAdmin(); });
  $$("[data-no]").forEach(x => x.onclick = async () => { const r = await sb.from("profiles").delete().eq("id", x.dataset.no); if (r.error) toast(r.error.message); renderAdmin(); });
  const mast = {}; (g.data || []).forEach(r => { if (r.status === "maitrise") mast[r.user_id] = (mast[r.user_id] || 0) + 1; });
  $("#members").innerHTML = users.filter(u => u.approved).map(u => `<div class="member"><span><b>${esc(u.display_name)}</b> <span class="msg">${esc(u.email || "")}</span>${u.is_admin ? ' <span class="pill maitrise">admin</span>' : ""}
     <span class="msg"> · inscrit le ${new Date(u.created_at).toLocaleDateString("fr-BE")} · ${mast[u.id] || 0} maîtrisé(s)</span></span>
     ${u.id === me.id ? "" : `<button class="btn sm" data-adm="${u.id}" data-to="${!u.is_admin}">${u.is_admin ? "Retirer admin" : "Rendre admin"}</button>`}</div>`).join("") || '<p class="msg">Aucun membre.</p>';
  $$("[data-adm]").forEach(x => x.onclick = async () => { const { error } = await sb.from("profiles").update({ is_admin: x.dataset.to === "true" }).eq("id", x.dataset.adm); if (error) toast(error.message); renderAdmin(); });
}
$("#em-go").onclick = async () => {
  const list = $("#em-add").value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (!list.length) { $("#em-msg").textContent = "Aucune adresse e-mail valide."; return; }
  const { error } = await sb.from("allowed_emails").upsert(list.map(email => ({ email })));
  $("#em-msg").textContent = error ? "Échec : " + error.message : `${list.length} adresse${list.length > 1 ? "s" : ""} autorisée${list.length > 1 ? "s" : ""} ✓`;
  if (!error) { $("#em-add").value = ""; renderAdmin(); }
};
$("#signups").onclick = async () => {
  const { data, error } = await sb.from("settings").update({ signups_open: !settings.signups_open }).eq("id", 1).select().single();
  if (error) { toast(error.message); return; } settings = data; renderAdmin();
};
$("#addform").onsubmit = async e => {
  e.preventDefault(); const msg = $("#f-msg"); msg.className = "msg";
  const ord = MOVES.reduce((a, m) => Math.max(a, m.ord || 0), 0) + 1;
  try {
    msg.textContent = "Création…";
    const { data, error } = await sb.from("moves").insert({ kind: $("#f-kind").value, name: $("#f-name").value.trim(), note: $("#f-note").value.trim(), diff: RATE["f-diff"] || null, ord }).select().single();
    if (error) throw error; MOVES.push(data);
    const f = $("#f-file").files[0]; if (f) { msg.textContent = "Envoi de la vidéo…"; await putLibVideo(data, f); }
    msg.textContent = "Ajouté ✓"; $("#addform").reset(); setRate("f-diff", 0); render();
  } catch (err) { msg.className = "msg err"; msg.textContent = "Échec : " + (err.message || err); }
};

// ---------------- Descriptions préparées ----------------
async function applyDescriptions(msgEl) {
  const r = await fetch("descriptions.json?v=" + Date.now()); if (!r.ok) throw new Error("fichier de descriptions introuvable");
  const D = await r.json(); let n = 0;
  for (const m of MOVES) {
    if (m.description || !D[m.id]) continue;
    const { error } = await sb.from("moves").update({ description: D[m.id] }).eq("id", m.id);
    if (error) throw error; m.description = D[m.id]; n++; if (msgEl) msgEl.textContent = `Descriptions : ${n}…`;
  }
  return n;
}
$("#desc-go").onclick = async () => { const msg = $("#imp-msg"); msg.className = "msg";
  try { const n = await applyDescriptions(msg); msg.textContent = `${n} description${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""} ✓`; render(); }
  catch (e) { msg.className = "msg err"; msg.textContent = "Échec : " + (e.message || e); } };

// ---------------- Import de l'ancienne app (zip non compressé) ----------------
function readZip(buf) {
  const dv = new DataView(buf), files = {}; let p = 0; const dec = new TextDecoder();
  while (p + 30 <= buf.byteLength && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = dec.decode(new Uint8Array(buf, p + 30, nl)); const start = p + 30 + nl + xl;
    if (method !== 0) throw new Error("zip compressé non pris en charge");
    files[name] = new Uint8Array(buf, start, size); p = start + size;
  }
  return files;
}
$("#imp").onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const msg = $("#imp-msg"); msg.className = "msg";
  try {
    const files = readZip(await f.arrayBuffer());
    const data = JSON.parse(new TextDecoder().decode(files["moves.json"]));
    let n = 0;
    for (const m of data) {
      n++; msg.textContent = `Import ${n} / ${data.length} : ${m.name}…`;
      const row = { id: m.id, kind: m.kind, name: m.name, note: m.note || "", diff: m.diff ?? null, risk: m.risk ?? null, spec: m.spec ?? null,
        source: m.source || null, catalog: !!m.catalog, description: m.description || null, ord: m.order || 0, trim_start: m.trimStart ?? null, trim_end: m.trimEnd ?? null, video_path: null, poster_path: null };
      for (const [k, key, type] of [["video", "video_path", "video/mp4"], ["poster", "poster_path", "image/jpeg"]]) {
        if (m[k] && files[m[k]]) {
          const path = `moves/${m.id}/${k}-${stamp()}.${type === "video/mp4" ? "mp4" : "jpg"}`;
          const up = await sb.storage.from("library").upload(path, new Blob([files[m[k]]], { type }), { contentType: type });
          if (up.error) throw up.error; row[key] = path;
        }
      }
      const { error } = await sb.from("moves").upsert(row); if (error) throw error;
    }
    await loadMoves();
    msg.textContent = `Import terminé ✓ ${data.length} fiches.`; render();
  } catch (err) { msg.className = "msg err"; msg.textContent = "Échec de l'import : " + (err.message || err); }
  e.target.value = "";
};
