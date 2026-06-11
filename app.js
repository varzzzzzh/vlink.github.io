// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem("vlink_friends")) || [];
let pendingImageData = null; // Store processed image before sending

const chatThread = document.getElementById("chat-thread");
const importInput = document.getElementById("import-input");
const secretKeyInput = document.getElementById("secret-key");
const packetCounter = document.getElementById("packet-counter");
const fileInput = document.getElementById("file-input");
const viewer = document.getElementById("image-viewer");
const fullImg = document.getElementById("full-image");
const qualitySelect = document.getElementById("image-quality");

// Preview modal elements
const previewModal = document.getElementById("preview-modal");
const previewImage = document.getElementById("preview-image");
const previewSize = document.getElementById("preview-size");
const previewPackets = document.getElementById("preview-packets");

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
    const chunkSize = 1800;
    const tId = Math.floor(Math.random() * 9000) + 1000;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    if (isImage) {
        addMessage(`📸 Sending image: ${packets.length} SMS packets`, "system");
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
    } catch (e) {
        console.error("Parse error:", e);
        addMessage("⚠️ Received malformed packet", "system");
    }
}

// ==========================================
// 6. IMAGE PROCESSING WITH PREVIEW
// ==========================================
// Preview Zoom/Pan variables
let previewZoom = 1;
let previewDragging = false;
let previewStartX, previewStartY, previewTranslateX = 0, previewTranslateY = 0;
let previewPinchDistance = null;
let previewInitialZoom = 1;

function updatePreviewTransform() {
    previewImage.style.transform = `translate(${previewTranslateX}px, ${previewTranslateY}px) scale(${previewZoom})`;
    const zoomPercent = Math.round(previewZoom * 100);
    const zoomIndicator = document.getElementById("preview-zoom-indicator");
    if (zoomIndicator) {
        zoomIndicator.textContent = `${zoomPercent}%`;
        zoomIndicator.style.opacity = "1";
        setTimeout(() => {
            if (zoomIndicator) zoomIndicator.style.opacity = "0";
        }, 1000);
    }
}

function resetPreviewZoom() {
    previewZoom = 1;
    previewTranslateX = 0;
    previewTranslateY = 0;
    updatePreviewTransform();
}

function previewZoomIn() {
    previewZoom = Math.min(previewZoom + 0.25, 4);
    updatePreviewTransform();
}

function previewZoomOut() {
    previewZoom = Math.max(previewZoom - 0.25, 0.5);
    if (previewZoom === 1) {
        previewTranslateX = 0;
        previewTranslateY = 0;
    }
    updatePreviewTransform();
}

function startPreviewDrag(e) {
    if (previewZoom <= 1) return;
    e.preventDefault();
    previewDragging = true;
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    previewStartX = clientX - previewTranslateX;
    previewStartY = clientY - previewTranslateY;
}

function doPreviewDrag(e) {
    if (!previewDragging) return;
    e.preventDefault();
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    previewTranslateX = clientX - previewStartX;
    previewTranslateY = clientY - previewStartY;
    updatePreviewTransform();
}

function endPreviewDrag() {
    previewDragging = false;
}

function handlePreviewTouchStart(e) {
    if (e.touches.length === 2) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        previewPinchDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );
        previewInitialZoom = previewZoom;
    } else if (e.touches.length === 1) {
        startPreviewDrag(e);
    }
}

function handlePreviewTouchMove(e) {
    if (e.touches.length === 2 && previewPinchDistance) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );
        const scale = currentDistance / previewPinchDistance;
        previewZoom = Math.min(Math.max(previewInitialZoom * scale, 0.5), 4);
        updatePreviewTransform();
    } else if (e.touches.length === 1) {
        doPreviewDrag(e);
    }
}

// Attach preview event listeners
previewImage?.addEventListener("mousedown", startPreviewDrag);
previewImage?.addEventListener("touchstart", handlePreviewTouchStart);
window.addEventListener("mousemove", doPreviewDrag);
window.addEventListener("touchmove", handlePreviewTouchMove, { passive: false });
window.addEventListener("mouseup", endPreviewDrag);
window.addEventListener("touchend", endPreviewDrag);

document.getElementById("preview-zoom-in")?.addEventListener("click", previewZoomIn);
document.getElementById("preview-zoom-out")?.addEventListener("click", previewZoomOut);
document.getElementById("preview-reset")?.addEventListener("click", resetPreviewZoom);

function closePreviewModal() {
    previewModal.style.display = "none";
    resetPreviewZoom();
    pendingImageData = null;
}

