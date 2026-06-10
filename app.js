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
    loadSecretKey();
}
initApp();

// Save/load secret key
function loadSecretKey() {
    const savedKey = localStorage.getItem("vlink_secret_key");
    if (savedKey && secretKeyInput) {
        secretKeyInput.value = savedKey;
    }
}

function saveSecretKey() {
    if (secretKeyInput && secretKeyInput.value) {
        localStorage.setItem("vlink_secret_key", secretKeyInput.value);
    }
}

secretKeyInput?.addEventListener("change", saveSecretKey);
secretKeyInput?.addEventListener("blur", saveSecretKey);

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
            const targetEl = document.getElementById("chat-target");
            if (targetEl) targetEl.innerText = `@${f.name}`;
            renderFriends();
            addMessage(`🔐 Secure session started with ${f.name}`, "system");
        };
        list.appendChild(div);
    });
}

document.getElementById("add-friend-btn")?.addEventListener("click", () => {
    const name = prompt("Friend Name:");
    const phone = prompt("Phone Number:");
    if (name && phone) {
        friends.push({ id: Date.now(), name, phone });
        localStorage.setItem("vlink_friends", JSON.stringify(friends));
        renderFriends();
        addMessage(`✅ Added ${name} to contacts`, "system");
    }
});

document.getElementById("delete-friend-btn")?.addEventListener("click", () => {
    if (!activeFriend) {
        addMessage("⚠️ Select a friend first to delete", "system");
        return;
    }
    if (confirm(`Delete ${activeFriend.name}?`)) {
        friends = friends.filter(f => f.id !== activeFriend.id);
        localStorage.setItem("vlink_friends", JSON.stringify(friends));
        activeFriend = null;
        document.getElementById("chat-target").innerText = "VLink Secure";
        renderFriends();
        addMessage(`🗑️ Removed from contacts`, "system");
    }
});

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
    if (!password) {
        addMessage("⚠️ Please enter a passcode first!", "system");
        return;
    }
    if (!activeFriend) {
        addMessage("⚠️ Please select a friend first!", "system");
        return;
    }

    let encrypted = await encryptData(data, password);
    const chunkSize = 1800; // Slightly smaller for safety
    const tId = Math.floor(Math.random() * 9000) + 1000;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    if (isImage) {
        addMessage(`📸 Image ready: ${packets.length} SMS packets`, "system");
    } else {
        addMessage(data, "sent", false);
    }
    
    let idx = 0;
    packetCounter.classList.remove("hidden");

    const updateBadge = () => {
        packetCounter.innerText = `📨 Packet ${idx + 1}/${packets.length} - Tap to Send`;
        packetCounter.onclick = () => {
            const smsUrl = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
            window.location.href = smsUrl;
            idx++;
            if (idx < packets.length) {
                updateBadge();
            } else {
                packetCounter.innerText = "✅ All Packets Sent!";
                setTimeout(() => packetCounter.classList.add("hidden"), 3000);
                addMessage(`✅ Complete! Sent ${packets.length} SMS packets`, "system");
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
    
    try {
        const parts = rawData.split("|");
        const tId = parts[1].split(":")[1];
        const seq = parseInt(parts[2].split(":")[1]);
        const tot = parseInt(parts[3].split(":")[1]);
        const data = parts[4].replace("DATA:", "");

        if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
        reassemblyBuffer[tId][seq - 1] = data;

        const receivedCount = reassemblyBuffer[tId].filter(x => x !== null).length;
        addMessage(`📦 Received packet ${seq}/${tot} for transfer ${tId}`, "system");

        if (reassemblyBuffer[tId].filter(x => x !== null).length === tot) {
            addMessage(`🔓 Complete! Reassembling ${tot} packets...`, "system");
            try {
                const decrypted = await decryptData(reassemblyBuffer[tId].join(""), password);
                const isImage = decrypted.startsWith("data:image");
                addMessage(decrypted, "received", isImage);
                delete reassemblyBuffer[tId];
            } catch (e) {
                addMessage("❌ Decryption Error - Check your passcode", "system");
                delete reassemblyBuffer[tId];
            }
        }
    } catch (e) {
        console.error("Parse error:", e);
        addMessage("⚠️ Received malformed packet", "system");
    }
}

// ==========================================
// 6. SMART IMAGE PROCESSING (Preserves Quality & Color)
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("🎨 Processing image for SMS transmission...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // Balanced resizing: 800px width for text readability
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            
            // Draw image WITH color preservation
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Optional: Light contrast boost for text clarity (preserves color)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            
            // Gentle contrast enhancement for better text readability
            let totalBrightness = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                totalBrightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
            }
            const avgBrightness = totalBrightness / (pixels.length / 4);
            const contrastFactor = 1.15;
            
            for (let i = 0; i < pixels.length; i += 4) {
                // Gentle contrast adjustment
                pixels[i] = Math.min(255, Math.max(0, (pixels[i] - avgBrightness) * contrastFactor + avgBrightness));
                pixels[i+1] = Math.min(255, Math.max(0, (pixels[i+1] - avgBrightness) * contrastFactor + avgBrightness));
                pixels[i+2] = Math.min(255, Math.max(0, (pixels[i+2] - avgBrightness) * contrastFactor + avgBrightness));
            }
            ctx.putImageData(imageData, 0, 0);
            
            // Smart compression: WebP preferred for quality/size
            let compressedDataUrl;
            let quality = 0.75;
            
            if (canvas.toDataURL("image/webp", quality).length < canvas.toDataURL("image/jpeg", 0.85).length) {
                compressedDataUrl = canvas.toDataURL("image/webp", quality);
                addMessage("📸 Using WebP compression (best quality/size ratio)", "system");
            } else {
                compressedDataUrl = canvas.toDataURL("image/jpeg", 0.85);
                addMessage("📸 Using JPEG compression (high quality)", "system");
            }
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 1800);
            
            addMessage(`✨ Image ready: ${sizeKB}KB | ${cost} SMS packet${cost > 1 ? 's' : ''}`, "system");
            
            if (cost > 20) {
                const proceed = confirm(`This image will take ${cost} SMS messages to send. Continue?\n\nTip: Use smaller images for better results.`);
                if (!proceed) return;
            }
            
            startSmsHandover(compressedDataUrl, true);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 6b. TEXT-ONLY MODE for Notes
// ==========================================
document.getElementById("text-note-btn")?.addEventListener("click", () => {
    const text = prompt("📝 Enter your notes or text to send:\n\n(Tip: Long text will be split into multiple SMS messages)");
    if (text && text.trim()) {
        if (!activeFriend) {
            addMessage("⚠️ Please select a friend first!", "system");
            return;
        }
        addMessage(`📝 Sending text note (${text.length} characters)...`, "system");
        startSmsHandover(text.trim(), false);
    } else if (text === "") {
        addMessage("⚠️ Cannot send empty message", "system");
    }
});

// ==========================================
// 7. ZOOM & PAN for Image Viewer
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
};

