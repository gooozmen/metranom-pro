let audioCtx = null;
let timerId = null;
let isPlaying = false;
let layerCounter = 0;

const tempoInput = document.getElementById('tempoInput');
const tempoSlider = document.getElementById('tempoSlider');
const startStopBtn = document.getElementById('startStopBtn');
const layersContainer = document.getElementById('layersContainer');
const soundSetSelect = document.getElementById('soundSetSelect');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const accentOnFirstCheckbox = document.getElementById('accentOnFirst');

const state = {
    layers: [],
};

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

// Слой метронома — своя очередь тактов, своя позиция в такте, опциональные
// переопределения темпа/звука/акцента (contracts.md: Layer).
function createLayer(tempoOverride = null) {
    layerCounter += 1;
    return {
        id: `layer-${layerCounter}`,
        measures: [{ steps: 4, unit: 4 }],
        currentIndex: 0,
        currentBeat: 1,
        tempoOverride,
        soundSetOverride: null,
        accentOverride: null,
        nextNoteTime: 0,
        notesInQueue: [],
        clickBuffer: null,
        accentBuffer: null,
    };
}

function getEffectiveTempo(layer) {
    return layer.tempoOverride ?? (parseInt(tempoInput.value) || 120);
}

function getEffectiveSoundSet(layer) {
    return layer.soundSetOverride ?? ((soundSetSelect && soundSetSelect.value) || 'acoustic');
}

function getEffectiveAccent(layer) {
    return layer.accentOverride ?? (accentOnFirstCheckbox ? accentOnFirstCheckbox.checked : true);
}

function getSecondsPerBeat(unit, tempo) {
    const baseSeconds = 60.0 / tempo;
    if (unit === 8) return baseSeconds / 2;
    if (unit === 16) return baseSeconds / 4;
    return baseSeconds;
}

async function loadLayerSound(layer) {
    if (!audioCtx) return;
    if (layer.clickBuffer && layer.accentBuffer) return;

    const set = getEffectiveSoundSet(layer);
    const clickSrc = `sepls/${set}/click.mp3`;
    const accentSrc = `sepls/${set}/accent.mp3`;

    try {
        const clickResponse = await fetch(clickSrc);
        if (!clickResponse.ok) throw new Error(`Ошибка сети: ${clickResponse.status}`);
        layer.clickBuffer = await audioCtx.decodeAudioData(await clickResponse.arrayBuffer());

        const accentResponse = await fetch(accentSrc);
        if (!accentResponse.ok) throw new Error(`Ошибка сети: ${accentResponse.status}`);
        layer.accentBuffer = await audioCtx.decodeAudioData(await accentResponse.arrayBuffer());
    } catch (error) {
        // Один сломанный слой не должен глушить остальные (contracts.md: таблица «Ошибки»).
        console.error(`Не удалось загрузить аудио для слоя ${layer.id}:`, error);
    }
}

function scheduleAudioNote(buffer, time) {
    if (!buffer) return;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(time);
}

function advanceLayerMeasureState(layer) {
    const measure = layer.measures[layer.currentIndex];
    if (!measure) return;

    if (layer.currentBeat >= measure.steps) {
        layer.currentBeat = 1;
        layer.currentIndex = (layer.currentIndex + 1) % layer.measures.length;
    } else {
        layer.currentBeat += 1;
    }
}

function nextLayerNote(layer) {
    const measure = layer.measures[layer.currentIndex];
    if (!measure) return;
    layer.nextNoteTime += getSecondsPerBeat(measure.unit, getEffectiveTempo(layer));
}

function scheduleLayerNote(layer, time) {
    const measure = layer.measures[layer.currentIndex];
    if (!measure) return;

    const isAccent = getEffectiveAccent(layer) && layer.currentBeat === 1;

    layer.notesInQueue.push({
        time,
        beat: layer.currentBeat,
        measureIndex: layer.currentIndex,
        totalSteps: measure.steps,
    });

    scheduleAudioNote(isAccent ? layer.accentBuffer : layer.clickBuffer, time);
    advanceLayerMeasureState(layer);
}

