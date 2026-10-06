const API = "https://commons.wikimedia.org/w/api.php";
const TOPICS = ["northern lights", "old maps", "street art", "butterfly", "steam locomotive",
    "lighthouse", "volcano", "cherry blossom", "medieval castle", "coral reef", "hot air balloon", "temple"];
const PAGES = ["home", "saved", "login"];

const $ = (id) => document.getElementById(id);
const form = $("search-form");
const input = $("search-input");
const results = $("results");
const statusEl = $("status");
const loadMoreBtn = $("load-more");
const lightbox = $("lightbox");

let state = { query: "", offset: 0, hasMore: false, loading: false };
let fetched = [];        // everything loaded for the current search
let shown = [];          // images on screen in the current page (used by the lightbox)
let view = "home";       // "home", "saved" or "login"
let searchId = 0;        // ignore results from an older search
let lbIndex = -1;
let lbCurrent = null;
let authMode = "login";  // "login" or "register"
let authNotice = "";
let returnTo = "";       // page to open after logging in

/* ---------- storage helpers (safe if storage is blocked) ---------- */
function load(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
    } catch (e) {
        return fallback;
    }
}
function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

/* ---------- theme ---------- */
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("theme-toggle").textContent = theme === "dark" ? "Light mode" : "Dark mode";
}
applyTheme(load("theme", window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

$("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    save("theme", next);
});

/* ---------- columns ---------- */
function applyColumns(n) {
    document.documentElement.style.setProperty("--cols", n);
    $("columns").value = n;
}
applyColumns(load("columns", "4"));

$("columns").addEventListener("change", (e) => {
    applyColumns(e.target.value);
    save("columns", e.target.value);
});

/* ---------- infinite scroll setting ---------- */
$("infinite").checked = load("infinite", false);
$("infinite").addEventListener("change", () => {
    save("infinite", $("infinite").checked);
    updateLoadMore();
    checkSentinel();
});

/* ---------- accounts (stored in this browser only) ---------- */
const getUsers = () => load("users", {});

function currentUser() {
    const email = load("session", null);
    const user = email && getUsers()[email];
    return user ? { email, name: user.name } : null;
}

async function hashPassword(password, salt) {
    const text = salt + password;
    if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Fallback when the browser blocks crypto.subtle (plain http pages)
    let h = 5381;
    for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
    return "x" + h;
}

function setAuthError(msg) { $("auth-error").textContent = msg; }

function setAuthMode(mode) {
    authMode = mode;
    const reg = mode === "register";
    $("tab-login").classList.toggle("active", !reg);
    $("tab-register").classList.toggle("active", reg);
    $("name-field").hidden = !reg;
    $("auth-title").textContent = reg ? "Create account" : "Log in";
    $("auth-submit").textContent = reg ? "Create account" : "Log in";
    $("auth-password").autocomplete = reg ? "new-password" : "current-password";
    setAuthError("");
}

$("tab-login").addEventListener("click", () => setAuthMode("login"));
$("tab-register").addEventListener("click", () => setAuthMode("register"));

$("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim().toLowerCase();
    const password = $("auth-password").value;
    const name = $("auth-name").value.trim();
    const users = getUsers();
    setAuthError("");

    if (authMode === "register") {
        if (!name) return setAuthError("Enter your name.");
        if (password.length < 6) return setAuthError("Password must be at least 6 characters.");
        if (users[email]) return setAuthError("An account with this email already exists. Log in instead.");
        const salt = Math.random().toString(36).slice(2);
        users[email] = { name, salt, hash: await hashPassword(password, salt) };
        save("users", users);
    } else {
        const user = users[email];
        if (!user || user.hash !== (await hashPassword(password, user.salt))) {
            return setAuthError("Email or password is incorrect.");
        }
    }

    save("session", email);
    authNotice = "";
    $("auth-form").reset();
    const dest = returnTo || "home";
    returnTo = "";
    go(dest);
});

