// Управление: действия, клавиши по умолчанию, проверка и подписи клавиш.
// Привязки хранятся в настройках аккаунта (до двух клавиш на действие, коды KeyboardEvent.code).
// Стрельба и прицел — мышь, цифры в меню покупки и голосования не переназначаются.

export const ACTIONS = [
  { id: 'forward', label: 'Вперёд', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Назад', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Влево', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Вправо', keys: ['KeyD', 'ArrowRight'] },
  { id: 'jump', label: 'Прыжок', keys: ['Space'] },
  { id: 'crouch', label: 'Присесть', keys: ['KeyC', 'ControlLeft'] },
  { id: 'use', label: 'Заложить / обезвредить / подобрать', keys: ['KeyE'] },
  { id: 'reload', label: 'Перезарядка', keys: ['KeyR'] },
  { id: 'drop', label: 'Выбросить оружие', keys: ['KeyG'] },
  { id: 'primary', label: 'Основное оружие', keys: ['Digit1'] },
  { id: 'pistol', label: 'Пистолет', keys: ['Digit2'] },
  { id: 'knife', label: 'Нож', keys: ['Digit3'] },
  { id: 'grenade', label: 'Гранаты (по кругу)', keys: ['Digit4'] },
  { id: 'lastWeapon', label: 'Прошлое оружие', keys: ['KeyQ'] },
  { id: 'buy', label: 'Меню покупки', keys: ['KeyB'] },
  { id: 'team', label: 'Сменить команду', keys: ['KeyM'] },
  { id: 'scoreboard', label: 'Таблица счёта', keys: ['Tab'] },
  { id: 'chat', label: 'Чат', keys: ['Enter', 'KeyT'] },
] as const;

export type Action = (typeof ACTIONS)[number]['id'];
export type Binds = Record<Action, string[]>;

export function defaultBinds(): Binds {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])) as unknown as Binds;
}

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;
/** Клавиши, которые нельзя занимать: Esc — пауза и выход из меню. */
const RESERVED = new Set(['Escape']);

/** Сервер и клиент: оставить только известные действия и разумные коды; пропущенное — по умолчанию. */
export function sanitizeBinds(b: unknown): Binds {
  const out = defaultBinds();
  if (!b || typeof b !== 'object') return out;
  const used = new Set<string>();
  for (const a of ACTIONS) {
    const v = (b as Record<string, unknown>)[a.id];
    if (!Array.isArray(v)) continue;
    const keys = v.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c) && !RESERVED.has(c) && !used.has(c)).slice(0, 2);
    keys.forEach((c) => used.add(c));
    out[a.id] = keys;
  }
  return out;
}

/** Подпись клавиши для интерфейса. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const names: Record<string, string> = {
    Space: 'Пробел',
    ControlLeft: 'Ctrl',
    ControlRight: 'Правый Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Правый Shift',
    AltLeft: 'Alt',
    AltRight: 'Правый Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Tab: 'Tab',
    Backquote: '`',
    CapsLock: 'Caps Lock',
    Backspace: 'Backspace',
  };
  return names[code] ?? code;
}
