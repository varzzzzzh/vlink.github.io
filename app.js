// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem("vlink_friends")) || [];
let pendingImageData = null;

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
// 6. SMART IMAGE COMPRESSION with PREVIEW
// ==========================================
function showImagePreview(imageDataUrl, fileSize) {
    // Create preview modal if it doesn't exist
    let previewModal = document.getElementById("preview-modal");
    if (!previewModal) {
        previewModal = document.createElement("div");
        previewModal.id = "preview-modal";
        previewModal.className = "modal";
        previewModal.innerHTML = `
            <span class="close-preview" style="position:absolute; top:20px; right:25px; color:white; font-size:35px; cursor:pointer;">&times;</span>
            <div class="modal-content-wrapper" style="flex:1; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                <img id="preview-img" class="modal-content" style="position:absolute; max-width:90%; cursor:grab;">
            </div>
            <div style="padding:15px; display:flex; justify-content:center; gap:10px; background:rgba(0,0,0,0.8);">
                <button id="preview-zoom-in" style="background:#5865f2; color:white; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">🔍 Zoom In</button>
                <button id="preview-zoom-out" style="background:#5865f2; color:white; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">🔍 Zoom Out</button>
                <button id="preview-reset" style="background:#5865f2; color:white; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">⟲ Reset</button>
                <button id="confirm-send" style="background:#23a559; color:white; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">✅ Send Image</button>
                <button id="cancel-send" style="background:#da373c; color:white; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">❌ Cancel</button>
            </div>
        `;
        document.body.appendChild(previewModal);
    }
    
    const previewImg = document.getElementById("preview-img");
    previewImg.src = imageDataUrl;
    previewModal.style.display = "flex";
    
    // Preview zoom variables
    let previewZoom = 1;
    let isPreviewDragging = false;
    let previewStartX, previewStartY, previewLeft = 0, previewTop = 0;
    
    function updatePreviewTransform() {
        previewImg.style.transform = `scale(${previewZoom})`;
        previewImg.style.left = `${previewLeft}px`;
        previewImg.style.top = `${previewTop}px`;
    }
    
    function resetPreviewZoom() {
        previewZoom = 1;
        previewLeft = 0;
        previewTop = 0;
        updatePreviewTransform();
    }
    
    document.getElementById("preview-zoom-in").onclick = () => {
        previewZoom = Math.min(previewZoom + 0.25, 4);
        updatePreviewTransform();
    };
    
    document.getElementById("preview-zoom-out").onclick = () => {
        previewZoom = Math.max(previewZoom - 0.25, 0.5);
        if (previewZoom === 1) {
            previewLeft = 0;
            previewTop = 0;
        }
        updatePreviewTransform();
    };
    
    document.getElementById("preview-reset").onclick = resetPreviewZoom;
    
    // Drag for preview
    previewImg.onmousedown = (e) => {
        if (previewZoom <= 1) return;
        isPreviewDragging = true;
        previewStartX = e.clientX - previewLeft;
        previewStartY = e.clientY - previewTop;
    };
    
    window.onmousemove = (e) => {
        if (!isPreviewDragging) return;
        previewLeft = e.clientX - previewStartX;
        previewTop = e.clientY - previewStartY;
        updatePreviewTransform();
    };
    
    window.onmouseup = () => {
        isPreviewDragging = false;
    };
    
    // Touch events for preview
    previewImg.ontouchstart = (e) => {
        if (previewZoom <= 1) return;
        const touch = e.touches[0];
        isPreviewDragging = true;
        previewStartX = touch.clientX - previewLeft;
        previewStartY = touch.clientY - previewTop;
    };
    
    window.ontouchmove = (e) => {
        if (!isPreviewDragging) return;
        const touch = e.touches[0];
        previewLeft = touch.clientX - previewStartX;
        previewTop = touch.clientY - previewStartY;
        updatePreviewTransform();
    };
    
    window.ontouchend = () => {
        isPreviewDragging = false;
    };
    
    document.querySelector(".close-preview").onclick = () => {
        previewModal.style.display = "none";
        pendingImageData = null;
    };
    
    document.getElementById("cancel-send").onclick = () => {
        previewModal.style.display = "none";
        pendingImageData = null;
        addMessage("❌ Image sending cancelled", "system");
    };
    
    document.getElementById("confirm-send").onclick = () => {
        previewModal.style.display = "none";
        if (pendingImageData) {
            startSmsHandover(pendingImageData, true);
        }
    };
}

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("📸 Processing image with smart compression...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // SMART RESIZING - 800px for good readability
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d");
            
            // Draw image normally (preserves colors)
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Gentle contrast for better text readability
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = Math.min(255, Math.max(0, (pixels[i] - 128) * 1.1 + 128));
                pixels[i+1] = Math.min(255, Math.max(0, (pixels[i+1] - 128) * 1.1 + 128));
                pixels[i+2] = Math.min(255, Math.max(0, (pixels[i+2] - 128) * 1.1 + 128));
            }
            ctx.putImageData(imageData, 0, 0);
            
            // SMART COMPRESSION: Use WebP for smaller files
            let compressedDataUrl;
            
            try {
                compressedDataUrl = canvas.toDataURL("image/webp", 0.65);
            } catch(e) {
                compressedDataUrl = canvas.toDataURL("image/jpeg", 0.75);
            }
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const originalSizeKB = Math.round(file.size / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 2000);
            
            addMessage(`✨ Image ready: ${sizeKB}KB (was ${originalSizeKB}KB) | ${cost} SMS messages`, "system");
            
            if (cost > 12) {
                const proceed = confirm(`⚠️ This image will take ${cost} SMS messages.\nSize: ${sizeKB}KB\n\nContinue?`);
                if (!proceed) return;
            }
            
            // Store for preview
            pendingImageData = compressedDataUrl;
            
            // Show preview with zoom capability
            showImagePreview(compressedDataUrl, file.size);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 6b. SEND AS TEXT (1 SMS)
// ==========================================
document.getElementById("text-note-btn").onclick = () => {
    const text = prompt("📝 Enter your notes/text to send:\n\n(1 SMS, perfect quality)");
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
    }
};

// ==========================================
// 7. ZOOM & PAN (For received images - FULLY WORKING)
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

// Mouse events
fullImg.addEventListener("mousedown", startDrag);
window.addEventListener("mousemove", doDrag);
window.addEventListener("mouseup", endDrag);

// Touch events
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
        img.style.maxHeight = "300px";
        img.style.borderRadius = "8px";
        img.style.cursor = "pointer";
        img.style.objectFit = "contain";
        img.onclick = () => openViewer(content);
        div.appendChild(img);
        const caption = document.createElement("div");
        caption.style.fontSize = "10px";
        caption.style.marginTop = "4px";
        caption.style.opacity = "0.7";
        caption.innerText = "🔍 Tap image to zoom & pan";
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
        addMessage("App reset", "system");
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