$("logout").addEventListener("click", () => {
    save("session", null);
    go("home");
});

/* ---------- navigation ---------- */
function go(page) {
    if (location.hash === "#" + page) route();
    else location.hash = page;
}

function updateNav() {
    const user = currentUser();
    $("nav-login").hidden = !!user;
    $("nav-user").hidden = !user;
    if (user) $("user-name").textContent = user.name;
    $("saved-count").textContent = user ? `(${getFavs().length})` : "";

    document.querySelectorAll("#menu a[data-page]").forEach((a) => {
        if (a.dataset.page === view) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
    });
}

function route() {
    let page = (location.hash || "#home").slice(1);
    if (!PAGES.includes(page)) page = "home";

    // Saved images needs an account
    if (page === "saved" && !currentUser()) {
        authNotice = "Log in to see your saved images.";
        returnTo = "saved";
        location.replace("#login");
        return;
    }
    // Already logged in, so the login page is not needed
    if (page === "login" && currentUser()) {
        location.replace("#home");
        return;
    }

    closeLightbox();
    view = page;
    PAGES.forEach((p) => { $("view-" + p).hidden = p !== page; });
    $("nav").classList.remove("open");
    $("menu-btn").setAttribute("aria-expanded", "false");

    if (page === "home") renderAll();
    if (page === "saved") renderSaved();
    if (page === "login") {
        $("auth-notice").textContent = authNotice;
        setAuthMode(authMode);
    }

    updateNav();
    window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

$("menu-btn").addEventListener("click", () => {
    const open = $("nav").classList.toggle("open");
    $("menu-btn").setAttribute("aria-expanded", String(open));
});

/* ---------- search history ---------- */
function renderHistory() {
    const list = load("history", []);
    const box = $("history");
    box.innerHTML = "";
    list.forEach((term) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = term;
        chip.addEventListener("click", () => {
            input.value = term;
            startSearch();
        });
        box.appendChild(chip);
    });
    $("history-wrap").hidden = list.length === 0;
}

function addHistory(term) {
    const list = load("history", []).filter((t) => t.toLowerCase() !== term.toLowerCase());
    list.unshift(term);
    save("history", list.slice(0, 8));
    renderHistory();
}

$("clear-history").addEventListener("click", () => {
    save("history", []);
    renderHistory();
});
renderHistory();

/* ---------- saved images (one list per account) ---------- */
function getFavs() {
    const user = currentUser();
    return user ? load("favs:" + user.email, []) : [];
}
const isFav = (img) => getFavs().some((f) => f.page === img.page);

function toggleFav(img) {
    const user = currentUser();
    if (!user) {
        authNotice = "Log in to save images.";
        returnTo = view;
        closeLightbox();
        go("login");
        return;
    }
    let favs = getFavs();
    if (isFav(img)) favs = favs.filter((f) => f.page !== img.page);
    else favs.unshift(img);
    save("favs:" + user.email, favs);

    updateNav();
    syncFavButtons();
    if (view === "saved" && lightbox.hidden) renderSaved();
}

function setFavLabel(btn, img) {
    const on = isFav(img);
    btn.textContent = on ? "Saved" : "Save";
    btn.classList.toggle("on", on);
}

function syncFavButtons() {
    document.querySelectorAll(".card .fav-btn").forEach((b) => setFavLabel(b, b._img));
    if (lbCurrent) setFavLabel($("lb-fav"), lbCurrent);
}

/* ---------- filters ---------- */
function licenseKind(lic) {
    if (/public domain|cc0|^pd/i.test(lic)) return "pd";
    if (/^cc/i.test(lic)) return "cc";
    return "other";
}

