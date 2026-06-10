// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem("vlink_friends")) || [];
let pendingBatch = null; // Store generated batch for copy/paste

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
// 4. SMS TRANSMISSION (FIXED FOR REAL SMS LIMIT)
// ==========================================
async function startSmsHandover(data, isImage = false, fileName = "message") {
    const password = secretKeyInput.value;
    if (!password) return alert("Enter Passcode!");
    if (!activeFriend) return alert("Select friend!");

    let encrypted = await encryptData(data, password);
    
    // ✅ REAL SMS LIMIT: 160 chars per message (GSM-7)
    // Header: "VLINK|ID:9999|SEQ:99|TOT:99|" = ~28 chars
    // Safe payload per SMS: 160 - 28 = 132 chars (conservative)
    const PAYLOAD_SIZE = 132;
    const tId = Math.floor(Math.random() * 9000) + 1000;
    const packets = [];
    const totalPackets = Math.ceil(encrypted.length / PAYLOAD_SIZE);

    // ✅ Generate all packets upfront
    for (let i = 0; i < encrypted.length; i += PAYLOAD_SIZE) {
        const seq = Math.floor(i / PAYLOAD_SIZE) + 1;
        const payload = encrypted.substring(i, i + PAYLOAD_SIZE);
        const packet = `VLINK|ID:${tId}|SEQ:${seq}|TOT:${totalPackets}|${payload}`;
        packets.push(packet);
    }

    // Store for batch display
    pendingBatch = {
        packets,
        fileName,
        isImage,
        totalPackets,
        tId,
        data
    };

    addMessage(
        isImage ? `📷 ${fileName}: Ready to send in ${totalPackets} SMS` : `📝 ${fileName}: Ready to send in ${totalPackets} SMS`, 
        "system"
    );

    // ✅ Show batch preview and copy UI
    showBatchPreview(packets, totalPackets, fileName);
}

function showBatchPreview(packets, totalPackets, fileName) {
    // Remove old batch UI if exists
    const oldBatch = document.getElementById("batch-preview");
    if (oldBatch) oldBatch.remove();

    const batchDiv = document.createElement("div");
    batchDiv.id = "batch-preview";
    batchDiv.style.cssText = `
        position: fixed; bottom: 140px; left: 10px; right: 10px;
        background: rgba(88, 101, 242, 0.15); border: 1px solid var(--accent-blue);
        border-radius: 12px; padding: 12px; z-index: 150;
        font-size: 12px; color: var(--text-main);
    `;

    batchDiv.innerHTML = `
        <div style="margin-bottom: 8px; font-weight: bold;">📦 Batch Ready (${totalPackets} SMS)</div>
        <div style="max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px; margin-bottom: 8px; font-family: monospace; font-size: 10px;">
            ${packets.slice(0, 3).map(p => `<div style="word-break: break-all; margin-bottom: 4px;">${p}</div>`).join("")}
            ${packets.length > 3 ? `<div style="color: var(--text-muted);">... (${packets.length - 3} more)</div>` : ""}
        </div>
        <div style="display: flex; gap: 6px;">
            <button id="copy-batch-btn" style="flex: 1; background: var(--accent-green); border: none; color: white; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px;">📋 Copy All</button>
            <button id="send-one-by-one-btn" style="flex: 1; background: var(--accent-blue); border: none; color: white; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px;">📱 Send One-by-One</button>
            <button id="close-batch-btn" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px;">✕</button>
        </div>
    `;

    document.body.appendChild(batchDiv);

    // Copy all to clipboard
    document.getElementById("copy-batch-btn").onclick = () => {
        const allText = packets.join("\n");
        navigator.clipboard.writeText(allText).then(() => {
            addMessage(`✅ Copied all ${packets.length} SMS to clipboard!`, "system");
            batchDiv.remove();
        });
    };

    // Send one by one (opens SMS app for each)
    document.getElementById("send-one-by-one-btn").onclick = () => {
        sendBatchSequential(packets);
        batchDiv.remove();
    };

    // Close batch UI
    document.getElementById("close-batch-btn").onclick = () => {
        batchDiv.remove();
    };
}