// Process image and show preview
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const quality = parseFloat(qualitySelect?.value || 0.9);
    const qualityLabel = qualitySelect?.options[qualitySelect.selectedIndex]?.text || "High Quality";
    
    addMessage(`🎨 Processing image for preview...`, "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // Optional resize only if extremely large
            let targetWidth = img.width;
            let targetHeight = img.height;
            
            if (img.width > 2000) {
                const scale = 2000 / img.width;
                targetWidth = 2000;
                targetHeight = img.height * scale;
            }
            
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Choose format
            let compressedDataUrl;
            let format = "image/jpeg";
            
            if (file.type === "image/png" || (img.width * img.height < 500000)) {
                format = "image/png";
                compressedDataUrl = canvas.toDataURL(format);
            } else {
                compressedDataUrl = canvas.toDataURL(format, quality);
            }
            
            const sizeKB = Math.round(compressedDataUrl.length / 1024);
            const originalSizeKB = Math.round(file.size / 1024);
            const cost = Math.ceil(compressedDataUrl.length / 1800);
            
            // Store for sending
            pendingImageData = compressedDataUrl;
            
            // Show preview modal
            previewImage.src = compressedDataUrl;
            previewSize.innerHTML = `📊 Size: ${sizeKB}KB (was ${originalSizeKB}KB)`;
            previewPackets.innerHTML = `📨 SMS Packets: ${cost}`;
            previewModal.style.display = "flex";
            resetPreviewZoom();
            
            addMessage(`👁️ Preview ready. Check image before sending.`, "system");
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// Confirm send from preview
document.getElementById("confirm-send-btn")?.addEventListener("click", () => {
    if (pendingImageData) {
        closePreviewModal();
        startSmsHandover(pendingImageData, true);
        fileInput.value = ""; // Clear so same file can be selected again
    }
});

// Cancel send from preview
document.getElementById("cancel-send-btn")?.addEventListener("click", () => {
    closePreviewModal();
    addMessage(`❌ Image sending cancelled`, "system");
    fileInput.value = "";
});

document.querySelector(".close-preview")?.addEventListener("click", closePreviewModal);

// ==========================================
// 6b. TEXT-ONLY MODE
// ==========================================
document.getElementById("text-note-btn")?.addEventListener("click", () => {
    const text = prompt("📝 Enter your notes or text to send:");
    if (text && text.trim()) {
        if (!activeFriend) {
            addMessage("⚠️ Please select a friend first!", "system");
            return;
        }
        if (!secretKeyInput.value) {
            addMessage("⚠️ Please enter a passcode first!", "system");
            return;
        }
        addMessage(`📝 Sending text note (${text.length} characters)...`, "system");
        startSmsHandover(text.trim(), false);
    }
});

// ==========================================
// 7. FULL ZOOM & PAN SYSTEM (For received images)
// ==========================================
let currentZoom = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;
let initialPinchDistance = null;
let initialZoom = 1;

function updateImageTransform() {
    fullImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`;
    const zoomPercent = Math.round(currentZoom * 100);
    const zoomIndicator = document.getElementById("zoom-indicator");
    if (zoomIndicator) {
        zoomIndicator.textContent = `${zoomPercent}%`;
        zoomIndicator.style.opacity = "1";
        setTimeout(() => {
            if (zoomIndicator) zoomIndicator.style.opacity = "0";
        }, 1000);
    }
}

function resetZoom() {
    currentZoom = 1;
    translateX = 0;
    translateY = 0;
    updateImageTransform();
}

function zoomIn() {
    currentZoom = Math.min(currentZoom + 0.25, 4);
    updateImageTransform();
}

function zoomOut() {
    currentZoom = Math.max(currentZoom - 0.25, 0.5);
    if (currentZoom === 1) {
        translateX = 0;
        translateY = 0;
    }
    updateImageTransform();
}

function startDrag(e) {
    if (currentZoom <= 1) return;
    e.preventDefault();
    isDragging = true;
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    startX = clientX - translateX;
    startY = clientY - translateY;
}

function doDrag(e) {
    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
    translateX = clientX - startX;
    translateY = clientY - startY;
    updateImageTransform();
}

function endDrag() {
    isDragging = false;
}

function handleTouchStart(e) {
    if (e.touches.length === 2) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        initialPinchDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );
        initialZoom = currentZoom;
    } else if (e.touches.length === 1) {
        startDrag(e);
    }
}

function handleTouchMove(e) {
    if (e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );
        const scale = currentDistance / initialPinchDistance;
        currentZoom = Math.min(Math.max(initialZoom * scale, 0.5), 4);
        updateImageTransform();
    } else if (e.touches.length === 1) {
        doDrag(e);
    }
}

function openImageViewer(imageSrc) {
    viewer.style.display = "flex";
    fullImg.src = imageSrc;
    resetZoom();
}

function closeViewer() {
    viewer.style.display = "none";
    resetZoom();
}

fullImg?.addEventListener("mousedown", startDrag);
fullImg?.addEventListener("touchstart", handleTouchStart);
window.addEventListener("mousemove", doDrag);
window.addEventListener("touchmove", handleTouchMove, { passive: false });
window.addEventListener("mouseup", endDrag);
window.addEventListener("touchend", endDrag);

document.getElementById("zoom-in-btn")?.addEventListener("click", zoomIn);
document.getElementById("zoom-out-btn")?.addEventListener("click", zoomOut);
document.getElementById("reset-view-btn")?.addEventListener("click", resetZoom);
document.querySelector(".close-viewer")?.addEventListener("click", closeViewer);

document.getElementById("download-btn")?.addEventListener("click", () => {
    if (fullImg.src) {
        const link = document.createElement("a");
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        link.download = `vlink-image-${timestamp}.jpg`;
        link.href = fullImg.src;
        link.click();
        addMessage("💾 Image saved to device", "system");
    }
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
        img.style.maxHeight = "300px";
        img.style.borderRadius = "12px";
        img.style.cursor = "pointer";
        img.style.objectFit = "contain";
        img.onclick = () => openImageViewer(content);
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
    addMessage("Chat cleared", "system");
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
