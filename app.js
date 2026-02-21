// ==========================================
// 1. DATABASE & GLOBALS
// ==========================================
let db;
let reassemblyBuffer = {};
let currentPackets = [];
let currentCopyIndex = 0;

async function initDB() {
    db = await idb.openDB('VLinkDB', 1, {
        upgrade(db) {
            db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
            console.log("IndexedDB: System Ready.");
        },
    });
}
initDB();

// UI Selectors
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('thumbnail-canvas');
const ctx = canvas.getContext('2d');
const chunkBtn = document.getElementById('chunk-btn');
const importInput = document.getElementById('import-input');
const chatThread = document.getElementById('chat-thread');
const secretKeyInput = document.getElementById('secret-key');
const packetCounter = document.getElementById('packet-counter');

// ==========================================
// 2. CRYPTOGRAPHY HELPERS
// ==========================================
async function getEncryptionKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("vlink-salt"), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function encryptData(text, password) {
    const key = await getEncryptionKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(base64Data, password) {
    const key = await getEncryptionKey(password);
    const combined = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
    return new TextDecoder().decode(decrypted);
}

// ==========================================
// 3. CHAT UI HELPERS
// ==========================================
function addMessage(content, type = 'sent', isImage = false) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    
    if (isImage) {
        const img = document.createElement('img');
        img.src = content;
        img.style.width = "100%";
        img.style.borderRadius = "10px";
        div.appendChild(img);
    } else {
        div.innerText = content;
    }
    
    chatThread.appendChild(div);
    chatThread.scrollTop = chatThread.scrollHeight;
}

// ==========================================
// 4. SENDER LOGIC (Auto-Handover)
// ==========================================
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            canvas.width = 100;
            canvas.height = 100;
            ctx.drawImage(img, 0, 0, 100, 100);
            addMessage("Image selected. Ready to send.", "system");
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

async function startPacketHandover(packets) {
    currentPackets = packets;
    currentCopyIndex = 0;
    
    // Auto-copy the first packet
    await navigator.clipboard.writeText(currentPackets[0]);
    
    packetCounter.classList.remove('hidden');
    updateCounterDisplay();
}

function updateCounterDisplay() {
    packetCounter.innerText = `Copy Packet ${currentCopyIndex + 1}/${currentPackets.length}`;
    packetCounter.style.background = "#075e54";
    packetCounter.style.color = "white";
    packetCounter.style.padding = "5px 12px";
    packetCounter.style.borderRadius = "20px";
    packetCounter.style.fontSize = "12px";
    packetCounter.style.cursor = "pointer";

    packetCounter.onclick = async () => {
        currentCopyIndex++;
        if (currentCopyIndex < currentPackets.length) {
            await navigator.clipboard.writeText(currentPackets[currentCopyIndex]);
            updateCounterDisplay();
        } else {
            packetCounter.innerText = "All Sent ✓";
            setTimeout(() => packetCounter.classList.add('hidden'), 3000);
        }
    };
}

chunkBtn.addEventListener('click', async () => {
    const password = secretKeyInput.value;
    if (!password) return alert("Set a passcode first!");
    if (!canvas.width) return alert("Select an image!");

    try {
        let encrypted = await encryptData(canvas.toDataURL('image/jpeg', 0.3), password);
        const chunkSize = 120;
        const transmissionId = Math.floor(Math.random() * 900) + 100;
        const chunks = [];

        for (let i = 0; i < encrypted.length; i += chunkSize) {
            chunks.push(encrypted.substring(i, i + chunkSize));
        }

        const finalizedPackets = chunks.map((data, index) => {
            const seq = (index + 1).toString().padStart(2, '0');
            const tot = chunks.length.toString().padStart(2, '0');
            return `VLINK|ID:${transmissionId}|SEQ:${seq}|TOT:${tot}|DATA:${data}`;
        });

        addMessage(canvas.toDataURL('image/jpeg', 0.3), 'sent', true);
        startPacketHandover(finalizedPackets);
    } catch (e) {
        alert("Error creating packets.");
    }
});

// ==========================================
// 5. RECEIVER LOGIC (Auto-Detect)
// ==========================================
async function processIncomingPacket(rawData) {
    const password = secretKeyInput.value;
    if (!password) return addMessage("Error: Set passcode to receive.", "system");

    const parts = rawData.split('|');
    const tId = parts[1].split(':')[1];
    const seq = parseInt(parts[2].split(':')[1]);
    const tot = parseInt(parts[3].split(':')[1]);
    const data = parts[4].replace('DATA:', '');

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
    
    if (reassemblyBuffer[tId][seq - 1] === null) {
        reassemblyBuffer[tId][seq - 1] = data;
        const received = reassemblyBuffer[tId].filter(x => x !== null).length;
        
        addMessage(`Packet ${received}/${tot} received for ID ${tId}`, "system");

        if (received === tot) {
            try {
                const fullEncrypted = reassemblyBuffer[tId].join('');
                const decrypted = await decryptData(fullEncrypted, password);
                addMessage(decrypted, "received", true);
                delete reassemblyBuffer[tId];
            } catch (e) {
                addMessage("Decryption failed. Check passcode.", "system");
            }
        }
    }
    importInput.value = ""; 
}
// Add this inside the (receivedCount === tot) block in app.js
if ("vibrate" in navigator) {
    navigator.vibrate([100, 50, 100]); // Short double-buzz for success
}

importInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.startsWith('VLINK|')) processIncomingPacket(val);
});

// ==========================================
// 6. QR & UTILS
// ==========================================
const qrContainer = document.getElementById("qrcode");
const qrBtn = document.getElementById("show-qr-btn");
let qrGenerated = false;

if(qrBtn) {
    qrBtn.addEventListener('click', () => {
        if (qrContainer.style.display === "none") {
            if (!qrGenerated) {
                new QRCode(qrContainer, { text: window.location.href, width: 128, height: 128 });
                qrGenerated = true;
            }
            qrContainer.style.display = "block";
            qrBtn.innerText = "Hide QR";
        } else {
            qrContainer.style.display = "none";
            qrBtn.innerText = "Share App";
        }
    });
}

document.getElementById('reset-receiver')?.addEventListener('click', () => {
    reassemblyBuffer = {};
    chatThread.innerHTML = '<div class="message system">Chat cleared.</div>';
    addMessage("System memory reset.", "system");
});

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(() => console.log("Offline Ready"));
    });
}
