/* ============================================
   VoiceNote AI — Application Logic
   ============================================ */

// ============= DOM Helpers =============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============= Configuration =============
const CONFIG = {
    API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
    DEFAULT_MODEL: 'gemini-3.5-flash',
    DEFAULT_LANG: 'ko-KR',
    MAX_TOKENS: 4096,
    DB_NAME: 'VoiceNoteAI',
    DB_VERSION: 1,
    STORE_NAME: 'recordings',
};

// ============= Application State =============
const state = {
    currentScreen: 'record',
    isRecording: false,
    transcript: '',
    interimTranscript: '',
    recordingSeconds: 0,
    timerInterval: null,
    apiKey: localStorage.getItem('vnai_apiKey') || 'AQ.Ab8RN6L7znUqXcRld-Qc249cwatbMBlQvDhJosgoDAyP25Qh9A',
    customVocab: localStorage.getItem('vnai_customVocab') || '',
    lang: localStorage.getItem('vnai_lang') || CONFIG.DEFAULT_LANG,
    model: (() => {
        const saved = localStorage.getItem('vnai_model');
        const validModels = ['gemini-3.5-flash'];
        return (saved && validModels.includes(saved)) ? saved : CONFIG.DEFAULT_MODEL;
    })(),
    results: null,
    activeTab: 'summary',
    recognition: null,
    audioContext: null,
    analyser: null,
    mediaStream: null,
    animFrameId: null,
    // New: recording metadata
    recordingId: null,
    recordingTitle: '',
    recordingDate: null,
    // New: audio recording
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
};

// ============= IndexedDB =============
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveRecord(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
        tx.objectStore(CONFIG.STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_NAME, 'readonly');
        const request = tx.objectStore(CONFIG.STORE_NAME).getAll();
        request.onsuccess = () => {
            const records = request.result.sort((a, b) => b.id - a.id);
            resolve(records);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function deleteRecord(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
        tx.objectStore(CONFIG.STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ============= Initialization =============
document.addEventListener('DOMContentLoaded', () => {
    initMermaid();
    checkBrowserSupport();
    initSettings();
    initRecording();
    initEditScreen();
    initResults();
    initHistory();
    initInstallPrompt();
    updateTabIndicator();
    window.addEventListener('resize', updateTabIndicator);
});

function initMermaid() {
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
                primaryColor: '#818cf8',
                primaryTextColor: '#f1f5f9',
                primaryBorderColor: '#6366f1',
                lineColor: '#475569',
                secondaryColor: '#1e1b4b',
                tertiaryColor: '#0e0e2a',
                fontFamily: 'Inter, sans-serif',
                fontSize: '14px',
            },
        });
    }
}

// ============= Browser Support =============
function checkBrowserSupport() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        $('#browserWarning').classList.remove('hidden');
        $('#dismissWarning').addEventListener('click', () => {
            $('#browserWarning').classList.add('hidden');
        });
    }
}

// ============= Toast Notifications =============
function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============= Screen Navigation =============
function navigateTo(screen) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $(`#screen${capitalize(screen)}`).classList.add('active');
    state.currentScreen = screen;

    // Handle back button visibility
    const backBtn = $('#backBtn');
    if (screen === 'record') {
        backBtn.classList.add('hidden');
    } else {
        backBtn.classList.remove('hidden');
    }
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Back button logic
$('#backBtn').addEventListener('click', () => {
    if (state.currentScreen === 'edit') {
        navigateTo('record');
    } else if (state.currentScreen === 'results') {
        navigateTo('edit');
    } else if (state.currentScreen === 'loading') {
        navigateTo('edit');
    } else if (state.currentScreen === 'history') {
        navigateTo('record');
    }
});

