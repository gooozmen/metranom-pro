let audioCtx = null;
let nextNoteTime = 0.0;
let timerId = null;
let isPlaying = false;

const tempoInput = document.getElementById('tempoInput');
const tempoSlider = document.getElementById('tempoSlider');
const startStopBtn = document.getElementById('startStopBtn');
const addMeasureBtn = document.getElementById('addMeasureBtn');
const timeSignatureQueue = document.getElementById('timeSignatureQueue');
const accentAudioElement = document.getElementById('accentSound');
const soundSetSelect = document.getElementById('soundSetSelect');
const beatIndicatorContainer = document.getElementById('beatIndicatorContainer');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const accentOnFirstCheckbox = document.getElementById('accentOnFirst');

let accentBuffer = null;
let clickBuffer = null;

// Очередь для синхронизации визуальной разметки с аудиопотоком
let notesInQueue = [];

function setTempoValue(value) {
    let tempo = parseInt(value);
    if (isNaN(tempo) || tempo < 20) {
        tempo = 20;
    } else if (tempo > 500) {
        tempo = 500;
    }
    tempoInput.value = tempo;
    tempoSlider.value = tempo;
}

function syncSliderToInput() {
    let tempo = parseInt(tempoInput.value);
    if (!isNaN(tempo) && tempo >= 20 && tempo <= 500) {
        tempoSlider.value = tempo;
    }
}

function syncTempoFromSlider() {
    tempoInput.value = tempoSlider.value;
}

tempoInput.addEventListener('input', syncSliderToInput);
tempoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') setTempoValue(tempoInput.value);
});
tempoInput.addEventListener('blur', () => setTempoValue(tempoInput.value));
tempoSlider.addEventListener('input', syncTempoFromSlider);
tempoSlider.addEventListener('change', syncTempoFromSlider);

async function loadSound() {
    if (!audioCtx) return;
    if (clickBuffer && accentBuffer) return;

    function getSoundSrcs() {
        const set = (soundSetSelect && soundSetSelect.value) || 'acoustic';
        if (set === 'electronic') {
            return { click: 'sepls/electronic/click.mp3', accent: 'sepls/electronic/accent.mp3' };
        }
        return { click: document.getElementById('clickSound').src, accent: accentAudioElement.src };
    }

    const { click: clickSrc, accent: accentSrc } = getSoundSrcs();

    try {
        const clickResponse = await fetch(clickSrc);
        if (!clickResponse.ok) throw new Error(`Ошибка сети: ${clickResponse.status}`);
        const clickArray = await clickResponse.arrayBuffer();
        clickBuffer = await audioCtx.decodeAudioData(clickArray);

        const accentResponse = await fetch(accentSrc);
        if (!accentResponse.ok) throw new Error(`Ошибка сети: ${accentResponse.status}`);
        const accentArray = await accentResponse.arrayBuffer();
        accentBuffer = await audioCtx.decodeAudioData(accentArray);
    } catch (error) {
        console.error('Не удалось загрузить аудио:', error);
        startStopBtn.textContent = 'Start Metronome';
        isPlaying = false;
    }
}

if (soundSetSelect) {
    soundSetSelect.addEventListener('change', () => {
        clickBuffer = null;
        accentBuffer = null;
        if (audioCtx && isPlaying) {
            loadSound();
        }
    });
}

const timeSignatureQueueState = {
    measures: [],
    currentIndex: 0,
    currentBeat: 1,
};

function createMeasure(steps = 4, unit = 4) {
    return { steps, unit };
}

function getSecondsPerBeat(unit) {
    const tempo = parseInt(tempoInput.value) || 120;
    const baseSeconds = 60.0 / tempo;
    if (unit === 4) return baseSeconds;
    if (unit === 8) return baseSeconds / 2;
    if (unit === 16) return baseSeconds / 4;
    return baseSeconds;
}

