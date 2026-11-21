// Где гибнут стороны и где застревают боты: npx tsx tools/zones.ts <карта>
import { Room } from '../server/src/room';
import { zoneName } from '../shared/src/index';
const mapId = process.argv[2] ?? 'caravan';
const room = new Room('medium', 20, mapId); room.lockMap = mapId;
const byZone: Record<string, [number, number]> = {};
const orig = room.damage.bind(room);
(room as any).damage = (v: any, a: any, dmg: number, part: number, ...rest: any[]) => {
  const was = v.alive; const r = (orig as any)(v, a, dmg, part, ...rest);
  if (was && !v.alive) { const z = zoneName(room.info, v.st.x, v.st.z) || 'прочее'; byZone[z] ??= [0, 0]; byZone[z][v.team]++; }
  return r;
};
const stuck: Record<string, number> = {};
let last = 0;
while (room.stats.matches < 12) { room.step(); if (room.stats.stuck !== last) { last = room.stats.stuck; for (const p of room.players) { const b: any = p.bot; if (b && b.stuckCount > 0 && b.stuckAt === room.time) { const k = Math.round(p.st.x) + ',' + Math.round(p.st.z); stuck[k] = (stuck[k] ?? 0) + 1; } } } }
console.log('гибель [нападение, защита]'); console.table(byZone);
console.log('застревания:', Object.entries(stuck).sort((a, b) => b[1] - a[1]).slice(0, 10));