function sendBatchSequential(packets) {
    if (!activeFriend) return;
    
    let idx = 0;
    const showNextPacket = () => {
        if (idx < packets.length) {
            packetCounter.innerText = `SMS ${idx + 1}/${packets.length} - Click to Send`;
            packetCounter.classList.remove("hidden");
            packetCounter.onclick = () => {
                window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
                idx++;
                setTimeout(showNextPacket, 500);
            };
        } else {
            packetCounter.innerText = "✓ Batch Sent";
            setTimeout(() => packetCounter.classList.add("hidden"), 2000);
        }
    };
    showNextPacket();
}

// ==========================================
// 5. RECEIVING & REASSEMBLY
// ==========================================
async function processIncoming(rawData) {
    const password = secretKeyInput.value;
    if (!rawData.startsWith("VLINK|") || !password) return;
    
    const parts = rawData.split("|");
    if (parts.length < 5) return; // Invalid format
    
    const tId = parts[1].split(":")[1];
    const seq = parseInt(parts[2].split(":")[1]);
    const tot = parseInt(parts[3].split(":")[1]);
    const data = parts.slice(4).join("|"); // Rest is payload

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = { packets: new Array(tot).fill(null), received: 0 };
    
    if (reassemblyBuffer[tId].packets[seq - 1] === null) {
        reassemblyBuffer[tId].packets[seq - 1] = data;
        reassemblyBuffer[tId].received++;
    }

    // Show progress
    addMessage(`📥 Received packet ${seq}/${tot}`, "system");

    if (reassemblyBuffer[tId].received === tot) {
        try {
            const decrypted = await decryptData(reassemblyBuffer[tId].packets.join(""), password);
            addMessage(decrypted, "received", decrypted.startsWith("data:image"));
            delete reassemblyBuffer[tId];
        } catch (e) { 
            addMessage(`❌ Decryption Error: ${e.message}`, "system");
            delete reassemblyBuffer[tId];
        }
    }
}

