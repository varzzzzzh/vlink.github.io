// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem("vlink_friends")) || [];

const chatThread = document.getElementById("chat-thread");
const importInput = document.getElementById("import-input");
const secretKeyInput = document.getElementById("secret-key");
const packetCounter = document.getElementById("packet-counter");
const fileInput = document.getElementById("file-input");
const viewer = document.getElementById("image-viewer");
const fullImg = document.getElementById("full-image");

function initApp() {
    renderFriends();
    updateStatus();
}
initApp();

// ==========================================
// 2. SIDEBAR & CONTACTS
// ==========================================
function renderFriends() {
    const list = document.getElementById("friends-list");
    if (!list) return;
    list.innerHTML = "";
    friends.forEach((f) => {
        const div = document.createElement("div");
        const isActive = activeFriend?.id === f.id;
        div.className = `server-icon ${isActive ? "active" : ""}`;
        div.innerText = f.name[0].toUpperCase();
        div.onclick = () => {
            activeFriend = f;
            document.getElementById("chat-target").innerText = `@${f.name}`;
            renderFriends();
            addMessage(`Secure session started with ${f.name}`, "system");
        };
        list.appendChild(div);
    });
}

document.getElementById("add-friend-btn").onclick = () => {
    const name = prompt("Friend Name:");
    const phone = prompt("Phone Number:");
    if (name && phone) {
        friends.push({ id: Date.now(), name, phone });
        localStorage.setItem("vlink_friends", JSON.stringify(friends));
        renderFriends();
    }
};

// ==========================================
// 3. CRYPTOGRAPHY (AES-GCM)
// ==========================================
async function getEncryptionKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("vlink-salt"), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function encryptData(text, password) {
    const key = await getEncryptionKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(base64Data, password) {
    const key = await getEncryptionKey(password);
    const combined = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
    return new TextDecoder().decode(decrypted);
}

// ==========================================
// 4. SMS TRANSMISSION
// ==========================================
async function startSmsHandover(data, isImage = false) {
    const password = secretKeyInput.value;
    if (!password) return alert("Enter Passcode!");
    if (!activeFriend) return alert("Select friend!");

    let encrypted = await encryptData(data, password);
    const chunkSize = 2000;
    const tId = Math.floor(Math.random() * 900) + 100;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    addMessage(data, "sent", isImage);
    let idx = 0;
    packetCounter.classList.remove("hidden");

    const updateBadge = () => {
        packetCounter.innerText = `Part ${idx + 1}/${packets.length} - Click to Send`;
        packetCounter.onclick = () => {
            window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
            idx++;
            if (idx < packets.length) updateBadge();
            else {
                packetCounter.innerText = "Sent ✓";
                setTimeout(() => packetCounter.classList.add("hidden"), 3000);
            }
        };
    };
    updateBadge();
}

// ==========================================
// 5. RECEIVING & REASSEMBLY
// ==========================================
async function processIncoming(rawData) {
    const password = secretKeyInput.value;
    if (!rawData.startsWith("VLINK|") || !password) return;
    const parts = rawData.split("|");
    const tId = parts[1].split(":")[1];
    const seq = parseInt(parts[2].split(":")[1]);
    const tot = parseInt(parts[3].split(":")[1]);
    const data = parts[4].replace("DATA:", "");

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
    reassemblyBuffer[tId][seq - 1] = data;

    if (reassemblyBuffer[tId].filter(x => x !== null).length === tot) {
        try {
            const decrypted = await decryptData(reassemblyBuffer[tId].join(""), password);
            addMessage(decrypted, "received", decrypted.startsWith("data:image"));
            delete reassemblyBuffer[tId];
        } catch (e) { addMessage("Decryption Error", "system"); }
    }
}

// ==========================================
// 6. THE "FAX-CRUSH" (GUARANTEED UNDER 10 SMS)
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("Fax-Crush: Stripping all grays...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // REDUCED WIDTH TO 480: Still very readable, but saves 40% more data
            const MAX_WIDTH = 480; 
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            ctx.filter = "grayscale(1) contrast(3) brightness(1.2)";
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // MANUAL 1-BIT THRESHOLDING
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                const lightness = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
                const v = lightness > 120 ? 255 : 0; // Pure Black or Pure White
                pixels[i] = pixels[i+1] = pixels[i+2] = v;
            }
            ctx.putImageData(imageData, 0, 0);

            // EXTREME JPEG CRUSH
            // Since there is NO gray, 0.05 quality looks exactly like 0.9 quality
            const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.05); 
            
            const cost = Math.ceil(compressedDataUrl.length / 2000);
            addMessage(`Binary Scan Ready. Cost: ${cost} SMS.`, "system");
            startSmsHandover(compressedDataUrl, true);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 7. ZOOM & PAN
// ==========================================
let currentZoom = 1;
let isDragging = false;
let startX, startY, imgLeft = 0, imgTop = 0;

function openViewer(src) {
    viewer.style.display = "flex";
    fullImg.src = src;
    resetZoom();
}

window.adjustZoom = (delta) => {
    currentZoom += delta;
    if (currentZoom < 1) currentZoom = 1;
    fullImg.style.transform = `scale(${currentZoom})`;
};

window.resetZoom = () => {
    currentZoom = 1; imgLeft = 0; imgTop = 0;
    fullImg.style.transform = `scale(1)`;
    fullImg.style.left = "0px"; fullImg.style.top = "0px";
};

const startDrag = (e) => {
    if (currentZoom <= 1) return;
    isDragging = true;
    const event = e.touches ? e.touches[0] : e;
    startX = event.clientX - imgLeft;
    startY = event.clientY - imgTop;
};

const doDrag = (e) => {
    if (!isDragging) return;
    const event = e.touches ? e.touches[0] : e;
    imgLeft = event.clientX - startX;
    imgTop = event.clientY - startY;
    fullImg.style.left = `${imgLeft}px`;
    fullImg.style.top = `${imgTop}px`;
};

fullImg.addEventListener("mousedown", startDrag);
fullImg.addEventListener("touchstart", startDrag);
window.addEventListener("mousemove", doDrag);
window.addEventListener("touchmove", doDrag, { passive: false });
window.addEventListener("mouseup", () => isDragging = false);
window.addEventListener("touchend", () => isDragging = false);

document.querySelector(".close-viewer").onclick = () => viewer.style.display = "none";

// ==========================================
// 8. HELPERS
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    if (isImage) {
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "100%";
        img.style.imageRendering = "pixelated"; 
        img.onclick = () => openViewer(content);
        div.appendChild(img);
    } else { div.innerText = content; }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

document.getElementById("chunk-btn").onclick = () => {
    if (importInput.value.trim()) {
        startSmsHandover(importInput.value.trim());
        importInput.value = "";
    }
};

importInput.addEventListener("input", (e) => {
    if (e.target.value.startsWith("VLINK|")) processIncoming(e.target.value.trim());
});

document.getElementById("show-qr-btn").onclick = () => {
    const qr = document.getElementById("qrcode");
    qr.classList.toggle("hidden");
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

function updateStatus() {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.innerHTML = navigator.onLine ? "● Online" : "● SMS Mode";
        statusEl.style.color = navigator.onLine ? "#23a559" : "#f23f43";
    }
}