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

// Cryptography
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

// Sending Logic
async function startSmsHandover(data, isImage = false) {
    const password = document.getElementById('secret-key').value;
    if (!password || !activeFriend) return alert("Select a friend and set passcode!");

    let encrypted = await encryptData(data, password);
    const chunkSize = 120;
    const tId = Math.floor(Math.random() * 900) + 100;
    const packets = [];

    for (let i = 0; i < encrypted.length; i += chunkSize) {
        packets.push(`VLINK|ID:${tId}|SEQ:${Math.floor(i/chunkSize)+1}|TOT:${Math.ceil(encrypted.length/chunkSize)}|DATA:${encrypted.substring(i, i+chunkSize)}`);
    }

    addMessage(data, 'sent', isImage);
    
    let idx = 0;
    const counter = document.getElementById('packet-counter');
    counter.classList.remove('hidden');
    
    const updateBadge = () => {
        counter.innerText = `Send Part ${idx + 1}/${packets.length} to ${activeFriend.name}`;
        counter.onclick = () => {
            window.location.href = `sms:${activeFriend.phone}?body=${encodeURIComponent(packets[idx])}`;
            idx++;
            if (idx < packets.length) updateBadge();
            else {
                counter.innerText = "All Sent ✓";
                setTimeout(() => counter.classList.add('hidden'), 3000);
            }
        };
    };
    updateBadge();
}

// UI Helpers
function addMessage(content, type = 'sent', isImage = false) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    if (isImage) {
        const img = document.createElement('img'); img.src = content;
        img.style.maxWidth = "100%"; img.style.borderRadius = "8px";
        div.appendChild(img);
    } else { div.innerText = content; }
    const thread = document.getElementById('chat-thread');
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
}

async function processIncoming(rawData) {
    const password = document.getElementById('secret-key').value;
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
    document.getElementById('import-input').value = "";
}

// Listeners
document.getElementById('chunk-btn').onclick = () => {
    const input = document.getElementById('import-input');
    if (input.value.trim()) { startSmsHandover(input.value.trim()); input.value = ""; }
};

document.getElementById('file-input').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => startSmsHandover(ev.target.result, true);
    reader.readAsDataURL(e.target.files[0]);
};

document.getElementById('import-input').addEventListener('input', (e) => {
    if (e.target.value.startsWith('VLINK|')) processIncoming(e.target.value.trim());
});

document.getElementById('show-qr-btn').onclick = () => {
    const qr = document.getElementById('qrcode');
    qr.style.display = qr.style.display === 'none' ? 'block' : 'none';
    if (qr.innerHTML === "") new QRCode(qr, { text: window.location.href, width: 128, height: 128 });
};

document.getElementById('reset-receiver').onclick = () => {
    document.getElementById('chat-thread').innerHTML = '<div class="message system">History cleared.</div>';
};



const fileInput = document.getElementById('file-input');

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Optional: Alert the user that processing has started
    addMessage("Processing image...", "system");

    const reader = new FileReader();
    reader.onload = (ev) => {
        // Start the SMS handover with the image data
        startSmsHandover(ev.target.result, true);
    };
    reader.readAsDataURL(file);
};