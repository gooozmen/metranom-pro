# Контракты

Ванильный JS без типизации — формы описаны как объектные литералы/JSDoc-комментарии.
Реализации нет: тела функций — `{ /* TODO */ }` или явный no-op.

## Модели данных

```js
// Такт — без изменений от текущего кода.
// Measure = { steps: number, unit: 4 | 8 | 16 }

// Нота, запланированная для визуальной синхронизации — без изменений.
// ScheduledNote = {
//   time: number,          // AudioContext.currentTime, когда нота звучит
//   beat: number,          // 1-based номер доли внутри такта
//   measureIndex: number,  // индекс такта в measures слоя на момент планирования
//   totalSteps: number,    // steps того такта (для отрисовки точек)
// }

// Слой — новая сущность, один на подложку.
// Layer = {
//   id: string,                          // стабильный id, "layer-<n>", не переиспользуется
//   measures: Measure[],                 // очередь тактов слоя; минимум 1 при Play (см. ниже)
//   currentIndex: number,                // индекс активного такта в measures
//   currentBeat: number,                 // текущая доля активного такта, 1-based
//   tempoOverride: number | null,        // BPM 20..500; null = наследовать globalTempo
//   soundSetOverride: 'acoustic' | 'electronic' | null,  // null = наследовать globalSoundSet
//   accentOverride: boolean | null,      // null = наследовать globalAccentOnFirst
//   nextNoteTime: number,                // AudioContext.currentTime следующей ноты этого слоя
//   notesInQueue: ScheduledNote[],       // очередь визуальной синхронизации этого слоя
//   clickBuffer: AudioBuffer | null,     // буфер клика под эффективный sound set
//   accentBuffer: AudioBuffer | null,    // буфер акцента под эффективный sound set
// }

// Глобальное состояние приложения — заменяет текущий плоский набор глобальных переменных.
// AppState = {
//   layers: Layer[],                     // порядок = порядок в тайлинг-раскладке
//   globalTempo: number,                 // из #tempoInput/#tempoSlider, 20..500
//   globalSoundSet: 'acoustic' | 'electronic',  // из #soundSetSelect
//   globalAccentOnFirst: boolean,        // из #accentOnFirst
//   isPlaying: boolean,
//   audioCtx: AudioContext | null,
//   timerId: number | null,              // id единственного setTimeout-цикла на все слои
// }
```

## Публичные сигнатуры

```js
// Создаёт новый слой: один такт 4/4, все override = null, буферы = null.
function createLayer() { /* -> Layer */ }

// Убирает слой из state.layers по id. Если слоёв становится 0 — состояние допускает
// пустой layers[] (аналогично текущему допуску пустого measures[] в состоянии покоя).
function removeLayer(layerId) { /* -> void */ }

// Меняет местами позиции двух слоёв в state.layers (тайл-своп), данные слоёв не трогает.
function swapLayers(layerIdA, layerIdB) { /* -> void */ }

// Эффективные значения слоя: собственный override, если задан, иначе глобальное значение.
function getEffectiveTempo(layer) { /* -> number, layer.tempoOverride ?? state.globalTempo */ }
function getEffectiveSoundSet(layer) { /* -> 'acoustic'|'electronic' */ }
function getEffectiveAccent(layer) { /* -> boolean */ }

// Секунды на долю для данных темпа/юнита. Принимает tempo явным параметром
// (раньше читала глобальный tempoInput напрямую — теперь у каждого слоя свой эффективный темп).
function getSecondsPerBeat(unit, tempo) { /* -> number */ }

// Аналоги текущих scheduleNote/nextNote/advanceMeasureState, но параметризованы слоем.
function scheduleLayerNote(layer, time) { /* -> void, пушит в layer.notesInQueue, планирует audio */ }
function nextLayerNote(layer) { /* -> void, layer.nextNoteTime += getSecondsPerBeat(...) */ }
function advanceLayerMeasureState(layer) { /* -> void, продвигает layer.currentIndex/currentBeat */ }

// Единый цикл на все слои (было — на весь метроном, остаётся один setTimeout-луп,
// но с внутренним циклом по state.layers).
function scheduler() {
  /* for (const layer of state.layers) {
       while (layer.nextNoteTime < state.audioCtx.currentTime + 0.1) {
         scheduleLayerNote(layer, layer.nextNoteTime);
         nextLayerNote(layer);
       }
     }
     state.timerId = setTimeout(scheduler, 25); */
}

// Отрисовка — проходит по всем слоям, каждый обновляет свою подложку независимо.
function drawVisuals() { /* -> void, requestAnimationFrame loop, как сейчас, но per-layer */ }

// Догружает буферы под эффективный sound set слоя. Не трогает буферы других слоёв.
async function loadLayerSound(layer) { /* -> Promise<void> */ }

// Рендер одной подложки (UI): такты, точки долей, controls переопределения, кнопки.
function renderLayerTile(layer) { /* -> HTMLElement, DOM-узел .layer-tile */ }

// Рендер всей области слоёв (тайлинг-контейнер + все подложки + кнопка добавления слоя).
function renderLayers() { /* -> void */ }
```

## Хранилище
Нет постоянного хранилища — пресеты между сессиями не сохраняются (non-goal, см. `brief.md`).
Всё состояние живёт в памяти вкладки и теряется при перезагрузке страницы. Идентичность
слоя — `Layer.id`, генерируется при создании (`layer-<инкрементный счётчик>`), не переиспользуется
после удаления слоя.

## Схемы ответов источника
Не меняются: только локальные `.mp3` через `fetch()` + `decodeAudioData()`, как в текущем коде.

## Конфигурация
| Параметр | Тип | Дефолт | Откуда | Смысл |
|---|---|---|---|---|
| `globalTempo` | number 20–500 | 120 | `#tempoInput` / `#tempoSlider` | базовый BPM для слоёв без переопределения |
| `globalSoundSet` | 'acoustic'\|'electronic' | 'acoustic' | `#soundSetSelect` | базовый набор звука |
| `globalAccentOnFirst` | boolean | true | `#accentOnFirst` | базовый акцент на первую долю |
| `layer.tempoOverride` | number 20–500 \| null | null | UI подложки (toggle + input) | переопределение темпа слоя |
| `layer.soundSetOverride` | 'acoustic'\|'electronic'\|null | null | UI подложки (toggle + select) | переопределение звука слоя |
| `layer.accentOverride` | boolean \| null | null | UI подложки (toggle + checkbox) | переопределение акцента слоя |

## Секреты и окружение
Нет — статический сайт без бэкенда, ключей и переменных окружения.

## Ошибки
| Ситуация | Когда | Что делает код |
|---|---|---|
| Не удалось загрузить аудио для слоя (`fetch`/`decodeAudioData` упал) | при старте Play или смене sound-override слоя | `console.error`, `layer.clickBuffer`/`accentBuffer` остаются `null`, `scheduleLayerNote` для этого слоя не планирует audio (visual продолжает идти) — остальные слои продолжают звучать. Решение осознанное: один сломанный слой не должен глушить весь метроном, в отличие от текущего однослойного поведения (там ошибка глушит всё, слоёв тогда не было). |
| `removeLayer` вызван с несуществующим `layerId` | гонка кликов (двойной клик по удалению) | no-op, `layers` не меняется |
| `swapLayers` вызван с одинаковым `layerIdA === layerIdB` | drag сам на себя | no-op |
| `layers.length === 0` и нажат Play | пользователь удалил все слои | `createLayer()` вызывается автоматически перед стартом (аналог текущего автосоздания такта при пустой очереди) |
