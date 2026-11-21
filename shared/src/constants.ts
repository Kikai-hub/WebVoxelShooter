// Общие константы симуляции: одинаковы на сервере и в клиенте.

export const TICK_RATE = 64;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 30;
export const INTERP_DELAY = 0.1; // секунды
export const MAX_LAG_COMP_TICKS = 13; // ~200 мс
export const HISTORY_TICKS = 32;

export type Team = 0 | 1;
export const TEAM_T: Team = 0; // нападающие
export const TEAM_CT: Team = 1; // защитники
export const TEAM_NAMES = ['Нападение', 'Защита'] as const;
export const TEAM_SIZE = 5;
export const MAX_PLAYERS = TEAM_SIZE * 2;
export const MAX_SPECTATORS = 20;

// Раунд
export const FREEZE_TIME = 10;
export const ROUND_TIME = 115;
export const BUY_TIME = 20; // после окончания заморозки
export const BOMB_TIMER = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 10;
export const DEFUSE_RANGE = 1.6;
export const ROUND_END_TIME = 6;
export const MATCH_END_TIME = 20;
export const VOTE_TIME = 20;
export const WIN_ROUNDS = 7;
export const HALF_ROUNDS = 6;
export const RECONNECT_HOLD = 60;

// Экономика
export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_BONUS_STEP = 500;
export const LOSS_REWARD_MAX = 3400;
export const PLANT_REWARD = 800;
export const ARMOR_PRICE = 650;
export const HELMET_PRICE = 1000; // броня + шлем

// Движение игрока (метры, секунды)
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.3;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.12;
export const RUN_SPEED = 5.2;
export const CROUCH_SPEED = 2.2;
export const GRAVITY = 20;
export const JUMP_VELOCITY = 7.1;
export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 1.5;
export const FRICTION = 8;
export const MAX_FALL_SPEED = 28;

// Раны
export const HEAD_EXPLODE_CHANCE = 0.4;
export const MAX_WOUNDS = 60;

// Кнопки UserCmd
export const BTN_FWD = 1;
export const BTN_BACK = 2;
export const BTN_LEFT = 4;
export const BTN_RIGHT = 8;
export const BTN_JUMP = 16;
export const BTN_CROUCH = 32;
export const BTN_FIRE = 64;
export const BTN_USE = 128;
export const BTN_RELOAD = 256;