function passesFilters(img) {
    const type = $("type").value;
    const size = $("size").value;
    const license = $("license").value;
    const shape = $("shape").value;

    if (type !== "all" && img.mime !== type) return false;

    const w = img.width;
    if (size === "small" && w >= 800) return false;
    if (size === "medium" && (w < 800 || w >= 2000)) return false;
    if (size === "large" && w < 2000) return false;

    if (license !== "all" && licenseKind(img.license) !== license) return false;

    if (shape !== "all") {
        const kind = img.width > img.height * 1.05 ? "landscape"
            : img.height > img.width * 1.05 ? "portrait" : "square";
        if (kind !== shape) return false;
    }
    return true;
}

/* ---------- fetching ---------- */
function stripHtml(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent || "").trim();
}

async function fetchPage() {
    const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*",
        generator: "search",
        gsrnamespace: "6",
        gsrsearch: state.query,
        gsrlimit: $("count").value,
        gsroffset: state.offset,
        gsrsort: $("sort").value,
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription",
        iiurlwidth: "500",
    });

    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();

    const pages = data.query ? Object.values(data.query.pages) : [];
    pages.sort((a, b) => a.index - b.index);

    const images = pages
        .filter((p) => p.imageinfo && p.imageinfo[0])
        .map((p) => {
            const info = p.imageinfo[0];
            const meta = info.extmetadata || {};
            return {
                title: p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
                thumb: info.thumburl || info.url,
                full: info.url,
                page: info.descriptionurl,
                width: info.width,
                height: info.height,
                mime: info.mime,
                author: stripHtml(meta.Artist && meta.Artist.value),
                license: (meta.LicenseShortName && meta.LicenseShortName.value) || "",
                desc: stripHtml(meta.ImageDescription && meta.ImageDescription.value),
            };
        });

    const next = data.continue ? data.continue.gsroffset : null;
    return { images, next };
}

/* ---------- download and copy ---------- */
async function downloadImage(img, btn) {
    const original = btn.textContent;
    btn.textContent = "Downloading...";
    try {
        const res = await fetch(img.full);
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const ext = (img.full.split(".").pop() || "jpg").split("?")[0];
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${img.title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
        window.open(img.full, "_blank", "noopener");
    }
    btn.textContent = original;
}

async function copyLink(img, btn) {
    const original = btn.textContent;
    try {
        await navigator.clipboard.writeText(img.page);
        btn.textContent = "Copied";
    } catch (e) {
        window.prompt("Copy this link:", img.page);
    }
    setTimeout(() => { btn.textContent = original; }, 1500);
}

/* ---------- rendering ---------- */
function makeCard(img, index) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.animationDelay = (index % 12) * 70 + "ms";   // photos jump in one after another

    const image = document.createElement("img");
    image.src = img.thumb;
    image.alt = img.title;
    image.loading = "lazy";
    image.addEventListener("click", () => openLightbox(index));

    const caption = document.createElement("p");
    caption.textContent = img.title;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "fav-btn";
    fav._img = img;
    setFavLabel(fav, img);
    fav.addEventListener("click", () => toggleFav(img));

    const dl = document.createElement("button");
    dl.type = "button";
    dl.textContent = "Download";
    dl.addEventListener("click", () => downloadImage(img, dl));

    actions.append(fav, dl);
    card.append(image, caption, actions);
    return card;
}

function updateLoadMore() {
    loadMoreBtn.hidden = !(view === "home" && state.hasMore && !$("infinite").checked);
}

function renderAll() {
    shown = fetched.filter(passesFilters);
    results.innerHTML = "";
    shown.forEach((img, i) => results.appendChild(makeCard(img, i)));

    if (!state.query) {
        statusEl.textContent = "";
    } else if (state.loading) {
        statusEl.textContent = "Loading...";
    } else if (shown.length === 0) {
        statusEl.textContent = state.hasMore
            ? "No loaded images match these filters. Loading more..."
            : `No images found for "${state.query}". Try other words or loosen the filters.`;
    } else {
        const hidden = fetched.length - shown.length;
        statusEl.textContent = `Showing ${shown.length} images for "${state.query}"` +
            (hidden > 0 ? ` (${hidden} hidden by filters)` : "");
    }
    updateLoadMore();
}