function scheduleAudioNote(time, isAccent) {
    const buffer = isAccent ? accentBuffer : clickBuffer;
    if (!buffer) return;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(time);
}

function advanceMeasureState() {
    const measure = timeSignatureQueueState.measures[timeSignatureQueueState.currentIndex];
    if (!measure) return;

    if (timeSignatureQueueState.currentBeat >= measure.steps) {
        timeSignatureQueueState.currentBeat = 1;
        timeSignatureQueueState.currentIndex = (timeSignatureQueueState.currentIndex + 1) % timeSignatureQueueState.measures.length;
    } else {
        timeSignatureQueueState.currentBeat += 1;
    }
}

function nextNote() {
    const measure = timeSignatureQueueState.measures[timeSignatureQueueState.currentIndex];
    if (!measure) return;
    const secondsPerBeat = getSecondsPerBeat(measure.unit);
    nextNoteTime += secondsPerBeat;
}

function scheduleNote(time) {
    const measure = timeSignatureQueueState.measures[timeSignatureQueueState.currentIndex];
    if (!measure) return;

    const accentEnabled = accentOnFirstCheckbox ? accentOnFirstCheckbox.checked : true;
    const isAccent = accentEnabled && timeSignatureQueueState.currentBeat === 1;
    
    // Сохраняем информацию о планируемой ноте для анимации интерфейса
    notesInQueue.push({
        time: time,
        beat: timeSignatureQueueState.currentBeat,
        measureIndex: timeSignatureQueueState.currentIndex,
        totalSteps: measure.steps
    });

    scheduleAudioNote(time, isAccent);
    advanceMeasureState();
}

function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        scheduleNote(nextNoteTime);
        nextNote();
    }
    timerId = setTimeout(scheduler, 25);
}

// Перерисовка визуальных точек (привязанная к частоте монитора)
function drawVisuals() {
    if (!isPlaying) return;

    const currentTime = audioCtx.currentTime;

    // Ищем ноты, время которых уже пришло
    while (notesInQueue.length > 0 && notesInQueue[0].time <= currentTime) {
        const activeNote = notesInQueue.shift();
        
        // 1. Переключаем зеленую рамку у текущего такта
        updateMeasureHighlights(activeNote.measureIndex);

        // 2. Обновляем/перерисовываем красные точки под текущий такт
        renderBeatDots(activeNote.totalSteps, activeNote.beat);
    }

    requestAnimationFrame(drawVisuals);
}

function renderBeatDots(totalSteps, activeBeat) {
    beatIndicatorContainer.innerHTML = '';
    for (let i = 1; i <= totalSteps; i++) {
        const dot = document.createElement('div');
        dot.className = 'beat-dot';
        if (activeBeat && i === activeBeat) {
            dot.classList.add(i === 1 ? 'accent-active' : 'active');
        }
        beatIndicatorContainer.appendChild(dot);
    }
}

function renderDefaultBeatDots() {
    const firstMeasure = timeSignatureQueueState.measures[0] || createMeasure(4, 4);
    const activeBeat = isPlaying ? timeSignatureQueueState.currentBeat : 1;
    renderBeatDots(firstMeasure.steps, activeBeat);
}

function renderStoppedBeatDots() {
    const firstMeasure = timeSignatureQueueState.measures[0] || createMeasure(4, 4);
    renderBeatDots(firstMeasure.steps, 1);
}

startStopBtn.addEventListener('click', async () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    if (!clickBuffer || !accentBuffer) {
        startStopBtn.textContent = 'Loading...';
        await loadSound();
        if (!clickBuffer || !accentBuffer) return; 
    }
    if (timeSignatureQueueState.measures.length === 0) {
        timeSignatureQueueState.measures.push(createMeasure(4, 4));
        renderQueue();
    }

    if (isPlaying) {
        clearTimeout(timerId);
        isPlaying = false;
        notesInQueue = [];
        startStopBtn.classList.remove('playing');
        startStopBtn.textContent = 'Start Metronome';
        updateMeasureHighlights(-1); // Убираем зеленую подсветку при стопе
        renderStoppedBeatDots();
    } else {
        isPlaying = true;
        startStopBtn.classList.add('playing');
        startStopBtn.textContent = 'Stop Metronome';
        timeSignatureQueueState.currentIndex = 0;
        timeSignatureQueueState.currentBeat = 1;
        updateMeasureHighlights(0);
        nextNoteTime = audioCtx.currentTime;
        scheduler();
        requestAnimationFrame(drawVisuals);
    }
});

