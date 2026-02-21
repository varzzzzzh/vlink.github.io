// ==========================================
// 1. DATABASE & STATE
// ==========================================
let db;
let reassemblyBuffer = {};
let activeFriend = null;
let friends = JSON.parse(localStorage.getItem('vlink_friends')) || [];

async function initDB() {
    db = await idb.openDB('VLinkDB', 1, {
        upgrade(db) { db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }); },
    });
    renderFriends();
}
initDB();

// UI Selectors
const chatThread = document.getElementById('chat-thread');
const importInput = document.getElementById('import-input');
const secretKeyInput = document.getElementById('secret-key');
const packetCounter = document.getElementById('packet-counter');

// ==========================================
// 2. DISCORD SIDEBAR LOGIC
// ==========================================
function renderFriends() {
    const list = document.getElementById('friends-list');
    list.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `server-icon ${activeFriend?.id === f.id ? 'active' : ''}`;
        div.style = "width: 48px; height: 48px; background: #4f545c; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; cursor: pointer; margin-bottom: 8px;";
        div.innerText = f.name[0].toUpperCase();
        div.onclick = () => {
            activeFriend = f;
            document.getElementById('chat-target').innerText = `@${f.name}`;
            addMessage(`Secure line open with ${f.name} (${f.phone})`, "system");
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
// 3. CRYPTO & SENDER
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

async function startSmsHandover(data, isImage = false) {
    const password = secretKeyInput.value;
    if (!password || !activeFriend) return alert("Select friend and set passcode!");

    let encrypted = await encryptData(data, password);
    const chunkSize = 120;
    const tId = Math.floor(Math.random() * 900) + 100;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    addMessage(data, 'sent', isImage);
    
    let currentIdx = 0;
    packetCounter.classList.remove('hidden');
    const updateBadge = () => {
        packetCounter.innerText = `Click to Send Part ${currentIdx + 1}/${packets.length}`;
        packetCounter.onclick = () => {
            // THE LONG DISTANCE MAGIC:
            window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[currentIdx])}`;
            currentIdx++;
            if (currentIdx < packets.length) updateBadge();
            else {
                packetCounter.innerText = "All Sent ✓";
                setTimeout(() => packetCounter.classList.add('hidden'), 3000);
            }
        };
    };
    updateBadge();
}

// ==========================================
// 4. RECEIVER & UI
// ==========================================
function addMessage(content, type = 'sent', isImage = false) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    if (isImage) {
        const img = document.createElement('img'); img.src = content;
        img.style = "max-width: 100%; border-radius: 8px;";
        div.appendChild(img);
    } else { div.innerText = content; }
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

async function decryptData(base64Data, password) {
    const key = await getEncryptionKey(password);
    const combined = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
    return new TextDecoder().decode(decrypted);
}

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
            const fullData = reassemblyBuffer[tId].join('');
            const decrypted = await decryptData(fullData, password);
            addMessage(decrypted, 'received', decrypted.startsWith('data:image'));
            if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
            delete reassemblyBuffer[tId];
        } catch (e) { addMessage("Decryption failed!", "system"); }
    }
    importInput.value = "";
}

// Listeners
document.getElementById('chunk-btn').onclick = () => {
    const text = importInput.value.trim();
    if (text) { startSmsHandover(text); importInput.value = ""; }
};

document.getElementById('file-input').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => startSmsHandover(ev.target.result, true);
    reader.readAsDataURL(e.target.files[0]);
};

importInput.addEventListener('input', (e) => processIncoming(e.target.value.trim()));

// Share QR
document.getElementById('show-qr-btn').onclick = () => {
    const qr = document.getElementById('qrcode');
    qr.style.display = qr.style.display === 'none' ? 'block' : 'none';
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

document.getElementById('reset-receiver').onclick = () => {
    chatThread.innerHTML = '<div class="message system">History cleared.</div>';
};