function renderSaved() {
    shown = getFavs();
    const box = $("saved-results");
    box.innerHTML = "";
    shown.forEach((img, i) => box.appendChild(makeCard(img, i)));
    $("saved-status").textContent = shown.length
        ? `${shown.length} saved ${shown.length === 1 ? "image" : "images"}`
        : "Nothing saved yet. Search on Home and select Save on any image.";
}

async function loadResults() {
    if (state.loading || !state.query) return;
    const myId = searchId;
    state.loading = true;
    loadMoreBtn.hidden = true;
    statusEl.textContent = "Loading...";

    try {
        let added = 0;
        let tries = 0;

        // Keep fetching until something passes the filters (max 5 requests)
        while (added === 0 && tries < 5) {
            const { images, next } = await fetchPage();
            if (myId !== searchId) return;
            fetched.push(...images);
            added += images.filter(passesFilters).length;
            state.offset = next;
            state.hasMore = next !== null;
            tries++;
            if (!state.hasMore) break;
        }
    } catch (err) {
        if (myId === searchId) {
            state.loading = false;
            statusEl.textContent = "Could not load images. Check your connection and try again.";
        }
        return;
    }

    if (myId !== searchId) return;
    state.loading = false;
    if (view === "home") renderAll();
    setTimeout(checkSentinel, 100);
}

/* ---------- infinite scroll ---------- */
function checkSentinel() {
    if (!$("infinite").checked || view !== "home" || !state.hasMore || state.loading) return;
    if ($("sentinel").getBoundingClientRect().top < window.innerHeight + 400) loadResults();
}
new IntersectionObserver(checkSentinel, { rootMargin: "400px" }).observe($("sentinel"));

/* ---------- searching ---------- */
function syncUrl(q) {
    try {
        const u = new URL(window.location.href);
        if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
        history.replaceState(null, "", u);
    } catch (e) { /* ignore (for example on file:// pages) */ }
}

function startSearch() {
    const query = input.value.trim();
    if (!query) {
        statusEl.textContent = "Type a word to search for.";
        return;
    }
    searchId++;
    state = { query, offset: 0, hasMore: false, loading: false };
    fetched = [];
    results.innerHTML = "";
    addHistory(query);
    syncUrl(query);
    loadResults();
}

form.addEventListener("submit", (e) => {
    e.preventDefault();
    startSearch();
});

loadMoreBtn.addEventListener("click", loadResults);

$("surprise").addEventListener("click", () => {
    input.value = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    startSearch();
});

// Sort and per page need a new request
["sort", "count"].forEach((id) => {
    $(id).addEventListener("change", () => {
        if (state.query) {
            input.value = state.query;
            startSearch();
        }
    });
});

// Filters work on what is already loaded
["size", "type", "license", "shape"].forEach((id) => {
    $(id).addEventListener("change", () => {
        renderAll();
        if (state.query && shown.length === 0 && state.hasMore) loadResults();
    });
});

/* ---------- lightbox ---------- */
function showLightbox() {
    const img = shown[lbIndex];
    if (!img) return closeLightbox();
    lbCurrent = img;

    $("lb-img").src = img.thumb;
    const big = new Image();
    big.onload = () => { if (lbCurrent === img) $("lb-img").src = img.full; };
    big.src = img.full;

    $("lb-img").alt = img.title;
    $("lb-title").textContent = img.title;

    const parts = [
        `${img.width} x ${img.height}px`,
        img.mime.replace("image/", "").replace("svg+xml", "svg").toUpperCase(),
    ];
    if (img.author) parts.push(`By ${img.author}`);
    if (img.license) parts.push(img.license);
    $("lb-meta").textContent = parts.join(", ");
    $("lb-desc").textContent = img.desc.length > 300 ? img.desc.slice(0, 300) + "..." : img.desc;

    $("lb-page").href = img.page;
    setFavLabel($("lb-fav"), img);
    $("lb-prev").hidden = lbIndex === 0;
    $("lb-next").hidden = lbIndex === shown.length - 1;
}

