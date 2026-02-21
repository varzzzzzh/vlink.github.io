// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem('vlink_friends')) || [];

async function initDB() {
    // Basic initialization for future persistent storage
    if (typeof idb !== 'undefined') {
        db = await idb.openDB('VLinkDB', 1, {
            upgrade(db) { 
                if (!db.objectStoreNames.contains('messages')) {
                    db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }); 
                }
            },
        });
    }
    renderFriends();
    updateStatus();
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
        // If active, add the 'active' class
        const isActive = activeFriend?.id === f.id;
        div.className = `server-icon ${isActive ? 'active' : ''}`;
        div.innerText = f.name[0].toUpperCase();
        
        // Add a small online/offline status dot inside the icon
        const dot = document.createElement('span');
        dot.className = `status-dot ${navigator.onLine ? 'online' : ''}`;
        div.appendChild(dot);

        div.onclick = () => {
            activeFriend = f;
            document.getElementById('chat-target').innerText = `@${f.name}`;
            renderFriends();
            addMessage(`Secure session started with ${f.name}`, "system");
        };
        list.appendChild(div);
    });
}

document.getElementById('add-friend-btn').onclick = () => {
    const name = prompt("Friend Name:");
    const phone = prompt("Phone Number (with country code, e.g., +91...):");
    if (name && phone) {
        friends.push({ id: Date.now(), name, phone });
        localStorage.setItem('vlink_friends', JSON.stringify(friends));
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
    if (!password) return alert("Please enter a Passcode for encryption!");
    if (!activeFriend) return alert("Select a friend from the sidebar first!");

    let encrypted = await encryptData(data, password);
    
    // ChunkSize 2000 for standard mobile carrier limits
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
        packetCounter.innerText = `Part ${idx + 1}/${packets.length} - Tap to Send`;
        packetCounter.onclick = () => {
            window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
            idx++;
            if (idx < packets.length) updateBadge();
            else {
                packetCounter.innerText = "Transmission Ready ✓";
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
        img.onclick = () => openViewer(content);
        div.appendChild(img);
    } else { 
        div.innerText = content; 
    }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

let currentZoom = 1;
const viewer = document.getElementById('image-viewer');
const fullImg = document.getElementById('full-image');

function openViewer(src) {
    if(!viewer) return;
    viewer.style.display = "flex";
    fullImg.src = src;
    resetZoom();
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
// 6. RECEIVING LOGIC (Reassembly)
// ==========================================

async function processIncoming(rawData) {
    const password = secretKeyInput.value;
    if (!rawData.startsWith('VLINK|')) return;
    if (!password) {
        addMessage("Incoming packet detected. Enter passcode to decrypt.", "system");
        return;
    }

    const parts = rawData.split('|');
    const tId = parts[1].split(':')[1];
    const seq = parseInt(parts[2].split(':')[1]);
    const tot = parseInt(parts[3].split(':')[1]);
    const data = parts[4].replace('DATA:', '');

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
    reassemblyBuffer[tId][seq - 1] = data;

    const receivedCount = reassemblyBuffer[tId].filter(x => x !== null).length;
    addMessage(`Receiving part ${receivedCount}/${tot}...`, 'system');

    if (receivedCount === tot) {
        try {
            const decrypted = await decryptData(reassemblyBuffer[tId].join(''), password);
            addMessage(decrypted, 'received', decrypted.startsWith('data:image'));
            if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
            delete reassemblyBuffer[tId];
        } catch (e) { 
            addMessage("Decryption failed. Check passcode.", "system"); 
        }
    }
    importInput.value = "";
}

// ==========================================
// 7. EVENT LISTENERS & MANAGEMENT
// ==========================================

// Send Text
document.getElementById('chunk-btn').onclick = () => {
    if (importInput.value.trim()) { 
        startSmsHandover(importInput.value.trim()); 
        importInput.value = ""; 
    }
};

// Process File (Image Processing for Notes)
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    addMessage("Processing notes for high-contrast...", "system");

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext('2d');
            ctx.filter = 'grayscale(1) contrast(1.2)'; // Enhances text visibility
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.2); 
            startSmsHandover(compressedDataUrl, true);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// Paste/Receive Handler
importInput.addEventListener('input', (e) => {
    if (e.target.value.startsWith('VLINK|')) processIncoming(e.target.value.trim());
});

// QR Logic
document.getElementById('show-qr-btn').onclick = () => {
    const qr = document.getElementById('qrcode');
    qr.style.display = qr.style.display === 'none' ? 'block' : 'none';
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

// MANAGEMENT: Delete User
document.getElementById('delete-friend-btn').onclick = () => {
    if (!activeFriend) return alert("Select a user to delete first.");
    if (confirm(`Delete ${activeFriend.name} and all data?`)) {
        friends = friends.filter(f => f.id !== activeFriend.id);
        localStorage.setItem('vlink_friends', JSON.stringify(friends));
        activeFriend = null;
        document.getElementById('chat-target').innerText = "Select a Friend";
        chatThread.innerHTML = '<div class="message system">User removed.</div>';
        renderFriends();
    }
};

// MANAGEMENT: Clear Current Chat View
document.getElementById('clear-chat-btn').onclick = () => {
    if (confirm("Clear chat thread? This won't delete saved settings.")) {
        chatThread.innerHTML = '<div class="message system">View cleared.</div>';
    }
};

// MANAGEMENT: Total Reset (Wipe All)
document.getElementById('reset-receiver').onclick = () => {
    if (confirm("DANGER: Wipe all friends and settings? This cannot be undone.")) {
        localStorage.clear();
        indexedDB.deleteDatabase("VLinkDB"); 
        location.reload();
    }
};

// Utility: Download View
const dlBtn = document.getElementById('download-btn');
if(dlBtn) {
    dlBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = fullImg.src;
        link.download = `VLink_Doc_${Date.now()}.jpg`;
        link.click();
    };
}

// Connection Status Handling
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

function updateStatus() {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    if (navigator.onLine) {
        statusEl.innerHTML = "● Online (P2P Ready)";
        statusEl.style.color = "#23a559";
    } else {
        statusEl.innerHTML = "● Offline (SMS Protocol Only)";
        statusEl.style.color = "#f23f43";
    }
    renderFriends(); // Re-render to update status dots
}