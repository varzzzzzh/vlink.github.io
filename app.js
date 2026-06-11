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

    if (isImage) {
        addMessage(`📸 Image ready: ${packets.length} SMS messages`, "system");
    } else {
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

    addMessage(`📦 Received packet ${seq}/${tot}`, "system");

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
}

// ==========================================
// 6. IMAGE PROCESSING (Good Quality, Fewer SMS)
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("📸 Processing image...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // 500px width - good balance for text readability
            const MAX_WIDTH = 500;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Gentle contrast for text clarity
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = Math.min(255, Math.max(0, (pixels[i] - 128) * 1.25 + 128));
                pixels[i+1] = Math.min(255, Math.max(0, (pixels[i+1] - 128) * 1.25 + 128));
                pixels[i+2] = Math.min(255, Math.max(0, (pixels[i+2] - 128) * 1.25 + 128));
            }
            ctx.putImageData(imageData, 0, 0);
            
            // Compress to JPEG
            const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.65);
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 2000);
            addMessage(`✨ Image ready: ${sizeKB}KB | ${cost} SMS messages`, "system");
            
            // Show image directly in chat (SENDER sees it)
            addMessage(compressedDataUrl, "sent", true);
            
            // Send via SMS
            startSmsHandover(compressedDataUrl, true);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 7. TEXT SEND BUTTON (For notes - 1 SMS)
// ==========================================
// Add text send button
if (!document.getElementById("text-send-btn")) {
    const textBtn = document.createElement("button");
    textBtn.id = "text-send-btn";
    textBtn.innerHTML = "📝";
    textBtn.title = "Send as Text (1 SMS) - Perfect for notes";
    textBtn.style.cssText = "background:none; border:none; color:var(--accent-green); cursor:pointer; font-size:20px; padding:8px; border-radius:50%;";
    const inputArea = document.querySelector(".chat-input-area");
    if (inputArea) {
        const label = inputArea.querySelector("label");
        if (label) {
            label.parentNode.insertBefore(textBtn, label.nextSibling);
        } else {
            inputArea.insertBefore(textBtn, inputArea.firstChild);
        }
    }
    textBtn.onclick = () => {
        const text = prompt("📝 PASTE YOUR NOTES HERE:\n\n(1 SMS, perfect quality, readable immediately!)\n\nExample: Your textbook notes, study material, etc.");
        if (text && text.trim()) {
            if (!activeFriend) {
                addMessage("⚠️ Select a friend first!", "system");
                return;
            }
            if (!secretKeyInput.value) {
                addMessage("⚠️ Enter passcode first!", "system");
                return;
            }
            addMessage(`📝 Text note (${text.length} chars)`, "sent", false);
            startSmsHandover(text.trim(), false);
        }
    };
}

// ==========================================
// 8. ZOOM & PAN (Working for BOTH sender and receiver)
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
// 9. ADD MESSAGE TO CHAT (Image visible in chat)
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    
    if (isImage && content && content.startsWith("data:image")) {
        // Create image element that appears directly in chat
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "100%";
        img.style.maxHeight = "300px";
        img.style.borderRadius = "12px";
        img.style.cursor = "pointer";
        img.style.margin = "5px 0";
        img.style.border = "1px solid #444";
        img.onclick = () => openViewer(content);
        div.appendChild(img);
        
        // Add caption
        const caption = document.createElement("div");
        caption.style.fontSize = "11px";
        caption.style.marginTop = "5px";
        caption.style.opacity = "0.8";
        caption.style.display = "flex";
        caption.style.gap = "10px";
        caption.innerHTML = `🔍 Click image to open viewer | ${type === "sent" ? "📤 Sent" : "📥 Received"}`;
        div.appendChild(caption);
    } else {
        div.innerText = content;
    }
    
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

// ==========================================
// 10. OTHER EVENT HANDLERS
// ==========================================
document.getElementById("chunk-btn").onclick = () => {
    const text = importInput.value.trim();
    if (text) {
        if (text.startsWith("VLINK|")) {
            processIncoming(text);
        } else {
            if (!activeFriend) {
                addMessage("⚠️ Select a friend first!", "system");
                return;
            }
            if (!secretKeyInput.value) {
                addMessage("⚠️ Enter passcode first!", "system");
                return;
            }
            startSmsHandover(text, false);
        }
        importInput.value = "";
    }
};

importInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val.startsWith("VLINK|")) {
        processIncoming(val);
        importInput.value = "";
        addMessage("📥 Packet processed", "system");
    }
});

document.getElementById("show-qr-btn").onclick = () => {
    const qr = document.getElementById("qrcode");
    qr.classList.toggle("hidden");
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

document.getElementById("clear-chat-btn").onclick = () => {
    chatThread.innerHTML = '<div class="message system">💬 Chat cleared.</div>';
};

document.getElementById("reset-receiver").onclick = () => {
    if (confirm("⚠️ Delete ALL data? Friends, messages, and settings will be lost.")) {
        localStorage.clear();
        friends = [];
        activeFriend = null;
        reassemblyBuffer = {};
        renderFriends();
        chatThread.innerHTML = '<div class="message system">🔄 App reset. Add friends to start sharing.</div>';
        if (secretKeyInput) secretKeyInput.value = "";
        addMessage("App has been reset", "system");
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