// Один цикл на все слои: каждый тик досчитывает ноты каждого слоя до его
// собственного nextNoteTime (contracts.md: scheduler — единый setTimeout-луп).
function scheduler() {
    for (const layer of state.layers) {
        while (layer.nextNoteTime < audioCtx.currentTime + 0.1) {
            scheduleLayerNote(layer, layer.nextNoteTime);
            nextLayerNote(layer);
        }
    }
    timerId = setTimeout(scheduler, 25);
}

function renderBeatDots(container, totalSteps, activeBeat) {
    container.innerHTML = '';
    for (let i = 1; i <= totalSteps; i++) {
        const dot = document.createElement('div');
        dot.className = 'beat-dot';
        if (activeBeat && i === activeBeat) {
            dot.classList.add(i === 1 ? 'accent-active' : 'active');
        }
        container.appendChild(dot);
    }
}

function drawVisuals() {
    if (!isPlaying) return;

    const currentTime = audioCtx.currentTime;

    for (const layer of state.layers) {
        const dotsEl = layersContainer.querySelector(`.layer-tile[data-layer-id="${layer.id}"] .beat-indicator-container`);
        while (layer.notesInQueue.length > 0 && layer.notesInQueue[0].time <= currentTime) {
            const activeNote = layer.notesInQueue.shift();
            if (dotsEl) renderBeatDots(dotsEl, activeNote.totalSteps, activeNote.beat);
        }
    }

    requestAnimationFrame(drawVisuals);
}

// Точки-доли слоя в покое всегда отражают первый такт слоя — так же вело себя
// исходное однослойное приложение (renderStoppedBeatDots на measures[0]).
function renderRestBeatDots(layer) {
    const dotsEl = layersContainer.querySelector(`.layer-tile[data-layer-id="${layer.id}"] .beat-indicator-container`);
    if (!dotsEl) return;
    const firstMeasure = layer.measures[0] || { steps: 4, unit: 4 };
    renderBeatDots(dotsEl, firstMeasure.steps, isPlaying ? layer.currentBeat : 1);
}

function createMeasureCardElement(layer, measure, index) {
    const card = document.createElement('div');
    card.className = 'measure-card';

    const display = document.createElement('div');
    display.className = 'measure-display';

    const topSelect = document.createElement('select');
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === measure.steps;
        topSelect.appendChild(option);
    });
    topSelect.addEventListener('change', () => {
        measure.steps = parseInt(topSelect.value);
        if (index === 0) renderRestBeatDots(layer);
    });

    const slash = document.createElement('span');
    slash.className = 'slash';
    slash.textContent = '/';

    const bottomSelect = document.createElement('select');
    [4, 8, 16].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === measure.unit;
        bottomSelect.appendChild(option);
    });
    bottomSelect.addEventListener('change', () => {
        measure.unit = parseInt(bottomSelect.value);
    });

    display.appendChild(topSelect);
    display.appendChild(slash);
    display.appendChild(bottomSelect);

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-measure-btn';
    removeButton.textContent = '×';
    removeButton.title = 'Убрать такт';
    removeButton.addEventListener('click', () => {
        layer.measures.splice(index, 1);
        renderLayers();
    });

    card.appendChild(display);
    card.appendChild(removeButton);
    return card;
}