// ============= Settings =============
function initSettings() {
    const settingsBtn = $('#settingsBtn');
    const modal = $('#settingsModal');
    const closeBtn = $('#closeSettings');
    const saveBtn = $('#saveSettings');
    const toggleApiKey = $('#toggleApiKey');
    const apiInput = $('#apiKeyInput');
    const vocabInput = $('#customVocabInput');
    const demoBtn = $('#demoModeBtn');

    // Load saved settings
    apiInput.value = state.apiKey;
    if (vocabInput) vocabInput.value = state.customVocab;
    $('#langSelect').value = state.lang;
    $('#modelSelect').value = state.model;

    settingsBtn.addEventListener('click', () => modal.classList.add('open'));
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });

    toggleApiKey.addEventListener('click', () => {
        apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
    });

    saveBtn.addEventListener('click', () => {
        state.apiKey = apiInput.value.trim();
        if (vocabInput) state.customVocab = vocabInput.value.trim();
        state.lang = $('#langSelect').value;
        state.model = $('#modelSelect').value;
        localStorage.setItem('vnai_apiKey', state.apiKey);
        if (vocabInput) localStorage.setItem('vnai_customVocab', state.customVocab);
        localStorage.setItem('vnai_lang', state.lang);
        localStorage.setItem('vnai_model', state.model);
        modal.classList.remove('open');
        showToast('설정이 저장되었습니다.', 'success');
    });

    demoBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        runDemoMode();
    });
}

