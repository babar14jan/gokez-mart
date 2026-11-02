const DATABASE_NAME = 'gokez-hub';
const STORE_NAME = 'settings';
const RINGTONE_KEY = 'order-ringtone';
const RINGTONE_ENABLED_KEY = 'order-ringtone-enabled';

let audio: HTMLAudioElement | null = null;
let oscillatorContext: AudioContext | null = null;
let oscillatorTimer: ReturnType<typeof setInterval> | null = null;
let alarmGeneration = 0;
let orderAlarmEnabled: boolean | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRingtone(): Promise<Blob | null> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RINGTONE_KEY);
      request.onsuccess = () => { database.close(); resolve(request.result instanceof Blob ? request.result : null); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
}

async function readSetting(key: string): Promise<unknown> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    return undefined;
  }
}

export async function isOrderAlarmEnabled(): Promise<boolean> {
  if (orderAlarmEnabled !== null) return orderAlarmEnabled;
  orderAlarmEnabled = await readSetting(RINGTONE_ENABLED_KEY) !== false;
  return orderAlarmEnabled;
}

export async function setOrderAlarmEnabled(enabled: boolean): Promise<void> {
  orderAlarmEnabled = enabled;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(enabled, RINGTONE_ENABLED_KEY);
    request.onsuccess = () => { database.close(); resolve(); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function saveOrderRingtone(file: File): Promise<void> {
  if (!file.type.startsWith('audio/')) throw new Error('Choose an audio file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an audio file smaller than 5 MB.');

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(file, RINGTONE_KEY);
    request.onsuccess = () => { database.close(); resolve(); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function clearOrderRingtone(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(RINGTONE_KEY);
    request.onsuccess = () => { database.close(); resolve(); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function hasOrderRingtone(): Promise<boolean> {
  return !!await readRingtone();
}

function playFallbackTone(): void {
  try {
    const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    oscillatorContext ??= new Context();
    const context = oscillatorContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.55);
  } catch {
    // Audio playback can be blocked until a device has received a user gesture.
  }
}

export async function startOrderAlarm(): Promise<void> {
  stopOrderAlarm();
  const generation = ++alarmGeneration;
  if (!await isOrderAlarmEnabled()) return;
  const ringtone = await readRingtone();
  if (generation !== alarmGeneration) return;

  if (ringtone) {
    audio = new Audio(URL.createObjectURL(ringtone));
    audio.loop = true;
    audio.onended = () => URL.revokeObjectURL(audio?.src || '');
    await audio.play().catch(() => { audio = null; playFallbackTone(); });
    return;
  }

  playFallbackTone();
  oscillatorTimer = setInterval(playFallbackTone, 1200);
}

export function stopOrderAlarm(): void {
  alarmGeneration += 1;
  if (oscillatorTimer) clearInterval(oscillatorTimer);
  oscillatorTimer = null;
  if (audio) {
    const source = audio.src;
    audio.pause();
    audio.src = '';
    URL.revokeObjectURL(source);
  }
  audio = null;
}