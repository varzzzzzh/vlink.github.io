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

document.getElementById("delete-friend-btn").onclick = () => {
    if (!activeFriend) {
        addMessage("Select a friend first to delete", "system");
        return;
    }
    if (confirm(`Delete ${activeFriend.name}?`)) {
        friends = friends.filter(f => f.id !== activeFriend.id);
        localStorage.setItem("vlink_friends", JSON.stringify(friends));
        activeFriend = null;
        document.getElementById("chat-target").innerText = "VLink Secure";
        renderFriends();
        addMessage(`Removed contact`, "system");
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

    if (!isImage) {
        addMessage(data, "sent", false);
    }
    
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
            const isImage = decrypted.startsWith("data:image");
            addMessage(decrypted, "received", isImage);
            delete reassemblyBuffer[tId];
        } catch (e) { addMessage("Decryption Error", "system"); }
    }
}

// ==========================================
// 6. SMART IMAGE COMPRESSION (Good Quality + Few SMS)
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check if it's a text/screenshot - suggest text mode
    addMessage("📸 Processing image...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // Use 600px for text images (smaller = fewer SMS)
            const MAX_WIDTH = 600;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            
            // Draw image
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Increase contrast for text readability
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            
            // Stronger contrast for text (1.3x)
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = Math.min(255, Math.max(0, (pixels[i] - 128) * 1.3 + 128));
                pixels[i+1] = Math.min(255, Math.max(0, (pixels[i+1] - 128) * 1.3 + 128));
                pixels[i+2] = Math.min(255, Math.max(0, (pixels[i+2] - 128) * 1.3 + 128));
            }
            ctx.putImageData(imageData, 0, 0);
            
            // Compress
            let compressedDataUrl;
            try {
                compressedDataUrl = canvas.toDataURL("image/webp", 0.5);
            } catch(e) {
                compressedDataUrl = canvas.toDataURL("image/jpeg", 0.6);
            }
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 2000);
            
            addMessage(`✨ Image ready: ${sizeKB}KB | ${cost} SMS messages`, "system");
            
            // Ask user if they want to proceed or use text mode
            if (cost > 10) {
                const useText = confirm(`⚠️ This will take ${cost} SMS messages.\n\nFor text notes, use "Send as Text" button (1 SMS).\n\nSend as image anyway?`);
                if (!useText) return;
            }
            
            // Show preview before sending
            showPreviewAndSend(compressedDataUrl);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// Preview before sending
function showPreviewAndSend(imageData) {
    // Create preview div
    let previewDiv = document.getElementById("image-preview");
    if (!previewDiv) {
        previewDiv = document.createElement("div");
        previewDiv.id = "image-preview";
        previewDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #1e1f22; border-radius: 16px; padding: 20px;
            z-index: 1000; text-align: center; max-width: 90vw; max-height: 90vh;
            box-shadow: 0 0 50px rgba(0,0,0,0.9); border: 1px solid #444;
        `;
        previewDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <h3 style="color:white;">Preview Image</h3>
                <button id="close-preview-btn" style="background:none; border:none; color:white; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div style="overflow: auto; max-height: 60vh;">
                <img id="preview-img" style="max-width: 100%; cursor: pointer;">
            </div>
            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                <button id="cancel-send-btn" style="background:#da373c; color:white; border:none; padding: 10px 20px; border-radius: 8px; cursor:pointer;">Cancel</button>
                <button id="confirm-send-btn" style="background:#23a559; color:white; border:none; padding: 10px 20px; border-radius: 8px; cursor:pointer;">Send Image</button>
            </div>
        `;
        document.body.appendChild(previewDiv);
    }
    
    const previewImg = document.getElementById("preview-img");
    previewImg.src = imageData;
    previewDiv.style.display = "block";
    
    // Zoom on click
    let zoomed = false;
    previewImg.onclick = () => {
        if (!zoomed) {
            previewImg.style.transform = "scale(2)";
            previewImg.style.cursor = "zoom-out";
            zoomed = true;
        } else {
            previewImg.style.transform = "scale(1)";
            previewImg.style.cursor = "zoom-in";
            zoomed = false;
        }
    };
    
    document.getElementById("close-preview-btn").onclick = () => {
        previewDiv.style.display = "none";
    };
    
    document.getElementById("cancel-send-btn").onclick = () => {
        previewDiv.style.display = "none";
        addMessage("❌ Send cancelled", "system");
    };
    
    document.getElementById("confirm-send-btn").onclick = () => {
        previewDiv.style.display = "none";
        startSmsHandover(imageData, true);
    };
}