const doDrag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const event = e.touches ? e.touches[0] : e;
    imgLeft = event.clientX - startX;
    imgTop = event.clientY - startY;
    fullImg.style.left = `${imgLeft}px`;
    fullImg.style.top = `${imgTop}px`;
};

fullImg?.addEventListener("mousedown", startDrag);
fullImg?.addEventListener("touchstart", startDrag);
window.addEventListener("mousemove", doDrag);
window.addEventListener("touchmove", doDrag, { passive: false });
window.addEventListener("mouseup", () => isDragging = false);
window.addEventListener("touchend", () => isDragging = false);

document.querySelector(".close-viewer")?.addEventListener("click", () => {
    viewer.style.display = "none";
    resetZoom();
});

// Download button
document.getElementById("download-btn")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "vlink-image.jpg";
    link.href = fullImg.src;
    link.click();
});

// ==========================================
// 8. HELPERS & UI
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    if (isImage && content.startsWith("data:image")) {
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "100%";
        img.style.borderRadius = "12px";
        img.style.cursor = "pointer";
        img.style.imageRendering = "auto";
        img.onclick = () => openViewer(content);
        div.appendChild(img);
        // Add caption
        const caption = document.createElement("div");
        caption.style.fontSize = "10px";
        caption.style.marginTop = "4px";
        caption.style.opacity = "0.7";
        caption.innerText = "📸 Tap to zoom";
        div.appendChild(caption);
    } else {
        div.innerText = content;
    }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

document.getElementById("chunk-btn")?.addEventListener("click", () => {
    const text = importInput.value.trim();
    if (text) {
        if (text.startsWith("VLINK|")) {
            processIncoming(text);
        } else {
            if (!activeFriend) {
                addMessage("⚠️ Please select a friend first!", "system");
                return;
            }
            if (!secretKeyInput.value) {
                addMessage("⚠️ Please enter a passcode first!", "system");
                return;
            }
            startSmsHandover(text, false);
        }
        importInput.value = "";
    }
});

// Auto-detect pasted VLINK packets
importInput?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val.startsWith("VLINK|")) {
        processIncoming(val);
        importInput.value = "";
        addMessage("📥 Packet received and processed", "system");
    }
});

document.getElementById("show-qr-btn")?.addEventListener("click", () => {
    const qr = document.getElementById("qrcode");
    qr.classList.toggle("hidden");
    if (qr.innerHTML === "" || qr.innerHTML === "<div></div>") {
        new QRCode(qr, { 
            text: window.location.href, 
            width: 128, 
            height: 128 
        });
    }
});

document.getElementById("clear-chat-btn")?.addEventListener("click", () => {
    chatThread.innerHTML = '<div class="message system">💬 Chat cleared. Ready for new messages.</div>';
    addMessage("Chat history cleared", "system");
});

document.getElementById("reset-receiver")?.addEventListener("click", () => {
    if (confirm("⚠️ This will delete ALL friends, messages, and settings. Continue?")) {
        localStorage.clear();
        friends = [];
        activeFriend = null;
        reassemblyBuffer = {};
        renderFriends();
        chatThread.innerHTML = '<div class="message system">🔄 App reset. Add friends to start sharing notes.</div>';
        if (secretKeyInput) secretKeyInput.value = "";
        addMessage("App has been reset", "system");
    }
});

function updateStatus() {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.innerHTML = navigator.onLine ? "● Online" : "● SMS Mode";
        statusEl.style.color = navigator.onLine ? "#23a559" : "#f23f43";
    }
}

window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);
