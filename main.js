const selectCaptureButton = document.getElementById('selectCaptureButton');
const toggleCaptureButton = document.getElementById('toggleCaptureButton');
const videoElement = document.getElementById('gameFeed');
const selectionCanvas = document.getElementById('selectionCanvas');
const ctxSelection = selectionCanvas.getContext('2d');
const capturedImagePreview = document.getElementById('capturedImagePreview');
const xpDisplayTable = document.getElementById('xpDisplayTable');
const statusElement = document.getElementById('status');
const ocrStatusElement = document.getElementById('ocrStatus');

let stream = null;
let currentSelectionRect = null;
let captureIntervalHandler = null;

async function startGameCapture() {
    statusElement.textContent = "正在請求畫面擷取權限...";
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "never", frameRate: { ideal: 10, max: 15 } },
            audio: false
        });
        statusElement.textContent = "成功擷取！請在下方畫面中圈選經驗值區域。";
        displayStream(stream);
    } catch (err) {
        console.error("無法擷取畫面:", err);
        statusElement.textContent = "無法擷取畫面，請確認已授權並重試。";
        alert("無法擷取畫面：" + err.message);
    }
}

function displayStream(mediaStream) {
    videoElement.srcObject = mediaStream;
    videoElement.onloadedmetadata = () => {
        videoElement.play().catch(e => console.error("播放視訊失敗:", e));
        const videoRect = videoElement.getBoundingClientRect();

        selectionCanvas.style.position = 'absolute';
        selectionCanvas.style.left = videoElement.offsetLeft + 'px';
        selectionCanvas.style.top = videoElement.offsetTop + 'px';
        selectionCanvas.width = videoElement.videoWidth;
        selectionCanvas.height = videoElement.videoHeight;
        selectionCanvas.style.width = videoRect.width + 'px';
        selectionCanvas.style.height = videoRect.height + 'px';

        console.log(`Video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
        console.log(`Canvas dimensions: ${selectionCanvas.width}x${selectionCanvas.height}`);
        console.log(`Canvas style dimensions: ${selectionCanvas.style.width}x${selectionCanvas.style.height}`);

        prepareSelection();
    };
    mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
        statusElement.textContent = "螢幕分享已停止。";
        videoElement.srcObject = null;
        ctxSelection.clearRect(0,0, selectionCanvas.width, selectionCanvas.height);
    });
}

function prepareSelection() {
    let startX, startY;
    let isSelecting = false;

    selectionCanvas.onmousedown = (e) => {
        isSelecting = true;
        const rect = selectionCanvas.getBoundingClientRect();
        startX = (e.clientX - rect.left) * (selectionCanvas.width / rect.width);
        startY = (e.clientY - rect.top) * (selectionCanvas.height / rect.height);
        ctxSelection.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    };

    selectionCanvas.onmousemove = (e) => {
        if (!isSelecting) return;
        const rect = selectionCanvas.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) * (selectionCanvas.width / rect.width);
        const currentY = (e.clientY - rect.top) * (selectionCanvas.height / rect.height);
        ctxSelection.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
        ctxSelection.strokeStyle = 'red';
        ctxSelection.lineWidth = 2;
        ctxSelection.strokeRect(startX, startY, currentX - startX, currentY - startY);
    };

    selectionCanvas.onmouseup = (e) => {
        if (!isSelecting) return;
        isSelecting = false;
        const rect = selectionCanvas.getBoundingClientRect();
        const endX = (e.clientX - rect.left) * (selectionCanvas.width / rect.width);
        const endY = (e.clientY - rect.top) * (selectionCanvas.height / rect.height);

        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        if (width > 20 && height > 20) {
            currentSelectionRect = { x, y, width, height };
            console.log("選取區域 (相對於視訊原始解析度):", currentSelectionRect);
            statusElement.textContent = `已選取區域: X:${Math.round(x)}, Y:${Math.round(y)}, W:${Math.round(width)}, H:${Math.round(height)}.`;
        } else {
            statusElement.textContent = "選取區域太小，請重新選取。";
            currentSelectionRect = null;
        }
    };
}

function toggleCapture() {
    if (!currentSelectionRect) {
        return;
    }
    if (captureIntervalHandler) {
        clearInterval(captureIntervalHandler);
        captureIntervalHandler = null;
        toggleCaptureButton.innerText = "開始記錄";
    } else {
        captureSelectedArea(currentSelectionRect);
        captureIntervalHandler = setInterval(() => {
            captureSelectedArea(currentSelectionRect);
        }, 60 * 1000)
        toggleCaptureButton.innerText = "暫停記錄";
    }
}


async function captureSelectedArea(rect) {
    if (!rect || rect.width === 0 || rect.height === 0 || !videoElement.srcObject) {
        ocrStatusElement.textContent = "錯誤：無效的選取區域或視訊來源。";
        return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(rect.width);
    tempCanvas.height = Math.round(rect.height);
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.drawImage(
        videoElement,
        Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height),
        0, 0, Math.round(rect.width), Math.round(rect.height)
    );

    const imageDataUrl = tempCanvas.toDataURL('image/png');
    capturedImagePreview.src = imageDataUrl;
    capturedImagePreview.style.display = 'block';
    statusElement.textContent = "圖像擷取完成，正在進行 OCR 辨識...";
    performOCR(imageDataUrl);
}

let ocrWorker = null;
let isWorkerInitialized = false;
async function initializeOCRWorker() {
    if (ocrWorker && isWorkerInitialized) {
        console.log("OCR Worker 已初始化。");
        if (ocrStatusElement) ocrStatusElement.textContent = "OCR 引擎已準備就緒。";
        return ocrWorker;
    }

    if (ocrStatusElement) ocrStatusElement.textContent = "正在建立 OCR Worker...";
    console.log("正在建立 OCR Worker...");

    try {
        ocrWorker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                console.log(m);
                if (ocrStatusElement) {
                    if (m.status === 'loading language model') {
                        ocrStatusElement.textContent = `正在載入 OCR 語言 (${m.lang || 'eng'}): ${Math.round(m.progress * 100)}%`;
                    } else if (m.status === 'initializing api' || m.status === 'initializing tesseract') {
                        ocrStatusElement.textContent = `正在初始化 OCR 引擎: ${Math.round(m.progress * 100)}%`;
                    } else if (m.status === 'recognizing text') {
                        ocrStatusElement.textContent = `OCR 辨識中: ${Math.round(m.progress * 100)}%`;
                    } else if (m.status === 'done' && m.jobId) {
                        // pass
                    }
                }
            },

        }, {
            tessedit_char_whitelist: '0123456789[]%.',
        });

        isWorkerInitialized = true;
        console.log("OCR Worker 初始化並設定完成。");
        if (ocrStatusElement) ocrStatusElement.textContent = "OCR 引擎準備就緒！";
        return ocrWorker;

    } catch (error) {
        console.error("OCR Worker 初始化失敗:", error);
        isWorkerInitialized = false;
        if (ocrStatusElement) ocrStatusElement.textContent = `OCR 引擎初始化失敗: ${error.message || error}`;
        throw error;
    }
}

async function performOCR(imageDataUrl) {
    if (!ocrWorker || !isWorkerInitialized) {
        console.log("OCR Worker 尚未初始化，正在嘗試初始化...");
        if (ocrStatusElement) ocrStatusElement.textContent = "OCR 引擎尚未初始化，正在嘗試...";
        try {
            await initializeOCRWorker();
            if (!isWorkerInitialized) {
                if (ocrStatusElement) ocrStatusElement.textContent = "OCR 引擎初始化失敗，無法辨識。";
                return;
            }
        } catch (initError) {
            console.error("在 performOCR 中初始化 Worker 失敗:", initError);
            return;
        }
    }

    if (ocrStatusElement) ocrStatusElement.textContent = "OCR 辨識準備中...";

    try {
        const { data: { text, confidence } } = await ocrWorker.recognize(imageDataUrl);
        const cleanedText = text.trim().replace(/\D\[\]\.%/g, '');

        console.log(`OCR 原始文字: "${text.trim()}", 清理後: "${cleanedText}", 信心度: ${confidence}`);

        if (cleanedText) {
            recordXP(cleanedText);
        } else {
            console.warn("OCR 未能辨識出任何數字。");
        }

    } catch (err) {
        console.error("OCR 辨識操作失敗:", err);
        if (ocrStatusElement) ocrStatusElement.textContent = `OCR 辨識失敗: ${err.message || err}`;
    }
}

let xpRecords = [];
const reMatchXP = /(\d+)\[([\d.]+%)\]?/;
function recordXP(text) {
    if (!text) {
        return;
    }
    const match = text.match(reMatchXP);
    if (match) {
        const newRecord = {
            xp: match[1],
            xpPercentage: match[2],
            timestamp: new Date().toLocaleString()
        };
        xpRecords.push(newRecord);
        console.log("經驗值已記錄:", newRecord);
        updateXPDisplay();
        // localStorage.setItem('artaleXpRecords', JSON.stringify(xpRecords));
    }
}

function updateXPDisplay() {
    xpDisplayTable.innerHTML = xpRecords.map(({xp, xpPercentage, timestamp}) => `<tr><td>${timestamp}</td><td>${xp}</td><td>${xpPercentage}</td></tr>`).join("");
}

// window.onload = () => {
//     const savedRecords = localStorage.getItem('artaleXpRecords');
//     if (savedRecords) {
//         xpRecords = JSON.parse(savedRecords);
//         updateXPDisplay();
//     }
// };

selectCaptureButton.addEventListener('click', startGameCapture);
toggleCaptureButton.addEventListener('click', toggleCapture)

window.addEventListener('resize', () => {
    if (videoElement.srcObject) {
        const videoRect = videoElement.getBoundingClientRect();
        selectionCanvas.style.left = videoElement.offsetLeft + 'px';
        selectionCanvas.style.top = videoElement.offsetTop + 'px';
        selectionCanvas.style.width = videoRect.width + 'px';
        selectionCanvas.style.height = videoRect.height + 'px';
    }
});