// ============= Recording =============
function initRecording() {
    const recordBtn = $('#recordBtn');
    const editBtn = $('#editBtn');

    recordBtn.addEventListener('click', toggleRecording);
    editBtn.addEventListener('click', () => {
        $('#editArea').value = state.transcript;
        updateTextStats();
        // Set recording date if not set
        if (!state.recordingDate) state.recordingDate = new Date();
        $('#recordDate').textContent = formatDate(state.recordingDate);
        // Show duration
        const durEl = $('#durationDisplay');
        if (durEl) durEl.textContent = `녹음 ${formatDuration(state.recordingSeconds)}`;
        
        // Pre-fill title input with current title
        $('#recordTitle').value = state.recordingTitle || '';
        navigateTo('edit');
    });
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${d} ${h}:${min}`;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

function toggleRecording() {
    if (state.isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('이 브라우저에서는 음성 인식이 지원되지 않습니다.', 'error');
        return;
    }

    try {
        // Get microphone access for visualization AND audio recording
        state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupAudioVisualizer(state.mediaStream);
        startAudioRecording(state.mediaStream);
    } catch (err) {
        showToast('마이크 접근이 거부되었습니다. 브라우저 설정을 확인해주세요.', 'error');
        return;
    }

    // Setup Speech Recognition
    state.recognition = new SpeechRecognition();
    state.recognition.lang = state.lang;
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.maxAlternatives = 1;

    state.recognition.onresult = (event) => {
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += transcript + ' ';
            } else {
                interim += transcript;
            }
        }

        if (finalText) {
            state.transcript += finalText;
            $('#transcriptFinal').textContent = state.transcript;
        }

        state.interimTranscript = interim;
        $('#transcriptInterim').textContent = interim;

        // Auto-scroll
        const liveArea = $('#liveTranscript');
        liveArea.scrollTop = liveArea.scrollHeight;
    };

    state.recognition.onerror = (event) => {
        if (event.error === 'no-speech') return; // Ignore silence
        if (event.error === 'aborted') return;
        console.warn('Speech recognition error:', event.error);
    };

    state.recognition.onend = () => {
        // Restart if still recording (Web Speech API can stop on its own)
        if (state.isRecording) {
            try {
                state.recognition.start();
            } catch (e) {
                // Already started
            }
        }
    };

    state.recognition.start();
    state.isRecording = true;

    // UI updates
    $('#recordBtn').classList.add('recording');
    $('#recordStatus').classList.add('recording');
    $('.status-text').textContent = '녹음 중';
    $('#timer').classList.add('recording');
    $('#recordHint').textContent = '버튼을 다시 눌러 녹음을 중지하세요';
    $('#waveform').classList.add('active');
    $('#liveTranscriptWrapper').classList.add('visible');
    $('#editBtn').classList.add('hidden');

    // Start timer
    state.recordingSeconds = 0;
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
        state.recordingSeconds++;
        updateTimerDisplay();
    }, 1000);

    // Reset recordingId if starting fresh
    if (!state.transcript.trim()) {
        state.recordingId = null;
        state.recordingDate = null;
        state.recordingTitle = '';
    }
}

// ============= Audio Recording (MediaRecorder) =============
function startAudioRecording(stream) {
    state.audioChunks = [];
    state.audioBlob = null;

    try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/mp4')
                ? 'audio/mp4'
                : 'audio/webm';

        state.mediaRecorder = new MediaRecorder(stream, { mimeType });

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                state.audioChunks.push(e.data);
            }
        };

        state.mediaRecorder.onstop = () => {
            state.audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
        };

        state.mediaRecorder.start(1000); // Collect data every second
    } catch (err) {
        console.warn('MediaRecorder not available, audio will not be saved:', err);
        state.mediaRecorder = null;
    }
}

function stopAudioRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
}

function stopRecording() {
    state.isRecording = false;

    // Stop recognition
    if (state.recognition) {
        state.recognition.stop();
        state.recognition = null;
    }

    // Stop audio recording
    stopAudioRecording();

    // Stop media stream (after MediaRecorder stops)
    setTimeout(() => {
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach((t) => t.stop());
            state.mediaStream = null;
        }
    }, 200);

    if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
    }

    if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }

    // Clear timer
    clearInterval(state.timerInterval);

    // Merge interim text
    if (state.interimTranscript) {
        state.transcript += state.interimTranscript + ' ';
        state.interimTranscript = '';
        $('#transcriptFinal').textContent = state.transcript;
        $('#transcriptInterim').textContent = '';
    }

    // UI updates
    $('#recordBtn').classList.remove('recording');
    $('#recordStatus').classList.remove('recording');
    $('.status-text').textContent = '완료';
    $('#timer').classList.remove('recording');
    $('#recordHint').textContent = '녹음이 완료되었습니다';
    $('#waveform').classList.remove('active');

    // Clear waveform
    const canvas = $('#waveform');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Show edit button if there's text
    if (state.transcript.trim()) {
        $('#editBtn').classList.remove('hidden');

        // Auto save raw log immediately so it appears in history
        if (!state.recordingId) {
            state.recordingId = Date.now();
            state.recordingDate = new Date();
            const dateStr = formatDate(state.recordingDate);
            const hours = state.recordingDate.getHours().toString().padStart(2, '0');
            const mins = state.recordingDate.getMinutes().toString().padStart(2, '0');
            state.recordingTitle = `${dateStr} ${hours}:${mins} 녹음`;
        }
        
        const record = {
            id: state.recordingId,
            title: state.recordingTitle,
            date: state.recordingDate.toISOString(),
            duration: state.recordingSeconds,
            transcript: state.transcript,
            results: null,
            audioBlob: state.audioBlob || null,
        };
        saveRecord(record).catch(err => console.warn('임시 저장 실패:', err));
    } else {
        showToast('텍스트가 인식되지 않았습니다. 다시 시도해주세요.', 'error');
    }
}

function updateTimerDisplay() {
    const min = Math.floor(state.recordingSeconds / 60).toString().padStart(2, '0');
    const sec = (state.recordingSeconds % 60).toString().padStart(2, '0');
    $('#timer').textContent = `${min}:${sec}`;
}

// ============= Audio Visualizer =============
function setupAudioVisualizer(stream) {
    const canvas = $('#waveform');
    const ctx = canvas.getContext('2d');

    // Set canvas size for high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);

    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const width = rect.width;
    const height = rect.height;

    function draw() {
        state.animFrameId = requestAnimationFrame(draw);
        state.analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, width, height);

        const barCount = 48;
        const gap = 3;
        const barWidth = (width - gap * (barCount - 1)) / barCount;
        const step = Math.floor(bufferLength / barCount);

        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i * step] / 255;
            const barHeight = Math.max(2, value * height * 0.85);
            const x = i * (barWidth + gap);
            const y = (height - barHeight) / 2;

            // Create gradient
            const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
            gradient.addColorStop(0, `rgba(129, 140, 248, ${0.4 + value * 0.6})`);
            gradient.addColorStop(1, `rgba(192, 132, 252, ${0.2 + value * 0.4})`);

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 2);
            ctx.fill();
        }
    }

    draw();
}

// ============= Edit Screen =============
function initEditScreen() {
    const editArea = $('#editArea');
    const clearBtn = $('#clearText');
    const aiBtn = $('#aiBtn');

    editArea.addEventListener('input', updateTextStats);

    clearBtn.addEventListener('click', () => {
        if (editArea.value && confirm('텍스트를 모두 삭제하시겠습니까?')) {
            editArea.value = '';
            updateTextStats();
        }
    });

    aiBtn.addEventListener('click', () => {
        const text = editArea.value.trim();
        if (!text) {
            showToast('정리할 텍스트가 없습니다.', 'error');
            return;
        }
        if (!state.apiKey) {
            showToast('설정에서 Gemini API 키를 입력해주세요.', 'error');
            $('#settingsModal').classList.add('open');
            return;
        }
        // Save title from input
        state.recordingTitle = $('#recordTitle').value.trim() || '제목 없음';
        processWithAI(text);
    });
}

function updateTextStats() {
    const text = $('#editArea').value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    $('#wordCount').textContent = `${words} 단어`;
    $('#charCount').textContent = `${chars} 자`;
}

// ============= AI Processing =============
async function processWithAI(text) {
    navigateTo('loading');

    const prompt = `다음 음성 녹음 텍스트를 분석하여 4가지 형식으로 정리해주세요.

${state.customVocab ? `**[중요] 다음은 우리 학교 전용 단어장(고유명사 사전)입니다. 음성 인식된 텍스트 중 발음이 비슷하게 오타가 난 고유명사나 용어가 있다면 아래 단어장을 참고하여 문맥에 맞게 알맞은 단어로 교정하여 정리해주세요.**\n단어장: ${state.customVocab}\n\n` : ''}**반드시 아래 JSON 형식으로만 응답해주세요. JSON 외의 텍스트는 포함하지 마세요.**

{
  "summary": "요점정리를 마크다운 형식으로 작성. 핵심 내용을 간결한 bullet point로 정리. 제목(##)과 소제목(###)을 활용하여 구조화.",
  "meeting_notes": "회의록을 마크다운 형식으로 작성. 다음 구조를 따를 것: ## 회의 개요, ## 주요 안건, ## 논의 사항 (각 안건별 상세), ## 결정 사항, ## 후속 조치",
  "todos": "할 일 목록을 마크다운 체크리스트 형식으로 작성. - [ ] 형식 사용. 우선순위별로 그룹화. 각 항목에 담당/기한이 추측 가능하면 포함.",
  "mindmap": "Mermaid.js mindmap 문법으로 작성. 'mindmap'으로 시작. 들여쓰기로 계층 표현. 특수문자나 괄호는 사용하지 않기. 각 노드는 간결하게. root 노드 다음에 2-4개 주요 가지, 각 가지에 2-3개 하위 항목."
}

텍스트:
${text}`;

    try {
        const apiUrl = `${CONFIG.API_BASE}/${state.model}:generateContent?key=${state.apiKey}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }],
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: CONFIG.MAX_TOKENS,
                    responseMimeType: 'application/json',
                },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API 오류 (${response.status})`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) {
            throw new Error('AI가 응답을 생성하지 못했습니다.');
        }

        // Parse JSON from response
        let results;
        try {
            results = JSON.parse(content);
        } catch (parseErr) {
            // Try to find JSON in the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                results = JSON.parse(jsonMatch[0]);
            } else {
                console.error('JSON parse error:', parseErr);
                results = {
                    summary: content,
                    meeting_notes: '파싱 오류가 발생했습니다. 요점정리 탭을 확인해주세요.',
                    todos: '- [ ] 파싱 오류로 할 일 목록을 생성할 수 없습니다.',
                    mindmap: 'mindmap\n  root(결과)\n    파싱 오류 발생',
                };
            }
        }

        state.results = results;
        displayResults(results);
        navigateTo('results');
        showToast('AI 정리가 완료되었습니다!', 'success');

        // Auto-save to IndexedDB
        await autoSaveRecord(text, results);

    } catch (err) {
        console.error('AI processing error:', err);
        showToast(`오류: ${err.message}`, 'error');
        navigateTo('edit');
    }
}

// ============= Auto-save Record =============
async function autoSaveRecord(transcript, results) {
    try {
        const record = {
            id: state.recordingId || Date.now(),
            title: state.recordingTitle || '제목 없음',
            date: (state.recordingDate || new Date()).toISOString(),
            duration: state.recordingSeconds,
            transcript: transcript,
            results: results,
            audioBlob: state.audioBlob || null,
        };
        await saveRecord(record);
        showToast('기록이 자동 저장되었습니다.', 'info');
    } catch (err) {
        console.warn('기록 저장 실패:', err);
    }
}

// ============= Results Display =============
function initResults() {
    // Tab switching
    $$('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });

    // Copy
    $('#copyResult').addEventListener('click', () => {
        if (!state.results) return;
        const tabName = state.activeTab;
        const key = tabKeyMap(tabName);
        const text = state.results[key] || '';
        navigator.clipboard
            .writeText(text)
            .then(() => showToast('클립보드에 복사되었습니다.', 'success'))
            .catch(() => showToast('복사에 실패했습니다.', 'error'));
    });

    // Download
    $('#downloadResult').addEventListener('click', () => {
        if (!state.results) return;

        let content = '';
        content += '# 요점정리\n\n' + (state.results.summary || '') + '\n\n';
        content += '---\n\n# 회의록\n\n' + (state.results.meeting_notes || '') + '\n\n';
        content += '---\n\n# 할 일 목록\n\n' + (state.results.todos || '') + '\n\n';
        content += '---\n\n# 마인드맵 (Mermaid)\n\n```mermaid\n' + (state.results.mindmap || '') + '\n```\n';

        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = state.recordingTitle || 'voicenote';
        a.download = `${title}_${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('파일이 다운로드되었습니다.', 'success');
    });

    // New recording
    $('#newRecording').addEventListener('click', () => {
        // Reset state
        state.transcript = '';
        state.interimTranscript = '';
        state.results = null;
        state.recordingSeconds = 0;
        state.recordingTitle = '';
        state.recordingDate = null;
        state.audioBlob = null;
        state.audioChunks = [];

        // Reset UI
        $('#transcriptFinal').textContent = '';
        $('#transcriptInterim').textContent = '';
        $('#timer').textContent = '00:00';
        $('.status-text').textContent = '준비';
        $('#recordHint').textContent = '마이크 버튼을 눌러 녹음을 시작하세요';
        $('#editBtn').classList.add('hidden');
        $('#liveTranscriptWrapper').classList.remove('visible');

        navigateTo('record');
    });
}