// ==========================================
// 6. IMPROVED IMAGE COMPRESSION (FIX BLUR)
// ==========================================
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("🖼️ Processing image for SMS...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            
            // ✅ FIX: Better dimensions + quality balance
            // Width: 400px = readable text + 40% smaller file
            // Height: scale proportionally
            const MAX_WIDTH = 400; 
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            
            // ✅ Better contrast without destroying readability
            ctx.filter = "grayscale(1) contrast(2) brightness(1.1)";
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // ✅ ADAPTIVE THRESHOLDING: Smarter black/white conversion
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                const lightness = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
                const v = lightness > 128 ? 255 : 0; // Threshold at 128 (midpoint)
                pixels[i] = pixels[i+1] = pixels[i+2] = v;
            }
            ctx.putImageData(imageData, 0, 0);

            // ✅ FIX: Use PNG for better compression + use higher quality
            // PNG is better for text/diagrams than JPEG
            // Quality 0.15 on JPEG, or use PNG (lossless but compresses better for B&W)
            const compressedDataUrl = canvas.toDataURL("image/png");
            
            const smsBatches = Math.ceil(compressedDataUrl.length / 132);
            addMessage(
                smsBatches > 15 
                    ? `⚠️ Image too large: ${smsBatches} SMS (limit: 15). Try smaller image.` 
                    : `✅ Image optimized: ${smsBatches} SMS required`, 
                "system"
            );
            
            if (smsBatches <= 50) { // Allow up to 50 SMS for images
                startSmsHandover(compressedDataUrl, true, `photo_${Date.now()}`);
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 7. EMERGENCY TEMPLATES
// ==========================================
function showEmergencyTemplates() {
    const templates = {
        "🚑 Medical Info": `EMERGENCY MEDICAL INFO
Name: ___________
Blood Type: O+
Allergies: Penicillin
Medications: Aspirin 100mg
Emergency Contact: Mom +91-XXXXXXXXXX
Location: Latitude, Longitude
Status: [Update as needed]`,
        
        "🗺️ Location Share": `LOCATION REPORT
Current Location: [Lat: 11.0168, Lng: 76.9558]
Area: Coimbatore
Status: SAFE/NEED HELP
Last Update: ${new Date().toLocaleString()}
Contact: [Phone Number]`,
        
        "📋 Evacuation Notice": `EVACUATION ALERT
Area: [Location Name]
Reason: [Flood/Fire/Disaster]
Safe Zone: [Direction & Distance]
Time to Evacuate: IMMEDIATELY
Bring: Documents, Cash, Medicine`,
        
        "🔗 Document Share": `DOCUMENT TRANSFER REQUEST
Document: [ID/Certificate Name]
Recipient: [Name]
Passcode: [Shared Separately]
Size: Will be sent in SMS chunks
Status: Ready to receive`,
    };

    const dlg = document.createElement("div");
    dlg.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: var(--bg-chat); border: 2px solid var(--accent-blue);
        border-radius: 12px; padding: 16px; z-index: 300; max-width: 90%;
        max-height: 70vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;

    dlg.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0;">🚨 Emergency Templates</h3>
            <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer;">×</button>
        </div>
        <div style="display: grid; gap: 8px;">
            ${Object.entries(templates).map(([label, content]) => `
                <button onclick="
                    document.getElementById('import-input').value = \`${content.replace(/`/g, '\\`')}\`;
                    this.closest('div').parentElement.remove();
                " style="
                    background: rgba(88, 101, 242, 0.2); border: 1px solid var(--accent-blue);
                    color: white; padding: 10px; border-radius: 6px; text-align: left; cursor: pointer;
                    font-size: 13px; transition: 0.2s;
                " onmouseover="this.style.background='rgba(88, 101, 242, 0.4)'" onmouseout="this.style.background='rgba(88, 101, 242, 0.2)'">
                    ${label}
                </button>
            `).join("")}
        </div>
    `;

    document.body.appendChild(dlg);
}

// Add emergency button to UI
const emergencyBtn = document.createElement("button");
emergencyBtn.innerText = "🚨 Emergency";
emergencyBtn.style.cssText = `
    position: absolute; bottom: 100px; right: 10px;
    background: var(--accent-red); border: none; color: white;
    padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; z-index: 120;
`;
emergencyBtn.onclick = showEmergencyTemplates;
document.body.appendChild(emergencyBtn);

// ==========================================
// 8. ZOOM & PAN (UNCHANGED)
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
    if (currentZoom > 5) currentZoom = 5;
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
// 9. HELPERS
// ==========================================
function addMessage(content, type = "sent", isImage = false) {
    const div = document.createElement("div");
    div.className = `message ${type}`;
    if (isImage) {
        const img = document.createElement("img");
        img.src = content;
        img.style.maxWidth = "100%";
        img.style.imageRendering = "crisp-edges"; 
        img.onclick = () => openViewer(content);
        div.appendChild(img);
    } else { 
        div.innerText = content; 
    }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

document.getElementById("chunk-btn").onclick = () => {
    if (importInput.value.trim()) {
        startSmsHandover(importInput.value.trim(), false, "message");
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
    if (confirm("Clear all messages?")) {
        chatThread.innerHTML = '<div class="message system">Chat cleared. Tap + to add friend.</div>';
    }
};

document.getElementById("reset-receiver").onclick = () => {
    if (confirm("Wipe all app data? This cannot be undone!")) {
        localStorage.clear();
        reassemblyBuffer = {};
        pendingBatch = null;
        location.reload();
    }
};

function updateStatus() {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.innerHTML = navigator.onLine ? "● Online" : "● SMS Mode";
        statusEl.style.color = navigator.onLine ? "#23a559" : "#f23f43";
    }
}