// ==========================================
// 6b. SEND AS TEXT (1 SMS, BEST FOR NOTES)
// ==========================================
document.getElementById("text-note-btn").onclick = () => {
    const text = prompt("📝 Paste your notes/text here:\n\n(This sends as text - 1 SMS, perfect quality)\n\nExample: Your textbook notes, study material, etc.");
    if (text && text.trim()) {
        if (!activeFriend) {
            addMessage("⚠️ Select a friend first!", "system");
            return;
        }
        if (!secretKeyInput.value) {
            addMessage("⚠️ Enter passcode first!", "system");
            return;
        }
        addMessage(`📝 Sending text (${text.length} characters)...`, "system");
        startSmsHandover(text.trim(), false);
    } else if (text === "") {
        addMessage("⚠️ Cannot send empty message", "system");
    }
};

// ==========================================
// 7. ZOOM & PAN (For received images)
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
    if (currentZoom > 4) currentZoom = 4;
    fullImg.style.transform = `scale(${currentZoom})`;
};

window.resetZoom = () => {
    currentZoom = 1;
    imgLeft = 0;
    imgTop = 0;
    fullImg.style.transform = `scale(1)`;
    fullImg.style.left = "0px";
    fullImg.style.top = "0px";
};

const startDrag = (e) => {
    if (currentZoom <= 1) return;
    isDragging = true;
    const event = e.touches ? e.touches[0] : e;
    startX = event.clientX - imgLeft;
    startY = event.clientY - imgTop;
    e.preventDefault();
};

const doDrag = (e) => {
    if (!isDragging) return;
    const event = e.touches ? e.touches[0] : e;
    imgLeft = event.clientX - startX;
    imgTop = event.clientY - startY;
    fullImg.style.left = `${imgLeft}px`;
    fullImg.style.top = `${imgTop}px`;
    e.preventDefault();
};

const endDrag = () => {
    isDragging = false;
};

fullImg.addEventListener("mousedown", startDrag);
window.addEventListener("mousemove", doDrag);
window.addEventListener("mouseup", endDrag);
fullImg.addEventListener("touchstart", startDrag);
window.addEventListener("touchmove", doDrag, { passive: false });
window.addEventListener("touchend", endDrag);

document.querySelector(".close-viewer").onclick = () => {
    viewer.style.display = "none";
    resetZoom();
};

document.getElementById("download-btn").onclick = () => {
    if (fullImg.src) {
        const link = document.createElement("a");
        link.download = "vlink-image.jpg";
        link.href = fullImg.src;
        link.click();
        addMessage("💾 Image saved", "system");
    }
};

// ==========================================
// 8. HELPERS
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    if (isImage && content.startsWith("data:image")) {
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "100%";
        img.style.maxHeight = "250px";
        img.style.borderRadius = "8px";
        img.style.cursor = "pointer";
        img.style.objectFit = "contain";
        img.onclick = () => openViewer(content);
        div.appendChild(img);
        const caption = document.createElement("div");
        caption.style.fontSize = "10px";
        caption.style.marginTop = "4px";
        caption.style.opacity = "0.7";
        caption.innerText = "🔍 Tap to zoom & pan";
        div.appendChild(caption);
    } else {
        div.innerText = content;
    }
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

document.getElementById("clear-chat-btn").onclick = () => {
    chatThread.innerHTML = '<div class="message system">Chat cleared.</div>';
};

document.getElementById("reset-receiver").onclick = () => {
    if (confirm("Delete all data?")) {
        localStorage.clear();
        friends = [];
        activeFriend = null;
        reassemblyBuffer = {};
        renderFriends();
        chatThread.innerHTML = '<div class="message system">App reset. Add friends to start.</div>';
    }
};

function updateStatus() {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.innerHTML = navigator.onLine ? "● Online" : "● SMS Mode";
        statusEl.style.color = navigator.onLine ? "#23a559" : "#f23f43";
    }
}

window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);