function tabKeyMap(tabName) {
    const map = {
        summary: 'summary',
        meeting: 'meeting_notes',
        todos: 'todos',
        mindmap: 'mindmap',
    };
    return map[tabName] || 'summary';
}

function switchTab(tabName) {
    state.activeTab = tabName;

    // Update tab buttons
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $(`.tab[data-tab="${tabName}"]`).classList.add('active');

    // Update panels
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    $(`#tab${capitalize(tabName)}`).classList.add('active');

    // Update indicator
    updateTabIndicator();
}

function updateTabIndicator() {
    const activeTab = $(`.tab.active`);
    const indicator = $('#tabIndicator');
    if (!activeTab || !indicator) return;

    const tabsContainer = $('#tabs');
    const tabRect = activeTab.getBoundingClientRect();
    const containerRect = tabsContainer.getBoundingClientRect();

    indicator.style.width = `${tabRect.width}px`;
    indicator.style.left = `${tabRect.left - containerRect.left}px`;
}

function displayResults(results) {
    // Summary
    if (results.summary) {
        $('#tabSummary').innerHTML = renderMarkdown(results.summary);
    }

    // Meeting notes
    if (results.meeting_notes) {
        $('#tabMeeting').innerHTML = renderMarkdown(results.meeting_notes);
    }

    // Todos
    if (results.todos) {
        $('#tabTodos').innerHTML = renderMarkdown(results.todos);
    }

    // Mindmap
    if (results.mindmap) {
        renderMindmap(results.mindmap);
    }

    // Reset to summary tab
    switchTab('summary');
}

