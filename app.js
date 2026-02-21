// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem('vlink_friends')) || [];

async function initDB() {
    if (typeof idb !== 'undefined') {
        db = await idb.openDB('VLinkDB', 1, {
            upgrade(db) { db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }); },
        });
    }
    renderFriends();
}
initDB();

// UI Selectors
const chatThread = document.getElementById('chat-thread');
const importInput = document.getElementById('import-input');
const secretKeyInput = document.getElementById('secret-key');
const packetCounter = document.getElementById('packet-counter');
const fileInput = document.getElementById('file-input');

// ==========================================
// 2. DISCORD SIDEBAR LOGIC
// ==========================================
function renderFriends() {
    const list = document.getElementById('friends-list');
    if (!list) return;
    list.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `server-icon ${activeFriend?.id === f.id ? 'active' : ''}`;
        div.innerText = f.name[0].toUpperCase();
        div.onclick = () => {
            activeFriend = f;
            document.getElementById('chat-target').innerText = `@${f.name}`;
            renderFriends();
            addMessage(`Switched to ${f.name}`, "system");
        };
        list.appendChild(div);
    });
}

document.getElementById('add-friend-btn').onclick = () => {
    const name = prompt("Friend Name:");
    const phone = prompt("Phone Number (+91...):");
    if (name && phone) {
        friends.push({ id: Date.now(), name, phone });
        localStorage.setItem('vlink_friends', JSON.stringify(friends));
        renderFriends();
    }
};

// ==========================================
// 3. CRYPTOGRAPHY
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
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(text));
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv); combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(base64Data, password) {
    const key = await getEncryptionKey(password);
    const combined = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
    return new TextDecoder().decode(decrypted);
}

// ==========================================
// 4. SENDING LOGIC (SMS Handover)
// ==========================================
async function startSmsHandover(data, isImage = false) {
    const password = secretKeyInput.value;
    if (!password || !activeFriend) return alert("Select a friend and set passcode!");

    let encrypted = await encryptData(data, password);
    
    // ChunkSize 2000 works best for long-distance Indian carriers
    const chunkSize = 2000; 
    const tId = Math.floor(Math.random() * 900) + 100;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    addMessage(data, 'sent', isImage);
    
    let idx = 0;
    packetCounter.classList.remove('hidden');
    
    const updateBadge = () => {
        packetCounter.innerText = `Send Part ${idx + 1}/${packets.length} to ${activeFriend.name}`;
        packetCounter.onclick = () => {
            window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
            idx++;
            if (idx < packets.length) updateBadge();
            else {
                packetCounter.innerText = "All Sent ✓";
                setTimeout(() => packetCounter.classList.add('hidden'), 3000);
            }
        };
    };
    updateBadge();
}

// ==========================================
// 5. UI HELPERS & IMAGE VIEWER
// ==========================================
function addMessage(content, type = 'sent', isImage = false) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    if (isImage) {
        const img = document.createElement('img'); 
        img.src = content;
        img.style.maxWidth = "100%"; 
        img.style.borderRadius = "8px";
        img.style.cursor = "zoom-in";
        img.onclick = () => openViewer(content); // Open full view on click
        div.appendChild(img);
    } else { 
        div.innerText = content; 
    }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

// ZOOM & VIEWER LOGIC
let currentZoom = 1;
const viewer = document.getElementById('image-viewer');
const fullImg = document.getElementById('full-image');

function openViewer(src) {
    if(!viewer) return;
    viewer.style.display = "flex";
    fullImg.src = src;
    currentZoom = 1;
    fullImg.style.transform = `scale(1)`;
}

window.adjustZoom = (delta) => {
    currentZoom += delta;
    if (currentZoom < 0.5) currentZoom = 0.5;
    fullImg.style.transform = `scale(${currentZoom})`;
};

window.resetZoom = () => {
    currentZoom = 1;
    fullImg.style.transform = `scale(1)`;
};

if(document.querySelector('.close-viewer')) {
    document.querySelector('.close-viewer').onclick = () => viewer.style.display = "none";
}

// ==========================================
// 6. RECEIVING LOGIC
// ==========================================
async function processIncoming(rawData) {
    const password = secretKeyInput.value;
    if (!rawData.startsWith('VLINK|')) return;

    const parts = rawData.split('|');
    const tId = parts[1].split(':')[1];
    const seq = parseInt(parts[2].split(':')[1]);
    const tot = parseInt(parts[3].split(':')[1]);
    const data = parts[4].replace('DATA:', '');

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
    reassemblyBuffer[tId][seq - 1] = data;

    const received = reassemblyBuffer[tId].filter(x => x !== null).length;
    addMessage(`Packet ${received}/${tot} received...`, 'system');

    if (received === tot) {
        try {
            const decrypted = await decryptData(reassemblyBuffer[tId].join(''), password);
            addMessage(decrypted, 'received', decrypted.startsWith('data:image'));
            if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
            delete reassemblyBuffer[tId];
        } catch (e) { addMessage("Decryption failed!", "system"); }
    }
    importInput.value = "";
}

// ==========================================
// 7. EVENT LISTENERS
// ==========================================
document.getElementById('chunk-btn').onclick = () => {
    if (importInput.value.trim()) { 
        startSmsHandover(importInput.value.trim()); 
        importInput.value = ""; 
    }
};

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("Enhancing text for study notes...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; // Optimal for notes
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext('2d');
            
            // Grayscale + Contrast filter makes text pop
            ctx.filter = 'grayscale(1) contrast(1.2)';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.2); 
            startSmsHandover(compressedDataUrl, true);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

importInput.addEventListener('input', (e) => {
    if (e.target.value.startsWith('VLINK|')) processIncoming(e.target.value.trim());
});

document.getElementById('show-qr-btn').onclick = () => {
    const qr = document.getElementById('qrcode');
    qr.style.display = qr.style.display === 'none' ? 'block' : 'none';
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

document.getElementById('reset-receiver').onclick = () => {
    chatThread.innerHTML = '<div class="message system">History cleared.</div>';
};

// Download Button Logic
const dlBtn = document.getElementById('download-btn');
if(dlBtn) {
    dlBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = fullImg.src;
        link.download = `VLink_Note_${Date.now()}.jpg`;
        link.click();
    };
}

// Add this inside renderFriends()
const statusDot = f.id === activeFriend?.id ? '<span class="status-dot online"></span>' : '';

// Update the Status bar based on connection
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

function updateStatus() {
    const statusEl = document.getElementById('status');
    if (navigator.onLine) {
        statusEl.innerHTML = "● Online Mode (Cloud Sync Enabled)";
        statusEl.style.color = "#23a559";
    } else {
        statusEl.innerHTML = "● Offline Mode (SMS Protocol Active)";
        statusEl.style.color = "#f23f43";
    }
}