function openLightbox(index) {
    lbIndex = index;
    lightbox.hidden = false;
    showLightbox();
    $("lb-close").focus();
}

function closeLightbox() {
    const wasOpen = !lightbox.hidden;
    lightbox.hidden = true;
    $("lb-img").src = "";
    lbCurrent = null;
    // Refresh the saved page in case something was removed while the lightbox was open
    if (wasOpen && view === "saved") renderSaved();
}

function stepLightbox(delta) {
    const next = lbIndex + delta;
    if (next < 0 || next >= shown.length) return;
    lbIndex = next;
    showLightbox();
}

$("lb-close").addEventListener("click", closeLightbox);
$("lb-prev").addEventListener("click", () => stepLightbox(-1));
$("lb-next").addEventListener("click", () => stepLightbox(1));
$("lb-fav").addEventListener("click", () => lbCurrent && toggleFav(lbCurrent));
$("lb-download").addEventListener("click", () => lbCurrent && downloadImage(lbCurrent, $("lb-download")));
$("lb-copy").addEventListener("click", () => lbCurrent && copyLink(lbCurrent, $("lb-copy")));

lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
});

/* ---------- keyboard ---------- */
document.addEventListener("keydown", (e) => {
    if (!lightbox.hidden) {
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") stepLightbox(-1);
        if (e.key === "ArrowRight") stepLightbox(1);
        return;
    }
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (e.key === "/" && view === "home" && !/INPUT|SELECT|TEXTAREA/.test(tag)) {
        e.preventDefault();
        input.focus();
    }
});

/* ---------- mouse effects ---------- */
(function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = $("fx");
    const ctx = canvas.getContext("2d");
    const bg = $("bg");
    const spot = $("spot");
    let w = 0, h = 0;

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    let mx = w / 2, my = h / 2;   // smoothed position
    let tx = mx, ty = my;         // real mouse position
    let hue = 0;
    let seen = false;
    const parts = [];

    function spawn(x, y, n, speed) {
        for (let i = 0; i < n; i++) {
            const angle = Math.random() * Math.PI * 2;
            const v = Math.random() * speed;
            parts.push({
                x, y,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v - 0.4,
                life: 1,
                size: 2 + Math.random() * 5,
                hue: (hue + Math.random() * 60) % 360,
            });
        }
        if (parts.length > 220) parts.splice(0, parts.length - 220);
    }

    window.addEventListener("pointermove", (e) => {
        tx = e.clientX;
        ty = e.clientY;
        if (!seen) { mx = tx; my = ty; }
        seen = e.pointerType === "mouse" || seen;
        spawn(tx, ty, 2, 1.6);
    });

    window.addEventListener("pointerdown", (e) => spawn(e.clientX, e.clientY, 24, 5));

    function frame() {
        requestAnimationFrame(frame);
        hue = (hue + 1.2) % 360;

        mx += (tx - mx) * 0.14;
        my += (ty - my) * 0.14;

        // Only the background elements get the mouse position
        [bg, spot].forEach((el) => {
            el.style.setProperty("--mx", mx + "px");
            el.style.setProperty("--my", my + "px");
        });

        ctx.clearRect(0, 0, w, h);

        // Ring that follows the mouse
        if (seen) {
            ctx.beginPath();
            ctx.arc(mx, my, 16, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.7)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Sparkles
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.03;
            p.life -= 0.022;
            if (p.life <= 0) { parts.splice(i, 1); continue; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${p.life})`;
            ctx.fill();
        }
    }
    frame();
})();

/* ---------- start ---------- */
route();

const initial = new URLSearchParams(window.location.search).get("q");
if (initial && view === "home") {
    input.value = initial;
    startSearch();
}