const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const results = document.getElementById("results");

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxClose = document.getElementById("lightbox-close");

/* ---------- Helpers ---------- */

function showStatus(message) {
    results.innerHTML = "";
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = message;
    results.appendChild(p);
}

function cleanTitle(title) {
    return title
        .replace(/^File:/, "")      // remove "File:" prefix
        .replace(/\.[^.]+$/, "")    // remove file extension
        .replace(/_/g, " ");        // underscores to spaces
}

function openLightbox(src, fallback, caption) {
    lightboxImg.src = src;
    lightboxImg.onerror = () => {
        lightboxImg.onerror = null;
        lightboxImg.src = fallback;   // use thumbnail if original fails
    };
    lightboxImg.alt = caption;
    lightboxCaption.textContent = caption;
    lightbox.classList.remove("hidden");
}

function closeLightbox() {
    lightbox.classList.add("hidden");
    lightboxImg.src = "";
}

/* ---------- Lightbox events ---------- */

lightboxClose.addEventListener("click", closeLightbox);

lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLightbox();
});

/* ---------- Search ---------- */

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const query = input.value.trim();
    if (!query) return;

    showStatus("Loading...");

    const url =
        "https://commons.wikimedia.org/w/api.php?action=query" +
        "&generator=search" +
        "&gsrsearch=" + encodeURIComponent(query) +
        "&gsrnamespace=6" +
        "&gsrlimit=12" +
        "&prop=imageinfo" +
        "&iiprop=url" +
        "&iiurlwidth=300" +
        "&format=json" +
        "&origin=*";

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Request failed");

        const data = await response.json();

        // No results
        if (!data.query) {
            showStatus("No results found for \"" + query + "\".");
            return;
        }

        // Keep search ranking order and skip pages without image info
        const items = Object.values(data.query.pages)
            .filter((item) => item.imageinfo)
            .sort((a, b) => a.index - b.index);

        if (items.length === 0) {
            showStatus("No results found for \"" + query + "\".");
            return;
        }

        results.innerHTML = "";

        items.forEach((item) => {

            const info = item.imageinfo[0];
            const name = cleanTitle(item.title);

            const card = document.createElement("article");
            card.className = "card";

            const img = document.createElement("img");
            img.src = info.thumburl;
            img.alt = name;
            img.loading = "lazy";

            const title = document.createElement("p");
            title.textContent = name;
            title.title = name;   // full title on hover

            card.appendChild(img);
            card.appendChild(title);

            card.addEventListener("click", () => {
                openLightbox(info.url, info.thumburl, name);
            });

            results.appendChild(card);
        });

    } catch (error) {
        showStatus("Something went wrong. Please check your connection and try again.");
    }
});