function renderLayerTile(layer) {
    const tile = document.createElement('div');
    tile.className = 'layer-tile';
    tile.dataset.layerId = layer.id;

    const header = document.createElement('div');
    header.className = 'layer-header';

    // Переопределение темпа временно не выведено в UI — поле layer.tempoOverride
    // в модели остаётся, просто нет элементов управления им на подложке.
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = 'Слой';

    const removeLayerBtn = document.createElement('button');
    removeLayerBtn.className = 'layer-remove-btn';
    removeLayerBtn.textContent = '×';
    removeLayerBtn.title = 'Удалить слой';
    removeLayerBtn.addEventListener('click', () => {
        // Ждём анимацию закрытия тайла и только потом убираем слой из данных —
        // иначе полный ререндер выдернет узел из DOM раньше, чем он успеет анимироваться.
        tile.classList.add('layer-tile--exiting');
        tile.addEventListener('animationend', () => {
            state.layers = state.layers.filter(l => l.id !== layer.id);
            renderLayers();
        }, { once: true });
    });

    header.appendChild(name);
    header.appendChild(removeLayerBtn);

    const dots = document.createElement('div');
    dots.className = 'beat-indicator-container';
    const firstMeasure = layer.measures[0] || { steps: 4, unit: 4 };
    renderBeatDots(dots, firstMeasure.steps, isPlaying ? layer.currentBeat : 1);

    const queueRow = document.createElement('div');
    queueRow.className = 'queue-section layer-queue-row';

    const queue = document.createElement('div');
    queue.className = 'time-signature-queue';
    layer.measures.forEach((measure, index) => {
        queue.appendChild(createMeasureCardElement(layer, measure, index));
    });

    const addMeasureBtn = document.createElement('button');
    addMeasureBtn.className = 'add-measure-btn';
    addMeasureBtn.title = 'Добавить такт';
    addMeasureBtn.textContent = '+';
    addMeasureBtn.addEventListener('click', () => {
        layer.measures.push({ steps: 4, unit: 4 });
        renderLayers();
    });

    queueRow.appendChild(queue);
    queueRow.appendChild(addMeasureBtn);

    tile.appendChild(header);
    tile.appendChild(dots);
    tile.appendChild(queueRow);
    return tile;
}

const MAX_LAYERS = 4;

// Раскладка тайлов задаётся классом tiles-N (грид-шаблоны — в styles.css).
// justAddedId помечает ровно один свежесозданный тайл — только он анимированно
// появляется; остальные при полном ререндере не должны переигрывать анимацию входа.
function renderLayers(justAddedId = null) {
    layersContainer.className = `layers-container tiles-${state.layers.length}`;
    layersContainer.innerHTML = '';
    state.layers.forEach(layer => {
        const tile = renderLayerTile(layer);
        if (layer.id === justAddedId) {
            tile.classList.add('layer-tile--entering');
            tile.addEventListener('animationend', () => {
                tile.classList.remove('layer-tile--entering');
            }, { once: true });
        }
        layersContainer.appendChild(tile);
    });
    addLayerBtn.disabled = state.layers.length >= MAX_LAYERS;
}

const addLayerBtn = document.getElementById('addLayerBtn');
addLayerBtn.addEventListener('click', () => {
    if (state.layers.length >= MAX_LAYERS) return;
    const layer = createLayer();
    state.layers.push(layer);
    if (audioCtx && isPlaying) {
        layer.nextNoteTime = audioCtx.currentTime;
        loadLayerSound(layer);
    }
    renderLayers(layer.id);
});

state.layers.push(createLayer());
state.layers.push(createLayer());
renderLayers();

startStopBtn.addEventListener('click', async () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    if (!isPlaying) {
        startStopBtn.textContent = 'Loading...';
        await Promise.all(state.layers.map(loadLayerSound));
    }

    if (isPlaying) {
        clearTimeout(timerId);
        isPlaying = false;
        state.layers.forEach(layer => { layer.notesInQueue = []; });
        startStopBtn.classList.remove('playing');
        startStopBtn.textContent = 'Start Metronome';
        renderLayers();
    } else {
        isPlaying = true;
        startStopBtn.classList.add('playing');
        startStopBtn.textContent = 'Stop Metronome';

        const t0 = audioCtx.currentTime;
        state.layers.forEach(layer => {
            layer.currentIndex = 0;
            layer.currentBeat = 1;
            layer.nextNoteTime = t0;
        });

        scheduler();
        requestAnimationFrame(drawVisuals);
    }
});

if (soundSetSelect) {
    soundSetSelect.addEventListener('change', () => {
        state.layers.forEach(layer => {
            if (!layer.soundSetOverride) {
                layer.clickBuffer = null;
                layer.accentBuffer = null;
            }
        });
        if (audioCtx && isPlaying) {
            state.layers.forEach(loadLayerSound);
        }
    });
}

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
