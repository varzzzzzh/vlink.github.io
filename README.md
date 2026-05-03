# Village Link - Offline Multimedia Protocol

## License

MIT License

Copyright (c) 2026 Varsha R

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

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
vlink.github.io/
├── index.html # Main application UI
├── app.js # Core logic (encryption, sequencing, IndexedDB)
├── style.css # Responsive styling
├── sw.js # Service Worker (offline caching)
└── manifest.json # PWA configuration


## Author

**Varsha R** (varzzzzzh)
