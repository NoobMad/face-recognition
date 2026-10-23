# FaceTrack AI — Smart Attendance System

An AI-powered face recognition attendance system built with **face-api.js** for real-time face detection and recognition directly in the browser.

![Dashboard](https://img.shields.io/badge/Status-Live-brightgreen) ![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

- **🎥 Real-Time Face Detection** — Uses webcam with live bounding boxes, confidence labels, and corner markers
- **📋 Automatic Attendance Tracking** — Recognized faces are logged automatically with timestamp, confidence, and Present/Late status
- **🧑 Face Registration** — Capture multiple face samples per person with name, ID, and department
- **📊 Dashboard** — Statistics cards, weekly bar chart, and live activity feed
- **📥 Excel Export** — Download attendance records as `.xlsx` files
- **👥 People Management** — View, manage, and delete registered faces with thumbnail previews
- **🔒 Privacy First** — All data stays in your browser (localStorage), nothing is sent to any server

## 🚀 Live Demo

[**https://facetrack-ai-two.vercel.app**](https://facetrack-ai-two.vercel.app)

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| HTML / CSS / JavaScript | Core frontend |
| [face-api.js](https://github.com/vladmandic/face-api) | Face detection & recognition |
| [SheetJS (XLSX)](https://sheetjs.com/) | Excel export |
| [Inter Font](https://fonts.google.com/specimen/Inter) | Typography |

## 📁 Project Structure

```
face-recognition/
├── index.html       # Main dashboard UI
├── index.css        # Premium dark theme styles
├── app.js           # Core application logic
└── README.md        # This file
```

## 🏁 Getting Started

### Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/NoobMad/face-recognition.git
   cd face-recognition
   ```

2. Start a local server (camera requires HTTP/HTTPS):
   ```bash
   npx http-server . -p 8080
   ```

3. Open [http://localhost:8080](http://localhost:8080) in your browser.

### How to Use

1. **Register Face** — Enter name/ID → Open camera → Capture 5 face samples → Save
2. **Live Camera** — Start Camera → Start Recognition → Faces are matched automatically
3. **Attendance Log** — View records, filter by date, export to Excel
4. **Dashboard** — See stats, weekly chart, and recent activity

## 📸 Screenshots

| Dashboard | Live Camera | Register |
|-----------|-------------|----------|
| Stats & charts | Real-time face detection | Multi-sample capture |

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
