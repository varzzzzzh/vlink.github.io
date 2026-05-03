# Village Link - Offline Multimedia Protocol

## What is Village Link?

**Village Link** is an offline communication protocol that transmits multimedia files using 160-character SMS packets - no internet connection required.

## Key Features

- **Offline-First**: Works without internet, uses only cellular SMS
- **AES-GCM Encryption**: End-to-end security for all transmitted data
- **Out-of-Order Packet Recovery**: Reassembles SMS packets arriving in wrong sequence
- **IndexedDB Storage**: Persistent local storage on user's device
- **Progressive Web App**: Installable, works offline like native app

## Technologies Used

| Technology | Purpose |
|------------|---------|
| HTML5/CSS3/JavaScript | Frontend UI and core logic |
| AES-GCM (Web Crypto API) | End-to-end encryption |
| IndexedDB | Local file storage |
| Service Workers | PWA offline capabilities |
| Custom Sequencing Logic | Out-of-order packet recovery |

## How It Works

1. **Select File** - User chooses a multimedia file
2. **Encrypt** - File encrypted using AES-GCM
3. **Burst** - Data compressed and split into 160-character SMS packets
4. **Send** - Packets transmitted via cellular network
5. **Receive** - Recipient collects possibly out-of-order packets
6. **Reassemble** - Sequencing logic reconstructs original order
7. **Decrypt** - AES-GCM decrypts the reassembled data
8. **Store** - File saved to IndexedDB for offline access

## Installation

Open `https://varzzzzzh.github.io/vlink.github.io/` on your phone and click "Add to Home Screen"

## Project Structure