addMeasureBtn.addEventListener('click', () => {
    timeSignatureQueueState.measures.push(createMeasure(4, 4));
    renderQueue();
    if (!isPlaying) renderStoppedBeatDots();
});

function updateMeasureHighlights(activeIndex) {
    const cards = timeSignatureQueue.querySelectorAll('.measure-card');
    cards.forEach((card, index) => {
        card.classList.toggle('active', index === activeIndex);
    });
}

function removeMeasure(index) {
    timeSignatureQueueState.measures.splice(index, 1);
    if (timeSignatureQueueState.currentIndex >= timeSignatureQueueState.measures.length) {
        timeSignatureQueueState.currentIndex = 0;
        timeSignatureQueueState.currentBeat = 1;
    }
    renderQueue();
    if (!isPlaying) renderStoppedBeatDots();
}

function renderQueue() {
    timeSignatureQueue.innerHTML = '';
    timeSignatureQueueState.measures.forEach((measure, index) => {
        const card = document.createElement('div');
        card.className = 'measure-card';
        // compact visual: [beats] / [unit]
        const display = document.createElement('div');
        display.className = 'measure-display';

        const topSelect = document.createElement('select');
        [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            option.selected = value === measure.steps;
            topSelect.appendChild(option);
        });
        topSelect.addEventListener('change', () => {
            measure.steps = parseInt(topSelect.value);
            if (!isPlaying) renderStoppedBeatDots();
        });

        const slash = document.createElement('span');
        slash.className = 'slash';
        slash.textContent = '/';

        const bottomSelect = document.createElement('select');
        [4,8,16].forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            option.selected = value === measure.unit;
            bottomSelect.appendChild(option);
        });
        bottomSelect.addEventListener('change', () => {
            measure.unit = parseInt(bottomSelect.value);
            if (!isPlaying) renderStoppedBeatDots();
        });

        display.appendChild(topSelect);
        display.appendChild(slash);
        display.appendChild(bottomSelect);

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-measure-btn';
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => removeMeasure(index));

        card.appendChild(display);
        card.appendChild(removeButton);
        timeSignatureQueue.appendChild(card);
    });
}

// Инициализация первой карточки
timeSignatureQueueState.measures.push(createMeasure(4, 4));
renderQueue();
renderStoppedBeatDots();

// --- ЛОГИКА КНОПКИ TAP ---
const tapBtn = document.getElementById('tapBtn');
let tapTimes = [];

tapBtn.addEventListener('click', async () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const currentTime = Date.now();
    if (tapTimes.length > 0 && currentTime - tapTimes[tapTimes.length - 1] > 2000) {
        tapTimes = [];
    }
    tapTimes.push(currentTime);

    if (tapTimes.length > 1) {
        if (tapTimes.length > 4) tapTimes.shift();
        let intervals = [];
        for (let i = 1; i < tapTimes.length; i++) {
            intervals.push(tapTimes[i] - tapTimes[i - 1]);
        }
        const averageInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
        let calculatedBpm = Math.round(60000 / averageInterval);

        if (calculatedBpm < 20) calculatedBpm = 20;
        if (calculatedBpm > 500) calculatedBpm = 500;
        setTempoValue(calculatedBpm);
    }
});

// --- ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ ---
themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
});

themeToggleBtn.textContent = document.body.classList.contains('dark-theme') ? '☀️' : '🌙';