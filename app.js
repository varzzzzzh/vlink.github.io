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
                addMessage(`✅ Image sent! ${packets.length} SMS messages`, "system");
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
// 6. AGGRESSIVE COMPRESSION FOR TEXT IMAGES
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("📸 Compressing image for SMS...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // AGGRESSIVE RESIZE - 400px for text images (fewer SMS)
            const MAX_WIDTH = 400;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Increase contrast for text (makes it sharper)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                // Strong contrast for text
                pixels[i] = Math.min(255, Math.max(0, (pixels[i] - 128) * 1.4 + 128));
                pixels[i+1] = Math.min(255, Math.max(0, (pixels[i+1] - 128) * 1.4 + 128));
                pixels[i+2] = Math.min(255, Math.max(0, (pixels[i+2] - 128) * 1.4 + 128));
            }
            ctx.putImageData(imageData, 0, 0);
            
            // AGGRESSIVE JPEG COMPRESSION
            const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.5);
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 2000);
            
            addMessage(`✨ Image compressed: ${sizeKB}KB | ${cost} SMS messages`, "system");
            
            if (cost > 15) {
                const proceed = confirm(`⚠️ This will take ${cost} SMS messages.\n\nFor text notes, please use the "Send as Text" option instead.\n\nContinue anyway?`);
                if (!proceed) return;
            }
            
            // Show preview and send
            showPreviewAndSend(compressedDataUrl);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// Preview before sending
function showPreviewAndSend(imageData) {
    let previewDiv = document.getElementById("image-preview");
    if (!previewDiv) {
        previewDiv = document.createElement("div");
        previewDiv.id = "image-preview";
        previewDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #1e1f22; border-radius: 16px; padding: 20px;
            z-index: 10000; text-align: center; max-width: 90vw;
            box-shadow: 0 0 50px rgba(0,0,0,0.9); border: 2px solid #5865f2;
        `;
        previewDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <h3 style="color:white;">📷 Preview Image</h3>
                <button id="close-preview" style="background:none; border:none; color:white; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div style="overflow: auto; max-height: 50vh;">
                <img id="preview-img" style="max-width: 100%; border-radius: 8px;">
            </div>
            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                <button id="cancel-send" style="background:#da373c; color:white; border:none; padding: 10px 20px; border-radius: 8px; cursor:pointer;">❌ Cancel</button>
                <button id="confirm-send" style="background:#23a559; color:white; border:none; padding: 10px 20px; border-radius: 8px; cursor:pointer;">✅ Send Image</button>
            </div>
            <p style="color:#949ba4; font-size: 11px; margin-top: 10px;">👆 Image will be viewable with zoom</p>
        `;
        document.body.appendChild(previewDiv);
    }
    
    const previewImg = document.getElementById("preview-img");
    previewImg.src = imageData;
    previewDiv.style.display = "block";
    
    document.getElementById("close-preview").onclick = () => {
        previewDiv.style.display = "none";
    };
    
    document.getElementById("cancel-send").onclick = () => {
        previewDiv.style.display = "none";
        addMessage("❌ Send cancelled", "system");
    };
    
    document.getElementById("confirm-send").onclick = () => {
        previewDiv.style.display = "none";
        startSmsHandover(imageData, true);
    };
}

// ==========================================
// 7. ZOOM & PAN (FULLY WORKING)
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
// 8. ADD TEXT SEND BUTTON
// ==========================================
// Add a text send button dynamically
const textBtn = document.createElement("button");
textBtn.id = "text-send-btn";
textBtn.innerHTML = "📝";
textBtn.title = "Send as Text (1 SMS)";
textBtn.style.cssText = "background:none; border:none; color:var(--accent-green); cursor:pointer; font-size:20px; padding:8px;";
const inputArea = document.querySelector(".chat-input-area");
if (inputArea && !document.getElementById("text-send-btn")) {
    inputArea.insertBefore(textBtn, document.getElementById("chunk-btn"));
}

document.getElementById("text-send-btn").onclick = () => {
    const text = prompt("📝 PASTE YOUR NOTES HERE:\n\n(This sends as TEXT - 1 SMS, perfect quality!)\n\nExample: Your textbook notes, study material, etc.");
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
// 9. HELPERS
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    if (isImage && content && content.startsWith("data:image")) {
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "200px";
        img.style.maxHeight = "200px";
        img.style.borderRadius = "8px";
        img.style.cursor = "pointer";
        img.style.objectFit = "cover";
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