function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        // Configure marked
        marked.setOptions({
            gfm: true,
            breaks: true,
        });
        return marked.parse(text);
    }
    // Fallback: basic rendering
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

async function renderMindmap(mermaidCode) {
    const container = $('#mermaidContainer');
    container.innerHTML = '';

    if (typeof mermaid === 'undefined') {
        container.innerHTML = '<p style="color: var(--text-muted);">Mermaid.js를 불러오지 못했습니다.</p>';
        return;
    }

    try {
        // Clean up the mermaid code
        let code = mermaidCode.trim();
        // Remove markdown code fences if present
        code = code.replace(/^```(?:mermaid)?\n?/g, '').replace(/\n?```$/g, '');

        const id = 'mermaid-' + Date.now();
        const { svg } = await mermaid.render(id, code);
        container.innerHTML = svg;
    } catch (err) {
        console.error('Mermaid render error:', err);
        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: var(--text-muted); margin-bottom: 12px;">마인드맵 렌더링에 실패했습니다.</p>
                <pre style="background: rgba(255,255,255,0.04); padding: 16px; border-radius: 8px; text-align: left; font-size: 0.8rem; color: var(--text-secondary); overflow-x: auto; white-space: pre-wrap;">${mermaidCode.replace(/</g, '&lt;')}</pre>
            </div>
        `;
    }
}

// ============= History Screen =============
function initHistory() {
    $('#historyBtn').addEventListener('click', () => {
        loadHistory();
        navigateTo('history');
    });
}

async function loadHistory() {
    const listEl = $('#historyList');
    const countEl = $('#historyCount');

    try {
        const records = await getAllRecords();
        countEl.textContent = `${records.length}건`;

        if (records.length === 0) {
            listEl.innerHTML = `
                <div class="history-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:0.3">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <p>아직 저장된 녹음이 없습니다.</p>
                    <p class="history-empty-sub">녹음 후 AI 정리를 완료하면 자동으로 저장됩니다.</p>
                </div>`;
            return;
        }

        listEl.innerHTML = records.map(rec => {
            const date = new Date(rec.date);
            const dateStr = formatDate(date);
            const durationStr = formatDuration(rec.duration || 0);
            const previewText = (rec.transcript || '').substring(0, 80) + ((rec.transcript || '').length > 80 ? '...' : '');
            const hasAudio = !!rec.audioBlob;

            return `
                <div class="history-card" data-id="${rec.id}">
                    <div class="history-card-top">
                        <div class="history-card-info">
                            <h3 class="history-title">${escapeHtml(rec.title || '제목 없음')}</h3>
                            <div class="history-meta">
                                <span class="history-date">${dateStr}</span>
                                <span class="history-dot">·</span>
                                <span class="history-duration">${durationStr}</span>
                            </div>
                        </div>
                        <button class="history-delete icon-btn-sm" data-id="${rec.id}" title="삭제">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                    <p class="history-preview">${escapeHtml(previewText)}</p>
                    <div class="history-card-actions">
                        ${hasAudio ? `<button class="history-play btn-ghost" data-id="${rec.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            재생
                        </button>` : '<span class="history-no-audio">오디오 없음</span>'}
                        <button class="history-view btn-ghost" data-id="${rec.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            AI 결과 보기
                        </button>
                    </div>
                    <div class="history-audio-player hidden" id="player-${rec.id}"></div>
                </div>`;
        }).join('');

        // Bind events
        listEl.querySelectorAll('.history-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                if (confirm('이 녹음 기록을 삭제하시겠습니까?')) {
                    await deleteRecord(id);
                    showToast('기록이 삭제되었습니다.', 'success');
                    loadHistory();
                }
            });
        });

        listEl.querySelectorAll('.history-play').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                toggleAudioPlayer(id, records);
            });
        });

        listEl.querySelectorAll('.history-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                const rec = records.find(r => r.id === id);
                if (rec && rec.results) {
                    state.results = rec.results;
                    state.recordingTitle = rec.title;
                    displayResults(rec.results);
                    navigateTo('results');
                }
            });
        });

    } catch (err) {
        console.error('기록 로드 실패:', err);
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">기록을 불러올 수 없습니다.</p>';
    }
}

function toggleAudioPlayer(id, records) {
    const playerEl = $(`#player-${id}`);
    if (!playerEl) return;

    if (!playerEl.classList.contains('hidden')) {
        playerEl.classList.add('hidden');
        playerEl.innerHTML = '';
        return;
    }

    const rec = records.find(r => r.id === id);
    if (!rec || !rec.audioBlob) {
        showToast('오디오 파일이 없습니다.', 'error');
        return;
    }

    const audioUrl = URL.createObjectURL(rec.audioBlob);
    playerEl.innerHTML = `<audio controls src="${audioUrl}" style="width:100%;height:40px;border-radius:8px;"></audio>`;
    playerEl.classList.remove('hidden');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============= Demo Mode =============
function runDemoMode() {
    const demoTranscript =
        '오늘 회의에서는 3분기 마케팅 전략에 대해 논의했습니다. 김 팀장이 SNS 캠페인 결과를 보고했고, 전환율이 15% 상승했다고 합니다. 이 대리는 신규 제품 런칭 일정을 10월 초로 제안했고, 모두 동의했습니다. 박 과장은 고객 피드백 분석 결과를 공유했는데, 가격 대비 품질에 대한 만족도가 높았습니다. 다음 주까지 각 팀별로 4분기 예산안을 제출하기로 했고, 신규 채용 면접은 다음 주 수요일에 진행하기로 했습니다. 또한 해외 진출 관련해서 동남아 시장 조사가 필요하다는 의견이 있었고, 이에 대한 보고서를 2주 내로 준비하기로 했습니다.';

    state.transcript = demoTranscript;
    state.recordingDate = new Date();
    state.recordingTitle = '데모 회의';
    state.recordingSeconds = 45;

    $('#editArea').value = demoTranscript;
    $('#recordTitle').value = '데모 회의';
    $('#recordDate').textContent = formatDate(state.recordingDate);
    const durEl = $('#durationDisplay');
    if (durEl) durEl.textContent = `녹음 ${formatDuration(45)}`;
    updateTextStats();

    const demoResults = {
        summary: `## 📋 3분기 마케팅 전략 회의 요점

### 성과 보고
- **SNS 캠페인** 전환율 **15% 상승** 달성 (김 팀장 보고)
- 고객 만족도 조사: **가격 대비 품질** 항목에서 높은 만족도 기록

### 주요 결정
- 🚀 **신규 제품 런칭**: 10월 초로 확정 (이 대리 제안, 전원 동의)
- 💰 **4분기 예산안**: 다음 주까지 팀별 제출
- 👥 **신규 채용 면접**: 다음 주 수요일 진행
- 🌏 **동남아 시장 조사** 보고서: 2주 내 준비

### 핵심 인사이트
> 3분기 마케팅 성과가 긍정적이며, 해외 시장 확장이 다음 성장 동력으로 논의되고 있음`,

        meeting_notes: `## 회의 개요

| 항목 | 내용 |
|------|------|
| 회의명 | 3분기 마케팅 전략 회의 |
| 참석자 | 김 팀장, 이 대리, 박 과장 외 |

---

## 주요 안건

### 1. SNS 캠페인 성과 보고
- **보고자**: 김 팀장
- 3분기 SNS 캠페인 전환율 **15% 상승**
- 주요 채널별 성과 분석 공유

### 2. 신규 제품 런칭 일정
- **제안자**: 이 대리
- 런칭 시기: **10월 초** 확정
- 전원 동의

### 3. 고객 피드백 분석
- **보고자**: 박 과장
- 가격 대비 품질 만족도 높음
- 상세 데이터 공유

### 4. 해외 진출 논의
- 동남아 시장 조사 필요성 제기
- 시장 조사 보고서 2주 내 준비

---

## 결정 사항
1. 신규 제품은 10월 초에 런칭한다
2. 4분기 예산안은 다음 주까지 팀별로 제출한다
3. 신규 채용 면접은 다음 주 수요일에 진행한다
4. 동남아 시장 조사 보고서를 2주 내로 준비한다

---

## 후속 조치
- 각 팀: 4분기 예산안 작성 및 제출 (기한: 다음 주)
- 담당자 미정: 동남아 시장 조사 보고서 작성 (기한: 2주 이내)
- HR팀: 수요일 면접 일정 확정 및 안내`,

        todos: `## 🔴 긴급 (이번 주)

- [ ] **4분기 예산안** 작성 및 제출 — 각 팀별 / 다음 주까지
- [ ] **신규 채용 면접** 준비 — HR팀 / 다음 주 수요일

## 🟡 중요 (2주 이내)

- [ ] **동남아 시장 조사 보고서** 작성 — 담당자 배정 필요 / 2주 이내
- [ ] **신규 제품 런칭** 세부 계획 수립 — 이 대리 / 10월 초 런칭 기준

## 🟢 진행 중

- [x] SNS 캠페인 3분기 성과 보고 — 김 팀장 ✅
- [x] 고객 피드백 분석 및 공유 — 박 과장 ✅

## 📌 참고

- [ ] SNS 캠페인 전환율 15% 상승 → 4분기 전략에 반영
- [ ] 고객 만족도 데이터 기반 가격 정책 재검토`,

        mindmap: `mindmap
  root(3분기 마케팅 회의)
    성과 보고
      SNS 캠페인 전환율 15% 상승
      고객 만족도 품질 높음
    주요 결정
      신규 제품 10월 초 런칭
      4분기 예산안 다음주 제출
      신규 채용 면접 수요일
    해외 진출
      동남아 시장 조사
      보고서 2주 내 준비
    후속 조치
      팀별 예산안 작성
      면접 일정 확정`,
    };

    state.results = demoResults;
    displayResults(demoResults);
    navigateTo('results');
    showToast('데모 모드로 실행되었습니다.', 'info');
}

// ============= PWA Install Prompt =============
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
});

function initInstallPrompt() {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
        return; // Already running as PWA
    }
}

function showInstallBanner() {
    // Remove existing banner if any
    const existing = document.querySelector('.install-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `
        <div class="install-banner-text">
            <strong>홈 화면에 추가</strong>
            VoiceNote AI를 앱처럼 설치하세요
        </div>
        <button class="btn-primary-sm" id="installBtn">설치</button>
        <button class="icon-btn-sm" id="dismissInstall" aria-label="닫기">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    document.body.appendChild(banner);

    banner.querySelector('#installBtn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            showToast('앱이 설치되었습니다!', 'success');
        }
        deferredPrompt = null;
        banner.remove();
    });

    banner.querySelector('#dismissInstall').addEventListener('click', () => {
        banner.remove();
    });
}

window.addEventListener('appinstalled', () => {
    showToast('VoiceNote AI가 설치되었습니다!', 'success');
    const banner = document.querySelector('.install-banner');
    if (banner) banner.remove();
    deferredPrompt = null;
});
