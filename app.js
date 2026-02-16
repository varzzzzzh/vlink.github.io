// ==========================================
// 1. DATABASE INITIALIZATION
// ==========================================
let db;

async function initDB() {
    db = await idb.openDB('VLinkDB', 1, {
        upgrade(db) {
            db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
            db.createObjectStore('settings');
            console.log("IndexedDB: Stores created.");
        },
    });
    console.log("IndexedDB: System Ready.");
}

initDB();

// ==========================================
// 2. UI ELEMENTS & GLOBALS
// ==========================================
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('thumbnail-canvas');
const ctx = canvas.getContext('2d');
const sizeReport = document.getElementById('size-report');
const chunkBtn = document.getElementById('chunk-btn');
const packetList = document.getElementById('packet-list');

const importInput = document.getElementById('import-input');
const importBtn = document.getElementById('import-btn');
const assemblyProgress = document.getElementById('assembly-progress');
const reconstructedContainer = document.getElementById('reconstructed-image-container');

let reassemblyBuffer = {};

// ==========================================
// 3. CRYPTOGRAPHY HELPERS
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
    try {
        const key = await getEncryptionKey(password);
        const combined = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        throw new Error("Decryption failed. Wrong password?");
    }
}

// ==========================================
// 4. SENDER LOGIC (Compression & Encryption)
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
            const dataUrl = canvas.toDataURL('image/jpeg', 0.3);
            sizeReport.innerText = `Compressed String Length: ${dataUrl.length} characters`;
            packetList.innerHTML = ""; 
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

chunkBtn.addEventListener('click', async () => {
    const password = document.getElementById('secret-key')?.value;
    if (!password) return alert("Enter a password to encrypt!");
    if (!canvas.width) return alert("Please select an image first!");

    let dataToProcess = canvas.toDataURL('image/jpeg', 0.3);
    
    sizeReport.innerText = "Encrypting...";
    try {
        dataToProcess = await encryptData(dataToProcess, password);
    } catch (err) {
        return alert("Encryption Error");
    }

    const chunkSize = 120; 
    const chunks = [];
    const transmissionId = Math.floor(Math.random() * 900) + 100;

    for (let i = 0; i < dataToProcess.length; i += chunkSize) {
        chunks.push(dataToProcess.substring(i, i + chunkSize));
    }

    const totalPackets = chunks.length;
    packetList.innerHTML = `<h3>VLink Encrypted Packets (${totalPackets}):</h3>`;

    const finalizedPackets = chunks.map((data, index) => {
        const seq = (index + 1).toString().padStart(2, '0');
        const tot = totalPackets.toString().padStart(2, '0');
        return `VLINK|ID:${transmissionId}|SEQ:${seq}|TOT:${tot}|DATA:${data}`;
    });

    finalizedPackets.forEach((packet) => {
        const div = document.createElement('div');
        div.style.cssText = "background: #f4f4f4; margin: 10px 0; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 11px; word-break: break-all; border-left: 4px solid #007AFF;";
        const smsHref = `sms:?body=${encodeURIComponent(packet)}`;
        div.innerHTML = `
            <strong>Packet:</strong><br>${packet}<br>
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button onclick="navigator.clipboard.writeText('${packet}')">Copy</button>
                <a href="${smsHref}" style="text-decoration:none; background:#28a745; color:white; padding:5px 10px; border-radius:3px; font-size:10px;">Send SMS</a>
            </div>
        `;
        packetList.appendChild(div);
        savePacketToDB(packet, transmissionId);
    });
    sizeReport.innerText = "Complete. Encrypted Packets Ready.";
});

// ==========================================
// 5. RECEIVER LOGIC (Reassembly & Decryption)
// ==========================================
importBtn.addEventListener('click', async () => {
    const password = document.getElementById('secret-key')?.value;
    if (!password) return alert("Enter the password to decrypt!");
    
    const rawData = importInput.value.trim();
    if (!rawData.startsWith('VLINK|')) return alert("Invalid Packet");

    const parts = rawData.split('|');
    const tId = parts[1].split(':')[1];
    const seq = parseInt(parts[2].split(':')[1]);
    const tot = parseInt(parts[3].split(':')[1]);
    const data = parts[4].replace('DATA:', '');

    if (!reassemblyBuffer[tId]) reassemblyBuffer[tId] = new Array(tot).fill(null);
    reassemblyBuffer[tId][seq - 1] = data;

    const receivedCount = reassemblyBuffer[tId].filter(x => x !== null).length;
    assemblyProgress.innerText = `Received ${receivedCount} of ${tot} packets for ID: ${tId}`;

    if (receivedCount === tot) {
        try {
            assemblyProgress.innerText = "All packets received. Decrypting...";
            const encryptedFull = reassemblyBuffer[tId].join('');
            const decryptedBase64 = await decryptData(encryptedFull, password);
            
            const img = document.createElement('img');
            img.src = decryptedBase64;
            img.style.width = "200px";
            img.style.border = "2px solid #28a745";
            
            reconstructedContainer.innerHTML = "<h4>Decrypted Image:</h4>";
            reconstructedContainer.appendChild(img);
            delete reassemblyBuffer[tId];
        } catch (err) {
            alert(err.message);
            assemblyProgress.innerText = "Decryption Failed.";
        }
    }
    importInput.value = "";
});

async function savePacketToDB(packet, tId) {
    if (!db) return;
    const tx = db.transaction('chunks', 'readwrite');
    await tx.store.add({
        transmissionId: tId,
        data: packet,
        timestamp: Date.now()
    });
    await tx.done;
}